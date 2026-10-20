import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { processIncomingMessage, recordIncomingMessage } from "@/lib/whatsapp/bot";
import { messageText, verifySignature, WebhookPayload } from "@/lib/whatsapp/cloud-api";

export const dynamic = "force-dynamic";
// La respuesta de la IA (con búsquedas) puede tardar varios segundos.
export const maxDuration = 60;

// Verificación del webhook: Meta llama una vez con hub.challenge al
// configurarlo en developers.facebook.com → WhatsApp → Configuración.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    verifyToken &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const supabase = createAdminClient();
  const jobs: Promise<unknown>[] = [];
  const records: Promise<unknown>[] = [];
  let failed = false;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const msg of value.messages ?? []) {
        const profile = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
        const incoming = {
          from: msg.from,
          profileName: profile,
          waMessageId: msg.id,
          type: msg.type,
          text: messageText(msg),
        };
        // El mensaje se guarda ANTES de responder 200 a Meta: si algo falla
        // después, queda en la base y Meta no lo reintenta en vano.
        records.push(
          recordIncomingMessage(supabase, incoming).then(
            (recorded) => {
              if (recorded) {
                jobs.push(
                  processIncomingMessage(supabase, recorded, incoming).catch((err) =>
                    console.error("[whatsapp] error procesando mensaje:", err)
                  )
                );
              }
            },
            (err) => {
              failed = true;
              console.error("[whatsapp] no se pudo guardar el mensaje:", err);
            }
          )
        );
      }

      // Estados de entrega (sent / delivered / read / failed) de lo que enviamos.
      for (const status of value.statuses ?? []) {
        jobs.push(
          Promise.resolve(
            supabase.from("wa_messages").update({ status: status.status }).eq("wa_message_id", status.id)
          )
        );
      }
    }
  }

  await Promise.allSettled(records);
  // Meta espera un 200 rápido o reintenta; la respuesta con IA sigue en segundo plano.
  waitUntil(Promise.allSettled(jobs));
  // Si no se pudo guardar algún mensaje (ej. base caída), 500 → Meta lo reintenta
  // más tarde; los ya guardados se ignoran en el reintento por su id único.
  if (failed) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
