# Plan: Automatizaciones de comentarios → DM

**Actualización de ejecución:** el usuario autorizó desarrollar y terminar el
sistema sin esperar una prueba de DM real. La Fase 0 queda preparada para que
la ejecute él después de configurar la migración, los permisos y el despliegue.
Esa indicación reemplaza los bloqueos de avance de la Fase 0 escritos abajo.
Se implementan también las Fases 6–8 de CRM y seguimientos. Ver instrucciones
operativas en `docs/AUTOMATIZACIONES_PUESTA_EN_MARCHA.md`.

Plan de ejecución para un agente de código. Leé también `AGENTS.md` y `CLAUDE.md`
antes de empezar. La UI y los textos van en español rioplatense ("vos").

## Objetivo

Cuando alguien comenta una palabra clave en un reel de @tony.ia_ (ej. "OJO"), BAKO:
1. le manda **un DM privado** (Private Reply de Meta) con un texto + link opcional, y
2. opcionalmente **responde el comentario en público** ("¡Te lo mandé por DM! 📩").

Se configura desde una sección nueva **"Automatizaciones"** y se ven los resultados
(comentarios detectados, DMs enviados, fallidos, actividad reciente).

## Estado verificado (6-oct-2026)

- Nombre de la app comprobado con Graph API: **Marca Tony Dashboard**. Es la
  integración existente de BAKO; no hace falta crear otra app ni otro access token.
- Revisión posterior: token válido, `SYSTEM_USER`, `expires_at=0`; `META_APP_SECRET`
  presente localmente. `GET /{app-id}/subscriptions` devolvió `data: []`.
  `META_WEBHOOK_VERIFY_TOKEN` ausente en `.env.local`; no se revisaron envs de Vercel.
  El verify token es independiente del access token permanente.

- `META_ACCESS_TOKEN` es de **System User** (no vence) con `instagram_manage_comments`,
  `instagram_manage_messages`, `pages_messaging`, `pages_manage_metadata`,
  `pages_read_engagement`. Está en Vercel, en Easypanel (worker) y en `.env.local`.
- Cuenta IG: `17841476480622974` (@tony.ia_), env `META_IG_ACCOUNT_ID`.
  Página de Facebook vinculada: `1061609440358642`.
- `GET /{media-id}/comments?fields=id,text,timestamp,from,username` funciona
  (probado sobre el reel del OJO, `18116527543983398`). Ojo: hay comentarios con typos
  reales ("Oko" en vez de "Ojo") → ver `fuzzy` abajo.
- `GET /{page-id}/subscribed_apps` con el page token devuelve `{"data":[]}`: el
  permiso funciona pero **la app todavía no está suscripta** (lo hace la Fase 2).
- Requisito del lado del usuario (NO lo puede hacer el código): en la app de Instagram
  *Configuración → Mensajes y respuestas a historias → Herramientas conectadas →
  "Permitir acceso a los mensajes"* debe estar activado, o Meta rechaza los DMs.

## Arquitectura

```
Comentario en IG
   ├─(instantáneo) Webhook Meta → POST /api/webhooks/instagram (Vercel)
   │                               verifica firma → matchea → INSERT event 'queued'
   └─(respaldo, c/5 min) worker/jobs/automations.mjs → GET /{media}/comments
                                   → matchea → INSERT event 'queued' (ON CONFLICT DO NOTHING)

worker/jobs/automations.mjs (cada 15 s)
   → toma events 'queued' respetando el cupo por hora
   → Private Reply (DM) → [respuesta pública] → status 'sent' / 'failed'
```

Decisiones (no las cambies sin consultarlo):
- **El envío lo hace sólo el worker**, nunca la ruta del webhook: así hay un único
  lugar con cupo por hora, reintentos y backoff, y el webhook responde 200 rápido.
- **El polling queda siempre activo** como respaldo: los webhooks de comentarios de
  terceros pueden no llegar si la app está en modo desarrollo / sin Advanced Access.
  Si en la Fase 2 se confirma que no llegan, el polling es el camino principal y
  alcanza (1-5 min de demora).
- **Idempotencia por `comment_id` (UNIQUE)**: un comentario genera como máximo un
  evento, venga por webhook, por polling o por ambos.

## Fase 0 — Prueba real de envío (hacer PRIMERO, antes de construir)

Script `scripts/test_private_reply.mjs` (lee `C:\dev\brand-dashboard\.env.local`):

