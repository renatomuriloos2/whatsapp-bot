-- Avisos al equipo (WhatsApp y/o correo) cuando el bot deja algo pendiente:
-- solicitudes de acceso, derivaciones a un asesor, números nuevos pendientes.
-- Ejecutar una vez en el SQL Editor (es idempotente).

alter table bot_settings add column if not exists alert_phone text;
alter table bot_settings add column if not exists alert_email text;
alter table bot_settings add column if not exists alert_template text;
