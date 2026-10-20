-- Mejoras de la auditoría. Ejecutar una vez en el SQL Editor (es idempotente).

-- Trazabilidad: documentos usados en cada respuesta del bot.
alter table ai_usage add column if not exists documents text[];

-- Si a un contacto le bajan el nivel de acceso, la IA deja de ver la
-- conversación anterior a ese momento (pudo contener información de su
-- nivel previo).
alter table wa_contacts add column if not exists history_reset_at timestamptz;
