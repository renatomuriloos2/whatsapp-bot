-- Avisos internos del bot: contradicciones o datos dudosos que encontró en
-- los documentos. El cliente no los ve; aparecen en Base de conocimiento.
-- Ejecutar una vez en el SQL Editor (es idempotente).

create table if not exists kb_alerts (
  id uuid primary key default gen_random_uuid(),
  detail text not null,
  documents text,
  contact_id uuid references wa_contacts(id) on delete set null,
  question text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table kb_alerts enable row level security;
drop policy if exists "kb_alerts staff all" on kb_alerts;
create policy "kb_alerts staff all" on kb_alerts
  for all using (is_staff()) with check (is_staff());
