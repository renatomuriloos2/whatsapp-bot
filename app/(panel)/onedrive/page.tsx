import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { getAllCompanies } from "@/lib/data";
import { onedriveConfigured } from "@/lib/onedrive/graph";
import { AddSourceForm, PendingButton } from "@/components/whatsapp/OneDriveForms";
import { AccessLevelBadge } from "@/components/whatsapp/Badges";
import { CompanySelect, LevelSelect } from "@/components/whatsapp/LevelSelect";
import {
  deleteSourceAction,
  syncSourceAction,
  toggleSourceAction,
  updateSourceAccessAction,
} from "@/lib/actions/onedrive";
import { AccessLevel } from "@/types/database";

export const dynamic = "force-dynamic";
// La sincronización manual puede tardar (descarga e indexa archivos).
export const maxDuration = 60;

interface SourceRow {
  id: string;
  name: string;
  web_url: string | null;
  access_level: AccessLevel;
  company_id: string | null;
  category: string | null;
  enabled: boolean;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  file_count: number;
}

function formatDateTime(value: string | null) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

export default async function OneDrivePage() {
  await requireAppUser("admin");
  const supabase = createClient();
  const [{ data }, companies] = await Promise.all([
    supabase.from("kb_sources").select("*").order("created_at"),
    getAllCompanies(supabase),
  ]);
  const sources = (data ?? []) as SourceRow[];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const configured = onedriveConfigured();

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Carpetas de OneDrive</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Conecta carpetas de OneDrive o SharePoint y el bot usará sus archivos como base de
        conocimiento. Cada día se revisan solas: lo nuevo se agrega, lo modificado se vuelve a
        leer y lo borrado se quita. También puedes sincronizar a mano cuando quieras.
      </p>

      {!configured && (
        <div className="mb-6 rounded-xl border border-rethink-amber/30 bg-rethink-amber/10 px-4 py-3 text-sm text-rethink-amber">
          Falta conectar Microsoft: agrega en Vercel MS_TENANT_ID, MS_CLIENT_ID y MS_CLIENT_SECRET (los
          entrega TI al registrar la aplicación) y vuelve a desplegar.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {sources.length === 0 && (
            <div className="card text-sm text-rethink-cream/50">Aún no hay carpetas conectadas.</div>
          )}
          {sources.map((s) => (
            <div key={s.id} className={`card flex flex-col gap-3 ${s.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-rethink-cream">
                    {s.web_url ? (
                      <a href={s.web_url} target="_blank" rel="noreferrer" className="hover:underline">
                        {s.name} ↗
                      </a>
                    ) : (
                      s.name
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-rethink-cream/60">
                    <AccessLevelBadge level={s.access_level} />
                    {s.company_id && <span>Solo {companyName.get(s.company_id) ?? "una empresa"}</span>}
                    <span>{s.category ? `Categoría: ${s.category}` : "Categoría: nombre de subcarpeta"}</span>
                    <span>{s.file_count} documentos</span>
                    {!s.enabled && <span>· Pausada</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={syncSourceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <PendingButton pendingText="Sincronizando…">Sincronizar ahora</PendingButton>
                  </form>
                  <form action={toggleSourceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="enabled" value={String(!s.enabled)} />
                    <button type="submit" className="btn-secondary">
                      {s.enabled ? "Pausar" : "Reanudar"}
                    </button>
                  </form>
                </div>
              </div>

              <p className="text-xs text-rethink-cream/60">
                Última sincronización: {formatDateTime(s.last_synced_at)}
                {s.last_status ? ` — ${s.last_status}` : ""}
              </p>
              {s.last_error && (
                <pre className="whitespace-pre-wrap rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {s.last_error}
                </pre>
              )}

              <details>
                <summary className="cursor-pointer text-xs text-rethink-orange">Cambiar acceso o desconectar</summary>
                <form action={updateSourceAccessAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="id" value={s.id} />
                  <LevelSelect id={`level-${s.id}`} defaultValue={s.access_level} />
                  <CompanySelect
                    id={`company-${s.id}`}
                    companies={companies}
                    defaultValue={s.company_id}
                    label="Empresa"
                    emptyLabel="Todas las empresas"
                  />
                  <PendingButton pendingText="Guardando…">Guardar</PendingButton>
                </form>
                <form action={deleteSourceAction} className="mt-3">
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs text-red-400 hover:underline">
                    Desconectar carpeta y borrar sus documentos del bot (los archivos en OneDrive no se tocan)
                  </button>
                </form>
              </details>
            </div>
          ))}
        </div>

        <div className="card h-fit">
          <h3 className="mb-1 text-sm font-medium text-rethink-cream">Conectar carpeta</h3>
          <p className="mb-4 text-xs text-rethink-cream/50">
            En OneDrive, sobre la carpeta: Compartir → Copiar vínculo, y pégalo aquí. Se leen PDF,
            Word, TXT, Markdown y CSV de hasta 15 MB, incluidas las subcarpetas.
          </p>
          <AddSourceForm companies={companies} />
        </div>
      </div>
    </div>
  );
}
