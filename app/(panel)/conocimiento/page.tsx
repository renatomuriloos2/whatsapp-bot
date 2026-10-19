import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAllCompanies } from "@/lib/data";
import { DocumentForm } from "@/components/whatsapp/DocumentForm";
import { BulkUploadForm } from "@/components/whatsapp/BulkUploadForm";
import { AccessLevelBadge } from "@/components/whatsapp/Badges";
import { renameCategoryAction, resolveAlertAction, toggleDocumentAction } from "@/lib/actions/whatsapp";
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
    .select("id, title, category, access_level, company_id, file_name, active, chunk_count, has_embeddings, updated_at, source_id")
    .order("updated_at", { ascending: false });
  if (q) query = query.or(`title.ilike.%${q.replace(/[%,()]/g, "")}%,category.ilike.%${q.replace(/[%,()]/g, "")}%`);

  const [{ data }, companies, { data: fileRows }, { data: alertRows }] = await Promise.all([
    query,
    getAllCompanies(supabase),
    supabase.from("kb_documents").select("file_name, category"),
    // Si la tabla aún no existe (falta la migración 005) simplemente no hay avisos.
    supabase
      .from("kb_alerts")
      .select("id, detail, documents, question, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const alerts = (alertRows ?? []) as {
    id: string;
    detail: string;
    documents: string | null;
    question: string | null;
    created_at: string;
  }[];
  const existingFileNames = (fileRows ?? []).filter((r) => r.file_name).map((r) => r.file_name as string);
  const categoryCounts = new Map<string, number>();
  for (const r of fileRows ?? []) {
    if (r.category) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
  }
  const categories = Array.from(categoryCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const docs = (data ?? []) as (Omit<KbDocument, "content" | "description" | "created_by" | "created_at"> & {
    source_id: string | null;
  })[];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Base de conocimiento</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Todo lo que el bot sabe sale de aquí: fichas técnicas, manuales, procedimientos, preguntas
        frecuentes. Cada documento tiene un nivel de acceso; el bot solo usa los documentos que el
        contacto puede ver.
      </p>

      {alerts.length > 0 && (
        <div className="card mb-6 border border-rethink-amber/40">
          <h2 className="text-sm font-medium text-rethink-amber">
            ⚠️ Documentos para revisar ({alerts.length})
          </h2>
          <p className="mb-3 mt-1 text-xs text-rethink-cream/50">
            El bot encontró contradicciones o datos dudosos entre documentos. Al cliente le respondió con la
            fuente más confiable (TDS o MSDS) sin mencionarlo. Corrige el documento y marca el aviso como resuelto.
          </p>
          <ul className="flex flex-col gap-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-lg bg-surface/5 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="text-sm text-rethink-cream/80">
                  <p>{a.detail}</p>
                  <p className="mt-1 text-xs text-rethink-cream/50">
                    {a.documents ? `Documentos: ${a.documents} · ` : ""}
                    {formatDate(a.created_at)}
                    {a.question ? ` · Pregunta: "${a.question}"` : ""}
                  </p>
                </div>
                <form action={resolveAlertAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn-secondary whitespace-nowrap text-xs">
                    Marcar resuelto
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-medium text-rethink-cream">
          Carga masiva — subir muchos archivos o una carpeta completa
        </summary>
        <p className="mb-4 mt-2 text-xs text-rethink-cream/50">
          Cada archivo se convierte en un documento cuyo título es el nombre del archivo. Se omiten
          los que ya están subidos (mismo nombre de archivo), los de más de 4 MB y los formatos no
          soportados. Se leen PDF, Word, Excel (.xlsx), PowerPoint (.pptx), imágenes, TXT y CSV.
        </p>
        <BulkUploadForm companies={companies} existingFileNames={existingFileNames} />
      </details>

      {categories.length > 0 && (
        <details className="card mb-6">
          <summary className="cursor-pointer text-sm font-medium text-rethink-cream">
            Categorías ({categories.length}) — renombrar o marcar como SGI
          </summary>
          <p className="mb-4 mt-2 text-xs text-rethink-cream/50">
            Si el nombre de la categoría contiene &quot;SGI&quot; (ej. &quot;SGI - Procedimientos&quot;), el bot usa esos
            documentos solo para preguntas del Sistema de Gestión (auditorías, procedimientos, consultas internas)
            y nunca para responder a clientes sobre productos.
          </p>
          <ul className="flex flex-col gap-2">
            {categories.map(([name, count]) => (
              <li key={name}>
                <form action={renameCategoryAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="from" value={name} />
                  <span className="min-w-[12rem] flex-1 text-sm text-rethink-cream/80">
                    {name} <span className="text-xs text-rethink-cream/50">({count})</span>
                  </span>
                  <input name="to" defaultValue={name} className="input max-w-xs flex-1" aria-label={`Nuevo nombre para ${name}`} />
                  <button type="submit" className="btn-secondary text-xs">
                    Renombrar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

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
                        {[d.source_id ? "Carpeta sincronizada" : null, d.category, d.file_name, d.company_id ? `Solo ${companyName.get(d.company_id) ?? "una empresa"}` : null]
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
