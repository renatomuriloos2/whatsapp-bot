# Asistente IA de WhatsApp — Rethink

Portal independiente para gestionar el bot de WhatsApp de Rethink: los clientes escriben
al WhatsApp de la empresa y reciben respuestas técnicas generadas por **Claude**
(Anthropic) a partir de una **base de conocimiento** que el equipo gestiona aquí.

No depende del portal de clientes de tratamiento de agua: tiene su propio repositorio,
su propia base de datos Supabase, su propio proyecto en Vercel y sus propios usuarios.

La guía de instalación paso a paso (pensada para quien no es programador) está en el
documento "Guía paso a paso: Asistente IA de WhatsApp de Rethink". Este README resume
lo técnico.

## Qué hace

| Sección | Quién | Para qué |
|---|---|---|
| Panel | admin y agentes | Mensajes de hoy, chats que requieren atención, estado de la integración, presupuesto (admin) |
| Conversaciones | admin y agentes | Ver cada chat, responder como asesor, tomar/devolver el control al bot, nivel de acceso y empresa de cada número |
| Base de conocimiento | admin y agentes | Subir PDF, Word, TXT, Markdown o CSV (o pegar texto) con nivel de acceso y, opcionalmente, exclusivo de una empresa |
| Empresas | admin y agentes | Empresas cliente a las que pertenecen los contactos |
| Costos de IA | admin | Gasto del mes, proyección, costo diario, por modelo y por contacto, % de caché |
| Probar el bot | admin | Chatear con el bot desde el portal simulando cualquier nivel de acceso |
| Configuración | admin | Encender/apagar, modelo, esfuerzo, instrucciones, presupuesto, límites, mensajes automáticos |
| Usuarios | admin | Cuentas del equipo (Administrador o Agente) |

Niveles de acceso de un contacto: **Público → Cliente → Confidencial**. El bot solo usa
documentos de ese nivel o inferior (y los exclusivos de su empresa). El filtro se aplica
en la función SQL `match_kb_chunks`, que solo puede ejecutar `service_role`, así que la
información reservada nunca llega al modelo si el contacto no tiene permiso.

## Instalación (resumen)

1. **Supabase**: crea un proyecto nuevo y corre [`supabase/schema.sql`](./supabase/schema.sql)
   completo en el SQL Editor.
2. **Primer administrador**: en Supabase → Authentication → Users → Add user (correo +
   contraseña, marca "Auto Confirm User"). Copia su UUID y corre:
   ```sql
   insert into users (id, email, role) values ('UUID-DEL-USUARIO', 'tu@correo.com', 'admin');
   ```
3. **Anthropic**: crea una API key en console.anthropic.com y pon un límite de gasto.
4. **Meta**: crea la app de WhatsApp, obtén Phone number ID, token permanente de un
   System User y App secret; inventa un verify token.
5. **Vercel**: importa este repositorio, agrega las variables de [`.env.example`](./.env.example)
   y despliega.
6. **Webhook**: en Meta → WhatsApp → Configuration, Callback URL
   `https://TU-DOMINIO/api/whatsapp/webhook`, el mismo verify token, y suscríbete al
   campo `messages`. Pasa la app a modo Live.
7. Entra a `https://TU-DOMINIO/login` con el administrador del paso 2.

## Sincronizar con Google Drive (opcional)

El portal puede leer carpetas de Google Drive y mantener la base de conocimiento al día: cada
día (cron de Vercel, 10:00 UTC) agrega archivos nuevos, vuelve a leer los modificados y quita
los borrados. También hay un botón **Sincronizar ahora** en **Administración → Carpetas
sincronizadas**. Lee Documentos, Hojas y Presentaciones de Google, PDF, Word, TXT, Markdown y
CSV (hasta 15 MB), con subcarpetas; el nombre de cada subcarpeta se usa como categoría.

Usa una **cuenta de servicio**: un "usuario robot" de Google que solo ve las carpetas que se
compartan con su correo. No hace falta un administrador de Google Workspace.

### 1. Base de datos (proyectos creados antes de esta función)

Corre [`supabase/migrations/002_carpetas_sincronizadas.sql`](./supabase/migrations/002_carpetas_sincronizadas.sql)
en el SQL Editor de Supabase. (En proyectos nuevos ya viene en `schema.sql`.)

### 2. Crear la cuenta de servicio (una vez)

1. [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate) →
   nombre `rethink-whatsapp-bot` → **Crear**.
