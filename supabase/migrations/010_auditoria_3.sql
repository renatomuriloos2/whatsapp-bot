-- Auditoría 3
-- 1) Pertenencia interna separada del nivel de acceso: los documentos y
--    enlaces del SGI solo se entregan a contactos marcados como personal
--    interno (además de nivel Confidencial). Un cliente externo con nivel
--    Confidencial ya no ve el SGI.
alter table wa_contacts add column if not exists interno boolean not null default false;

-- 2) Una sola respuesta en curso por conversación: el procesamiento "toma"
--    la conversación hasta esta hora; si la función se cae, vence sola.
alter table wa_contacts add column if not exists processing_until timestamptz;

-- 3) Las funciones de rol no se ejecutan sin sesión (advertencia del
--    Security Advisor). Los usuarios con sesión las siguen usando en RLS.
--    (Postgres da EXECUTE a PUBLIC por defecto; por eso se quita a ambos.)
revoke execute on function public.auth_role(), public.is_admin(), public.is_staff() from public, anon;
grant execute on function public.auth_role(), public.is_admin(), public.is_staff() to authenticated, service_role;
