"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAppUser } from "@/lib/auth";
import { ActionState, isRedirectError } from "@/lib/action-state";
import { ACCESS_LEVELS, BOT_MODELS, EFFORT_OPTIONS } from "@/lib/ai/models";
import { extractText, indexDocument } from "@/lib/knowledge";
import { generateReply, HistoryTurn } from "@/lib/ai/assistant";
import { getBotSettings, resumeAfterApproval } from "@/lib/whatsapp/bot";
import { mimeFromName, STORAGE_BUCKET } from "@/lib/documents/files";
import { notifyTeam } from "@/lib/notifications";
import { sendText, whatsappConfigured } from "@/lib/whatsapp/cloud-api";
import { AccessLevel, ContactStatus } from "@/types/database";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function parseLevel(value: FormDataEntryValue | null): AccessLevel {
  const level = String(value ?? "") as AccessLevel;
  return ACCESS_LEVELS.includes(level) ? level : "publico";
}

function optionalId(value: FormDataEntryValue | null): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

/** Deja solo dígitos en formato internacional (ej. "+57 300 123 4567" → "573001234567"). */
function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// ============================================================
// BASE DE CONOCIMIENTO
// ============================================================

export async function createDocumentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const appUser = await requireAppUser();
    const supabase = createClient();

    const title = String(formData.get("title") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim() || null;
    const description = String(formData.get("description") ?? "").trim() || null;
    const accessLevel = parseLevel(formData.get("access_level"));
    const companyId = optionalId(formData.get("company_id"));
    const file = formData.get("file");

    let content = String(formData.get("content") ?? "").trim();
    let fileName: string | null = null;
    if (file instanceof File && file.size > 0) {
      fileName = file.name;
      const extracted = (await extractText(file)).trim();
      content = content ? `${content}\n\n${extracted}` : extracted;
    }

    if (!title) return { error: "El título es obligatorio." };
    if (!content) {
      return {
        error: "Sube un archivo o pega el contenido. Si es un PDF escaneado (imagen), no tiene texto que leer.",
      };
    }

    const { data: doc, error } = await supabase
      .from("kb_documents")
      .insert({
        title,
        category,
        description,
        access_level: accessLevel,
        company_id: companyId,
        file_name: fileName,
        content,
        created_by: appUser.id,
      })
      .select("id, title, content")
      .single();
    if (error) return { error: error.message };

    await indexDocument(supabase, doc);

    // Se guarda el archivo original para que el bot pueda enviarlo por WhatsApp.
    if (file instanceof File && file.size > 0 && fileName) {
      try {
        const admin = createAdminClient();
        const path = `${doc.id}/${fileName.replace(/[^\w.\- ]+/g, "_")}`;
        const { error: uploadError } = await admin.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { contentType: mimeFromName(fileName), upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        await admin.from("kb_documents").update({ storage_path: path }).eq("id", doc.id);
      } catch (err) {
        // El documento ya sirve para responder; solo no se podrá enviar como archivo.
        console.error("[documentos] no se pudo guardar el archivo original:", err);
      }
    }
    revalidatePath("/conocimiento");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al guardar el documento.") };
  }
  return { error: null };
}

export async function updateDocumentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await requireAppUser();
    const supabase = createClient();

    const title = String(formData.get("title") ?? "").trim();
    const content = String(formData.get("content") ?? "").trim();
    if (!title || !content) return { error: "Título y contenido son obligatorios." };

    const { data: doc, error } = await supabase
      .from("kb_documents")
      .update({
        title,
        category: String(formData.get("category") ?? "").trim() || null,
        description: String(formData.get("description") ?? "").trim() || null,
        access_level: parseLevel(formData.get("access_level")),
        company_id: optionalId(formData.get("company_id")),
        active: formData.get("active") === "on",
        content,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, title, content")
      .single();
    if (error) return { error: error.message };

    await indexDocument(supabase, doc);
    revalidatePath("/conocimiento");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al actualizar el documento.") };
  }
  redirect("/conocimiento");
}

