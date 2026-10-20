-- Ficha de cada documento generada con IA (resumen, tipo, productos y
-- palabras clave) para que el bot lo encuentre aunque el cliente use otras
-- palabras. Ejecutar una vez en el SQL Editor (es idempotente).

alter table kb_documents add column if not exists summary text;
alter table kb_documents add column if not exists doc_type text;
alter table kb_documents add column if not exists products text;
alter table kb_documents add column if not exists keywords text;
alter table kb_documents add column if not exists enriched_at timestamptz;
