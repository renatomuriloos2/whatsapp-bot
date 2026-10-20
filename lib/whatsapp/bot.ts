import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BotSettings, WaContact } from "@/types/database";
import { generateReply, HistoryTurn } from "@/lib/ai/assistant";
import { markReadWithTyping, sendDocument, sendText } from "@/lib/whatsapp/cloud-api";
import { downloadDocumentFile, findSendableDocument, SendableDocument } from "@/lib/documents/files";
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

/**
 * Gasto de IA del mes. Paginado (PostgREST devuelve máximo 1000 filas por
 * petición) y sin ocultar errores: si no se puede leer, falla y el mensaje
 * no se responde con IA (queda marcado para el equipo).
 */
export async function monthToDateCost(supabase: SupabaseClient): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ai_usage")
      .select("cost_usd")
      .gte("created_at", start.toISOString())
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`No se pudo leer el gasto del mes: ${error.message}`);
    total += (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
    if (!data || data.length < 1000) return total;
  }
}

/** Personal interno: marcado a mano o vinculado a la empresa propia (Rethink). */
async function contactIsInternal(supabase: SupabaseClient, contact: WaContact): Promise<boolean> {
  if (contact.interno === true) return true;
  if (!contact.company_id) return false;
  const { data } = await supabase.from("companies").select("*").eq("id", contact.company_id).single();
  return data?.interna === true;
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
      // La descarga puede tardar: justo antes de enviar se vuelve a comprobar
      // el contacto y el documento (pudieron desactivarlo, restringirlo o
      // cambiar el nivel, la empresa o la condición interna del contacto).
      if (!(await stillAllowed(supabase, contact))) return;
      const sgi = contact.access_level === "confidencial" && (await contactIsInternal(supabase, contact));
      if (!(await findSendableDocument(supabase, doc.id, contact.access_level, contact.company_id, sgi))) {
        console.warn(`[bot] archivo "${doc.title}" ya no autorizado para ${contact.id}; no se envía`);
        continue;
      }
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

export interface IncomingMessage {
  from: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  text: string | null;
}

// Si el cliente manda varios mensajes seguidos, se espera este tiempo y se
// responde una sola vez a todos juntos (el último mensaje se encarga).
const DEBOUNCE_MS = 3500;
// Una sola respuesta en curso por conversación: quien procesa "toma" la
// conversación por este tiempo (si la función se cae, vence sola) y los demás
// esperan hasta MAX_WAIT_MS.
const CLAIM_MS = 60_000;
const MAX_WAIT_MS = 25_000;

// Tipos de mensaje de WhatsApp que traen texto (ver messageText).
const TEXT_TYPES = ["text", "button", "interactive"];

/** Último mensaje de texto del cliente (stickers, audios, etc. no cuentan). */
async function latestTextMessageId(supabase: SupabaseClient, contactId: string): Promise<string | null> {
  const { data } = await supabase
    .from("wa_messages")
    .select("wa_message_id")
    .eq("contact_id", contactId)
    .eq("direction", "in")
    .in("message_type", TEXT_TYPES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.wa_message_id ?? null;
}

/**
 * Toma la conversación de forma atómica en Postgres (UPDATE condicionado).
 * Espera si otra respuesta está en curso. Si la columna aún no existe
 * (migración 010 sin correr) sigue sin bloqueo, como antes.
 */
async function claimConversation(supabase: SupabaseClient, contactId: string): Promise<boolean> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const now = new Date();
    const { data, error } = await supabase
      .from("wa_contacts")
      .update({ processing_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
      .eq("id", contactId)
      .or(`processing_until.is.null,processing_until.lt.${now.toISOString()}`)
      .select("id");
    // Sin la migración 010 la columna no existe: se sigue sin bloqueo, como antes.
    if (error && /processing_until/.test(error.message)) return true;
    if (error) throw new Error(`No se pudo tomar la conversación: ${error.message}`);
    if (data?.length) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function releaseConversation(supabase: SupabaseClient, contactId: string) {
  await supabase.from("wa_contacts").update({ processing_until: null }).eq("id", contactId);
}

/**
 * Paso 1 (antes de responder 200 a Meta): registra el contacto y guarda el
 * mensaje. Así el mensaje queda en la base aunque el procesamiento posterior
 * falle. Devuelve null si es un reintento de Meta ya registrado.
 */
export async function recordIncomingMessage(
  supabase: SupabaseClient,
  msg: IncomingMessage
): Promise<{ settings: BotSettings; contact: WaContact } | null> {
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
    if (insertError.code === "23505") return null;
    throw new Error(insertError.message);
  }

  const now = new Date().toISOString();
  await supabase
    .from("wa_contacts")
    .update({ last_inbound_at: now, last_message_at: now })
    .eq("id", contact.id);
  return { settings, contact };
}

/**
 * Paso 2 (en segundo plano): aplica reglas (bot apagado, bloqueos,
 * presupuesto, límite diario, control humano) y, si corresponde, responde.
 */
export async function processIncomingMessage(
  supabase: SupabaseClient,
  recorded: { settings: BotSettings; contact: WaContact },
  msg: IncomingMessage
): Promise<void> {
  try {
    await processMessage(supabase, recorded, msg);
  } catch (err) {
    // Cualquier falla (base, Meta, descarga…) deja el mensaje marcado para
    // el equipo en lugar de perderse en los logs.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[bot] error procesando mensaje:", detail);
    await flagAttention(supabase, recorded.contact, `Mensaje sin respuesta por un error: ${detail.slice(0, 300)}`, recorded.settings, {
      title: "⚠️ Error del bot",
    }).catch((e) => console.error("[bot] tampoco se pudo marcar la conversación:", e));
  }
}

async function processMessage(
  supabase: SupabaseClient,
  { settings, contact: initial }: { settings: BotSettings; contact: WaContact },
  msg: IncomingMessage
): Promise<void> {
  if (initial.status === "bloqueado") return;
  if (!settings.enabled || initial.bot_paused) return;

  await markReadWithTyping(msg.waMessageId);

  // Mensajes seguidos: solo responde el último texto, con todos en el
  // historial. Un sticker o audio posterior no cancela una pregunta escrita.
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const isLatest = async () => !msg.text || (await latestTextMessageId(supabase, initial.id)) === msg.waMessageId;
  if (!(await isLatest())) return;

  if (!(await claimConversation(supabase, initial.id))) {
    // Otra respuesta lleva demasiado tiempo: el equipo lo ve en la bandeja.
    console.error(`[bot] conversación ${initial.id} ocupada; mensaje ${msg.waMessageId} sin respuesta automática`);
    await flagAttention(supabase, initial, "Mensaje sin respuesta automática (el bot estaba ocupado con otra respuesta).", settings);
    return;
  }
  try {
    // Mientras esperaba su turno pudo llegar otro mensaje: ese responde por todos.
    if (!(await isLatest())) return;
    await processClaimed(supabase, settings, initial, msg);
  } finally {
    await releaseConversation(supabase, initial.id);
  }
}

async function processClaimed(
  supabase: SupabaseClient,
  settings: BotSettings,
  initial: WaContact,
  msg: IncomingMessage
): Promise<void> {
  // Estado actual del contacto (pudo pasar a atención humana o cambiar de nivel).
  const { data: fresh } = await supabase.from("wa_contacts").select("*").eq("id", initial.id).single();
  const contact = (fresh ?? initial) as WaContact;
  if (contact.status === "bloqueado" || contact.bot_paused) return;
  const body = msg.text ?? `[${msg.type}]`;

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

  await respond(supabase, settings, contact, { userText: msg.text, excludeMessageId: msg.waMessageId });
}

/**
 * Genera la respuesta con IA y la envía (texto, archivos, avisos al equipo).
 * Se usa para cada mensaje entrante y para retomar una conversación cuando el
 * equipo aprueba el registro de un contacto.
 */
async function respond(
  supabase: SupabaseClient,
  settings: BotSettings,
  contact: WaContact,
  opts: { userText: string; excludeMessageId?: string; systemNote?: string; searchQuery?: string }
) {
  // Historial reciente (sin el mensaje actual), del más antiguo al más nuevo.
  // Si al contacto le bajaron el nivel de acceso, la conversación anterior
  // (que pudo traer información de su nivel previo) ya no se le muestra a la IA.
  let historyQuery = supabase
    .from("wa_messages")
    .select("direction, sender, body, wa_message_id")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(settings.history_messages + 1);
  if (contact.history_reset_at) historyQuery = historyQuery.gte("created_at", contact.history_reset_at);
  const { data: recent } = await historyQuery;
  const history: HistoryTurn[] = (recent ?? [])
    .filter((m) => !opts.excludeMessageId || m.wa_message_id !== opts.excludeMessageId)
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
  const internal = await contactIsInternal(supabase, contact);

  let reply: Awaited<ReturnType<typeof generateReply>>;
  try {
    reply = await generateReply({
    settings,
    contact: {
      name: contact.display_name ?? contact.profile_name,
      phone: contact.phone,
      level: contact.access_level,
      companyId: contact.company_id,
      companyName,
      internal,
    },
    history,
    userText: opts.userText,
    adminClient: supabase,
    systemNote: opts.systemNote,
    searchQuery: opts.searchQuery,
  });
  } catch (err) {
    // La IA no respondió (límite de gasto de Anthropic, clave inválida, caída
    // del servicio…): el cliente no se queda sin respuesta y el equipo se entera.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[bot] la IA falló:", detail);
    const limit = /usage limits|credit balance/i.test(detail);
    await sendAndLog(supabase, contact, settings.handoff_message, "sistema");
    await flagAttention(
      supabase,
      contact,
      limit
        ? "La IA está detenida: se alcanzó el límite de gasto o se acabó el saldo en la cuenta de Anthropic (Claude Console → Settings → Limits / Billing)."
        : `La IA no pudo responder: ${detail.slice(0, 300)}`,
      settings,
      { title: limit ? "⚠️ Bot sin IA: límite de gasto de Anthropic" : "⚠️ Error de la IA del bot" }
    );
    return;
  }

  const usageRow = {
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
  };
  // Trazabilidad: qué documentos se usaron en esta respuesta (columna de la
  // migración 009; sin ella se guarda el resto igual).
  const { error: usageError } = await supabase
    .from("ai_usage")
    .insert({ ...usageRow, documents: [...reply.sources, ...reply.documents.map((d) => `archivo: ${d.title}`)] });
  if (usageError) await supabase.from("ai_usage").insert(usageRow);

  // Mientras la IA respondía, alguien pudo tomar el control, bloquear el
  // número o cambiarle los permisos: entonces la respuesta se descarta.
  if (!(await stillAllowed(supabase, contact))) return;

  if (reply.text) {
    await sendAndLog(supabase, contact, reply.text, "bot");
  } else if (reply.documents.length === 0) {
    await sendAndLog(supabase, contact, settings.handoff_message, "sistema");
  }
  if (reply.documents.length > 0 && (await stillAllowed(supabase, contact))) {
    await sendDocuments(supabase, contact, reply.documents, settings);
  }

  if (reply.alerts.length > 0) {
    await supabase.from("kb_alerts").insert(
      reply.alerts.map((al) => ({ detail: al.detail, documents: al.documents, contact_id: contact.id, question: opts.searchQuery ?? opts.userText }))
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
    // Un solo aviso mientras la solicitud siga pendiente: así nadie puede
    // llenar de avisos (plantillas pagas) al equipo repitiendo la solicitud.
    const repeated = (contact.notes ?? "").match(/Solicitó acceso/g)?.length ?? 0;
    const recent =
      repeated > 0 && contact.needs_attention && /Solicita acceso/.test(contact.attention_reason ?? "");
    await flagAttention(
      supabase,
      contact,
      `Solicita acceso ${level}${details ? ` (${details})` : ""}: ${r.reason}. Apruébalo cambiando su nivel en Conversaciones.`,
      settings,
      { always: !recent, title: `Solicitud de acceso ${level}` }
    );
  }

  if (reply.escalation) {
    await flagAttention(supabase, contact, reply.escalation, settings, { title: "El bot derivó a un asesor" });
  }
}

/**
 * Vuelve a leer el contacto justo antes de enviar. Si un humano tomó el
 * control, lo bloquearon o le cambiaron nivel, empresa, pertenencia interna o
 * historial desde que empezó la respuesta, no se envía nada.
 */
async function stillAllowed(supabase: SupabaseClient, before: WaContact): Promise<boolean> {
  const { data } = await supabase.from("wa_contacts").select("*").eq("id", before.id).single();
  const now = data as WaContact | null;
  const same =
    !!now &&
    !now.bot_paused &&
    now.status === "activo" &&
    now.access_level === before.access_level &&
    (now.company_id ?? null) === (before.company_id ?? null) &&
    (now.interno ?? false) === (before.interno ?? false) &&
    (now.history_reset_at ?? null) === (before.history_reset_at ?? null);
  if (!same) console.warn(`[bot] respuesta descartada: el contacto ${before.id} cambió mientras la IA respondía`);
  return same;
}

/**
 * Cuando el equipo sube el nivel de un contacto que tenía una solicitud
 * pendiente, el bot le escribe solo: avisa que ya quedó registrado y le
 * entrega lo que había pedido. Solo dentro de la ventana de 24 h de WhatsApp.
 */
export async function resumeAfterApproval(supabase: SupabaseClient, contactId: string): Promise<boolean> {
  const settings = await getBotSettings(supabase);
  const { data } = await supabase.from("wa_contacts").select("*").eq("id", contactId).single();
  const contact = data as WaContact | null;
  if (!contact || !settings.enabled || contact.bot_paused || contact.status !== "activo") return false;
  const lastIn = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : 0;
  if (Date.now() - lastIn > 23.5 * 60 * 60 * 1000) return false;
  // Mismos controles que un mensaje normal: presupuesto y una sola respuesta
  // en curso por conversación.
  if ((await monthToDateCost(supabase)) >= settings.monthly_budget_usd) return false;
  if (!(await claimConversation(supabase, contact.id))) return false;
  try {
    const { data: lastClient } = await supabase
      .from("wa_messages")
      .select("body")
      .eq("contact_id", contact.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(5);
    await respond(supabase, settings, contact, {
      userText: "[Aviso del sistema: el equipo aprobó el registro de este contacto]",
      searchQuery: (lastClient ?? []).map((m) => m.body).join(" ").slice(0, 500),
      systemNote: `El equipo de ${settings.company_name} acaba de aprobar el registro de este contacto (ahora tiene nivel ${ACCESS_LEVEL_LABELS[contact.access_level]}). Escríbele un mensaje breve y cordial avisándole que ya quedó registrado y entrégale lo que había pedido en la conversación (si era un archivo, usa enviar_documento). No menciones este aviso del sistema.`,
    });
  } finally {
    await releaseConversation(supabase, contact.id);
  }
  await supabase.from("wa_contacts").update({ needs_attention: false, attention_reason: null }).eq("id", contact.id);
  return true;
}

/** Registra y procesa un mensaje entrante (ambos pasos seguidos). */
export async function handleIncomingMessage(supabase: SupabaseClient, msg: IncomingMessage): Promise<void> {
  const recorded = await recordIncomingMessage(supabase, msg);
  if (recorded) await processIncomingMessage(supabase, recorded, msg);
}
