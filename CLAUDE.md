@AGENTS.md

# BAKO

Panel de inteligencia de contenido de Instagram para la marca personal de
Antonio (`@tony.ia_`). Next.js 16 + React 19 + Supabase + Meta Graph API.
Deploy en Vercel desde `main` (push a `main` = deploy de producción).

Documentación larga: `README.md` (qué hace), `PRODUCT.md` (para quién),
`DESIGN.md` (sistema visual), `INFORME_SISTEMA.md` (arquitectura),
`STUDIO_HANDOFF.md` (módulo Studio), `worker/README.md` (worker de video).

Lo que sigue es lo que NO se deduce leyendo el código y cuesta horas
redescubrir.

## La copia viva del repo

Es **`C:\dev\brand-dashboard`**. Existe una copia vieja en
`OneDrive\...\Aplicaciones Personales\brand-dashboard` que quedó como respaldo y
está muy atrasada — no tiene Studio ni nada posterior a julio. Se mudó fuera de
OneDrive porque ahí los git worktrees paralelos fallan con EEXIST por los locks
de sincronización.

Si el editor del usuario apunta a la copia de OneDrive, el trabajo igual va en
`C:\dev`.

## Migraciones: las corre el usuario a mano

**No se pueden correr desde acá.** En `.env.local` solo está la anon key: sirve
para filas (SELECT/INSERT/UPDATE/DELETE vía PostgREST), pero PostgREST no tiene
endpoint para `CREATE TABLE` / `ALTER TABLE`. Toda migración se le pasa al
usuario para que la pegue en el SQL Editor de Supabase.

Orden histórico:

1. `supabase_schema.sql` — tabla `reels`
2. `supabase_migration_inspiration.sql` — referentes, bangers, sesiones de chat
3. `supabase_migration_studio.sql` — tablas de Studio + bucket `studio`
4. `supabase_migration_ai_config.sql` — `publish_queue.caption` + `ai_settings`
5. `supabase_migration_produccion.sql` — `reels.bookings` / `reels.qualified_leads`
   (carga manual) + `scripts` (tablero de guiones) e `ideas` (banco de ideas)

Todas re-ejecutables. **La app tiene que degradar sin migración**, nunca romper:
banner 428, aviso inline o fallback a defaults. Ese patrón ya está en Studio,
Chat y el editor de entrenamiento; respetalo al agregar tablas.

Para diagnosticar el estado real de la base: script node con
`@supabase/supabase-js` leyendo `.env.local`. Las policies anon están abiertas.

## Claves y sus trampas

- **`OPENAI_API_KEY` existe SOLO en Vercel**, no en `.env.local`.
  `src/lib/llm.ts` elige proveedor según esa variable: si está, OpenAI
  (`gpt-5.4-mini`); si no, OpenRouter (`claude-3.5-haiku`). La
  `OPENROUTER_API_KEY` local está **muerta** (401 pese a tener crédito). Para
  probar chat/analyze/adapt en local hay que agregar la key de OpenAI a
  `.env.local`.
- **Token de Meta**: desde el 6-oct-2026 se usa un **System User token permanente**.
  Se verificó con `debug_token`: válido, `expires_at=0`, con permisos de administrar
  comentarios/mensajes y perteneciente a la misma app de `META_APP_ID`.
  Reutilizarlo; no reemplazarlo por un token de usuario de 60 días ni renovarlo con
  el helper antiguo `/api/meta/token`. `META_APP_SECRET` ya existe en `.env.local`.
- **Supabase usa la anon key también en el servidor.** Un DELETE sin policy se
  ignora en silencio (ya hubo un "borrado fantasma" de duplicados).
- **Vercel Hobby**: `/api/transcribe` y `/api/inspiration/adapt` pueden cortarse
  por timeout (Apify tarda 30-90s). Correr en local o pasar a Pro.

## Nombres (no renombrar por las tuyas)

El **producto** se llama **BAKO** (UI, metadata, docs, favicon). Antes se
llamaba "Dashboard Content"; el rebrand es de septiembre de 2026.

