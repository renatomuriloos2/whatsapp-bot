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
const MIN_LINKS = 10;

/** Enlaces http(s) distintos y bien formados del documento. */
function countLinks(text: string): number {
  const urls = new Set<string>();
  for (const raw of text.match(/https?:\/\/[^\s)<>"]+/g) ?? []) {
    try {
      urls.add(new URL(raw).href);
    } catch {
      // URL mal formada: no cuenta.
    }
  }
  return urls.size;
}

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
  // Solo documentos autorizados (por defecto, la lista del Portal SGI): si la
  // clave se filtrara, no serviría para meter otros documentos en el bot.
  const allowed = (process.env.UPSERT_DOCUMENT_KEYS || "portal-sgi-enlaces").split(",").map((k) => k.trim());
  if (!allowed.includes(key)) {
    return NextResponse.json({ error: "Documento no autorizado." }, { status: 403 });
  }
  if (content.length > 2_000_000) {
    return NextResponse.json({ error: "Contenido demasiado grande." }, { status: 413 });
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

  // Freno: si el rastreo falló a medias (Canva no cargó, sitio caído), no se
  // reemplaza la lista vigente por una mucho más corta.
  const links = countLinks(content);
  if (links < MIN_LINKS) {
    return NextResponse.json({ error: `Solo ${links} enlaces válidos (mínimo ${MIN_LINKS}); no se reemplaza.` }, { status: 422 });
  }
  if (existing && links < countLinks(existing.content ?? "") * 0.5) {
    return NextResponse.json(
      { error: `La lista nueva tiene ${links} enlaces, menos de la mitad de la vigente; no se reemplaza.` },
      { status: 422 }
    );
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
