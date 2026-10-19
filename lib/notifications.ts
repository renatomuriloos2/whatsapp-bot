import "server-only";
import { BotSettings } from "@/types/database";
import { sendTemplate, sendText } from "@/lib/whatsapp/cloud-api";

// Avisa al equipo cuando el bot deja algo pendiente (solicitud de acceso,
// derivación a un asesor, número nuevo por aprobar). Usa el WhatsApp y/o el
// correo configurados en Configuración → Avisos al equipo. Nunca lanza
// errores: si un canal falla, se registra y el bot sigue funcionando.

export interface TeamAlert {
  title: string;
  reason: string;
  contactName: string | null;
  contactPhone: string | null;
  contactId?: string | null;
}

function portalUrl(path = ""): string | null {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  return base ? `${base}${path}` : null;
}

function alertText(alert: TeamAlert): string {
  const who = [alert.contactName, alert.contactPhone ? `+${alert.contactPhone}` : null].filter(Boolean).join(" ");
  const link = portalUrl(alert.contactId ? `/conversaciones/${alert.contactId}` : "/conversaciones");
  return [`🔔 ${alert.title}`, who ? `Contacto: ${who}` : null, alert.reason, link ? `Revisar: ${link}` : null]
    .filter(Boolean)
    .join("\n");
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Falta RESEND_API_KEY en Vercel.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Bot WhatsApp <onboarding@resend.dev>",
      to: to.split(/[,;\s]+/).filter(Boolean),
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Envía el aviso por los canales configurados. Devuelve qué pasó en cada uno. */
export async function notifyTeam(settings: BotSettings, alert: TeamAlert): Promise<string[]> {
  const text = alertText(alert);
  const results: string[] = [];

  const phone = settings.alert_phone?.replace(/\D/g, "");
  if (phone) {
    try {
      const template = settings.alert_template?.trim();
      if (template) {
        await sendTemplate(phone, template, text);
      } else {
        // Sin plantilla solo llega si ese número le escribió al bot en las últimas 24 h.
        await sendText(phone, text);
      }
      results.push("WhatsApp: enviado");
    } catch (err) {
      console.error("[avisos] WhatsApp falló:", err);
      results.push(`WhatsApp: error — ${err instanceof Error ? err.message : "desconocido"}`);
    }
  }

  const email = settings.alert_email?.trim();
  if (email) {
    try {
      await sendEmail(email, `Bot WhatsApp: ${alert.title}`, text);
      results.push("Correo: enviado");
    } catch (err) {
      console.error("[avisos] correo falló:", err);
      results.push(`Correo: error — ${err instanceof Error ? err.message : "desconocido"}`);
    }
  }

  if (results.length === 0) results.push("No hay WhatsApp ni correo configurados para avisos.");
  return results;
}
