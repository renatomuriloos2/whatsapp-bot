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
  // ADMIN_MFA=off en Vercel la desactiva si alguien queda bloqueado.
  if (appUser.role === "admin" && process.env.ADMIN_MFA !== "off") {
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
