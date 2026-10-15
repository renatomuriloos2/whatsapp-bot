"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAppUser } from "@/lib/auth";
import { ActionState, isRedirectError } from "@/lib/action-state";
import { ACCESS_LEVELS } from "@/lib/ai/models";
import { detectProvider, providerConfigured, resolveFolder } from "@/lib/sources";
import { syncSource } from "@/lib/sources/sync";
import type { KbSource } from "@/lib/sources/types";
import { AccessLevel } from "@/types/database";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function addSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAppUser("admin");
    const shareUrl = String(formData.get("share_url") ?? "").trim();
    if (!shareUrl) return { error: "Pega el vínculo de la carpeta." };
    const provider = detectProvider(shareUrl);
    if (!provider) {
      return { error: "No reconozco el enlace. Debe ser de una carpeta de Google Drive (drive.google.com) u OneDrive." };
    }
    if (!providerConfigured(provider)) {
      return {
        error:
          provider === "gdrive"
            ? "Google Drive aún no está conectado: falta GOOGLE_SERVICE_ACCOUNT_JSON en Vercel."
            : "OneDrive aún no está conectado: faltan las variables MS_* en Vercel.",
      };
    }

    const level = String(formData.get("access_level") ?? "publico") as AccessLevel;
    const folder = await resolveFolder(provider, shareUrl);

    const supabase = createClient();
    const { data: source, error } = await supabase
      .from("kb_sources")
      .insert({
        provider,
        name: String(formData.get("name") ?? "").trim() || folder.name,
        share_url: shareUrl,
        drive_id: folder.driveId,
        item_id: folder.itemId,
        web_url: folder.webUrl,
        access_level: ACCESS_LEVELS.includes(level) ? level : "publico",
        company_id: String(formData.get("company_id") ?? "").trim() || null,
        category: String(formData.get("category") ?? "").trim() || null,
      })
      .select("*")
      .single();
    if (error) {
      return { error: error.code === "23505" ? "Esa carpeta ya está conectada." : error.message };
    }

    // Primera sincronización inmediata (lo que no alcance, sigue después).
    await syncSource(createAdminClient(), source as KbSource, Date.now() + 40_000);
    revalidatePath("/carpetas");
    revalidatePath("/conocimiento");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: errorMessage(err, "No se pudo conectar la carpeta.") };
  }
  return { error: null };
}

export async function syncSourceAction(formData: FormData) {
  await requireAppUser("admin");
  const admin = createAdminClient();
  const { data: source } = await admin.from("kb_sources").select("*").eq("id", String(formData.get("id"))).single();
  if (source) await syncSource(admin, source as KbSource, Date.now() + 45_000);
  revalidatePath("/carpetas");
  revalidatePath("/conocimiento");
}

export async function toggleSourceAction(formData: FormData) {
  await requireAppUser("admin");
  const supabase = createClient();
  await supabase
    .from("kb_sources")
    .update({ enabled: formData.get("enabled") === "true" })
    .eq("id", String(formData.get("id")));
  revalidatePath("/carpetas");
}

export async function updateSourceAccessAction(formData: FormData) {
  await requireAppUser("admin");
  const supabase = createClient();
  const id = String(formData.get("id"));
  const level = String(formData.get("access_level")) as AccessLevel;
  if (!ACCESS_LEVELS.includes(level)) return;
  const companyId = String(formData.get("company_id") ?? "").trim() || null;
  await supabase.from("kb_sources").update({ access_level: level, company_id: companyId }).eq("id", id);
  // Los documentos ya sincronizados toman el nuevo nivel de inmediato.
  await supabase.from("kb_documents").update({ access_level: level, company_id: companyId }).eq("source_id", id);
  revalidatePath("/carpetas");
  revalidatePath("/conocimiento");
}

export async function deleteSourceAction(formData: FormData) {
  await requireAppUser("admin");
  const supabase = createClient();
  // Sus documentos se borran en cascada (kb_documents.source_id).
  await supabase.from("kb_sources").delete().eq("id", String(formData.get("id")));
  revalidatePath("/carpetas");
  revalidatePath("/conocimiento");
}
