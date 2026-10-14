import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAllCompanies } from "@/lib/data";
import { DocumentForm } from "@/components/whatsapp/DocumentForm";
import { AccessLevelBadge } from "@/components/whatsapp/Badges";
import { toggleDocumentAction } from "@/lib/actions/whatsapp";
import { formatDate } from "@/lib/utils";
import { KbDocument } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ConocimientoPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const supabase = createClient();
  const q = searchParams.q?.trim() ?? "";

  let query = supabase
    .from("kb_documents")
    .select("id, title, category, access_level, company_id, file_name, active, chunk_count, has_embeddings, updated_at")
    .order("updated_at", { ascending: false });
  if (q) query = query.or(`title.ilike.%${q.replace(/[%,()]/g, "")}%,category.ilike.%${q.replace(/[%,()]/g, "")}%`);

  const [{ data }, companies] = await Promise.all([query, getAllCompanies(supabase)]);
  const docs = (data ?? []) as Omit<KbDocument, "content" | "description" | "created_by" | "created_at">[];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Base de conocimiento</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Todo lo que el bot sabe sale de aquí: fichas técnicas, manuales, procedimientos, preguntas
        frecuentes. Cada documento tiene un nivel de acceso; el bot solo usa los documentos que el
        contacto puede ver.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card overflow-x-auto">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-rethink-cream">Documentos ({docs.length})</h3>
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="Buscar por título o categoría" className="input w-56" />
              <button type="submit" className="btn-secondary">
                Buscar
              </button>
            </form>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">
              {q ? "Ningún documento coincide." : "Aún no hay documentos. Sube el primero con el formulario."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                  <th className="py-2 pr-4 font-normal">Documento</th>
                  <th className="py-2 pr-4 font-normal">Acceso</th>
                  <th className="py-2 pr-4 font-normal">Fragmentos</th>
                  <th className="py-2 pr-4 font-normal">Actualizado</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className={`border-b border-white/5 last:border-0 ${d.active ? "" : "opacity-50"}`}>
                    <td className="py-2 pr-4">
                      <p className="text-rethink-cream/90">{d.title}</p>
                      <p className="text-xs text-rethink-cream/50">
                        {[d.category, d.file_name, d.company_id ? `Solo ${companyName.get(d.company_id) ?? "una empresa"}` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="py-2 pr-4">
                      <AccessLevelBadge level={d.access_level} />
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-rethink-cream/80">
                      {d.chunk_count}
                      {d.has_embeddings && (
                        <span className="ml-1 text-xs text-rethink-cream/40" title="Con búsqueda semántica">
                          ✦
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-rethink-cream/80">{formatDate(d.updated_at)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <form action={toggleDocumentAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="active" value={String(!d.active)} />
                          <button type="submit" className="text-rethink-cream/70 hover:underline">
                            {d.active ? "Desactivar" : "Activar"}
                          </button>
                        </form>
                        <Link href={`/conocimiento/${d.id}`} className="text-rethink-orange hover:underline">
                          Editar
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card h-fit">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Agregar conocimiento</h3>
          <DocumentForm companies={companies} />
        </div>
      </div>
    </div>
  );
}