```
node scripts/test_private_reply.mjs --comment <comment_id> --text "Prueba BAKO" [--reply "Te escribí 📩"]
```

1. Resuelve el page token: `GET /{page-id}?fields=access_token` con el token de System User.
2. Private Reply: `POST https://graph.facebook.com/v23.0/{page-id}/messages`
   con el page token y body
   `{"recipient":{"comment_id":"<id>"},"message":{"text":"..."}}`.
   Si falla con error de endpoint, probar `POST /{ig-user-id}/messages` y quedarse con
   el que funcione (dejarlo documentado en el código).
3. Respuesta pública (si `--reply`): `POST /{comment-id}/replies?message=...`.
4. Imprime la respuesta cruda de Meta (sin imprimir tokens).

El usuario comenta desde **otra cuenta** en un reel suyo y te pasa el `comment_id`
(o el script lista los últimos 5 comentarios de un media con `--list <media_id>`).
**No sigas a la Fase 1 hasta que el DM llegue.** Si Meta devuelve
"(#10) ... not allowed" o similar, casi seguro falta el toggle de "Permitir acceso a
los mensajes": pedíselo al usuario.

## Fase 1 — Base de datos

Archivo nuevo `supabase_migration_automations.sql` en la raíz (mismo estilo que
`supabase_migration_studio.sql`: idempotente, `IF NOT EXISTS`, comentarios en español).
El usuario lo corre a mano en el SQL Editor de Supabase: avisale al terminar.

```sql
CREATE TABLE IF NOT EXISTS public.automations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Nueva automatización',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- 'media' = un reel puntual · 'next_publish' = el próximo que salga del calendario · 'all' = todos los reels
  scope TEXT NOT NULL DEFAULT 'media' CHECK (scope IN ('media', 'next_publish', 'all')),
  media_id TEXT,                                   -- IG media id (scope = 'media')
  publish_queue_id UUID REFERENCES public.publish_queue(id) ON DELETE SET NULL,  -- scope = 'next_publish'
  keywords TEXT[] NOT NULL DEFAULT '{}',
  match_mode TEXT NOT NULL DEFAULT 'contains' CHECK (match_mode IN ('contains', 'exact')),
  fuzzy BOOLEAN NOT NULL DEFAULT TRUE,             -- tolera 1 letra de diferencia en keywords de 3+ letras
  dm_text TEXT NOT NULL,
  dm_link_url TEXT,
  dm_link_label TEXT,
  reply_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reply_texts TEXT[] NOT NULL DEFAULT '{}',         -- rotan al azar (anti-spam)
  once_per_user BOOLEAN NOT NULL DEFAULT TRUE,      -- un DM por persona por automatización
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- no procesa comentarios anteriores
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.automation_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL UNIQUE,
  media_id TEXT,
  commenter_id TEXT,
  commenter_username TEXT,
  comment_text TEXT,
  comment_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'poll' CHECK (source IN ('webhook', 'poll')),
  -- queued → sent | failed | skipped (ya recibió DM, comentario propio, fuera de ventana)
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  dm_sent_at TIMESTAMPTZ,
  reply_sent_at TIMESTAMPTZ,
  reply_comment_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_events_queue ON public.automation_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_automation_events_auto ON public.automation_events(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_events_user ON public.automation_events(automation_id, commenter_id);
```

RLS: igual que el resto de las tablas tras `supabase_migration_lock_anon.sql`
(RLS activado, sin políticas para anon; el servidor y el worker usan la service key).
Revisá ese archivo y replicá el patrón.

Tipos: agregar `Automation` y `AutomationEvent` en `src/lib/studio-types.ts` (o un
`src/lib/automation-types.ts` nuevo si queda más limpio).

## Matching (lógica compartida)

Una sola implementación, usada por la ruta del webhook (TS) y por el worker (.mjs).
Como el worker es JS puro sin build, escribila en `worker/lib/match.mjs` (JS con JSDoc)
e importala desde TS con un `src/lib/automationMatch.ts` que la re-exporte, o duplicala
con un test que verifique que ambas dan lo mismo. Preferí la primera opción si el
bundler de Next la acepta; si no, la segunda.

- `normalize(s)`: minúsculas, NFD + quitar diacríticos, quitar emojis y puntuación,
  colapsar espacios. `"Ojo!!! 👁️"` → `"ojo"`.
- `contains`: alguna keyword normalizada aparece como **palabra completa** en el
  comentario normalizado (no como substring: "MCP" no matchea "mcpserver").
