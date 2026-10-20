import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAllCompanies } from "@/lib/data";
import { ContactForm } from "@/components/whatsapp/ContactForm";
import { AccessLevelBadge, ContactStatusBadge } from "@/components/whatsapp/Badges";
import { cn } from "@/lib/utils";
import { WaContact } from "@/types/database";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "Todos" },
  { key: "atencion", label: "Requieren atención" },
  { key: "pendiente", label: "Pendientes" },
  { key: "humano", label: "Atendidos por humano" },
  { key: "bloqueado", label: "Bloqueados" },
];

function timeAgo(value: string | null): string {
  if (!value) return "—";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export default async function ContactosPage(props: {
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const filter = searchParams.f ?? "";
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, "");

  let query = supabase
    .from("wa_contacts")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(300);
  if (filter === "atencion") query = query.eq("needs_attention", true);
  if (filter === "pendiente") query = query.eq("status", "pendiente");
  if (filter === "bloqueado") query = query.eq("status", "bloqueado");
  if (filter === "humano") query = query.eq("bot_paused", true);
  if (q) query = query.or(`phone.ilike.%${q}%,display_name.ilike.%${q}%,profile_name.ilike.%${q}%`);

  const [{ data }, companies] = await Promise.all([query, getAllCompanies(supabase)]);
  const contacts = (data ?? []) as WaContact[];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Contactos y conversaciones</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Cada número que escribe al WhatsApp aparece aquí. Vincúlalo a su empresa y sube su nivel de
        acceso para liberarle información reservada.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card overflow-x-auto">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <nav className="flex flex-wrap gap-1" aria-label="Filtrar contactos">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={f.key ? `/conversaciones?f=${f.key}` : "/conversaciones"}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs",
                    filter === f.key
                      ? "bg-rethink-orange/15 text-rethink-orange"
                      : "text-rethink-cream/60 hover:bg-surface/10"
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            <form className="flex gap-2">
              {filter && <input type="hidden" name="f" value={filter} />}
              <input name="q" defaultValue={q} placeholder="Nombre o número" className="input w-44" />
              <button type="submit" className="btn-secondary">
                Buscar
              </button>
            </form>
          </div>

          {contacts.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">No hay contactos con este filtro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                  <th className="py-2 pr-4 font-normal">Contacto</th>
                  <th className="py-2 pr-4 font-normal">Empresa</th>
                  <th className="py-2 pr-4 font-normal">Acceso</th>
                  <th className="py-2 pr-4 font-normal">Estado</th>
                  <th className="py-2 pr-4 font-normal">Último mensaje</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/conversaciones/${c.id}`} className="group block">
                        <span className="text-rethink-cream/90 group-hover:text-rethink-orange group-hover:underline">
                          {c.display_name ?? c.profile_name ?? "Sin nombre"}
                        </span>
                        <span className="block text-xs text-rethink-cream/50">
                          +{c.phone}
                          {c.needs_attention && <span className="ml-2 text-rethink-amber">● atención</span>}
                          {c.bot_paused && <span className="ml-2 text-rethink-cream/60">👤 humano</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-rethink-cream/80">
                      {c.company_id ? companyName.get(c.company_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <AccessLevelBadge level={c.access_level} />
                    </td>
                    <td className="py-2 pr-4">
                      <ContactStatusBadge status={c.status} />
                    </td>
                    <td className="py-2 pr-4 text-rethink-cream/70">{timeAgo(c.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card h-fit">
          <h3 className="mb-1 text-sm font-medium text-rethink-cream">Registrar contacto</h3>
          <p className="mb-4 text-xs text-rethink-cream/50">
            Pre-registra a un contacto de confianza para que desde su primer mensaje tenga el nivel
            de acceso correcto.
          </p>
          <ContactForm companies={companies} />
        </div>
      </div>
    </div>
  );
}
