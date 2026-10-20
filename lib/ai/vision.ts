import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { costUsd } from "@/lib/ai/models";

// Convierte una imagen (diagrama, flujograma, VSM, foto de una ficha) en texto
// para la base de conocimiento: el bot no "ve" imágenes al responder, así que
// se transcriben una vez, al subirlas o sincronizarlas.

const VISION_MODEL = "claude-sonnet-5-5";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // límite de la API de Anthropic por imagen

const MEDIA_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function isImageName(name: string): boolean {
  return (name.split(".").pop()?.toLowerCase() ?? "") in MEDIA_TYPES;
}

export async function imageToText(data: Uint8Array, fileName: string): Promise<string> {
  const mediaType = MEDIA_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""];
  if (!mediaType) throw new Error("Formato de imagen no soportado.");
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("La imagen pesa más de 5 MB: redúcela o guárdala como PDF.");
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY.");

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(data).toString("base64") } },
          {
            type: "text",
            text: `Esta imagen ("${fileName}") forma parte de la documentación interna de una empresa. Conviértela en texto para una base de conocimiento:
1. Transcribe todo el texto visible, sin omitir cifras, unidades, códigos ni nombres.
2. Si es un diagrama (flujo de proceso, mapa de flujo de valor/VSM, organigrama, tabla), describe su estructura en orden: etapas, secuencia, responsables, tiempos, inventarios, indicadores y flechas/relaciones.
3. Usa listas y frases claras en español. No agregues interpretaciones ni datos que no estén en la imagen.
Responde solo con el contenido, sin introducción.`,
          },
        ],
      },
    ],
  });
  // Se registra en Costos de IA (fuente "documentos"); si falla no importa.
  try {
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    await createAdminClient()
      .from("ai_usage")
      .insert({ source: "documentos", model: response.model, ...usage, cost_usd: costUsd(response.model, usage) });
  } catch (err) {
    console.warn("[vision] no se pudo registrar el costo:", err);
  }

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
