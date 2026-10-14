import "server-only";
import { SUPABASE_URL } from "@/lib/supabase/url";
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

  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
