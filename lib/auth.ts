import { createClient } from "@/lib/supabase/server";
import { AppUser, Role } from "@/types/database";
import { redirect } from "next/navigation";

export async function requireAppUser(allowedRoles?: Role | Role[]): Promise<AppUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: appUser } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("id", user.id)
    .single();

  if (!appUser) {
    redirect("/login?sin_acceso=1");
  }

  // Los administradores deben entrar con verificación en dos pasos (TOTP).
  // La base exige lo mismo (migración 012): sin AAL2 las políticas RLS no
  // le devuelven datos.
  if (appUser.role === "admin") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") redirect("/mfa");
  }

  if (allowedRoles) {
    const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!allowed.includes(appUser.role)) {
      redirect("/panel");
    }
  }

  return appUser as AppUser;
}
