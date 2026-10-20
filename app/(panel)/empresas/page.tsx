import { createClient } from "@/lib/supabase/server";
import { getAllCompanies } from "@/lib/data";
import { CompanyForm } from "@/components/whatsapp/CompanyForm";
import { deleteCompanyAction } from "@/lib/actions/whatsapp";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EmpresasPage() {
  const supabase = await createClient();
  const [companies, { data: contactRows }, { data: docRows }] = await Promise.all([
    getAllCompanies(supabase),
    supabase.from("wa_contacts").select("company_id").not("company_id", "is", null),
    supabase.from("kb_documents").select("company_id").not("company_id", "is", null),
  ]);

  const count = (rows: { company_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) map.set(r.company_id, (map.get(r.company_id) ?? 0) + 1);
    return map;
  };
  const contacts = count(contactRows);
  const docs = count(docRows);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Empresas</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Las empresas cliente a las que pertenecen tus contactos. Sirven para dos cosas: ver de
        qué empresa es cada chat y subir documentos exclusivos de una empresa (por ejemplo, su
        programa de tratamiento), que solo verán sus contactos.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card overflow-x-auto">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Empresas ({companies.length})</h3>
          {companies.length === 0 ? (
            <p className="text-sm text-rethink-cream/50">Aún no hay empresas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                  <th className="py-2 pr-4 font-normal">Empresa</th>
                  <th className="py-2 pr-4 text-right font-normal">Contactos</th>
                  <th className="py-2 pr-4 text-right font-normal">Documentos exclusivos</th>
                  <th className="py-2 pr-4 font-normal">Creada</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4">
                      <p className="text-rethink-cream/90">{c.name}</p>
                      {c.notes && <p className="text-xs text-rethink-cream/50">{c.notes}</p>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-rethink-cream/80">{contacts.get(c.id) ?? 0}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-rethink-cream/80">{docs.get(c.id) ?? 0}</td>
                    <td className="py-2 pr-4 text-rethink-cream/80">{formatDate(c.created_at)}</td>
                    <td className="py-2 text-right">
                      <form action={deleteCompanyAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="text-red-400 hover:underline" title="Borra también sus documentos exclusivos">
                          Eliminar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-xs text-rethink-cream/40">
            Al eliminar una empresa se borran sus documentos exclusivos; sus contactos quedan sin empresa.
          </p>
        </div>

        <div className="card h-fit">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Nueva empresa</h3>
          <CompanyForm />
        </div>
      </div>
    </div>
  );
}
