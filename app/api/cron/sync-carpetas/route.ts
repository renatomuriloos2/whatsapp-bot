import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAllSources } from "@/lib/sources/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rondas seguidas como máximo en una misma sincronización diaria.
const MAX_ROUNDS = 10;

// Sincroniza las carpetas y sitios conectados. Lo llama Vercel Cron (ver vercel.json)
// o cualquier servicio de cron externo con el header
// Authorization: Bearer CRON_SECRET.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  // Se deja margen bajo el límite de 60 s de la función.
  const results = await syncAllSources(createAdminClient(), Date.now() + 45_000);

  // Si quedaron archivos pendientes, se lanza otra ronda en una función
  // nueva en lugar de esperar al día siguiente.
  const url = new URL(request.url);
  const round = Number(url.searchParams.get("round") ?? "1");
  const pending = results.some((r) => !r.result.complete && r.result.added + r.result.updated > 0);
  if (pending && round < MAX_ROUNDS) {
    url.searchParams.set("round", String(round + 1));
    waitUntil(
      fetch(url, {
        headers: { authorization: `Bearer ${cronSecret}` },
        // Solo hace falta que la petición salga; la otra ronda sigue sola.
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {})
    );
  }
  return NextResponse.json({ ok: true, round, results });
}
