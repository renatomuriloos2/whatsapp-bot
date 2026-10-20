-- Registra en "Costos de IA" lo que cuesta leer imágenes con IA al subir o
-- sincronizar documentos. Ejecutar una vez en el SQL Editor (es idempotente).

alter table ai_usage drop constraint if exists ai_usage_source_check;
alter table ai_usage add constraint ai_usage_source_check
  check (source in ('whatsapp', 'prueba', 'documentos'));
