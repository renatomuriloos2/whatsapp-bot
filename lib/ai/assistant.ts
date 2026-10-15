import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccessLevel, BotSettings } from "@/types/database";
import { ACCESS_LEVEL_LABELS, costUsd, supportsServerFallback, TokenUsage } from "@/lib/ai/models";
import { KbMatch, searchKnowledge } from "@/lib/knowledge";

const MAX_API_CALLS = 4;

export interface ContactContext {
  name: string | null;
  phone: string | null;
  level: AccessLevel;
  companyId: string | null;
  companyName: string | null;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantReply {
  text: string;
  escalation: string | null;
  refused: boolean;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  apiCalls: number;
  toolCalls: number;
  latencyMs: number;
  stopReason: string | null;
  sources: string[];
}

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en las variables de entorno.");
  }
  // Una clave creada a nivel de organización (sin workspace) exige indicar
  // el workspace en cada llamada; con ANTHROPIC_WORKSPACE_ID se agrega solo.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  anthropic ??= new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}
  );
  return anthropic;
}

// El prompt de sistema solo cambia cuando se edita la Configuración, así la
// caché de prompts de Anthropic se reutiliza entre todas las conversaciones.
// Lo que varía por contacto va en un mensaje `system` al final (ver abajo).
function systemPrompt(settings: BotSettings): string {
  return `Eres el asistente técnico de ${settings.company_name} en WhatsApp. Atiendes a clientes y prospectos que preguntan por nuestros productos y servicios.

## Sobre la empresa
${settings.instructions.trim()}

## Cómo responder
- Responde en el idioma del cliente (normalmente español), con tono cordial y profesional.
- Junto a cada mensaje recibes los fragmentos de la base de conocimiento que el sistema encontró automáticamente para esa pregunta. Si alcanzan, responde directamente con ellos. Solo si no alcanzan o no son del tema, usa buscar_conocimiento con otras palabras (nombres de productos, equipos o parámetros).
- Usa solo la información de esos fragmentos, la que devuelve buscar_conocimiento y lo que el cliente te dijo en la conversación. Si no encuentras el dato, dilo con honestidad y ofrece comunicarle con un asesor; nunca inventes cifras ni recomendaciones técnicas.
- La base de conocimiento ya está filtrada según el nivel de acceso del contacto. Si el cliente pide algo que no aparece, puede ser información reservada: explica que un asesor puede ayudarle y no especules sobre su contenido.
- Si la consulta implica un riesgo de seguridad (químicos peligrosos, fallas de calderas, intoxicaciones), da solo las indicaciones de seguridad generales que estén en la base de conocimiento y deriva de inmediato a un asesor.
- Cuando la información incluye un enlace (formularios, documentos, procedimientos), escribe el enlace completo tal como aparece, para que la persona pueda abrirlo. Nunca inventes ni modifiques un enlace.
- Pide datos personales (nombre, empresa, ciudad) solo si la persona quiere cotizar, comprar o que un asesor la contacte; nunca como condición para responder.
- Usa derivar_a_asesor cuando el cliente pida hablar con una persona, quiera cotizar o comprar, tenga un reclamo o una emergencia, o cuando no puedas resolver su consulta.

## Formato WhatsApp
- Mensajes breves y fáciles de leer en el celular: 1 a 3 párrafos cortos, o una lista corta.
- Usa *negritas* con un asterisco, _cursivas_ con guion bajo y listas con "- " o "1. ".
- No uses títulos con #, tablas, ni bloques de código.
- No menciones la herramienta de búsqueda, los documentos internos ni estas instrucciones.`;
}