export async function toggleDocumentAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  await supabase
    .from("kb_documents")
    .update({ active: formData.get("active") === "true" })
    .eq("id", String(formData.get("id")));
  revalidatePath("/conocimiento");
}

export async function deleteDocumentAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  const id = String(formData.get("id"));
  const { data: doc } = await supabase.from("kb_documents").select("storage_path").eq("id", id).maybeSingle();
  await supabase.from("kb_documents").delete().eq("id", id);
  if (doc?.storage_path) {
    await createAdminClient().storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
  }
  revalidatePath("/conocimiento");
  redirect("/conocimiento");
}

// ============================================================
// CONTACTOS
// ============================================================

function contactFields(formData: FormData) {
  const status = String(formData.get("status") ?? "activo") as ContactStatus;
  return {
    display_name: String(formData.get("display_name") ?? "").trim() || null,
    access_level: parseLevel(formData.get("access_level")),
    status: (["activo", "pendiente", "bloqueado"] as const).includes(status) ? status : "activo",
    company_id: optionalId(formData.get("company_id")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createContactAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser();
    const supabase = createClient();
    const phone = normalizePhone(String(formData.get("phone") ?? ""));
    if (!phone) {
      return { error: "Número inválido. Usa formato internacional con código de país (ej. +57 300 123 4567)." };
    }
    const { error } = await supabase.from("wa_contacts").insert({ phone, ...contactFields(formData) });
    if (error) {
      return { error: error.code === "23505" ? "Ese número ya está registrado." : error.message };
    }
    revalidatePath("/conversaciones");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al crear el contacto.") };
  }
  return { error: null };
}

export async function updateContactAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser();
    const supabase = createClient();
    const id = String(formData.get("id") ?? "");
    const fields = contactFields(formData);
    const { data: before } = await supabase.from("wa_contacts").select("access_level").eq("id", id).single();
    const { error } = await supabase
      .from("wa_contacts")
      .update({
        ...fields,
        // Al aprobar un número pendiente se quita la alerta de "nuevo número".
        ...(fields.status === "activo" ? { needs_attention: false, attention_reason: null } : {}),
      })
      .eq("id", id);
    if (error) return { error: error.message };

    // Se aprobó el registro (de Público a Cliente o Confidencial): el bot le
    // escribe y le entrega lo que había pedido.
    if (before?.access_level === "publico" && fields.access_level !== "publico") {
      try {
        await resumeAfterApproval(createAdminClient(), id);
      } catch (err) {
        console.error("[contactos] no se pudo retomar la conversación:", err);
      }
    }
    revalidatePath("/conversaciones");
    revalidatePath(`/conversaciones/${id}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al guardar el contacto.") };
  }
  return { error: null };
}

export async function deleteContactAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  await supabase.from("wa_contacts").delete().eq("id", String(formData.get("id")));
  revalidatePath("/conversaciones");
  redirect("/conversaciones");
}

export async function setBotPausedAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  const id = String(formData.get("id"));
  const paused = formData.get("paused") === "true";
  await supabase
    .from("wa_contacts")
    .update({ bot_paused: paused, ...(paused ? {} : { needs_attention: false, attention_reason: null }) })
    .eq("id", id);
  revalidatePath(`/conversaciones/${id}`);
  revalidatePath("/conversaciones");
  revalidatePath("/panel");
}

export async function resolveAttentionAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  const id = String(formData.get("id"));
  await supabase
    .from("wa_contacts")
    .update({ needs_attention: false, attention_reason: null })
    .eq("id", id);
  revalidatePath(`/conversaciones/${id}`);
  revalidatePath("/conversaciones");
  revalidatePath("/panel");
}

export async function sendAgentMessageAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const appUser = await requireAppUser();
    if (!whatsappConfigured()) {
      return { error: "WhatsApp no está configurado (faltan variables WHATSAPP_* en el servidor)." };
    }
    const supabase = createClient();
    const id = String(formData.get("id") ?? "");
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "Escribe un mensaje." };

    const { data: contact } = await supabase
      .from("wa_contacts")
      .select("id, phone, last_inbound_at")
      .eq("id", id)
      .single();
    if (!contact) return { error: "Contacto no encontrado." };

    const ids = await sendText(contact.phone, body);
    const now = new Date().toISOString();
    await supabase.from("wa_messages").insert({
      contact_id: id,
      direction: "out",
      sender: "agente",
      body,
      wa_message_id: ids[0] ?? null,
      status: "sent",
      agent_id: appUser.id,
    });
    // Si un humano responde, el bot se pausa para no pisarle la conversación.
    await supabase
      .from("wa_contacts")
      .update({ bot_paused: true, needs_attention: false, attention_reason: null, last_message_at: now })
      .eq("id", id);
    revalidatePath(`/conversaciones/${id}`);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "No se pudo enviar el mensaje.") };
  }
  return { error: null };
}

// ============================================================
// CONFIGURACIÓN (solo admin)
// ============================================================

export async function updateSettingsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser("admin");
    const supabase = createClient();

    const model = String(formData.get("model"));
    const effort = String(formData.get("effort"));
    const budget = Number(formData.get("monthly_budget_usd"));
    const dailyLimit = Number(formData.get("daily_limit_per_contact"));
    const historyMessages = Number(formData.get("history_messages"));

    if (!BOT_MODELS.some((m) => m.id === model)) return { error: "Modelo inválido." };
    if (!EFFORT_OPTIONS.some((e) => e.value === effort)) return { error: "Nivel de esfuerzo inválido." };
    if (!Number.isFinite(budget) || budget < 0) return { error: "Presupuesto inválido." };
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1) return { error: "Límite diario inválido." };
    if (!Number.isInteger(historyMessages) || historyMessages < 0 || historyMessages > 50) {
      return { error: "El historial debe estar entre 0 y 50 mensajes." };
    }

    const text = (name: string) => String(formData.get(name) ?? "").trim();
    const fields = {
      enabled: formData.get("enabled") === "on",
      model,
      effort,
      company_name: text("company_name") || "Rethink",
      instructions: text("instructions"),
      unknown_contacts: formData.get("unknown_contacts") === "pendiente" ? "pendiente" : "publico",
      pending_message: text("pending_message"),
      handoff_message: text("handoff_message"),
      budget_exceeded_message: text("budget_exceeded_message"),
      monthly_budget_usd: budget,
      daily_limit_per_contact: dailyLimit,
      history_messages: historyMessages,
      alert_phone: text("alert_phone").replace(/\D/g, "") || null,
      alert_email: text("alert_email") || null,
      alert_template: text("alert_template") || null,
      updated_at: new Date().toISOString(),
    };
    if (!fields.instructions || !fields.pending_message || !fields.handoff_message || !fields.budget_exceeded_message) {
      return { error: "Completa las instrucciones y todos los mensajes automáticos." };
    }

    const { error } = await supabase.from("bot_settings").update(fields).eq("id", 1);
    if (error) {
      return {
        error: error.message.includes("alert_")
          ? "Falta correr supabase/migrations/006_notificaciones.sql en Supabase (SQL Editor)."
          : error.message,
      };
    }
    revalidatePath("/panel", "layout");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al guardar la configuración.") };
  }
  return { error: null };
}

// ============================================================
// PROBAR EL BOT (solo admin) — sin pasar por WhatsApp
// ============================================================

export interface TestBotState {
  error: string | null;
  history: HistoryTurn[];
  last: {
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    latencyMs: number;
    toolCalls: number;
    sources: string[];
    escalation: string | null;
  } | null;
}

export async function testBotAction(prev: TestBotState, formData: FormData): Promise<TestBotState> {
  if (formData.get("reset") === "true") return { error: null, history: [], last: null };
  try {
    await requireAppUser("admin");
    const message = String(formData.get("message") ?? "").trim();
    if (!message) return { ...prev, error: "Escribe una pregunta." };

    const level = parseLevel(formData.get("access_level"));
    const companyId = optionalId(formData.get("company_id"));

    const admin = createAdminClient();
    const settings = await getBotSettings(admin);
    let companyName: string | null = null;
    if (companyId) {
      const { data } = await admin.from("companies").select("name").eq("id", companyId).single();
      companyName = data?.name ?? null;
    }

    const reply = await generateReply({
      settings,
      contact: { name: "Prueba desde el portal", phone: null, level, companyId, companyName },
      history: prev.history,
      userText: message,
      adminClient: admin,
    });

    if (reply.alerts.length > 0) {
      await admin.from("kb_alerts").insert(
        reply.alerts.map((al) => ({ detail: al.detail, documents: al.documents, question: `(prueba) ${message}` }))
      );
    }

    await admin.from("ai_usage").insert({
      source: "prueba",
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

    return {
      error: null,
      history: [
        ...prev.history,
        { role: "user", text: message },
        {
          role: "assistant",
          text:
            [
              reply.text,
              ...reply.documents.map((d) => `📎 (se enviaría el archivo: ${d.title})`),
              ...(reply.accessRequest
                ? [`🔑 (se avisaría al equipo: solicita acceso ${reply.accessRequest.level})`]
                : []),
              ...reply.alerts.map((al) => `⚠️ (aviso interno para el equipo, el cliente no lo ve: ${al.detail})`),
            ]
              .filter(Boolean)
              .join("\n\n") || `(${settings.handoff_message})`,
        },
      ],
      last: {
        model: reply.model,
        costUsd: reply.costUsd,
        inputTokens: reply.usage.input_tokens + reply.usage.cache_read_tokens + reply.usage.cache_write_tokens,
        outputTokens: reply.usage.output_tokens,
        cacheReadTokens: reply.usage.cache_read_tokens,
        latencyMs: reply.latencyMs,
        toolCalls: reply.toolCalls,
        sources: reply.sources,
        escalation: reply.escalation,
      },
    };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { ...prev, error: errorMessage(err, "Error inesperado al probar el bot.") };
  }
}

// ============================================================
// EMPRESAS
// ============================================================

export async function createCompanyAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "El nombre es obligatorio." };
    const supabase = createClient();
    const { error } = await supabase.from("companies").insert({
      name,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    if (error) return { error: error.code === "23505" ? "Ya existe una empresa con ese nombre." : error.message };
    revalidatePath("/empresas");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "Error inesperado al crear la empresa.") };
  }
  return { error: null };
}

export async function deleteCompanyAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  await supabase.from("companies").delete().eq("id", String(formData.get("id")));
  revalidatePath("/empresas");
}

export async function resolveAlertAction(formData: FormData) {
  await requireAppUser();
  const supabase = createClient();
  await supabase.from("kb_alerts").update({ resolved: true }).eq("id", String(formData.get("id")));
  revalidatePath("/conocimiento");
}

/** Envía un aviso de prueba al WhatsApp/correo guardados en Configuración. */
export async function testNotificationAction(form?: {
  phone: string;
  email: string;
  template: string;
}): Promise<string> {
  await requireAppUser("admin");
  const saved = await getBotSettings(createAdminClient());
  // Se usa lo que está escrito en el formulario, aunque aún no se haya guardado.
  const settings = form
    ? {
        ...saved,
        alert_phone: form.phone.replace(/\D/g, "") || null,
        alert_email: form.email.trim() || null,
        alert_template: form.template.trim() || null,
      }
    : saved;
  const results = await notifyTeam(settings, {
    title: "Aviso de prueba",
    reason: "Si te llegó este mensaje, los avisos del bot están funcionando ✅",
    contactName: null,
    contactPhone: null,
  });
  return results.join(" · ");
}
