import type { SupabaseClient } from "@supabase/supabase-js";
import { AppUser, Company } from "@/types/database";

export async function getAllCompanies(supabase: SupabaseClient): Promise<Company[]> {
  const { data } = await supabase.from("companies").select("*").order("name");
  return (data ?? []) as Company[];
}

export async function getAllAppUsers(supabase: SupabaseClient): Promise<AppUser[]> {
  const { data } = await supabase.from("users").select("id, email, role").order("email");
  return (data ?? []) as AppUser[];
}

export async function getAppUserById(supabase: SupabaseClient, id: string): Promise<AppUser | null> {
  const { data } = await supabase.from("users").select("id, email, role").eq("id", id).single();
  return (data as AppUser | null) ?? null;
}
