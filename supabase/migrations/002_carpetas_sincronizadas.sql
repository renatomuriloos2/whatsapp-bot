-- Sincronización de carpetas de Google Drive (u OneDrive / SharePoint) con
-- la base de conocimiento. Ejecutar una vez en el SQL Editor (es idempotente).
-- En un proyecto nuevo no hace falta: ya está al final de schema.sql.

create table if not exists kb_sources (
  id uuid primary key default gen_random_uuid(),
  -- gdrive = Google Drive, onedrive = OneDrive / SharePoint, web = sitio web
  provider text not null default 'gdrive' check (provider in ('gdrive', 'onedrive', 'web')),
  name text not null,
  share_url text not null,
  drive_id text not null,
  item_id text not null,
  web_url text,
  access_level text not null default 'publico'
    check (access_level in ('publico', 'cliente', 'confidencial')),
  company_id uuid references companies(id) on delete cascade,
  -- Categoría fija; si es null se usa el nombre de la subcarpeta.
  category text,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  file_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (drive_id, item_id)
);

alter table kb_sources add column if not exists provider text not null default 'gdrive';

alter table kb_documents add column if not exists source_id uuid references kb_sources(id) on delete cascade;
alter table kb_documents add column if not exists external_id text;
alter table kb_documents add column if not exists external_etag text;
alter table kb_documents add column if not exists external_url text;
create unique index if not exists idx_kb_documents_external on kb_documents(source_id, external_id);

alter table kb_sources enable row level security;

drop policy if exists "kb_sources staff select" on kb_sources;
create policy "kb_sources staff select" on kb_sources
  for select using (is_staff());

drop policy if exists "kb_sources admin write" on kb_sources;
create policy "kb_sources admin write" on kb_sources
  for all using (is_admin()) with check (is_admin());
