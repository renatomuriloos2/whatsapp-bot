export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value + (value.length === 10 ? "T00:00:00" : ""));
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  agente: "Agente",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
