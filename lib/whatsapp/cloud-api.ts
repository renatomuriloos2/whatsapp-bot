import "server-only";
import crypto from "node:crypto";

// Cliente mínimo de la WhatsApp Cloud API (Meta).
// https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const MAX_TEXT_LENGTH = 4000; // WhatsApp acepta hasta 4096 caracteres por mensaje.

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN &&
      process.env.WHATSAPP_APP_SECRET
  );
}

/**
 * Verifica la firma X-Hub-Signature-256 que Meta agrega a cada webhook, para
 * que nadie más pueda inyectar mensajes falsos en el bot.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

async function graphPost(body: unknown): Promise<{ messages?: { id: string }[] }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Parte un texto largo en mensajes que WhatsApp acepte, cortando en párrafos. */
export function splitForWhatsApp(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_TEXT_LENGTH) {
    let cut = rest.lastIndexOf("\n\n", MAX_TEXT_LENGTH);
    if (cut < MAX_TEXT_LENGTH / 2) cut = rest.lastIndexOf("\n", MAX_TEXT_LENGTH);
    if (cut < MAX_TEXT_LENGTH / 2) cut = rest.lastIndexOf(" ", MAX_TEXT_LENGTH);
    if (cut <= 0) cut = MAX_TEXT_LENGTH;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Envía un texto (partido si es largo). Devuelve los wamid de cada parte. */
export async function sendText(to: string, text: string): Promise<string[]> {
  const ids: string[] = [];
  for (const part of splitForWhatsApp(text)) {
    const res = await graphPost({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: part, preview_url: true },
    });
    if (res.messages?.[0]?.id) ids.push(res.messages[0].id);
  }
  return ids;
}

/**
 * Marca el mensaje como leído (doble check azul) y muestra "escribiendo…"
 * mientras el bot prepara la respuesta. Es cosmético: si falla, se ignora.
 */
export async function markReadWithTyping(messageId: string): Promise<void> {
  try {
    await graphPost({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    });
  } catch (err) {
    console.warn("[whatsapp] no se pudo marcar como leído:", err);
  }
}

// ---- Tipos del payload del webhook (solo lo que usamos) ------------------

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: {
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
}

export interface WebhookStatus {
  id: string;
  status: string;
}

export interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: WebhookMessage[];
        statuses?: WebhookStatus[];
      };
    }[];
  }[];
}

/** Texto legible de un mensaje entrante, o null si no es de texto. */
export function messageText(msg: WebhookMessage): string | null {
  if (msg.type === "text") return msg.text?.body ?? null;
  if (msg.type === "button") return msg.button?.text ?? null;
  if (msg.type === "interactive") {
    return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null;
  }
  return null;
}
