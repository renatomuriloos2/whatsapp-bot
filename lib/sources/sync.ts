import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, indexDocument } from "@/lib/knowledge";
import { downloadRemoteFile, listFiles } from "@/lib/sources";
import type { KbSource } from "@/lib/sources/types";

const SUPPORTED = /\.(pdf|docx|txt|md|markdown|csv|json)$/i;
const MAX_BYTES = 15 * 1024 * 1024;

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  skipped: number;
  failed: string[];
  complete: boolean;
}

function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sincroniza una carpeta (Google Drive u OneDrive) o un sitio web con la base de conocimiento:
 * agrega archivos nuevos, vuelve a leer los modificados (cambia su cTag) y
 * borra los documentos cuyos archivos ya no están. Se detiene al acercarse
 * a `deadline` para no pasar el límite de tiempo de Vercel; lo que falte se
 * procesa en la siguiente sincronización (los archivos sin cambios se saltan
 * rápido).
 */
export async function syncSource(
  supabase: SupabaseClient,
  source: KbSource,
  deadline: number
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0, failed: [], complete: true };

  try {
    const files = await listFiles(source);

    const { data: existingRows, error } = await supabase
      .from("kb_documents")
      .select("id, external_id, external_etag")
      .eq("source_id", source.id);
    if (error) throw new Error(error.message);
    const existing = new Map((existingRows ?? []).map((r) => [r.external_id as string, r]));

    // 1) Borrar documentos cuyos archivos ya no están en la carpeta.
    const seen = new Set(files.map((f) => f.id));
    const gone = (existingRows ?? []).filter((r) => !seen.has(r.external_id as string)).map((r) => r.id);
    if (gone.length > 0) {
      await supabase.from("kb_documents").delete().in("id", gone);
      result.removed = gone.length;
    }

    // 2) Agregar o actualizar.
    for (const item of files) {
      const { folderPath } = item;
      if (!SUPPORTED.test(item.name) || item.size > MAX_BYTES) {
        result.skipped++;
        continue;
      }
      const version = item.version;
      const prev = existing.get(item.id);
      if (prev && prev.external_etag === version) {
        result.unchanged++;
        continue;
      }
      if (Date.now() > deadline) {
        result.complete = false;
        break;
      }

      try {
        const buffer = await downloadRemoteFile(source, item);
        const content = (await extractText(new File([buffer], item.name))).trim();
        if (!content) {
          result.failed.push(`${item.name}: sin texto (¿PDF escaneado?)`);
          continue;
        }
        const fields = {
          title: titleFromName(item.name),
          category: source.category ?? (folderPath.length ? folderPath[folderPath.length - 1] : null),
          access_level: source.access_level,
          company_id: source.company_id,
          file_name: item.name,
          content,
          source_id: source.id,
          external_id: item.id,
          external_etag: version,
          external_url: item.webUrl,
          updated_at: new Date().toISOString(),
        };
        const { data: doc, error: upsertError } = await supabase
          .from("kb_documents")
          .upsert(fields, { onConflict: "source_id,external_id" })
          .select("id, title, content")
          .single();
        if (upsertError) throw new Error(upsertError.message);
        await indexDocument(supabase, doc);
        if (prev) result.updated++;
        else result.added++;
      } catch (err) {
        result.failed.push(`${item.name}: ${err instanceof Error ? err.message : "error"}`);
      }
    }

    const { count } = await supabase
      .from("kb_documents")
      .select("id", { count: "exact", head: true })
      .eq("source_id", source.id);

    const status = [
      `${result.added} nuevos`,
      `${result.updated} actualizados`,
      `${result.removed} eliminados`,
      `${result.unchanged} sin cambios`,
      result.skipped ? `${result.skipped} omitidos (formato o tamaño)` : null,
      result.complete ? null : "faltan archivos: continuará en la próxima sincronización",
    ]
      .filter(Boolean)
      .join(" · ");

    await supabase
      .from("kb_sources")
      .update({
        last_synced_at: new Date().toISOString(),
        last_status: status,
        last_error: result.failed.length ? result.failed.slice(0, 10).join("\n") : null,
        file_count: count ?? 0,
      })
      .eq("id", source.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    result.complete = false;
    result.failed.push(message);
    await supabase
      .from("kb_sources")
      .update({ last_synced_at: new Date().toISOString(), last_status: "Error", last_error: message })
      .eq("id", source.id);
  }

  return result;
}

/** Sincroniza todas las carpetas activas, repartiendo el tiempo disponible. */
export async function syncAllSources(supabase: SupabaseClient, deadline: number) {
  const { data } = await supabase.from("kb_sources").select("*").eq("enabled", true).order("last_synced_at", {
    ascending: true,
    nullsFirst: true,
  });
  const results: { source: string; result: SyncResult }[] = [];
  for (const source of (data ?? []) as KbSource[]) {
    if (Date.now() > deadline) break;
    results.push({ source: source.name, result: await syncSource(supabase, source, deadline) });
  }
  return results;
}
