-- Privilegios: solo un administrador (con MFA) puede dar acceso a
-- información reservada. Un agente, desde el portal o directo por la API,
-- no puede:
--   - subir un contacto a nivel Confidencial ni marcarlo como interno,
--   - vincular un contacto a la empresa interna (Rethink),
--   - marcar una empresa como interna,
--   - bajar el nivel de un documento ni cambiarle la empresa.
-- El servidor del bot (service role) y el SQL Editor no tienen sesión
-- (auth.uid() nulo) y no se ven afectados.
-- Requiere las migraciones 010 y 011.

create or replace function guard_contact_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.access_level = 'confidencial' and (tg_op = 'INSERT' or old.access_level <> 'confidencial') then
    raise exception 'Solo un administrador puede dar nivel Confidencial.';
  end if;
  if new.interno and (tg_op = 'INSERT' or not old.interno) then
    raise exception 'Solo un administrador puede marcar a un contacto como personal interno.';
  end if;
  if new.company_id is not null
     and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id)
     and exists (select 1 from companies c where c.id = new.company_id and c.interna) then
    raise exception 'Solo un administrador puede vincular contactos a la empresa interna.';
  end if;
  return new;
end $$;

drop trigger if exists guard_contact_privileges on wa_contacts;
create trigger guard_contact_privileges before insert or update on wa_contacts
  for each row execute function guard_contact_privileges();

create or replace function guard_company_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if new.interna and (tg_op = 'INSERT' or not old.interna) then
    raise exception 'Solo un administrador puede marcar una empresa como interna.';
  end if;
  return new;
end $$;

drop trigger if exists guard_company_privileges on companies;
create trigger guard_company_privileges before insert or update on companies
  for each row execute function guard_company_privileges();

create or replace function guard_document_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  rank_old int := array_position(array['publico', 'cliente', 'confidencial'], old.access_level);
  rank_new int := array_position(array['publico', 'cliente', 'confidencial'], new.access_level);
begin
  if auth.uid() is null or is_admin() then return new; end if;
  if rank_new < rank_old then
    raise exception 'Solo un administrador puede bajar el nivel de acceso de un documento.';
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'Solo un administrador puede cambiar la empresa de un documento.';
  end if;
  return new;
end $$;

drop trigger if exists guard_document_privileges on kb_documents;
create trigger guard_document_privileges before update on kb_documents
  for each row execute function guard_document_privileges();