- `exact`: el comentario normalizado es exactamente una keyword.
- `fuzzy`: además acepta distancia de Levenshtein ≤ 1 contra cada palabra del
  comentario, sólo para keywords de 3+ letras ("oko" → "ojo").
- Si un comentario matchea varias automatizaciones activas, gana la más específica:
  `media` > `next_publish` > `all`. Un comentario = un evento.
- Se descartan (no se crea evento): comentarios de la propia cuenta
  (`from.id === META_IG_ACCOUNT_ID`) y comentarios anteriores a `starts_at`.
- Se crean como `skipped` (para que se vean en la actividad): `once_per_user` y esa
  persona ya tiene un evento `sent` en esa automatización.

Tests: `node --test worker/lib/match.test.mjs` con casos reales (OJO, Oko, ojito,
"MCP!!", "quiero el mcp", emojis solos, mayúsculas, tildes).

## Fase 2 — Webhook (Vercel)

`src/app/api/webhooks/instagram/route.ts`. **Next 16 tiene cambios incompatibles:
leé `node_modules/next/dist/docs/` sobre route handlers antes de escribirla.**

- `GET`: verificación de Meta. Si `hub.mode === 'subscribe'` y `hub.verify_token ===
  process.env.META_WEBHOOK_VERIFY_TOKEN` → responder `hub.challenge` en texto plano, 200.
  Si no, 403.
- `POST`: leer el **body crudo**, verificar `X-Hub-Signature-256` =
  `sha256=` + HMAC-SHA256(body, `META_APP_SECRET`) con `timingSafeEqual`. Firma
  inválida → 401. Recorrer `entry[].changes[]` con `field === 'comments'`
  (`value.id`, `value.text`, `value.from.{id,username}`, `value.media.id`), matchear e
  insertar `queued` con `source='webhook'` (`upsert` con `onConflict: 'comment_id',
  ignoreDuplicates: true`). Responder 200 siempre que la firma sea válida, aunque no
  matchee nada (si no, Meta reintenta y termina desactivando el webhook).
- Agregar `'/api/webhooks/instagram'` a `PUBLIC_PATHS` en `src/proxy.ts` (Meta no tiene
  sesión). Es la única ruta pública nueva.
- Env nueva `META_WEBHOOK_VERIFY_TOKEN` (string random): documentarla en `.env.example`.

Suscripción de la página (una vez): script `scripts/subscribe_webhooks.mjs` que hace
`POST /{page-id}/subscribed_apps?subscribed_fields=feed` con el page token y después
imprime `GET /{page-id}/subscribed_apps`. Idempotente.

Pasos manuales para el usuario (dejalos escritos en tu mensaje final):
1. Vercel: agregar `META_WEBHOOK_VERIFY_TOKEN` y redeployar.
2. developers.facebook.com → la app → Webhooks → objeto **Instagram** → Callback URL
   `https://<dominio-de-vercel>/api/webhooks/instagram` + el verify token → Verificar →
   suscribir el campo **comments**.
3. Correr `node scripts/subscribe_webhooks.mjs`.
4. Comentar desde otra cuenta y ver si aparece un evento con `source='webhook'`. Si no
   aparece (modo desarrollo / falta Advanced Access), no es bloqueante: el polling lo
   levanta igual.

## Fase 3 — Job del worker

`worker/jobs/automations.mjs`, contrato del loader: `export const name`,
`export const intervalMs = 15_000`, `export async function run({ supabase, env, log })`.
Mirá `worker/jobs/publisher.mjs` y `worker/jobs/retention.mjs` como referencia de estilo.

Cada tick:

1. **Vincular `next_publish`**: para automatizaciones `scope='next_publish'` cuyo
   `publish_queue` ya está `published` con `ig_media_id` → pasar a `scope='media'`,
   `media_id = ig_media_id`, `starts_at = published_at`. No modifiques `publisher.mjs`.
2. **Polling** (sólo si pasaron ≥ 5 min desde el último; guardá el timestamp en
   memoria del módulo): para cada automatización activa, resolver los media
   (`media` → su id; `all` → reels de los últimos 7 días vía
   `GET /{ig-id}/media?fields=id,media_product_type,timestamp`), leer
   `GET /{media}/comments?fields=id,text,timestamp,from,username&limit=50` paginando
   hasta pasar `starts_at` o 7 días, matchear e insertar con `source='poll'`
   (`ignoreDuplicates`). Los comentarios vienen del más nuevo al más viejo.
