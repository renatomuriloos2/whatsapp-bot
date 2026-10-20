-- Empresa interna: todos los contactos vinculados a ella cuentan como
-- personal interno (pueden recibir el SGI si además son Confidenciales),
-- sin marcar uno por uno.
alter table companies add column if not exists interna boolean not null default false;
update companies set interna = true where name ilike 'rethink%';
