-- MFA también en la capa de datos: un administrador solo actúa como
-- administrador (y como personal) con una sesión verificada en dos pasos
-- (AAL2). Con solo la contraseña, la API de Supabase no le devuelve datos.
-- Los agentes no usan MFA y siguen igual. El servidor del bot usa la
-- service role, que no pasa por RLS.
-- Si un administrador pierde su app de autenticación: Supabase →
-- Authentication → Users → el usuario → borrar su factor MFA; al volver a
-- entrar al portal registra uno nuevo.
create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce(auth_role() = 'admin' and coalesce(auth.jwt() ->> 'aal', '') = 'aal2', false); $$;

create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public
as $$
  select coalesce(
    auth_role() = 'agente'
    or (auth_role() = 'admin' and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'),
    false
  );
$$;