3. **Envío**: cupo = `AUTOMATION_MAX_DM_PER_HOUR` (env, default 180) − DMs con
   `dm_sent_at` en la última hora. Tomar hasta `min(cupo, 10)` eventos `queued` con
   `next_attempt_at <= now()`, del más viejo al más nuevo. Para cada uno:
   - marcarlo `sending` (update condicionado a `status='queued'` para no duplicar),
   - si el comentario tiene más de 7 días → `skipped`, `skip_reason='fuera de la ventana de 7 días'`,
   - Private Reply con el endpoint confirmado en la Fase 0. Texto: `dm_text` y, si hay
     `dm_link_url`, agregado al final en una línea aparte (v1: texto plano, el link se
     ve clickeable en IG; los botones/templates quedan para después),
   - si `reply_enabled` y hay `reply_texts`: responder en público con uno al azar,
   - `sent` + `dm_sent_at` (+ `reply_sent_at`, `reply_comment_id`),
   - error de Meta: **permanente** (usuario no disponible, ventana vencida, ya se
     respondió en privado ese comentario, permisos) → `failed` con el mensaje;
     **transitorio** (rate limit, 5xx, red) → `queued`, `attempts+1`,
     `next_attempt_at = now + 2^attempts min`; con `attempts >= 4` → `failed`.
   - Si la respuesta pública falla pero el DM salió, el evento queda `sent` (con
     `error` anotado): nunca reenviar un DM por culpa de la respuesta pública.
4. Eventos `sending` con más de 10 min (worker reiniciado a mitad) → volver a `queued`.

El page token se resuelve una vez y se cachea en memoria; si Meta devuelve token
inválido, se descarta la caché y se reintenta en el próximo tick. **Nunca loguees
tokens.** Logueá sólo cuando pasa algo (`[automations] 3 DMs enviados, 1 fallido`).

`worker/jobs/retention.mjs` no toca estas tablas, y así tiene que seguir.

## Fase 4 — API de la app

Todas con el cliente de servidor (`import { supabase } from '@/utils/supabase'`), detrás
de la sesión (el proxy ya las protege por estar bajo `/api`). Mirá
`src/app/api/variants/route.ts` como referencia de estilo y manejo de errores.

- `GET /api/automations` → lista + stats por automatización (counts por status de
  `automation_events`) + datos del reel (`title`, `cover_url` de la tabla `reels` por
  `instagram_id = media_id`).
- `POST /api/automations` → crear. Validar: al menos una keyword, `dm_text` no vacío
  (máx. 1000 caracteres), `media_id` si `scope='media'`, `publish_queue_id` si
  `scope='next_publish'`, `dm_link_url` http(s) si viene.
- `PATCH /api/automations/[id]` → editar / activar / pausar (actualiza `updated_at`).
- `DELETE /api/automations/[id]` → borrar (cascadea los eventos).
- `GET /api/automations/events?automationId=&limit=50` → actividad (sin `automationId`
  = de todas).
- `POST /api/automations/events/[id]/retry` → un `failed` vuelve a `queued`.
- `GET /api/automations/media` → reels para el selector (de la tabla `reels`:
  `instagram_id, title, cover_url, published_at, views`, más nuevos primero) + items
  `pending` de `publish_queue` (para "el próximo que publique").

## Fase 5 — Interfaz

Ruta nueva `src/app/automatizaciones/page.tsx` + `page.module.css`. Seguí `DESIGN.md`:
CSS Modules, tokens de `globals.css`, monocromo con jerarquía por luminancia, nada de
colores nuevos hardcodeados. Mirá `src/app/variantes/` para el estilo de paneles.

**Sidebar** (`src/components/Sidebar.tsx`): ítem "Automatizaciones" con el ícono `Zap`
de lucide-react, después de Calendario y antes de Admin.

