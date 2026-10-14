import { cn } from "@/lib/utils";
import { AccessLevel, ContactStatus } from "@/types/database";
import { ACCESS_LEVEL_LABELS } from "@/lib/ai/models";

const LEVEL_STYLES: Record<AccessLevel, string> = {
  publico: "bg-surface/10 text-rethink-cream/70",
  cliente: "bg-rethink-green/20 text-rethink-green",
  confidencial: "bg-rethink-orange/20 text-rethink-orange",
};

export function AccessLevelBadge({ level }: { level: AccessLevel }) {
  return <span className={cn("badge", LEVEL_STYLES[level])}>{ACCESS_LEVEL_LABELS[level]}</span>;
}

const STATUS_STYLES: Record<ContactStatus, string> = {
  activo: "bg-rethink-green/20 text-rethink-green",
  pendiente: "bg-rethink-amber/20 text-rethink-amber",
  bloqueado: "bg-red-500/20 text-red-400",
};

const STATUS_TEXT: Record<ContactStatus, string> = {
  activo: "Activo",
  pendiente: "Pendiente",
  bloqueado: "Bloqueado",
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <span className={cn("badge", STATUS_STYLES[status])}>{STATUS_TEXT[status]}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="card">
      <p className="text-xs text-rethink-cream/60">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" ? "text-red-400" : tone === "warn" ? "text-rethink-amber" : "text-rethink-cream"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-rethink-cream/50">{hint}</p>}
    </div>
  );
}

/** Barra de consumo del presupuesto mensual. */
export function BudgetMeter({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 100;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface/10"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={budget}
      aria-valuenow={spent}
      aria-label="Consumo del presupuesto mensual"
    >
      <div
        className={cn(
          "h-full rounded-full",
          pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-rethink-amber" : "bg-rethink-green"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
