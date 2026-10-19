import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BotSettings, WaContact } from "@/types/database";
import { generateReply, HistoryTurn } from "@/lib/ai/assistant";
import { markReadWithTyping, sendDocument, sendText } from "@/lib/whatsapp/cloud-api";
import { downloadDocumentFile, SendableDocument } from "@/lib/documents/files";
import { notifyTeam } from "@/lib/notifications";
import { ACCESS_LEVEL_LABELS } from "@/lib/ai/models";

export async function getBotSettings(supabase: SupabaseClient): Promise<BotSettings> {
  const { data, error } = await supabase.from("bot_settings").select("*").eq("id", 1).single();
  if (error || !data) {
    throw new Error(
      "No existe la configuración del bot. Corre supabase/whatsapp_bot.sql en el SQL Editor de Supabase."
    );
  }
  return { ...data, monthly_budget_usd: Number(data.monthly_budget_usd) } as BotSettings;
}

export async function monthToDateCost(supabase: SupabaseClient): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("ai_usage")
    .select("cost_usd")
    .gte("created_at", start.toISOString());
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

async function upsertContact(
  supabase: SupabaseClient,
  phone: string,
  profileName: string | null,
  settings: BotSettings
): Promise<WaContact> {
  const { data: existing } = await supabase
    .from("wa_contacts")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    if (profileName && profileName !== existing.profile_name) {
      await supabase.from("wa_contacts").update({ profile_name: profileName }).eq("id", existing.id);
    }
    return existing as WaContact;
  }

  const { data: created, error } = await supabase
    .from("wa_contacts")
    .insert({
      phone,
      profile_name: profileName,
      access_level: "publico",
      status: settings.unknown_contacts === "pendiente" ? "pendiente" : "activo",
      needs_attention: settings.unknown_contacts === "pendiente",
      attention_reason:
        settings.unknown_contacts === "pendiente" ? "Número nuevo pendiente de aprobación." : null,
    })
    .select()
    .single();

  if (error) {
    // Dos mensajes simultáneos del mismo número nuevo: el otro ya lo creó.
    const { data: retry } = await supabase.from("wa_contacts").select("*").eq("phone", phone).single();
    if (retry) return retry as WaContact;
    throw new Error(error.message);
  }
  return created as WaContact;
}

async function sendAndLog(
  supabase: SupabaseClient,
  contact: WaContact,
  body: string,
  sender: "bot" | "sistema"
) {
  const ids = await sendText(contact.phone, body);
  await supabase.from("wa_messages").insert({
    contact_id: contact.id,
    direction: "out",
    sender,
    body,
    wa_message_id: ids[0] ?? null,
    status: "sent",
  });
  await supabase
    .from("wa_contacts")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", contact.id);
}

/** Envía los archivos que pidió el cliente; si alguno falla, avisa y marca la conversación. */
async function sendDocuments(
  supabase: SupabaseClient,
  contact: WaContact,
  documents: SendableDocument[],
  settings: BotSettings
) {
  const failed: string[] = [];
  for (const doc of documents) {
    try {
      const file = await downloadDocumentFile(supabase, doc.id);
      // WhatsApp acepta documentos de hasta 100 MB.
      if (file.data.byteLength > 100 * 1024 * 1024) throw new Error("pesa más de 100 MB");
      const id = await sendDocument(contact.phone, file);
      await supabase.from("wa_messages").insert({
        contact_id: contact.id,
        direction: "out",
        sender: "bot",
        body: `📎 ${file.fileName}`,
        message_type: "document",
        wa_message_id: id,
        status: "sent",
      });
    } catch (err) {
      console.error(`[bot] no se pudo enviar "${doc.title}":`, err);
      failed.push(doc.title);
    }
  }
  if (failed.length > 0) {
    await sendAndLog(
      supabase,
      contact,
      `No pude adjuntar ${failed.length === 1 ? "el archivo" : "los archivos"} ${failed.map((t) => `"${t}"`).join(", ")} 😕 Un asesor te lo enviará en breve.`,
      "sistema"
    );
    await flagAttention(supabase, contact, `No se pudo enviar: ${failed.join(", ")}`, settings);
  }
}

/**
 * Marca la conversación como "necesita atención" y avisa al equipo por
 * WhatsApp/correo. Para no llenar de avisos, solo se avisa cuando la
 * conversación pasa de "sin pendientes" a "con pendientes" (o si `always`).
 */
async function flagAttention(
  supabase: SupabaseClient,
  contact: WaContact,
  reason: string,
  settings: BotSettings,
  { always = false, title = "Pendiente en el bot de WhatsApp" } = {}
) {
  const { data: changed } = await supabase
    .from("wa_contacts")
    .update({ needs_attention: true, attention_reason: reason })
    .eq("id", contact.id)
    .eq("needs_attention", false)
    .select("id");
  if (!changed?.length) {
    await supabase.from("wa_contacts").update({ attention_reason: reason }).eq("id", contact.id);
    if (!always) return;
  }
  await notifyTeam(settings, {
    title,
    reason,
    contactName: contact.display_name ?? contact.profile_name,
    contactPhone: contact.phone,
    contactId: contact.id,
  });
}

/**
 * Procesa un mensaje entrante de WhatsApp de principio a fin: registra el
 * contacto y el mensaje, aplica reglas (bot apagado, bloqueos, presupuesto,
 * límite diario, control humano) y, si corresponde, responde con IA.
 */