**Pantalla principal**:
```
Automatizaciones                                        [+ Nueva]
┌───────────────────────────────────────────────────────────────┐
│ [miniatura]  Comenta 'OJO' y lo tenes 👁️          ● Activa ⏻  │
│  Palabras: OJO · ojito       DM: "Acá tenés la guía…"         │
│  1.284 detectados · 1.190 enviados · 12 fallidos              │
└───────────────────────────────────────────────────────────────┘
Actividad reciente                                  [Todas ▾]
 @juan.perez   "OJO!!"   → DM enviado          hace 2 min
 @maria_ai     "Oko"     → DM enviado          hace 3 min
 @pedro        "ojo"     → Ya lo había recibido  hace 5 min
 @x            "ojo"     → Falló: usuario no disponible  [Reintentar]
```
- Tarjetas: toggle activa/pausada inline (PATCH optimista), click → editor.
- Actividad: polling cada 10 s mientras la pestaña está visible.
- Estado vacío: explicación en una línea + botón "Crear la primera".

**Editor** (panel lateral o vista, en el mismo estilo que el resto de la app), 4 bloques:
1. **Dónde**: grilla de reels (`/api/automations/media`) · "El próximo que publique"
   (elegir un pending del calendario) · "Todos mis reels".
2. **Palabras clave**: input de chips (Enter / coma agrega), selector
   "Contiene la palabra" / "Es exactamente la palabra", toggle "Tolerar errores de tipeo".
3. **Respuesta pública**: toggle + lista editable de frases (precargar 3 por defecto:
   "¡Te lo mandé por DM! 📩", "Revisá tus mensajes 👀", "¡Listo! Te escribí por privado 🙌").
4. **El DM**: textarea con contador, link + texto del link opcionales, y **vista previa
   tipo chat** de cómo le llega.
- Botón Guardar fijo abajo. Validaciones con mensajes en línea, no `alert`.

**Atajo desde el Calendario** (`src/app/calendario/`): si el caption de un item tiene
`Comenta 'X'` / `"X" y te lo paso` / `'X' y lo tenes` (regex tolerante a comillas
rectas y curvas: `/[\'"‘’“”]([^\'"‘’“”]{2,20})[\'"‘’“”]/`), mostrar
"⚡ Crear automatización para *X*" que abre el editor con `scope='next_publish'`, ese
`publish_queue_id` y la keyword cargada. Si ya hay una automatización vinculada, mostrar
"⚡ Automatización activa" en su lugar.

## Reglas del repo (importantes)

- Repo vivo: `C:\dev\brand-dashboard` (la copia de OneDrive está vieja, no la uses).
- **Next.js 16.2.6 con cambios incompatibles**: leer `node_modules/next/dist/docs/`
  antes de escribir rutas o páginas (p. ej. `params` en route handlers dinámicos).
- `core.autocrlf=true`, archivos en CRLF: no conviertas finales de línea de archivos
  existentes.
- Lint estricto: nada de `any` sin comentario de justificación, nada de `setState`
  sincrónico dentro de `useEffect` (regla `react-hooks/set-state-in-effect`; mirá el
  patrón `fetchX` + `apply(promise)` de `src/components/StorageMeter.tsx`).
- Graph API: definí la versión en una constante; el resto del repo usa `v20.0`, para
  código nuevo usá `v23.0`.
- Deploy: Vercel y el worker (Easypanel) se construyen desde `main`. El worker
  necesita redeploy manual en Easypanel después del push.

## Criterios de aceptación

- [ ] Fase 0: un DM real llegó a una cuenta de prueba.
- [ ] `npx tsc --noEmit`, `npm run lint` y `npm run build` sin errores nuevos.
- [ ] `node --test worker/lib/match.test.mjs` pasa.
- [ ] Un comentario "Ojo" en el reel configurado → DM recibido en ≤ 5 min (polling)
      o ≤ 30 s (webhook), con respuesta pública si está activada.
- [ ] El mismo comentario procesado por webhook y polling → un solo DM.
- [ ] La misma persona comentando dos veces con `once_per_user` → un DM, el segundo
      evento queda `skipped`.
- [ ] Pausar la automatización → los comentarios nuevos no generan eventos.
- [ ] Webhook con firma inválida → 401; GET de verificación con token correcto → challenge.
- [ ] Documentación: sección "Automatizaciones" en `CLAUDE.md` (arquitectura en 10
      líneas + pasos manuales de Meta), sección del job en `worker/README.md`, envs nuevas
      en `.env.example`.

## Ampliación solicitada — CRM y seguimientos

El objetivo del producto se amplía: reemplazar las funciones de ManyChat que usa
BAKO con comment-to-DM, contactos, etiquetas propias y seguimientos de texto/audio.
La implementación de comentarios sigue las Fases 0–5. La Fase 0 sigue siendo un
prerrequisito: no asumir que los permisos o el endpoint funcionan sin recibir el DM.

