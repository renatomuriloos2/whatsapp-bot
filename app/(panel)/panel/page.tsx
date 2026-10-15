import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getBotSettings } from "@/lib/whatsapp/bot";
import { whatsappConfigured } from "@/lib/whatsapp/cloud-api";
import { embeddingsEnabled } from "@/lib/knowledge";
import { gdriveConfigured } from "@/lib/sources/gdrive";
import { cacheHitRate, dailySeries, getUsageSince, monthStart, sumUsage } from "@/lib/whatsapp/usage";
import { formatUsd, modelLabel } from "@/lib/ai/models";
import { BudgetMeter, Stat } from "@/components/whatsapp/Badges";
import { DailyCostChart } from "@/components/whatsapp/DailyCostChart";
import { WaContact } from "@/types/database";

export const dynamic = "force-dynamic";

function SetupItem({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden className={ok ? "text-rethink-green" : "text-rethink-amber"}>
        {ok ? "✓" : "!"}
      </span>
      <span>
        <span className="text-rethink-cream/90">{label}</span>
        <span className="sr-only">{ok ? " (listo)" : " (pendiente)"}</span>
        {!ok && <span className="block text-xs text-rethink-cream/50">{hint}</span>}
      </span>
    </li>
  );
}

export default async function WhatsAppDashboardPage() {
  const appUser = await requireAppUser();
  const isAdmin = appUser.role === "admin";
  const supabase = createClient();

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [settings, attention, docsCount, contactsCount, inToday, usageRows] = await Promise.all([
    getBotSettings(supabase),
    supabase
      .from("wa_contacts")
      .select("*")
      .eq("needs_attention", true)
      .order("last_message_at", { ascending: false })
      .limit(10)
      .then((r) => (r.data ?? []) as WaContact[]),
    supabase.from("kb_documents").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("wa_contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .gte("created_at", dayStart.toISOString()),
    isAdmin ? getUsageSince(supabase, monthStart()) : Promise.resolve([]),
  ]);

  const month = sumUsage(usageRows.filter((r) => r.source === "whatsapp"));
  const monthAll = sumUsage(usageRows);
  const budgetPct = settings.monthly_budget_usd > 0 ? (monthAll.cost / settings.monthly_budget_usd) * 100 : 0;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Asistente de WhatsApp</h1>
          <p className="text-sm text-rethink-cream/60">
            {settings.enabled ? "🟢 Activo" : "⚪ Apagado"} · {modelLabel(settings.model)} · responde con la
            base de conocimiento según el nivel de acceso de cada contacto.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/conocimiento" className="btn-primary">
            Subir conocimiento
          </Link>
          {isAdmin && (
            <Link href="/probar" className="btn-secondary">
              Probar el bot
            </Link>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Mensajes recibidos hoy" value={String(inToday.count ?? 0)} />
        <Stat label="Contactos" value={String(contactsCount.count ?? 0)} />
        <Stat label="Documentos activos" value={String(docsCount.count ?? 0)} />
        <Stat
          label="Requieren atención"
          value={String(attention.length)}
          tone={attention.length > 0 ? "warn" : undefined}
        />
      </div>

      {isAdmin && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <div className="card flex flex-col gap-3">
            <h3 className="text-sm font-medium text-rethink-cream">Presupuesto del mes</h3>
            <p className="text-2xl font-semibold tabular-nums text-rethink-cream">
              {formatUsd(monthAll.cost)}
              <span className="text-sm font-normal text-rethink-cream/50">
                {" "}
                de {formatUsd(settings.monthly_budget_usd)}
              </span>
            </p>
            <BudgetMeter spent={monthAll.cost} budget={settings.monthly_budget_usd} />
            <p className="text-xs text-rethink-cream/50">
              {budgetPct.toFixed(0)}% usado · {month.replies} respuestas por WhatsApp · costo medio{" "}
              {formatUsd(month.replies ? month.cost / month.replies : 0, 4)} · caché{" "}
              {cacheHitRate(monthAll).toFixed(0)}%
            </p>
            <Link href="/costos" className="text-xs text-rethink-orange hover:underline">
              Ver detalle de costos
            </Link>
          </div>
          <div className="card">
            <h3 className="mb-4 text-sm font-medium text-rethink-cream">Costo diario de IA (este mes, USD)</h3>
            <DailyCostChart data={dailySeries(usageRows, new Date().getUTCDate())} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card overflow-x-auto">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-rethink-cream">Conversaciones que requieren atención</h3>
            <Link href="/conversaciones" className="text-xs text-rethink-orange hover:underline">
              Ver todas
            </Link>
          </div>
          {attention.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">Nada pendiente. El bot está resolviendo solo. ✨</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {attention.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-rethink-cream/90">
                      {c.display_name ?? c.profile_name ?? `+${c.phone}`}
                    </p>
                    <p className="truncate text-xs text-rethink-cream/50">{c.attention_reason}</p>
                  </div>
                  <Link
                    href={`/conversaciones/${c.id}`}
                    className="shrink-0 text-xs text-rethink-orange hover:underline"
                  >
                    Abrir chat
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-rethink-cream">Estado de la integración</h3>
          <ul className="flex flex-col gap-2">
            <SetupItem
              ok={whatsappConfigured()}
              label="WhatsApp Cloud API"
              hint="Faltan variables WHATSAPP_* en Vercel (ver README, paso 5)."
            />
            <SetupItem ok={hasKey} label="Claude (Anthropic)" hint="Falta ANTHROPIC_API_KEY." />
            <SetupItem
              ok={embeddingsEnabled()}
              label="Búsqueda semántica (opcional)"
              hint="Sin VOYAGE_API_KEY se usa solo búsqueda por texto completo."
            />
            <SetupItem
              ok={gdriveConfigured()}
              label="Google Drive (opcional)"
              hint="Sin GOOGLE_SERVICE_ACCOUNT_JSON no se sincronizan carpetas."
            />
            <SetupItem
              ok={(docsCount.count ?? 0) > 0}
              label="Base de conocimiento"
              hint="Sube al menos un documento para que el bot tenga qué responder."
            />
          </ul>
        </div>
      </div>
    </div>
  );
}
