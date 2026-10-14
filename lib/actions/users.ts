"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAppUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ActionState, isRedirectError } from "@/lib/action-state";

export type { ActionState };

export async function createUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser("admin");

    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const role = String(formData.get("role") ?? "agente").trim();

    if (!email || !password) return { error: "Correo y contraseña son obligatorios." };
    if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
    if (role !== "admin" && role !== "agente") return { error: "Rol inválido." };

    const admin = createAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) return { error: createError.message };

    const supabase = createClient();
    const { error: insertError } = await supabase.from("users").insert({
      id: created.user.id,
      email,
      role,
    });

    if (insertError) {
      // Revert the auth account so we don't leave an orphaned login with no app row.
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: insertError.message };
    }


    revalidatePath("/usuarios");
    redirect("/usuarios?created=1");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "Error inesperado al crear el usuario.";
    return { error: message };
  }
}

export async function setUserPasswordAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser("admin");

    const password = String(formData.get("password") ?? "").trim();
    if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return { error: error.message };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "Error inesperado al cambiar la contraseña.";
    return { error: message };
  }

  redirect(`/usuarios/${id}?password_set=1`);
}

export async function updateUserRoleAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAppUser("admin");
    const supabase = createClient();

    const role = String(formData.get("role") ?? "agente").trim();
    if (role !== "admin" && role !== "agente") return { error: "Rol inválido." };

    const { error } = await supabase.from("users").update({ role }).eq("id", id);
    if (error) return { error: error.message };

    revalidatePath("/usuarios");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "Error inesperado al guardar los cambios.";
    return { error: message };
  }

  redirect(`/usuarios/${id}?role_updated=1`);
}

export async function deleteUserAction(
  id: string,
  _prevState: ActionState
): Promise<ActionState> {
  try {
    const currentUser = await requireAppUser("admin");
    if (currentUser.id === id) {
      return { error: "No puedes eliminar tu propia cuenta desde aquí." };
    }

    // Deleting the auth.users row cascades to public.users (FK ON DELETE CASCADE
    // in schema.sql), so there's nothing separate to clean up here.
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return { error: error.message };

    revalidatePath("/usuarios");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "Error inesperado al eliminar el usuario.";
    return { error: message };
  }

  redirect("/usuarios?deleted=1");
}
