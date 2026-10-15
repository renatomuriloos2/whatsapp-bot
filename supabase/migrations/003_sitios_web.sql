-- Permite conectar sitios web (además de carpetas de Google Drive / OneDrive)
-- en "Carpetas sincronizadas". Correr una vez si ya corriste
-- 002_carpetas_sincronizadas.sql antes de esta versión. Es idempotente.

alter table kb_sources drop constraint if exists kb_sources_provider_check;
alter table kb_sources add constraint kb_sources_provider_check
  check (provider in ('gdrive', 'onedrive', 'web'));
