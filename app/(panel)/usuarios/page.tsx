import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAllAppUsers } from "@/lib/data";
import { CreateUserForm } from "@/components/CreateUserForm";
import { requireAppUser } from "@/lib/auth";
import { roleLabel } from "@/lib/utils";

export default async function UsuariosPage(props: {
  searchParams: Promise<{ created?: string; deleted?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireAppUser("admin");
  const users = await getAllAppUsers(await createClient());

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">Usuarios del portal</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">
        Las personas de tu equipo que pueden entrar a este portal. Los clientes de WhatsApp no
        necesitan cuenta: se gestionan en Conversaciones.
      </p>

      {searchParams.created && (
        <div className="mb-6 rounded-lg border border-rethink-green/30 bg-rethink-green/10 px-4 py-2 text-sm text-rethink-green">
          Usuario creado.
        </div>
      )}
      {searchParams.deleted && (
        <div className="mb-6 rounded-lg border border-rethink-green/30 bg-rethink-green/10 px-4 py-2 text-sm text-rethink-green">
          Usuario eliminado.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card overflow-x-auto">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Usuarios ({users.length})</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-rethink-cream/50">
                <th className="py-2 pr-4 font-normal">Correo</th>
                <th className="py-2 pr-4 font-normal">Rol</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 text-rethink-cream/80">{u.email}</td>
                  <td className="py-2 pr-4 text-rethink-cream/80">{roleLabel(u.role)}</td>
                  <td className="py-2 text-right">
                    <Link href={`/usuarios/${u.id}`} className="text-rethink-orange hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="mb-4 text-sm font-medium text-rethink-cream">Nuevo usuario</h3>
          <CreateUserForm />
        </div>
      </div>
    </div>
  );
}