export async function handleIncomingMessage(
  supabase: SupabaseClient,
  msg: {
    from: string;
    profileName: string | null;
    waMessageId: string;
    type: string;
    text: string | null;
  }
): Promise<void> {
  const settings = await getBotSettings(supabase);
  const contact = await upsertContact(supabase, msg.from, msg.profileName, settings);

  const body = msg.text ?? `[${msg.type}]`;
  const { error: insertError } = await supabase.from("wa_messages").insert({
    contact_id: contact.id,
    direction: "in",
    sender: "cliente",
    body,
    message_type: msg.type,
    wa_message_id: msg.waMessageId,
  });
  // Violación de unicidad = Meta reintentó un webhook que ya procesamos.
  if (insertError) {
    if (insertError.code === "23505") return;
    throw new Error(insertError.message);
  }

  const now = new Date().toISOString();
  await supabase
    .from("wa_contacts")
    .update({ last_inbound_at: now, last_message_at: now })
    .eq("id", contact.id);

  if (contact.status === "bloqueado") return;
  if (!settings.enabled || contact.bot_paused) return;

  await markReadWithTyping(msg.waMessageId);

  if (contact.status === "pendiente") {
    // Se avisa una sola vez; el resto queda en la bandeja para el equipo.
    const { count } = await supabase
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id)
      .eq("direction", "out");
    if (!count) {
      await sendAndLog(supabase, contact, settings.pending_message, "sistema");
      await notifyTeam(settings, {
        title: "Número nuevo pendiente de aprobación",
        reason: `Escribió: "${body.slice(0, 200)}". Apruébalo en Conversaciones.`,
        contactName: contact.profile_name,
        contactPhone: contact.phone,
        contactId: contact.id,
      });
    }
    return;
  }

  if (!msg.text) {
    await sendAndLog(
      supabase,
      contact,
      "Por ahora solo puedo leer mensajes de texto ✍️ ¿Me escribes tu consulta?",
      "sistema"
    );
    return;
  }

  if ((await monthToDateCost(supabase)) >= settings.monthly_budget_usd) {
    await sendAndLog(supabase, contact, settings.budget_exceeded_message, "sistema");
    await flagAttention(supabase, contact, "Presupuesto mensual de IA agotado.", settings);
    return;
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: repliesToday } = await supabase
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contact.id)
    .eq("sender", "bot")
    .gte("created_at", dayStart.toISOString());
  if ((repliesToday ?? 0) >= settings.daily_limit_per_contact) {
    await flagAttention(supabase, contact, "Alcanzó el límite diario de respuestas del bot.", settings);
    return;
  }

  // Historial reciente (sin el mensaje actual), del más antiguo al más nuevo.
  const { data: recent } = await supabase
    .from("wa_messages")
    .select("direction, sender, body, wa_message_id")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(settings.history_messages + 1);
  const history: HistoryTurn[] = (recent ?? [])
    .filter((m) => m.wa_message_id !== msg.waMessageId)
    .slice(0, settings.history_messages)
    .reverse()
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", text: m.body }));

  let companyName: string | null = null;
  if (contact.company_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", contact.company_id)
      .single();
    companyName = company?.name ?? null;
  }

  const reply = await generateReply({
    settings,
    contact: {
      name: contact.display_name ?? contact.profile_name,
      phone: contact.phone,
      level: contact.access_level,
      companyId: contact.company_id,
      companyName,
    },
    history,
    userText: msg.text,
    adminClient: supabase,
  });

  await supabase.from("ai_usage").insert({
    contact_id: contact.id,
    source: "whatsapp",
    model: reply.model,
    input_tokens: reply.usage.input_tokens,
    output_tokens: reply.usage.output_tokens,
    cache_read_tokens: reply.usage.cache_read_tokens,
    cache_write_tokens: reply.usage.cache_write_tokens,
    cost_usd: reply.costUsd,
    api_calls: reply.apiCalls,
    tool_calls: reply.toolCalls,
    latency_ms: reply.latencyMs,
    stop_reason: reply.stopReason,
  });

  if (reply.text) {
    await sendAndLog(supabase, contact, reply.text, "bot");
  } else if (reply.documents.length === 0) {
    await sendAndLog(supabase, contact, settings.handoff_message, "sistema");
  }
  if (reply.documents.length > 0) {
    await sendDocuments(supabase, contact, reply.documents, settings);
  }

  if (reply.alerts.length > 0) {
    await supabase.from("kb_alerts").insert(
      reply.alerts.map((al) => ({ detail: al.detail, documents: al.documents, contact_id: contact.id, question: msg.text }))
    );
  }

  if (reply.accessRequest) {
    const r = reply.accessRequest;
    const level = ACCESS_LEVEL_LABELS[r.level];
    const details = [r.name, r.company].filter(Boolean).join(" — ");
    await supabase
      .from("wa_contacts")
      .update({ notes: `${contact.notes ? `${contact.notes}\n` : ""}Solicitó acceso ${level}: ${details}. ${r.reason}`.trim() })
      .eq("id", contact.id);
    await flagAttention(
      supabase,
      contact,
      `Solicita acceso ${level}${details ? ` (${details})` : ""}: ${r.reason}. Apruébalo cambiando su nivel en Conversaciones.`,
      settings,
      { always: true, title: `Solicitud de acceso ${level}` }
    );
  }

  if (reply.escalation) {
    await flagAttention(supabase, contact, reply.escalation, settings, { title: "El bot derivó a un asesor" });
  }
}
