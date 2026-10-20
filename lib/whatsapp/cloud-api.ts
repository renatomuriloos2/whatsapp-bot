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
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
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

/** Sube un archivo a WhatsApp y devuelve su id de media (válido por 30 días). */
async function uploadMedia(data: ArrayBuffer, fileName: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  // Nombre sin tildes en la subida: si no, WhatsApp lo muestra con símbolos
  // raros ("SocializaciÃ³n"). El nombre real va en el mensaje.
  const asciiName = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_");
  form.set("file", new Blob([data], { type: mimeType }), asciiName);
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: form,
    }
  );
  if (!res.ok) throw new Error(`WhatsApp media ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("WhatsApp no devolvió el id del archivo subido.");
  return json.id;
}

/** Envía un archivo como documento descargable. Devuelve el wamid. */
export async function sendDocument(
  to: string,
  file: { data: ArrayBuffer; fileName: string; mimeType: string },
  caption?: string
): Promise<string | null> {
  const mediaId = await uploadMedia(file.data, file.fileName, file.mimeType);
  // PNG/JPG van como imagen (se ven en el chat); el resto como documento.
  const asImage = file.mimeType === "image/png" || file.mimeType === "image/jpeg";
  const res = await graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    ...(asImage
      ? { type: "image", image: { id: mediaId, caption: caption ?? file.fileName } }
      : { type: "document", document: { id: mediaId, filename: file.fileName, ...(caption ? { caption } : {}) } }),
  });
  return res.messages?.[0]?.id ?? null;
}

/**
 * Envía una plantilla aprobada con un solo parámetro en el cuerpo ({{1}}).
 * Es la única forma de escribirle a alguien que no le escribió al número en
 * las últimas 24 horas.
 */
export async function sendTemplate(to: string, name: string, param: string, language = "es"): Promise<void> {
  await graphPost({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [
        {
          type: "body",
          // Los parámetros de plantilla no admiten saltos de línea ni tabulaciones.
          parameters: [{ type: "text", text: param.replace(/[\n\t]+/g, " · ").replace(/ {4,}/g, " ").slice(0, 1000) }],
        },
      ],
    },
  });
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
