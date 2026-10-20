import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getBotSettings } from "@/lib/whatsapp/bot";
import { cacheHitRate, dailySeries, daysAgo, getUsageSince, groupBy, monthStart, sumUsage } from "@/lib/whatsapp/usage";
import { formatUsd, modelLabel } from "@/lib/ai/models";
import { BudgetMeter, Stat } from "@/components/whatsapp/Badges";
import { DailyCostChart } from "@/components/whatsapp/DailyCostChart";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const fmtInt = (n: number) => n.toLocaleString("es-CO");

export default async function CostosPage() {
  await requireAppUser("admin");
  const supabase = await createClient();

  const since = daysAgo(29);
  const [settings, rows] = await Promise.all([getBotSettings(supabase), getUsageSince(supabase, since)]);

  const start = monthStart();
  const monthRows = rows.filter((r) => new Date(r.created_at) >= start);
  const month = sumUsage(monthRows);
  const last30 = sumUsage(rows);

  // Proyección lineal al cierre del mes con el ritmo de este mes.
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = (month.cost / dayOfMonth) * daysInMonth;
  const projectedTone =
    projected > settings.monthly_budget_usd ? "danger" : projected > settings.monthly_budget_usd * 0.8 ? "warn" : undefined;

  const byModel = Array.from(groupBy(rows, (r) => r.model).entries())
    .map(([model, list]) => ({ model, ...sumUsage(list) }))
    .sort((a, b) => b.cost - a.cost);

  const byContactMap = groupBy(
    rows.filter((r) => r.contact_id),
    (r) => r.contact_id as string
  );
  const topContacts = Array.from(byContactMap.entries())
    .map(([id, list]) => ({ id, ...sumUsage(list) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
  const { data: contactRows } = topContacts.length
    ? await supabase
        .from("wa_contacts")
        .select("id, phone, display_name, profile_name")
        .in("id", topContacts.map((c) => c.id))
    : { data: [] };
  const contactName = new Map(
    (contactRows ?? []).map((c) => [c.id, c.display_name ?? c.profile_name ?? `+${c.phone}`])
  );

  const testCost = sumUsage(rows.filter((r) => r.source === "prueba")).cost;
  const docsCost = sumUsage(rows.filter((r) => r.source === "documentos")).cost;
  const whatsappRows = rows.filter((r) => r.source === "whatsapp");
  const perReply = whatsappRows.length ? sumUsage(whatsappRows).cost / whatsappRows.length : 0;
  const daily = dailySeries(rows, 30);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Costos de IA</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Consumo de tokens y costo estimado según la tarifa pública de Anthropic. El valor exacto de
        tu factura está en console.anthropic.com → Usage.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Gastado este mes"
          value={formatUsd(month.cost)}
          hint={`de ${formatUsd(settings.monthly_budget_usd)} de presupuesto`}
        />
        <Stat
          label="Proyección a fin de mes"
          value={formatUsd(projected)}
          hint="al ritmo actual"
          tone={projectedTone}
        />
        <Stat
          label="Costo medio por respuesta"
          value={formatUsd(last30.replies ? last30.cost / last30.replies : 0, 4)}
          hint={`${fmtInt(last30.replies)} respuestas en 30 días`}
        />
        <Stat
          label="Entrada servida desde caché"
          value={`${cacheHitRate(last30).toFixed(0)}%`}
          hint="más alto = más barato"
        />
      </div>

      <div className="card mb-6">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium text-rethink-cream">Costo diario, últimos 30 días (USD)</h3>
          <Link href="/configuracion" className="text-xs text-rethink-orange hover:underline">
            Ajustar presupuesto y límites
          </Link>
        </div>
        <div className="mb-4 max-w-sm">
          <BudgetMeter spent={month.cost} budget={settings.monthly_budget_usd} />
        </div>
        <DailyCostChart data={daily} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Por modelo (30 días)</h3>
          {byModel.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">Sin consumo todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                  <th className="py-2 pr-4 font-normal">Modelo</th>
                  <th className="py-2 pr-4 text-right font-normal">Respuestas</th>
                  <th className="py-2 pr-4 text-right font-normal">Tokens entrada</th>
                  <th className="py-2 pr-4 text-right font-normal">Tokens salida</th>
                  <th className="py-2 text-right font-normal">Costo</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {byModel.map((m) => (
                  <tr key={m.model} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4 text-rethink-cream/90">{modelLabel(m.model)}</td>
                    <td className="py-2 pr-4 text-right text-rethink-cream/80">{fmtInt(m.replies)}</td>
                    <td className="py-2 pr-4 text-right text-rethink-cream/80">
                      {fmtInt(m.input + m.cacheRead + m.cacheWrite)}
                    </td>
                    <td className="py-2 pr-4 text-right text-rethink-cream/80">{fmtInt(m.output)}</td>
                    <td className="py-2 text-right text-rethink-cream/90">{formatUsd(m.cost, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {testCost > 0 && (
            <p className="mt-3 text-xs text-rethink-cream/50">
              Incluye {formatUsd(testCost, 4)} de pruebas desde el portal.
            </p>
          )}
          {docsCost > 0 && (
            <p className="mt-1 text-xs text-rethink-cream/50">
              Incluye {formatUsd(docsCost, 4)} de lectura de imágenes al subir documentos.
            </p>
          )}
          {perReply > 0 && (
            <p className="mt-1 text-xs text-rethink-cream/50">
              Costo promedio por respuesta del bot en WhatsApp: {formatUsd(perReply, 4)} ({whatsappRows.length}{" "}
              respuestas).
            </p>
          )}
        </div>

        <div className="card overflow-x-auto">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Contactos con más consumo (30 días)</h3>
          {topContacts.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">Sin consumo todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                  <th className="py-2 pr-4 font-normal">Contacto</th>
                  <th className="py-2 pr-4 text-right font-normal">Respuestas</th>
                  <th className="py-2 text-right font-normal">Costo</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {topContacts.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/conversaciones/${c.id}`} className="text-rethink-cream/90 hover:underline">
                        {contactName.get(c.id) ?? "Contacto"}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right text-rethink-cream/80">{fmtInt(c.replies)}</td>
                    <td className="py-2 text-right text-rethink-cream/90">{formatUsd(c.cost, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium text-rethink-cream">
          Ver tabla diaria
        </summary>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-rethink-cream/50">
              <th className="py-2 pr-4 font-normal">Día</th>
              <th className="py-2 pr-4 text-right font-normal">Respuestas</th>
              <th className="py-2 text-right font-normal">Costo</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...daily].reverse().map((d) => (
              <tr key={d.date} className="border-b border-white/5 last:border-0">
                <td className="py-1.5 pr-4 text-rethink-cream/80">{formatDate(d.date)}</td>
                <td className="py-1.5 pr-4 text-right text-rethink-cream/80">{d.replies}</td>
                <td className="py-1.5 text-right text-rethink-cream/90">{formatUsd(d.cost, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="mt-6 card text-xs text-rethink-cream/60">
        <h3 className="mb-2 text-sm font-medium text-rethink-cream">Cómo bajar el costo</h3>
        <ul className="list-disc space-y-1 pl-4">
          <li>Bajar el <em>esfuerzo de razonamiento</em> a “Bajo” suele bastar para preguntas frecuentes.</li>
          <li>Claude Sonnet 5.5 cuesta la mitad que Opus 5.5; Haiku 5.5 es mucho más barato para consultas simples.</li>
          <li>Recordar menos mensajes previos reduce los tokens de entrada de cada respuesta.</li>
          <li>Documentos cortos y bien titulados hacen que el bot encuentre la respuesta con menos búsquedas.</li>
        </ul>
      </div>
    </div>
  );
}
