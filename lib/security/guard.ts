import { timingSafeEqual } from "node:crypto";

// Controles contra manipulación del bot por texto que controla un tercero
// (nombre de perfil de WhatsApp, mensajes, documentos) y contra fuga de
// información interna en las respuestas.

/**
 * Nombre de perfil de WhatsApp (lo elige el propio usuario): una sola línea,
 * sin caracteres de control ni marcadores que imiten el contexto del sistema.
 */
export function sanitizeName(name: string | null | undefined, max = 60): string | null {
  if (!name) return null;
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/[<>[\]{}`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return clean || null;
}

/**
 * Texto escrito por un tercero que se reenvía al equipo (avisos por WhatsApp
 * o correo): sin enlaces, para que nadie use el bot para mandarle un enlace
 * de phishing al equipo, y con largo limitado.
 */
export function neutralizeForTeam(text: string, max = 500): string {
  const clean = text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[enlace omitido]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ly|me|info|xyz|app|site|link|hn)(?:\/\S*)?/gi, "[enlace omitido]");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Dominios donde viven documentos, formularios y carpetas internas de la
// empresa. Un contacto que no es personal interno no debería recibirlos.
const INTERNAL_LINK = /\b(?:[\w-]+\.)*(?:sharepoint\.com|forms\.office\.com|forms\.microsoft\.com|onedrive\.live\.com|1drv\.ms|drive\.google\.com|docs\.google\.com|canva\.site|canva\.com|jotform\.com)\b/i;

/**
 * Filtro de salida (DLP): true si la respuesta para un contacto sin acceso al
 * SGI contiene enlaces a sistemas internos. Es un control independiente del
 * modelo: aunque una inyección de prompt lograra que el modelo los escriba,
 * no salen.
 */
export function leaksInternalLinks(text: string, canSeeSgi: boolean): boolean {
  return !canSeeSgi && INTERNAL_LINK.test(text);
}

/** Compara el encabezado Authorization con `Bearer CRON_SECRET` en tiempo constante. */
export function validCronAuth(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
