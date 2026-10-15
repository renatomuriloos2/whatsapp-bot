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

## Sincronizar con OneDrive / SharePoint (opcional)

El portal puede leer carpetas de OneDrive o SharePoint de Microsoft 365 y mantener la base
de conocimiento al día: cada día (cron de Vercel, 10:00 UTC) agrega archivos nuevos, vuelve a
leer los modificados y quita los borrados. También hay un botón **Sincronizar ahora** en
**Administración → Carpetas de OneDrive**.

### 1. Base de datos (proyectos creados antes de esta función)

Corre [`supabase/migrations/002_onedrive.sql`](./supabase/migrations/002_onedrive.sql) en el
SQL Editor de Supabase. (En proyectos nuevos ya viene en `schema.sql`.)

### 2. Registrar la aplicación en Microsoft (lo hace un administrador de Microsoft 365)

1. Entrar a [entra.microsoft.com](https://entra.microsoft.com) → **Identidad → Aplicaciones →
   Registros de aplicaciones → Nuevo registro**.
   - Nombre: `Rethink WhatsApp Bot - OneDrive`
   - Tipos de cuenta: **Solo cuentas de este directorio organizativo**
   - URI de redirección: vacío → **Registrar**.
2. En **Información general**, copiar **Id. de aplicación (cliente)** → `MS_CLIENT_ID` e
   **Id. de directorio (inquilino)** → `MS_TENANT_ID`.
3. **Certificados y secretos → Nuevo secreto de cliente** (vencimiento 24 meses) → copiar el
   **Valor** (no el Id.) → `MS_CLIENT_SECRET`. Anotar la fecha de vencimiento: hay que
   renovarlo antes.
4. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos de aplicación** → marcar
   `Files.Read.All` y `Sites.Read.All` → **Agregar permisos** → **Conceder consentimiento de
   administrador para Rethink** → Sí. Ambos deben quedar con ✓ verde "Concedido".

Son permisos de **solo lectura**: el portal nunca modifica ni borra archivos en OneDrive. La
app puede leer cualquier archivo de la organización, pero solo procesa las carpetas que un
administrador del portal conecta. (Si TI prefiere limitarla a sitios concretos, se puede usar
`Sites.Selected`; requiere asignar los sitios con PowerShell o Graph.)

### 3. Variables en Vercel

`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (Secret) y `CRON_SECRET` (un valor
aleatorio largo, Secret). Luego **Redeploy**.

### 4. Conectar carpetas

En OneDrive, sobre la carpeta: **Compartir → Copiar vínculo**. En el portal: **Administración →
Carpetas de OneDrive → Conectar carpeta**, pegar el vínculo y elegir el nivel de acceso (y la
empresa, si aplica). Se leen PDF, Word, TXT, Markdown y CSV de hasta 15 MB, con subcarpetas;
el nombre de cada subcarpeta se usa como categoría.

En el plan Hobby de Vercel el cron corre una vez al día. Para revisar más seguido: plan Pro
(cambiar `schedule` en `vercel.json`) o un servicio de cron externo (ej. cron-job.org) que
llame `GET https://TU-DOMINIO/api/cron/onedrive-sync` con el header
`Authorization: Bearer CRON_SECRET`.

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
