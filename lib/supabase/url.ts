/**
 * URL del proyecto Supabase, tolerando que se haya pegado la dirección de
 * la Data API (".../rest/v1/") o con barra final: el cliente de Supabase
 * necesita solo el dominio, o falla con "Invalid path specified in request URL".
 */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .trim()
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/+$/, "");
