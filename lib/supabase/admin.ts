import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for Supabase Auth admin operations (create/update/delete
 * users). This key bypasses Row Level Security entirely — never import this
 * module from a "use client" component or anything other than a "use server"
 * action file gated by requireAppUser("admin").
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno. Cópiala desde Supabase → Project Settings → API → service_role."
    );
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