**Crevy es la empresa de Antonio, no el producto**, y se mantiene a propósito en
`src/lib/brand.ts` y en el prompt de `/api/chat`: ahí "Crevy" es *contenido* del
entrenamiento de la IA (Antonio es su fundador), no una etiqueta de marca del
sistema. No lo renombres.

La app registrada en Meta se llama **"Marca Tony Dashboard"** (nombre verificado
con Graph API el 6-oct-2026). Es la misma integración usada por BAKO; reutilizar
`META_APP_ID`, `META_APP_SECRET` y `META_ACCESS_TOKEN`, sin crear otra app.
El módulo interno pasó a llamarse **BAKO Studio**.

## Retención del Storage (automática)

El plan free de Supabase tiene 1 GB y se llenó dos veces: las variantes pesan
20-35 MB cada una. Desde el 6-oct-2026 corre `worker/jobs/retention.mjs` cada
hora en el worker, con esta regla (pedida por el usuario, no la cambies sin él):

- **Programada** (publish_queue `pending` / `publishing` / `failed`) → no se toca.
- **Publicada** → se borra el video; la fila del calendario queda con
  `variant_id = NULL` para conservar el historial.
- **Nunca enviada** al calendario a las 48 h → se borra.
- Generaciones vacías, videos base sin generación (+48 h) y archivos colgados → se borran.

Las FK son `ON DELETE CASCADE` de punta a punta (media_assets → variant_jobs →
video_variants → publish_queue): borrar un video base que todavía usa un job
arrastra las variantes programadas y el historial. Por eso el orden es siempre
desligar historial → borrar variantes → jobs vacíos → recién ahí videos base.
El mismo criterio usa `DELETE /api/variants` (botones de borrar en la UI).

A mano: `node worker/jobs/retention.mjs --now` (dry-run sin la espera de 48 h),
`--apply` para ejecutar. El medidor de uso es `GET /api/storage/usage`.

## Arquitectura de los prompts de IA

**Los tres prompts se arman SOLO con bloques editables.** No hay texto de
estrategia fuera del editor. Tres capas:

- `src/lib/brand.ts` — un `export const` por sección: es el **default** de cada
  bloque, nada entra a un prompt directamente desde acá.
- `src/lib/promptConfig.ts` — `BLOCK_DEFS` (id, label, hint, heading, en qué
  prompts se usa, default) y las tres funciones que ensamblan:
  `composeChatSystemPrompt`, `composeAnalyzeSystemPrompt` y
  `composeAdaptSystemPrompt` (`/api/chat`, `/api/analyze`,
  `/api/inspiration/adapt`).
- `ai_settings.blocks` (JSONB) — lo que el usuario editó desde
  Chat → Entrenamiento.

Tres estados por bloque, y la diferencia es el corazón del sistema:

| en `blocks` | significa | qué pasa |
|---|---|---|
| clave ausente | nunca lo tocó | usa el default de `brand.ts` (hereda mejoras) |
| string con texto | lo editó | pisa el default |
| string vacío `""` | lo **apagó** | el bloque NO entra al prompt |

Que el vacío se persista es deliberado: antes se descartaba, al leer caía otra
vez al default, y borrar un bloque desde la app reinstalaba el texto original.

**La regla que no se puede romper: un concepto vive en UN solo bloque.** Si el
andamiaje fijo (o el default de otro bloque) vuelve a mencionar el embudo, la
estructura o los pilares, el modelo recibe dos versiones y obedece a la más
imperativa. Ese fue el bug de "borro TOF/MOF/BOF y sigue apareciendo": el embudo
estaba además en `SCRIPT_STRATEGY`, en la sección "ARQUITECTURA DE MARCA", en el
"ORDEN DE OPERACIÓN" y en el contrato JSON de adapt.

Queda fijo a propósito y no debe volverse editable: la línea de rol, el enganche
con el dossier de reels y los contratos JSON de `/api/analyze` y
`/api/inspiration/adapt`.