2. Con ese proyecto seleccionado, habilita la API:
   [console.cloud.google.com/apis/library/drive.googleapis.com](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   → **Habilitar**.
3. [console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → **Crear cuenta de servicio** → nombre `bot-drive` → **Crear y continuar** → (sin roles)
   **Listo**.
4. Abre la cuenta creada → pestaña **Claves** → **Agregar clave → Crear clave nueva → JSON**.
   Se descarga un archivo `.json`. Guárdalo en un lugar seguro: es una contraseña.
   - Si Google dice que la creación de claves está bloqueada por una política de la
     organización (`iam.disableServiceAccountKeyCreation`), un administrador de Google
     Workspace debe permitirla para este proyecto.

### 3. Variables en Vercel

- `GOOGLE_SERVICE_ACCOUNT_JSON` (Secret): abre el `.json` con el Bloc de notas, copia **todo**
  el contenido y pégalo como valor.
- `CRON_SECRET` (Secret): un valor aleatorio largo (protege la sincronización diaria).

Luego **Redeploy**.

### 4. Compartir y conectar carpetas

1. En el portal, **Carpetas sincronizadas** muestra el correo de la cuenta de servicio
   (…@….iam.gserviceaccount.com).
2. En Google Drive, clic derecho en la carpeta → **Compartir** → pega ese correo → rol
   **Lector** → desmarca "Notificar" → **Compartir**.
3. Copia la dirección de la carpeta (`https://drive.google.com/drive/folders/…`) y pégala en
   **Conectar carpeta**, con el nivel de acceso (y la empresa, si aplica).

En el plan Hobby de Vercel el cron corre una vez al día. Para revisar más seguido: plan Pro
(cambiar `schedule` en `vercel.json`) o un servicio de cron externo (ej. cron-job.org) que
llame `GET https://TU-DOMINIO/api/cron/sync-carpetas` con el header
`Authorization: Bearer CRON_SECRET`.

### Sitios web (ej. portal del SGI en Canva o Google Sites)

En **Carpetas y sitios → Conectar**, pega la dirección del sitio (ej.
`https://sgi-rethink.my.canva.site/sgi`). El portal recorre hasta 60 páginas que empiecen con
esa dirección y guarda su texto **con los enlaces** ("Formulario X (https://…)"), para que el
bot responda con el enlace exacto. Se revisa cada día como las carpetas. Los sitios que arman
su contenido con JavaScript (como Canva) se abren con un navegador interno (Chromium, vía
`@sparticuz/chromium`) que corre dentro de la propia función de Vercel; el contenido no se envía
a servicios externos. Si el sitio tiene contraseña, el portal no puede leerlo: en ese caso,
descárgalo como PDF o guarda la página (Ctrl+S) y súbela.

Proyectos que ya corrieron `002_carpetas_sincronizadas.sql`: correr también
[`supabase/migrations/003_sitios_web.sql`](./supabase/migrations/003_sitios_web.sql).

### OneDrive / SharePoint (alternativa)

El mismo mecanismo funciona con carpetas de OneDrive o SharePoint si un administrador de
Microsoft 365 registra una aplicación en Entra ID con permisos de aplicación `Files.Read.All` y
`Sites.Read.All` y se agregan `MS_TENANT_ID`, `MS_CLIENT_ID` y `MS_CLIENT_SECRET` en Vercel. El
portal detecta el tipo por el enlace que se pega.

## Desarrollo local

```bash
cp .env.example .env.local   # completa los valores
npm install
npm run dev                  # http://localhost:3000
```

## Estructura

```
app/
  login/, auth/callback/   Inicio de sesión (Supabase Auth)
  (panel)/                 Secciones del portal (layout con menú y control de sesión)
  api/whatsapp/webhook     Webhook de la WhatsApp Cloud API (verifica la firma de Meta)
components/whatsapp/       Formularios, chat, gráfico de costos
lib/
  ai/assistant.ts          Llamada a Claude con herramientas (buscar conocimiento,
                            derivar a asesor) y registro de tokens/costo
  ai/models.ts             Modelos elegibles, tabla de precios, niveles de acceso
  knowledge/               Extracción de PDF/Word, troceo, embeddings y búsqueda
  whatsapp/                Cliente de la Cloud API, flujo del bot, agregados de costos
  actions/                 Server actions (bot, empresas, usuarios)
  supabase/                Clientes de Supabase (navegador, servidor, service_role)
supabase/schema.sql        Tablas, búsqueda híbrida, RLS — correr completo una vez
middleware.ts              Sesión obligatoria y secciones solo para admin
```

## Notas

- **Modelo**: Claude Opus 5.5 por defecto; se puede cambiar a Sonnet 5.5 o Haiku 5.5 en
  Configuración. En Opus y Sonnet está activado el fallback del lado del servidor de
  Anthropic para consultas que un filtro de seguridad rechace.
- **Costos**: cada respuesta registra tokens y costo en `ai_usage` con la tarifa pública
  (tabla en `lib/ai/models.ts`; actualízala si cambian los precios). El presupuesto
  mensual corta el uso de IA al alcanzarse.
- **Ventana de 24 h**: WhatsApp solo permite texto libre hasta 24 h después del último
  mensaje del cliente; fuera de eso hace falta una plantilla aprobada por Meta.
- **Solo texto**: notas de voz e imágenes reciben un aviso pidiendo escribir la consulta.
