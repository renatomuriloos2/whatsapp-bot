import { createClient } from "@/lib/supabase/server";
import { getAppUserById } from "@/lib/data";
import { SetPasswordForm } from "@/components/SetPasswordForm";
import { UpdateRoleForm } from "@/components/UpdateRoleForm";
import { DeleteUserForm } from "@/components/DeleteUserForm";
import { requireAppUser } from "@/lib/auth";
import { roleLabel } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function EditUsuarioPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ password_set?: string; role_updated?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const currentUser = await requireAppUser("admin");
  const supabase = await createClient();
  const user = await getAppUserById(supabase, params.id);

  if (!user) notFound();

  const isSelf = currentUser.id === user.id;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-rethink-cream">{user.email}</h1>
      <p className="mb-6 text-sm text-rethink-cream/60">{roleLabel(user.role)}</p>

      {searchParams.password_set && (
        <div className="mb-6 rounded-lg border border-rethink-green/30 bg-rethink-green/10 px-4 py-2 text-sm text-rethink-green">
          Contraseña actualizada.
        </div>
      )}

      {searchParams.role_updated && (
        <div className="mb-6 rounded-lg border border-rethink-green/30 bg-rethink-green/10 px-4 py-2 text-sm text-rethink-green">
          Cambios guardados.
        </div>
      )}

      <div className="card mb-6">
        <h3 className="mb-1 text-sm font-medium text-rethink-cream">Cambiar contraseña</h3>
        <p className="mb-4 text-xs text-rethink-cream/50">
          Se aplica de inmediato, sin enviar correo. Útil si la persona perdió acceso a su
          correo.
        </p>
        <SetPasswordForm userId={user.id} />
      </div>

      <div className="card mb-6">
        <h3 className="mb-4 text-sm font-medium text-rethink-cream">Rol</h3>
        <UpdateRoleForm userId={user.id} currentRole={user.role} />
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-medium text-rethink-cream">Eliminar cuenta</h3>
        <p className="mb-4 text-xs text-rethink-cream/50">
          Borra el acceso por completo. No se puede deshacer.
        </p>
        {isSelf ? (
          <p className="text-sm text-rethink-cream/50">No puedes eliminar tu propia cuenta.</p>
        ) : (
          <DeleteUserForm userId={user.id} />
        )}
      </div>
    </div>
  );
}
