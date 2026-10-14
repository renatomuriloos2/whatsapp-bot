-- Rethink — Asistente IA de WhatsApp (proyecto independiente)
-- Ejecutar completo en el SQL Editor de un proyecto Supabase NUEVO, dedicado
-- solo a este portal. Es idempotente: se puede volver a correr sin problema.

create extension if not exists "pgcrypto";
create extension if not exists unaccent;
-- pgvector: solo se usa si configuras VOYAGE_API_KEY (búsqueda semántica).
-- Sin esa clave, el bot busca con texto completo y la columna queda vacía.
create extension if not exists vector;

-- ============================================================
-- USUARIOS DEL PORTAL
-- ============================================================
-- Cada cuenta de Supabase Auth que puede entrar al portal tiene una fila
-- aquí con su rol:
--   admin  → todo, incluidos costos, configuración del bot y usuarios
--   agente → atiende conversaciones, gestiona contactos, empresas y
--            la base de conocimiento

create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'agente')),
  created_at timestamptz not null default now()
);

-- Funciones auxiliares (SECURITY DEFINER para evitar recursión en RLS).
create or replace function auth_role()
returns text language sql security definer stable set search_path = public
as $$ select role from users where id = auth.uid(); $$;

create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce(auth_role() = 'admin', false); $$;

create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce(auth_role() in ('admin', 'agente'), false); $$;

-- Empresas cliente: agrupan contactos y permiten documentos exclusivos de
-- una empresa (ej. su programa de tratamiento).
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  created_at timestamptz not null default now()
);

-- Configuración de búsqueda en español que ignora tildes ("dosificacion" =
-- "dosificación"), porque en WhatsApp casi nadie escribe con tildes.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'es_unaccent') then
    create text search configuration es_unaccent (copy = spanish);
    alter text search configuration es_unaccent
      alter mapping for hword, hword_part, word with unaccent, spanish_stem;
  end if;
end
$$;

-- ============================================================
-- TABLAS
-- ============================================================

-- Niveles de acceso (de menor a mayor):
--   publico      → cualquier persona que escriba al número
--   cliente      → contactos verificados de una empresa cliente
--   confidencial → contactos de confianza (fichas internas, precios, etc.)

create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  description text,
  access_level text not null default 'publico'
    check (access_level in ('publico', 'cliente', 'confidencial')),
  -- Si se define, el documento solo lo ven contactos de esa empresa.
  company_id uuid references companies(id) on delete cascade,
  file_name text,
  content text not null,
  active boolean not null default true,
  chunk_count int not null default 0,
  has_embeddings boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  chunk_index int not null,
  heading text not null default '',
  content text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('es_unaccent'::regconfig, coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('es_unaccent'::regconfig, content), 'B')
  ) stored,
  embedding vector(1024)
);

create table if not exists wa_contacts (
  id uuid primary key default gen_random_uuid(),
  -- Número en formato internacional sin "+" (ej. 573001234567), tal como lo
  -- manda WhatsApp en el campo wa_id.
  phone text not null unique,
  profile_name text,
  display_name text,
  access_level text not null default 'publico'
    check (access_level in ('publico', 'cliente', 'confidencial')),
  status text not null default 'activo'
    check (status in ('activo', 'pendiente', 'bloqueado')),
  company_id uuid references companies(id) on delete set null,
  notes text,
  -- true = un humano tomó la conversación; el bot no responde.
  bot_paused boolean not null default false,
  needs_attention boolean not null default false,
  attention_reason text,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references wa_contacts(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('cliente', 'bot', 'agente', 'sistema')),
  body text not null,
  message_type text not null default 'text',
  -- id de WhatsApp (wamid...). Único para no responder dos veces cuando Meta
  -- reintenta el webhook.
  wa_message_id text unique,
  status text,
  agent_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references wa_contacts(id) on delete set null,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'prueba')),
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  api_calls int not null default 1,
  tool_calls int not null default 0,
  latency_ms int,
  stop_reason text,
  created_at timestamptz not null default now()
);

-- Una sola fila (id = 1) con la configuración del bot.
create table if not exists bot_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  model text not null default 'claude-opus-5-5',
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  company_name text not null default 'Rethink',
  instructions text not null default
    'Somos una empresa de tratamiento de agua industrial (calderas, torres de enfriamiento, vapor y PTAR). Responde dudas técnicas sobre nuestros productos y servicios.',
  -- Política para números que no están registrados en Contactos.
  unknown_contacts text not null default 'publico' check (unknown_contacts in ('publico', 'pendiente')),
  pending_message text not null default
    'Hola 👋 Tu número aún no está habilitado para el asistente. Un asesor lo revisará pronto.',
  handoff_message text not null default
    'Te comunico con un asesor de nuestro equipo, te escribirá en breve. 🙌',
  monthly_budget_usd numeric(10, 2) not null default 50,
  budget_exceeded_message text not null default
    'En este momento el asistente no está disponible. Un asesor te responderá pronto.',
  daily_limit_per_contact int not null default 40,
  history_messages int not null default 12,
  updated_at timestamptz not null default now()
);

insert into bot_settings (id) values (1) on conflict (id) do nothing;

