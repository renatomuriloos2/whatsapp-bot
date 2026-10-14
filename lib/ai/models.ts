import { AccessLevel, Effort } from "@/types/database";

// Modelos que se pueden elegir en Configuración. Todos aceptan mensajes
// `system` a mitad de conversación (los usa el bot para el contexto del
// contacto) y `output_config.effort`.
export const BOT_MODELS = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    hint: "Máxima calidad en respuestas técnicas. Recomendado.",
    serverFallback: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    hint: "Muy buena calidad, aprox. la mitad del costo de Opus.",
    serverFallback: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    hint: "El más económico y rápido; para preguntas simples.",
    serverFallback: false,
  },
] as const;

export const DEFAULT_MODEL = "claude-opus-5-5";

export function modelLabel(id: string): string {
  return BOT_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function supportsServerFallback(id: string): boolean {
  return BOT_MODELS.find((m) => m.id === id)?.serverFallback ?? false;
}

export const EFFORT_OPTIONS: { value: Effort; label: string; hint: string }[] = [
  { value: "low", label: "Bajo", hint: "Más rápido y barato; respuestas directas." },
  { value: "medium", label: "Medio", hint: "Equilibrio entre calidad y costo." },
  { value: "high", label: "Alto", hint: "Razona más a fondo; más tokens por respuesta." },
];

// Precios en USD por millón de tokens (tarifas de la API de Anthropic).
// cacheWrite = escritura de caché de 5 minutos (1.25× la entrada).
// Si Anthropic cambia sus precios, actualiza esta tabla; los costos ya
// registrados en ai_usage no se recalculan.
// Incluye los modelos a los que la API puede derivar una respuesta rechazada
// (fallbacks), para que el costo se calcule con el modelo que respondió.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const p = PRICING[model] ?? PRICING[DEFAULT_MODEL];
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_read_tokens * p.cacheRead +
      usage.cache_write_tokens * p.cacheWrite) /
    1_000_000
  );
}

export const ACCESS_LEVELS: AccessLevel[] = ["publico", "cliente", "confidencial"];

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  publico: "Público",
  cliente: "Cliente",
  confidencial: "Confidencial",
};

export const ACCESS_LEVEL_HINTS: Record<AccessLevel, string> = {
  publico: "Cualquier persona que escriba al número.",
  cliente: "Contactos verificados de un cliente.",
  confidencial: "Contactos de confianza (fichas internas, precios, etc.).",
};

/** Niveles de documento que puede ver un contacto con el nivel dado. */
export function allowedLevels(level: AccessLevel): AccessLevel[] {
  return ACCESS_LEVELS.slice(0, ACCESS_LEVELS.indexOf(level) + 1);
}

export function formatUsd(value: number, digits = 2): string {
  return `US$ ${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
