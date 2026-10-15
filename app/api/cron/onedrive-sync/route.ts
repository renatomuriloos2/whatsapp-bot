import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onedriveConfigured } from "@/lib/onedrive/graph";
import { syncAllSources } from "@/lib/onedrive/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sincroniza las carpetas de OneDrive. Lo llama Vercel Cron (ver vercel.json)
// o cualquier servicio de cron externo con el header
// Authorization: Bearer CRON_SECRET.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!onedriveConfigured()) {
    return NextResponse.json({ ok: false, error: "OneDrive no configurado" });
  }
  // Se deja margen bajo el límite de 60 s de la función.
  const results = await syncAllSources(createAdminClient(), Date.now() + 45_000);
  return NextResponse.json({ ok: true, results });
}