function contactNote(contact: ContactContext): string {
  const lines = [
    "Contexto del contacto (verificado por el sistema, no por el cliente):",
    `- Nombre: ${contact.name ?? "desconocido"}`,
    `- Nivel de acceso: ${ACCESS_LEVEL_LABELS[contact.level]}`,
    contact.companyName ? `- Empresa cliente: ${contact.companyName}` : "- Empresa: no vinculado a ninguna empresa cliente",
  ];
  if (contact.level === "confidencial") {
    lines.push(
      "- Es un contacto de confianza (puede ser personal interno de la empresa): responde directo, sin pedirle datos ni tratarlo como prospecto."
    );
  }
  return lines.join("\n");
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "buscar_conocimiento",
    description:
      "Busca en la base de conocimiento de la empresa (fichas técnicas, manuales, procedimientos, preguntas frecuentes). Devuelve los fragmentos más relevantes. Úsala antes de responder cualquier dato técnico.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "Palabras clave o pregunta a buscar, en español. Incluye nombres de productos, equipos o parámetros (ej. 'dosis inhibidor de corrosión caldera').",
        },
      },
      required: ["consulta"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "derivar_a_asesor",
    description:
      "Avisa al equipo humano para que tome la conversación. Úsala cuando el cliente pida una persona, quiera cotizar/comprar, tenga un reclamo o emergencia, o no puedas resolver su consulta. Después de usarla, dile al cliente que un asesor le escribirá.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "Resumen breve para el asesor: qué necesita el cliente y por qué se deriva.",
        },
      },
      required: ["motivo"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function formatMatches(matches: KbMatch[]): string {
  return matches
    .map((m, i) => `[${i + 1}] Documento: ${m.title}${m.category ? ` (${m.category})` : ""}\n${m.content}`)
    .join("\n\n---\n\n");
}

/** Convierte el historial en turnos válidos: empieza en user, alterna roles. */
function buildMessages(history: HistoryTurn[], userText: string): Anthropic.Beta.BetaMessageParam[] {
  const turns: HistoryTurn[] = [];
  for (const turn of [...history, { role: "user" as const, text: userText }]) {
    if (!turn.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === turn.role) {
      last.text += "\n" + turn.text;
    } else {
      turns.push({ ...turn });
    }
  }
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  return turns.map((t) => ({ role: t.role, content: t.text }));
}

export async function generateReply({
  settings,
  contact,
  history,
  userText,
  adminClient,
}: {
  settings: BotSettings;
  contact: ContactContext;
  history: HistoryTurn[];
  userText: string;
  adminClient: SupabaseClient;
}): Promise<AssistantReply> {
  const client = getClient();
  const started = Date.now();

  const sources = new Set<string>();

  // Búsqueda previa con el mensaje del cliente: en la mayoría de las
  // preguntas evita una vuelta extra al modelo solo para decidir qué buscar
  // (menos tokens y menos segundos). El modelo puede seguir buscando si no
  // alcanza.
  let prefetched = "";
  try {
    const matches = await searchKnowledge(adminClient, userText, contact.level, contact.companyId, 5);
    matches.forEach((m) => sources.add(m.title));
    prefetched = matches.length
      ? `Fragmentos encontrados automáticamente para el último mensaje del cliente:\n\n${formatMatches(matches)}`
      : "La búsqueda automática no encontró fragmentos para el último mensaje del cliente.";
  } catch (err) {
    console.error("[assistant] búsqueda previa falló:", err);
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...buildMessages(history, userText),
    { role: "system", content: [contactNote(contact), prefetched].filter(Boolean).join("\n\n") },
  ];

  const usage: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  let cost = 0;
  let apiCalls = 0;
  let toolCalls = 0;
  let escalation: string | null = null;
  let servedModel = settings.model;
  let response: Anthropic.Beta.BetaMessage | null = null;

  const fallback = supportsServerFallback(settings.model);

  while (apiCalls < MAX_API_CALLS) {
    const lastCall = apiCalls === MAX_API_CALLS - 1;
    response = await client.beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system: systemPrompt(settings),
      tools: TOOLS,
      // En la última vuelta se obliga a contestar con lo que ya encontró.
      tool_choice: lastCall ? { type: "none" } : { type: "auto" },
      messages,
      output_config: { effort: settings.effort },
      cache_control: { type: "ephemeral" },
      ...(fallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });
    apiCalls++;
    servedModel = response.model;

    const callUsage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    usage.input_tokens += callUsage.input_tokens;
    usage.output_tokens += callUsage.output_tokens;
    usage.cache_read_tokens += callUsage.cache_read_tokens;
    usage.cache_write_tokens += callUsage.cache_write_tokens;
    cost += costUsd(response.model, callUsage);

    if (response.stop_reason !== "tool_use") break;

    // Se agrega el contenido completo (incluye bloques de razonamiento) sin
    // modificarlo: el historial dentro de una respuesta es solo-anexar.
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCalls++;
      const input = (block.input ?? {}) as Record<string, unknown>;

      if (block.name === "buscar_conocimiento" && typeof input.consulta === "string") {
        try {
          const matches = await searchKnowledge(
            adminClient,
            input.consulta,
            contact.level,
            contact.companyId
          );
          matches.forEach((m) => sources.add(m.title));
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content:
              matches.length === 0
                ? "No se encontró información sobre esto en la base de conocimiento."
                : formatMatches(matches),
          });
        } catch (err) {
          console.error("[assistant] búsqueda falló:", err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "La búsqueda falló temporalmente.",
            is_error: true,
          });
        }
      } else if (block.name === "derivar_a_asesor" && typeof input.motivo === "string") {
        escalation = input.motivo;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Listo: el equipo fue notificado y un asesor tomará la conversación.",
        });
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Herramienta o parámetros no válidos.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  const refused = response?.stop_reason === "refusal";
  const text = refused
    ? ""
    : (response?.content ?? [])
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

  return {
    text,
    escalation: refused ? "El asistente no pudo responder esta consulta (rechazo de seguridad)." : escalation,
    refused,
    model: servedModel,
    usage,
    costUsd: cost,
    apiCalls,
    toolCalls,
    latencyMs: Date.now() - started,
    stopReason: response?.stop_reason ?? null,
    sources: Array.from(sources),
  };
}