Para verificar que un cambio llegó: **Chat → Entrenamiento → pestañas de
preview**, o `GET /api/ai-settings?preview=1`, que devuelve los tres prompts
finales tal cual los recibe el modelo.

## Detalles del código que muerden

- **El repo está en CRLF.** Los scripts que editan archivos por string matching
  tienen que normalizar a LF para buscar y devolver CRLF al escribir, o los
  anclajes multilínea no matchean nunca.
- **Duplicados de Apify**: los reels con `instagram_id` de 19+ dígitos vienen de
  Apify y no de Meta. Varias consultas los filtran con
  `(r.instagram_id || '').length < 19`.
- **Fechas en hora local, no UTC.** `src/lib/dateRange.ts` parsea los
  `'YYYY-MM-DD'` a mano: `new Date('2026-05-01')` los toma como UTC y en UTC-3
  corre el rango un día.
- **Portadas**: la URL del CDN de Instagram viene firmada y caduca en días. Se
  copian una vez al Storage (`src/lib/covers.ts`); preferir siempre la copia
  persistida.
- **Estilos**: todo por tokens de `globals.css` y CSS Modules. Nada de colores
  hardcodeados — el tema claro/oscuro se invierte por luminancia. Ver
  `DESIGN.md`.

## Automatizaciones

`/automatizaciones`: comment-to-DM, etiquetas libres, contactos y secuencias de
texto/audio. Migración manual: `supabase_migration_automations.sql`.
Webhook público `/api/webhooks/instagram`: verificación HMAC; sólo persiste eventos.
`worker/jobs/automations.mjs` (15 s) es el único emisor; polling de respaldo cada 5 min.
Matching compartido en `worker/lib/match.mjs`; RPCs serializan reclamos y cupo por hora.
Un comentario = un evento. Seguimientos requieren un DM entrante en las últimas 24 h.
Las respuestas entrantes detienen secuencias configuradas con `stop_on_reply`.
Envíos sin confirmación quedan `uncertain`; no se reintentan automáticamente.
Audios: adjuntos nativos por URL pública; soporte real de Meta pendiente de tu prueba.
Pruebas sin enviar mensajes: `npm run test:automations`, `npm run lint:automations`.

Activación: reutilizar credenciales existentes de Supabase y Meta, correr SQL,
configurar `META_WEBHOOK_VERIFY_TOKEN` si aún no existe; callback
`https://<dominio>/api/webhooks/instagram`, objeto Instagram, campos `comments`
y `messages`. `node scripts/subscribe_webhooks.mjs --status` sólo consulta.
`--apply --callback https://tony-dashboard-psi.vercel.app/api/webhooks/instagram`
registra Instagram comments/messages y la app en la página feed/messages después
de verificar el challenge. Requiere el verify token ya configurado, conserva
campos existentes y no envía DMs. Activar acceso a mensajes y redeployar el worker.
Verificación del 6-oct-2026: token válido/permanente y App Secret local presentes;
`GET /{app-id}/subscriptions` y `GET /{page-id}/subscribed_apps` devolvieron `data: []`.
`META_WEBHOOK_VERIFY_TOKEN` está ausente en `.env.local` (Vercel no se inspeccionó).
La ruta del webhook en el código no equivale a una suscripción registrada en Meta.
`/api/automations/health` consulta el estado real de Meta/base y no escribe ni
confirma la ejecución del worker. La pantalla muestra si la recepción necesita
configuración; los contactos sólo incluyen identidades del Instagram conectado.
El verify token es una cadena independiente para el handshake, no el access token.
La prueba de DM se difirió por pedido explícito del usuario; ejecutar después
`node scripts/test_private_reply.mjs --list <media_id>` y luego `--comment <id>
--text "Prueba BAKO"`. No ejecutar scripts de envío/suscripción como parte de tests.

## Al hacer cambios de UI

El contenido más ancho que el área útil debe poder alcanzarse (scroll), nunca
recortarse: hubo botones inalcanzables salvo a pantalla completa por un
`overflow-x: hidden`. Verificar en el rango de portátil (~1280px) además de
mobile.
