import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedLevels } from "@/lib/ai/models";
import { AccessLevel } from "@/types/database";

// Búsqueda de enlaces (formularios, KPIs, documentos) en las listas de enlaces
// de la base de conocimiento, como "SGI - Enlaces del Portal SGI". La búsqueda
// general por contenido a veces prefiere otros documentos del mismo tema; aquí
// se compara línea por línea, que es como están escritos los enlaces.

const normalize = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const STOPWORDS = new Set([
  "para", "cuando", "donde", "como", "link", "links", "enlace", "enlaces", "pasame", "pasa", "dame",
  "envia", "enviame", "necesito", "quiero", "tenga", "tiene", "nos", "los", "las", "del", "que", "una",
  "uno", "por", "favor", "este", "esta", "cual", "formulario", "formularios",
]);

/** Raíz corta de cada palabra: "envío"/"enviar" → "envi", "muestras" → "mues". */
function roots(text: string): string[] {
  return Array.from(
    new Set(
      normalize(text)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        .map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 4)))
    )
  );
}

export async function findLinks(
  admin: SupabaseClient,
  query: string,
  level: AccessLevel,
  companyId: string | null,
  limit = 8
): Promise<string[]> {
  const wanted = roots(query);
  if (wanted.length === 0) return [];
  const { data, error } = await admin
    .from("kb_documents")
    .select("title, content, company_id")
    .eq("active", true)
    .in("access_level", allowedLevels(level))
    .ilike("category", "%enlace%")
    .limit(20);
  if (error) throw new Error(error.message);

  const scored: { line: string; score: number }[] = [];
  for (const doc of data ?? []) {
    if (doc.company_id && doc.company_id !== companyId) continue;
    let site = "";
    let section = "";
    for (const raw of String(doc.content).split("\n")) {
      const line = raw.trim();
      if (line.startsWith("## ")) {
        site = line.slice(3).trim();
        section = "";
        continue;
      }
      if (line.startsWith("#")) {
        section = line.replace(/^#+\s*/, "");
        continue;
      }
      if (!line.startsWith("- ") || !/https?:\/\//.test(line)) continue;
      const label = line.replace(/https?:\/\/\S+/g, " ");
      const context = [site, section].filter(Boolean).join(" / ");
      const have = new Set(roots(`${label} ${context}`));
      const labelRoots = new Set(roots(label));
      // Las coincidencias en el nombre del enlace valen más que en la sección.
      let score = 0;
      for (const w of wanted) if (labelRoots.has(w)) score += 2;
      else if (have.has(w)) score += 1;
      if (score > 0) scored.push({ line: `${line.replace(/^-\s*/, "- ")} [sección: ${context || doc.title}]`, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.line);
}
