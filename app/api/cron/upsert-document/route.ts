import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexDocument } from "@/lib/knowledge";
import { ACCESS_LEVELS } from "@/lib/ai/models";
import { AccessLevel } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Crea o actualiza un documento de la base de conocimiento desde un proceso
// externo (ej. el rastreo diario del Portal SGI en GitHub Actions).
// Authorization: Bearer CRON_SECRET. El documento se identifica por `key`.
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    title?: string;
    category?: string;
    access_level?: string;
    content?: string;
  } | null;
  const key = body?.key?.trim();
  const title = body?.title?.trim();
  const content = body?.content?.trim();
  if (!key || !title || !content) {
    return NextResponse.json({ error: "Faltan key, title o content." }, { status: 400 });
  }
  const level = (ACCESS_LEVELS.includes(body?.access_level as AccessLevel) ? body?.access_level : "confidencial") as AccessLevel;

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("kb_documents")
    .select("id, content")
    .is("source_id", null)
    .eq("external_id", key)
    .maybeSingle();

  if (existing && existing.content === content) {
    return NextResponse.json({ ok: true, status: "sin cambios" });
  }

  const fields = {
    title,
    category: body?.category?.trim() || null,
    access_level: level,
    content,
    external_id: key,
    updated_at: new Date().toISOString(),
  };
  const { data: doc, error } = existing
    ? await supabase.from("kb_documents").update(fields).eq("id", existing.id).select("id, title, content").single()
    : await supabase.from("kb_documents").insert(fields).select("id, title, content").single();
  if (error || !doc) return NextResponse.json({ error: error?.message ?? "No se pudo guardar." }, { status: 500 });

  const { chunkCount } = await indexDocument(supabase, doc);
  return NextResponse.json({ ok: true, status: existing ? "actualizado" : "creado", chunks: chunkCount });
}
