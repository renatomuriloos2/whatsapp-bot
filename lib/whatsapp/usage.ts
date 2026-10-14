import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyPoint } from "@/components/whatsapp/DailyCostChart";

export interface UsageRow {
  contact_id: string | null;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  created_at: string;
}

export function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function monthStart(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Filas de uso desde una fecha (RLS: solo admin las puede leer). */
export async function getUsageSince(supabase: SupabaseClient, since: Date): Promise<UsageRow[]> {
  const rows: UsageRow[] = [];
  // Paginado: PostgREST devuelve máximo 1000 filas por petición.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ai_usage")
      .select("contact_id, source, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export function dailySeries(rows: UsageRow[], days: number): DailyPoint[] {
  const byDay = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const date = daysAgo(i).toISOString().slice(0, 10);
    byDay.set(date, { date, cost: 0, replies: 0 });
  }
  for (const r of rows) {
    const point = byDay.get(r.created_at.slice(0, 10));
    if (point) {
      point.cost += r.cost_usd;
      point.replies += 1;
    }
  }
  return Array.from(byDay.values());
}

export function sumUsage(rows: UsageRow[]) {
  const total = { cost: 0, replies: rows.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const r of rows) {
    total.cost += r.cost_usd;
    total.input += r.input_tokens;
    total.output += r.output_tokens;
    total.cacheRead += r.cache_read_tokens;
    total.cacheWrite += r.cache_write_tokens;
  }
  return total;
}

/** % de tokens de entrada servidos desde la caché de prompts. */
export function cacheHitRate(t: ReturnType<typeof sumUsage>): number {
  const totalIn = t.input + t.cacheRead + t.cacheWrite;
  return totalIn > 0 ? (t.cacheRead / totalIn) * 100 : 0;
}

export function groupBy<K extends string>(rows: UsageRow[], key: (r: UsageRow) => K) {
  const map = new Map<K, UsageRow[]>();
  for (const r of rows) {
    const k = key(r);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}
