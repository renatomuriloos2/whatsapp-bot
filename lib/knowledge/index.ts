import "server-only";
import { buildDocumentCard } from "@/lib/knowledge/enrich";
import { imageToText, isImageName } from "@/lib/ai/vision";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccessLevel } from "@/types/database";
import { allowedLevels } from "@/lib/ai/models";

const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 200;

/**
 * Parte el texto en fragmentos de ~1400 caracteres respetando párrafos, con
 * un pequeño solape para que una respuesta no quede cortada entre dos.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
  };
  // El solape empieza en un límite de palabra, para no copiar medio enlace.
  const overlap = () => {
    const tail = current.slice(-CHUNK_OVERLAP);
    const cut = tail.search(/\s/);
    return cut >= 0 ? tail.slice(cut + 1) : "";
  };

  for (const para of paragraphs) {
    // Párrafos muy largos (ej. PDFs sin saltos) se cortan por líneas u
    // oraciones. Solo se corta tras un punto seguido de espacio, para no
    // partir direcciones web como "docs.google.com".
    const pieces =
      para.length > CHUNK_SIZE ? para.split(/(?<=[.!?])\s+|\n/).filter((p) => p.trim()) : [para];

    pieces.forEach((piece, i) => {
      // Las partes de un mismo párrafo se unen con espacio; párrafos distintos, con línea en blanco.
      const sep = i === 0 ? "\n\n" : " ";
      if (current && current.length + piece.length + 2 > CHUNK_SIZE) {
        pushCurrent();
        current = overlap() + sep + piece;
      } else {
        current = current ? current + sep + piece : piece;
      }
      // Una sola "oración" gigante: se corta a la fuerza.
      while (current.length > CHUNK_SIZE * 1.5) {
        chunks.push(current.slice(0, CHUNK_SIZE));
        current = current.slice(CHUNK_SIZE - CHUNK_OVERLAP);
      }
    });
  }
  pushCurrent();
  return chunks;
}

/** Extrae texto de un archivo subido (PDF, Word, imagen, texto, Markdown, CSV). */
export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractPdf(pdf, { mergePages: false });
    // Los enlaces de un PDF (ej. exportado de Canva) no están en el texto:
    // se agregan al final de cada página para que el bot pueda darlos.
    const pages = await Promise.all(
      text.map(async (pageText, i) => {
        try {
          const page = await pdf.getPage(i + 1);
          const annotations = (await page.getAnnotations()) as { subtype?: string; url?: string }[];
          const urls = Array.from(new Set(annotations.filter((a) => a.subtype === "Link" && a.url).map((a) => a.url!)));
          return urls.length ? `${pageText}\n\nEnlaces en esta página:\n${urls.map((u) => `- ${u}`).join("\n")}` : pageText;
        } catch {
          return pageText;
        }
      })
    );
    const joined = pages.join("\n\n");
    // Casi sin texto para la cantidad de páginas = PDF escaneado: se lee con IA.
    const letters = joined.replace(/\s+/g, "").length;
    if (letters < Math.max(200, 60 * text.length)) {
      try {
        const { scannedPdfToText } = await import("@/lib/ai/vision");
        const transcribed = await scannedPdfToText(buffer, file.name);
        if (transcribed.length > letters) return transcribed;
      } catch (err) {
        console.error("[knowledge] no se pudo leer el PDF escaneado:", err);
      }
    }
    return joined;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return value;
  }

  if (name.endsWith(".doc")) {
    // Word 97-2003 (formato binario antiguo).
    const WordExtractor = (await import("word-extractor")).default;
    const doc = await new WordExtractor().extract(Buffer.from(buffer));
    return [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter((t) => t?.trim()).join("\n\n");
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { xlsxToText } = await import("@/lib/knowledge/office");
    return xlsxToText(buffer);
  }

  if (name.endsWith(".pptx")) {
    const { pptxToText } = await import("@/lib/knowledge/office");
    return pptxToText(buffer);
  }

  if (isImageName(name)) {
    return imageToText(buffer, file.name);
  }

  if (/\.html?$/.test(name)) {
    const { savedHtmlToText } = await import("@/lib/sources/web");
    return savedHtmlToText(new TextDecoder("utf-8").decode(buffer));
  }

  if (/\.(txt|md|markdown|csv|json)$/.test(name)) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  throw new Error("Formato no soportado. Sube PDF, Word (.doc/.docx), Excel (.xlsx), PowerPoint (.pptx), imagen (PNG/JPG), página web (.html), TXT, Markdown o CSV.");
}

// ---- Embeddings (opcionales, Voyage AI) ----------------------------------

const VOYAGE_DIMENSIONS = 1024;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.VOYAGE_MODEL || "voyage-3.5",
      input: texts,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage AI respondió ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/**
 * (Re)genera los fragmentos de un documento. Primero arma su "ficha" con IA
 * (resumen, tipo, productos, palabras clave); las palabras clave van en el
 * encabezado de cada fragmento, que pesa más en la búsqueda. Luego borra los
 * fragmentos anteriores, inserta los nuevos y, si hay VOYAGE_API_KEY, calcula
 * sus embeddings.
 */
