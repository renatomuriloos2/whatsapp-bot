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

  if (allowedRoles) {
    const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!allowed.includes(appUser.role)) {
      redirect("/panel");
    }
  }

  return appUser as AppUser;
}
