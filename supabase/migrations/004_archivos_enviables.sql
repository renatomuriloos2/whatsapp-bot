-- Permite que el bot envíe por WhatsApp el archivo original de los
-- documentos subidos desde el portal. Ejecutar una vez en el SQL Editor
-- (es idempotente). Los de carpetas de Google Drive no lo necesitan: se
-- descargan de Drive al momento de enviarlos.

alter table kb_documents add column if not exists storage_path text;

-- Bucket privado: solo el servidor (service_role) lee y escribe en él.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;