create index if not exists idx_kb_chunks_document on kb_chunks(document_id);
create index if not exists idx_kb_chunks_tsv on kb_chunks using gin(tsv);
create index if not exists idx_kb_chunks_embedding on kb_chunks
  using hnsw (embedding vector_cosine_ops);
create index if not exists idx_kb_documents_company on kb_documents(company_id);
create index if not exists idx_wa_contacts_company on wa_contacts(company_id);
create index if not exists idx_wa_messages_contact on wa_messages(contact_id, created_at desc);
create index if not exists idx_ai_usage_created on ai_usage(created_at);
create index if not exists idx_ai_usage_contact on ai_usage(contact_id);

-- ============================================================
-- BÚSQUEDA HÍBRIDA (texto completo + semántica, fusión RRF)
-- ============================================================
-- El filtro de acceso se aplica AQUÍ, en la base de datos: el modelo nunca
-- recibe fragmentos de documentos por encima del nivel del contacto.

create or replace function match_kb_chunks(
  query_text text,
  query_embedding vector(1024),
  allowed_levels text[],
  p_company_id uuid,
  match_count int default 6
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  category text,
  access_level text,
  content text,
  score double precision
)
language sql
stable
set search_path = public
as $$
  with visible as (
    select c.id, c.document_id, c.content, c.tsv, c.embedding
    from kb_chunks c
    join kb_documents d on d.id = c.document_id
    where d.active
      and d.access_level = any(allowed_levels)
      and (d.company_id is null or d.company_id = p_company_id)
  ),
  q as (
    -- websearch_to_tsquery une términos con AND; se cambia a OR para que una
    -- pregunta larga no exija que todas sus palabras aparezcan.
    select nullif(
      replace(websearch_to_tsquery('es_unaccent'::regconfig, query_text)::text, '&', '|'),
      ''
    )::tsquery as tsq
  ),
  fts as (
    select v.id, row_number() over (order by ts_rank_cd(v.tsv, q.tsq) desc) as rnk
    from visible v, q
    where q.tsq is not null and v.tsv @@ q.tsq
    order by ts_rank_cd(v.tsv, q.tsq) desc
    limit 30
  ),
  sem as (
    select v.id, row_number() over (order by v.embedding <=> query_embedding) as rnk
    from visible v
    where query_embedding is not null and v.embedding is not null
    order by v.embedding <=> query_embedding
    limit 30
  ),
  fused as (
    select id, sum(1.0 / (60 + rnk)) as score
    from (select id, rnk from fts union all select id, rnk from sem) r
    group by id
  )
  select c.id, d.id, d.title, d.category, d.access_level, c.content, f.score
  from fused f
  join kb_chunks c on c.id = f.id
  join kb_documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$$;

-- Solo el servidor (service_role) puede llamar la búsqueda: si quedara
-- expuesta vía /rest/v1/rpc, alguien podría pedir allowed_levels = todos.
revoke execute on function match_kb_chunks(text, vector, text[], uuid, int) from public, anon, authenticated;
grant execute on function match_kb_chunks(text, vector, text[], uuid, int) to service_role;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- El webhook de WhatsApp usa service_role (salta RLS). Desde el portal:
--   - admin y agentes gestionan conocimiento, empresas, contactos y conversaciones
--   - solo admin ve costos, cambia la configuración del bot y gestiona usuarios

alter table users enable row level security;
alter table companies enable row level security;
alter table kb_documents enable row level security;
alter table kb_chunks enable row level security;
alter table wa_contacts enable row level security;
alter table wa_messages enable row level security;
alter table ai_usage enable row level security;
alter table bot_settings enable row level security;

drop policy if exists "users select own or admin" on users;
create policy "users select own or admin" on users
  for select using (id = auth.uid() or is_admin());

drop policy if exists "users admin write" on users;
create policy "users admin write" on users
  for all using (is_admin()) with check (is_admin());

drop policy if exists "companies staff all" on companies;
create policy "companies staff all" on companies
  for all using (is_staff()) with check (is_staff());

drop policy if exists "kb_documents staff all" on kb_documents;
create policy "kb_documents staff all" on kb_documents
  for all using (is_staff()) with check (is_staff());

drop policy if exists "kb_chunks staff all" on kb_chunks;
create policy "kb_chunks staff all" on kb_chunks
  for all using (is_staff()) with check (is_staff());

drop policy if exists "wa_contacts staff all" on wa_contacts;
create policy "wa_contacts staff all" on wa_contacts
  for all using (is_staff()) with check (is_staff());

drop policy if exists "wa_messages staff all" on wa_messages;
create policy "wa_messages staff all" on wa_messages
  for all using (is_staff()) with check (is_staff());

drop policy if exists "ai_usage admin select" on ai_usage;
create policy "ai_usage admin select" on ai_usage
  for select using (is_admin());

drop policy if exists "bot_settings staff select" on bot_settings;
create policy "bot_settings staff select" on bot_settings
  for select using (is_staff());

drop policy if exists "bot_settings admin update" on bot_settings;
create policy "bot_settings admin update" on bot_settings
  for update using (is_admin()) with check (is_admin());
