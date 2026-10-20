import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd } from "@/lib/ai/models";

// "Ficha" de cada documento: un modelo pequeño y barato lee el documento una
// sola vez (al subirlo o cuando cambia) y escribe un resumen, el tipo de
// documento, los productos que menciona y palabras clave con sinónimos.
// Las palabras clave se agregan al índice de búsqueda de cada fragmento, así
// "proveedor quiere enviarnos una muestra" encuentra "Envío de Muestra".

const ENRICH_MODEL = "claude-haiku-5-5";
// Con el inicio y el final del documento alcanza para clasificarlo.
const MAX_CHARS = 24_000;

export const DOC_TYPES = [
  "Ficha técnica (TDS)",
  "Hoja de seguridad (MSDS)",
  "Material comercial (flyer)",
  "Presentación",
  "Procedimiento",
  "Instructivo o manual",
  "Formulario o registro",
  "Lista de enlaces",
  "Política o código",
  "Matriz o indicador",
  "Certificado",
  "Reporte técnico",
  "Preguntas frecuentes",
  "Otro",
] as const;

const SCHEMA = {
  type: "object",
  properties: {
    resumen: { type: "string", description: "2 o 3 frases: qué es el documento y para qué sirve." },
    tipo: { type: "string", enum: [...DOC_TYPES] },
    productos: {
      type: "array",
      items: { type: "string" },
      description: "Nombres exactos de productos, equipos o códigos de documento que aparecen (ej. Think2Dye Scour, PRST-02).",
    },
    palabras_clave: {
      type: "array",
      items: { type: "string" },
      description:
        "10 a 25 términos con los que alguien buscaría este documento: temas, procesos, sinónimos en español, términos equivalentes en inglés y formas coloquiales.",
    },
  },
  required: ["resumen", "tipo", "productos", "palabras_clave"],
  additionalProperties: false,
} as const;

export interface DocumentCard {
  summary: string;
  docType: string;
  products: string[];
  keywords: string[];
}

export function enrichmentEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  client ??= new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
  return client;
}

/** Genera la ficha. Devuelve null si falla (el documento se indexa igual). */
export async function buildDocumentCard(
  admin: SupabaseClient,
  doc: { title: string; content: string; category?: string | null; file_name?: string | null }
): Promise<DocumentCard | null> {
  if (!enrichmentEnabled()) return null;
  const text =
    doc.content.length > MAX_CHARS
      ? `${doc.content.slice(0, MAX_CHARS * 0.75)}\n[…]\n${doc.content.slice(-MAX_CHARS * 0.25)}`
      : doc.content;
  try {
    const response = await getClient().messages.parse({
      model: ENRICH_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(SCHEMA) },
      messages: [
        {
          role: "user",
          content: `Clasifica este documento de la base de conocimiento de una empresa de químicos textiles para que un asistente lo encuentre fácilmente. Usa solo lo que dice el documento.\n\nTítulo: ${doc.title}\nArchivo: ${doc.file_name ?? "-"}\nCategoría: ${doc.category ?? "-"}\n\n<documento>\n${text}\n</documento>`,
        },
      ],
    });
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    await admin
      .from("ai_usage")
      .insert({ source: "documentos", model: response.model, ...usage, cost_usd: costUsd(response.model, usage) })
      .then(() => undefined, () => undefined);
    const out = response.parsed_output;
    if (!out) return null;
    return {
      summary: out.resumen.trim(),
      docType: out.tipo,
      products: out.productos.map((p) => p.trim()).filter(Boolean).slice(0, 30),
      keywords: out.palabras_clave.map((k) => k.trim()).filter(Boolean).slice(0, 40),
    };
  } catch (err) {
    console.error("[enrich] no se pudo generar la ficha:", err);
    return null;
  }
}
