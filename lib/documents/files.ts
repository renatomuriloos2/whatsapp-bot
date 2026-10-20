import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadFile } from "@/lib/onedrive/graph";
import { downloadGdriveOriginal } from "@/lib/sources/gdrive";
import { allowedLevels } from "@/lib/ai/models";
import { AccessLevel } from "@/types/database";

// Archivos originales de la base de conocimiento, para enviarlos por
// WhatsApp cuando un cliente los pide. Se pueden enviar los de carpetas de
// Google Drive / OneDrive y los subidos desde el portal (guardados en el
// bucket "documentos" de Supabase Storage). Las páginas de sitios web no.

export const STORAGE_BUCKET = "documentos";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/plain",
  md: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function mimeFromName(name: string): string {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

interface DocRow {
  id: string;
  title: string;
  file_name: string | null;
  storage_path: string | null;
  external_id: string | null;
  access_level: AccessLevel;
  company_id: string | null;
  active: boolean;
  kb_sources: { provider: string; drive_id: string } | null;
}

const DOC_FIELDS =
  "id, title, file_name, storage_path, external_id, access_level, company_id, active, kb_sources(provider, drive_id)";

function hasFile(d: DocRow): boolean {
  if (d.storage_path) return true;
  const provider = d.kb_sources?.provider;
  return Boolean(d.external_id && (provider === "gdrive" || provider === "onedrive"));
}

export interface DocumentMeta {
  sendable: boolean;
  summary: string | null;
  docType: string | null;
  /** Enlace al original (Drive / OneDrive), si existe. */
  url: string | null;
}

/** Ficha breve de cada documento (para mostrarle al modelo una sola vez). */
export async function documentMeta(admin: SupabaseClient, ids: string[]): Promise<Map<string, DocumentMeta>> {
  const out = new Map<string, DocumentMeta>();
  if (ids.length === 0) return out;
  const { data, error } = await admin
    .from("kb_documents")
    .select(`${DOC_FIELDS}, summary, doc_type, external_url`)
    .in("id", ids);
  // Sin la migración 008 las columnas nuevas no existen: se usa lo básico.
  const rows = (error
    ? (await admin.from("kb_documents").select(DOC_FIELDS).in("id", ids)).data
    : data) as unknown as (DocRow & { summary?: string; doc_type?: string; external_url?: string })[] | null;
  for (const d of rows ?? []) {
    out.set(d.id, {
      sendable: hasFile(d),
      summary: d.summary ?? null,
      docType: d.doc_type ?? null,
      url: d.external_url ?? null,
    });
  }
  return out;
}

/** De estos documentos, cuáles tienen un archivo que se puede enviar. */
export async function sendableDocumentIds(admin: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await admin.from("kb_documents").select(DOC_FIELDS).in("id", ids);
  return new Set(((data ?? []) as unknown as DocRow[]).filter(hasFile).map((d) => d.id));
}

export interface SendableDocument {
  id: string;
  title: string;
}

/**
 * Busca el documento verificando que el contacto tenga acceso (mismo filtro
 * que la búsqueda): el modelo solo elige el id, el permiso lo decide el sistema.
 */
export async function findSendableDocument(
  admin: SupabaseClient,
  id: string,
  level: AccessLevel,
  companyId: string | null
): Promise<SendableDocument | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("kb_documents").select(DOC_FIELDS).eq("id", id).maybeSingle();
  const doc = data as unknown as DocRow | null;
  if (!doc || !doc.active || !hasFile(doc)) return null;
  if (!allowedLevels(level).includes(doc.access_level)) return null;
  if (doc.company_id && doc.company_id !== companyId) return null;
  return { id: doc.id, title: doc.title };
}

/** Descarga el archivo original del documento. */
export async function downloadDocumentFile(
  admin: SupabaseClient,
  id: string
): Promise<{ data: ArrayBuffer; fileName: string; mimeType: string }> {
  const { data } = await admin.from("kb_documents").select(DOC_FIELDS).eq("id", id).single();
  const doc = data as unknown as DocRow;

  if (doc.storage_path) {
    const { data: blob, error } = await admin.storage.from(STORAGE_BUCKET).download(doc.storage_path);
    if (error || !blob) throw new Error(`No se pudo leer el archivo guardado: ${error?.message ?? "vacío"}`);
    const fileName = doc.file_name ?? doc.storage_path.split("/").pop()!;
    return { data: await blob.arrayBuffer(), fileName, mimeType: mimeFromName(fileName) };
  }
  if (doc.kb_sources?.provider === "gdrive" && doc.external_id) {
    return downloadGdriveOriginal(doc.external_id);
  }
  if (doc.kb_sources?.provider === "onedrive" && doc.external_id) {
    const fileName = doc.file_name ?? doc.title;
    return {
      data: await downloadFile(doc.kb_sources.drive_id, doc.external_id),
      fileName,
      mimeType: mimeFromName(fileName),
    };
  }
  throw new Error("Este documento no tiene un archivo para enviar.");
}

const normalize = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras de la petición que no ayudan a encontrar el archivo por nombre.
const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "y", "o", "para", "por", "con", "en",
  "me", "mi", "envie", "envia", "enviar", "mandar", "manda", "archivo", "documento", "pdf",
]);

/**
 * Busca archivos enviables por su nombre (título o nombre de archivo), para
 * cuando el cliente pide un documento concreto ("MSDS del Think2Base Cat 4")
 * y la búsqueda por contenido no lo trae. Respeta nivel de acceso y empresa.
 */
export async function findDocumentsByName(
  admin: SupabaseClient,
  query: string,
  level: AccessLevel,
  companyId: string | null,
  limit = 8
): Promise<{ id: string; title: string; fileName: string | null }[]> {
  const words = Array.from(
    new Set(
      normalize(query)
        .split(/[^a-z0-9]+/)
        .filter((w) => w && !STOPWORDS.has(w))
    )
  ).slice(0, 8);
  if (words.length === 0) return [];

  // Candidatos: títulos o nombres de archivo con alguna palabra larga.
  const keys = words.filter((w) => w.length >= 3);
  const filters = (keys.length ? keys : words).flatMap((w) => [`title.ilike.*${w}*`, `file_name.ilike.*${w}*`]);
  const { data, error } = await admin
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("active", true)
    .in("access_level", allowedLevels(level))
    .or(filters.join(","))
    .limit(300);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as DocRow[])
    .filter((d) => hasFile(d) && (!d.company_id || d.company_id === companyId))
    .map((d) => {
      const name = normalize(`${d.title} ${d.file_name ?? ""}`);
      const compact = name.replace(/[^a-z0-9]+/g, "");
      // Cuenta las palabras presentes; "cat 4" también coincide con "CAT-4" o "cat4".
      const score = words.filter((w) => name.split(/[^a-z0-9]+/).includes(w) || compact.includes(w)).length;
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ id: d.id, title: d.title, fileName: d.file_name }));
}