### Fase 6 — Contactos y etiquetas personalizables

- Crear `leads` con identificador de Instagram y cuenta de origen, username,
  estado comercial, nivel de calificación, origen y fechas de creación/actualización.
  Unicidad por `(ig_account_id, instagram_user_id)`, nunca por username.
- Crear `lead_tags` (nombre elegido por el usuario) y `lead_tag_assignments`
  (relación entre contactos y etiquetas, UNIQUE por lead/etiqueta).
  B2B, B2C y Calificado son ejemplos: no un enum cerrado ni reglas implícitas.
- Permitir crear, renombrar, asignar, quitar y eliminar etiquetas. Eliminar una
  etiqueta borra sus asignaciones, nunca los contactos.
- Permitir configurar etiquetas por automatización. Al detectar un contacto,
  resolverlo por ID y asignar las etiquetas idempotentemente.
- Pantalla de contactos con búsqueda, filtros por etiquetas/calificación y
  detalle con historial de automatizaciones y seguimientos.
- APIs protegidas por sesión, validación de entradas, RLS cerrado y banner 428
  mientras falten las migraciones, siguiendo el patrón del repo.

### Fase 7 — Mensajes entrantes y ventana de envío

- Ampliar el webhook firmado para recibir mensajes entrantes de Instagram.
  Verificar el esquema, las suscripciones y los permisos con documentación vigente
  de Meta y una prueba real antes de implementarlo.
- Guardar mensajes entrantes con unicidad por ID de Meta. Ignorar ecos de mensajes
  propios. Actualizar `last_inbound_at` sin retroceder ante eventos desordenados.
- Mantener separados el primer Private Reply por comentario y los mensajes de
  seguimiento de una conversación. Un comentario no equivale a un DM entrante.
- Antes de cada envío, comprobar la ventana permitida por Meta. Etiquetar a alguien
  como Calificado no habilita por sí mismo a escribirle en cualquier fecha futura.
- Confirmar los límites vigentes con Meta: la documentación oficial no pudo
  consultarse durante esta revisión (429). No habilitar seguimientos basándose
  únicamente en límites recordados o fuentes de terceros.

### Fase 8 — Seguimientos de texto y audio

- Configurar secuencias con pasos, demora, texto o audio y condiciones por etiquetas
  y calificación. Usar inicialmente audios provistos por el usuario; generar voz
  con IA requiere una decisión adicional sobre proveedor y almacenamiento.
- Inscripciones únicas por contacto/secuencia y cola persistente de pasos con
  fecha de ejecución, estado, intentos, motivo de bloqueo y referencia de Meta.
- Permitir pausar/cancelar y detener una secuencia ante una respuesta del contacto,
  una baja o pérdida de elegibilidad. Evaluar las condiciones otra vez al enviar.
- El worker es el único emisor. Aplicar cupo compartido, reclamo atómico de trabajos,
  reintentos con backoff y validación de la ventana justo antes de llamar a Meta.
- Si la ventana está cerrada, marcar el paso como bloqueado y mostrar el motivo;
  no reprogramarlo infinitamente ni reenviarlo tras una nueva interacción sin
  revisar la vigencia de la secuencia.
- Validar soporte real de audio, formato, tamaño y URL accesible antes de activar
  la funcionalidad. No presentar un enlace de descarga como un audio nativo.
- Distinguir rechazos confirmados de resultados inciertos: un timeout después de
  enviar puede significar que Meta recibió el mensaje. No recuperar automáticamente
  esos trabajos como pendientes sin reconciliación, para evitar duplicados.

### Aceptación adicional

- [ ] Crear etiquetas arbitrarias, asignarlas y filtrar contactos por ellas.
- [ ] Detectar repetidamente el mismo contacto no duplica el lead ni sus etiquetas.
- [ ] Un mensaje entrante actualiza la elegibilidad sin duplicar el historial.
- [ ] Un seguimiento elegible envía texto/audio y registra el resultado.
- [ ] Un seguimiento fuera de ventana queda bloqueado con motivo visible.
- [ ] Pausar o cancelar una secuencia impide sus envíos pendientes.
- [ ] Un resultado de envío incierto no dispara otro mensaje automáticamente.

## Fuera de alcance de las Fases 0–5

Botones / templates en el DM, exigir que sigan la cuenta antes de mandar el link,
secuencias de varios mensajes, DMs por respuestas a historias, multi-cuenta (B2C).