export async function indexDocument(
  supabase: SupabaseClient,
  doc: { id: string; title: string; content: string },
  { enrich = true }: { enrich?: boolean } = {}
): Promise<{ chunkCount: number; hasEmbeddings: boolean }> {
  const chunks = chunkText(doc.content);

  const { data: meta } = await supabase
    .from("kb_documents")
    .select("category, file_name, doc_type, products, keywords")
    .eq("id", doc.id)
    .maybeSingle();
  let card: { docType: string | null; products: string; keywords: string } = {
    docType: meta?.doc_type ?? null,
    products: meta?.products ?? "",
    keywords: meta?.keywords ?? "",
  };
  if (enrich) {
    const built = await buildDocumentCard(supabase, { ...doc, category: meta?.category, file_name: meta?.file_name });
    if (built) {
      card = { docType: built.docType, products: built.products.join(", "), keywords: built.keywords.join(", ") };
      await supabase
        .from("kb_documents")
        .update({
          summary: built.summary,
          doc_type: built.docType,
          products: card.products,
          keywords: card.keywords,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
    }
  }
  // Encabezado para la búsqueda por palabras (incluye las palabras clave).
  const heading = [doc.title, meta?.category, card.docType, card.products, card.keywords]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1500);
  // Para el embedding, un encabezado corto: una lista larga de palabras clave
  // diluiría el significado del fragmento.
  const embedHeading = [doc.title, card.docType, card.products].filter(Boolean).join(" | ").slice(0, 300);

  let embeddings: number[][] | null = null;
  if (embeddingsEnabled() && chunks.length > 0) {
    try {
      embeddings = [];
      for (let i = 0; i < chunks.length; i += 64) {
        const batch = chunks.slice(i, i + 64).map((c) => `${embedHeading}\n\n${c}`);
        embeddings.push(...(await embed(batch, "document")));
      }
    } catch (err) {
      // Sin embeddings el documento igual se encuentra por texto completo.
      console.error("[knowledge] embeddings fallaron:", err);
      embeddings = null;
    }
  }

  // Reemplazo sin hueco: primero se insertan los fragmentos nuevos y recién
  // después se borran los viejos. Si algo falla a mitad, el documento sigue
  // con su versión anterior en lugar de quedar sin fragmentos.
  const { data: oldChunks, error: oldError } = await supabase.from("kb_chunks").select("id").eq("document_id", doc.id);
  if (oldError) throw new Error(oldError.message);

  if (chunks.length > 0) {
    const rows = chunks.map((content, i) => ({
      document_id: doc.id,
      chunk_index: i,
      heading,
      content,
      embedding: embeddings ? JSON.stringify(embeddings[i]) : null,
    }));
    const inserted: string[] = [];
    for (let i = 0; i < rows.length; i += 200) {
      const { data: ins, error } = await supabase.from("kb_chunks").insert(rows.slice(i, i + 200)).select("id");
      if (error) {
        // Se deshace lo nuevo; queda la versión anterior intacta.
        if (inserted.length) await supabase.from("kb_chunks").delete().in("id", inserted);
        throw new Error(error.message);
      }
      inserted.push(...(ins ?? []).map((r) => r.id as string));
    }
  }
  const oldIds = (oldChunks ?? []).map((r) => r.id as string);
  for (let i = 0; i < oldIds.length; i += 200) {
    await supabase.from("kb_chunks").delete().in("id", oldIds.slice(i, i + 200));
  }

  const hasEmbeddings = embeddings !== null;
  await supabase
    .from("kb_documents")
    .update({ chunk_count: chunks.length, has_embeddings: hasEmbeddings })
    .eq("id", doc.id);

  return { chunkCount: chunks.length, hasEmbeddings };
}

/**
 * Tipo de documento según su título o categoría (o carpeta), para que el bot
 * priorice la ficha técnica sobre el flyer y la MSDS en temas de seguridad.
 */
export function documentType(...names: (string | null | undefined)[]): string | null {
  for (const raw of names) {
    if (!raw) continue;
    const t = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_.]+/g, " ").toLowerCase();
    if (/\b(m?sds|hds|hoja(s)? de (datos de )?seguridad|safety data)\b/.test(t)) return "Hoja de seguridad (MSDS)";
    if (/\b(tds|ficha(s)? tecnica(s)?|technical data|data ?sheet|boletin tecnico)\b/.test(t)) return "Ficha técnica (TDS)";
    if (/\b(flyer|brochure|folleto|catalogo|leaflet)\b/.test(t)) return "Material comercial (flyer)";
  }
  return null;
}

/** Documentos del Sistema de Gestión Integrado (uso interno: auditorías, procedimientos). */
export function isSgiDocument(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => n && /\bsgi\b|sistema (de )?gesti[oó]n/i.test(n.replace(/[_.]+/g, " ")));
}

export interface KbMatch {
  chunk_id: string;
  document_id: string;
  title: string;
  category: string | null;
  access_level: AccessLevel;
  content: string;
  score: number;
}

/**
 * Búsqueda híbrida filtrada por nivel de acceso. Requiere el cliente
 * service_role (la función SQL no está expuesta a usuarios del portal).
 */
export async function searchKnowledge(
  adminClient: SupabaseClient,
  query: string,
  level: AccessLevel,
  companyId: string | null,
  limit = 6
): Promise<KbMatch[]> {
  let queryEmbedding: string | null = null;
  if (embeddingsEnabled()) {
    try {
      const [vector] = await embed([query], "query");
      queryEmbedding = JSON.stringify(vector);
    } catch (err) {
      console.error("[knowledge] embedding de la consulta falló:", err);
    }
  }

  // Se piden más fragmentos de los necesarios y se dejan máximo 2 por
  // documento: así un documento largo no tapa a los demás candidatos.
  const { data, error } = await adminClient.rpc("match_kb_chunks", {
    query_text: query,
    query_embedding: queryEmbedding,
    allowed_levels: allowedLevels(level),
    p_company_id: companyId,
    match_count: limit * 3,
  });
  if (error) throw new Error(error.message);
  const perDoc = new Map<string, number>();
  const out: KbMatch[] = [];
  for (const m of (data ?? []) as KbMatch[]) {
    const n = perDoc.get(m.document_id) ?? 0;
    if (n >= 2) continue;
    perDoc.set(m.document_id, n + 1);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}
