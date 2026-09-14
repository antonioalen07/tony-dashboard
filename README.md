# Dashboard Content

Centro de mando de contenido de Instagram para la marca personal (`tony.ia_`).
Next.js 16 + React 19 + Supabase + Apify + ElevenLabs + Meta Graph API.

El proveedor de LLM se elige solo en `src/lib/llm.ts`: con `OPENAI_API_KEY` usa
OpenAI (`gpt-5.4-mini`), si no cae a OpenRouter (`claude-3.5-haiku`). Se fuerza el
modelo con `LLM_MODEL`. En producción corre OpenAI.

## Qué hace

- **Dashboard**: seguidores, reach, guardados, **conversaciones** (comentarios), **agendas** y **leads calificados** (carga manual), ER, deltas vs mes pasado, reach mes a mes y audiencia por país (datos reales). **Filtro temporal** (7/30/90 días, este mes, todo o rango a medida) que recalcula métricas, gráfico y Top Contenidos. Seguidores, audiencia y objetivos quedan fuera del filtro por ser valores de hoy o acumulados.
- **Instagram**: sincroniza Reels desde la Meta API. Al sincronizar, los reels nuevos se **transcriben** (Apify + ElevenLabs) y se **analizan** con IA automáticamente. Panel de **conversaciones generadas** (total, promedio por reel, tasa por 1k de alcance, más comentado), panel de **resultados de negocio** (agendas y leads calificados que cargás a mano en cada reel, con las tasas conversación→agenda y lead→agenda), mismo filtro temporal que el dashboard, orden por recientes/vistos/ER/comentados/agendas y badges de cobertura.
- **Inspiración (Banger Hunter)**: escaneá a tus referentes fijos o investigá cualquier cuenta puntual. Detecta videos virales con la fórmula del monitor_viral (score 0-100: velocidad vs mediana de la cuenta + penetración + frescura; banger = ≥60) y **adapta el guion a tu marca** (transcribe el viral y lo reescribe con tu voz, pilares y kit de marca).
- **AI Chat**: estratega personal con tu kit de marca completo (avatar, pilares, variables probadas). Sesiones persistentes y retomables. Razona sobre transcripciones + análisis + métricas reales. El botón **Entrenamiento** abre el editor del prompt: **los tres prompts del sistema (chat, análisis por reel y adaptación de virales) se arman sólo con esos 17 bloques**, no hay texto de estrategia fuera del editor. Un bloque sin tocar sigue el default del código, uno editado lo pisa y uno **vacío se apaga** (no se le manda a la IA). Las pestañas de preview muestran el prompt final tal cual lo recibe el modelo.
- **Guiones**: tablero tipo Trello con cinco etapas (Borrador → Listo para grabar → Grabado → En edición → Publicado). Cada tarjeta separa **hook** (con espacio para cargar todas las variantes), **cuerpo** y **CTA**, lleva etiqueta de **formato** (talking head, pantalla dividida, entrevista, mostrando pantalla, b-roll, voz en off) más etiquetas libres, y guarda **links de referencia** que se abren en un toque o se previsualizan ahí mismo (Instagram, YouTube, TikTok, Vimeo, Drive). Se arrastra entre columnas, o se mueve con los botones ‹ › en mobile. La segunda vista es el **banco de ideas y referencias**: se guarda la idea o el video que te gustó, y cualquiera se convierte en guion con un botón.
- **Crevy Studio** — producción y publicación de contenido:
  - **Historias**: editor visual 9:16 con fondos (subida directa + Google Drive), capas de texto arrastrables (tipografía, tamaño, color, negrita, subrayado, resaltado) y export de la secuencia (4-6 slides) como ZIP de PNGs 1080×1920.
  - **Variantes**: a partir de un reel ganador genera 5-10 re-ediciones sutiles (saturación, contraste, micro-cortes de inicio, velocidad ±2%, zoom leve) vía ffmpeg en el worker, para testearlas como *trial reels*.
  - **Calendario**: distribuye las variantes en días de forma dispareja (hora aleatoria 11:00-21:00) y las publica por la Content Publishing API de Meta (`media_type=REELS` + `trial_params`). `PUBLISH_DRY_RUN=1` loguea sin publicar.
  - El procesamiento de video y la publicación corren en `worker/` (Docker, deploy en Easypanel — ver [`worker/README.md`](worker/README.md)).
- Tema claro/oscuro, responsive con drawer mobile, toasts.

## Migraciones de base

1. `supabase_schema.sql` — tabla `reels` (inicial).
2. `supabase_migration_inspiration.sql` — referentes, bangers, sesiones de chat (**correr en el SQL Editor de Supabase**). La app degrada con un aviso si falta.
3. `supabase_migration_studio.sql` — Crevy Studio: `media_assets`, `story_projects`, `variant_jobs`, `video_variants`, `publish_queue`, `google_tokens` + bucket público `studio` (**correr en el SQL Editor de Supabase**). Las páginas de Studio muestran un banner 428 si falta.
4. `supabase_migration_ai_config.sql` — `publish_queue.caption` (faltaba en bases creadas antes de esa columna: sin ella no se puede guardar el texto del post) y `ai_settings`, el entrenamiento editable de la IA. Sin correrla, los prompts caen a los defaults del código y el editor avisa que no puede guardar.
5. `supabase_migration_produccion.sql` — `reels.bookings` y `reels.qualified_leads` (agendas y leads calificados por reel, carga manual) + las tablas `scripts` (tablero de guiones) e `ideas` (banco de ideas y referencias). Sin correrla, la sección Guiones muestra el banner 428 y los dos campos de negocio avisan que no pueden guardar.
6. `supabase_migration_auth.sql` — `app_users`, `app_sessions`, `auth_events`: la autenticación propia (ver [Acceso y seguridad](#acceso-y-seguridad)). **Sin ella la app no deja entrar a nadie** (503 en el login), a propósito.
7. `supabase_migration_lock_anon.sql` — cierra la base a la anon key: borra todas las políticas `anon`, activa RLS en todo `public` y revoca los GRANT. **Correrla al final**, con `SUPABASE_SERVICE_ROLE_KEY` ya cargada en Vercel y en el worker.

Todas son re-ejecutables. Salvo la 6, la app degrada con aviso si falta alguna, nunca rompe.

## Acceso y seguridad

- **Usuarios y sesiones en la base**, no en variables de entorno. Se administran desde `/admin` (sólo rol `admin`): alta/baja, rol, desactivar, resetear clave, ver sesiones activas y expulsar (una o todas), y la auditoría de accesos. Cada usuario cambia su clave en `/cuenta`.
- **Arranque / emergencia**: `node scripts/auth-cli.mjs create-user <email> --name "Nombre" --role admin` crea el primer admin (pide la clave oculta). También `set-password`, `list`, `revoke-all` y `hash` (para insertar a mano en el SQL Editor).
- **Sesiones revocables**: la cookie lleva un token aleatorio; la base guarda su hash. Vencen a los 30 días o tras 7 sin uso. Revocar una fila expulsa a ese dispositivo en la próxima petición.
- **Bloqueo por intentos**: 5 logins fallidos en 15 min bloquean ese email (20 por IP) durante la ventana.
- **El navegador no tiene ninguna key de Supabase.** Habla con la base a través de `/api/db`, un gateway same-origin que exige sesión y reenvía con la service-role key. Las subidas de video van directo a Storage con una URL firmada por `/api/storage/sign-upload`. Con `supabase_migration_lock_anon.sql` la anon key deja de servir para todo, así que expulsar a alguien de la app lo expulsa también de la base.
- **Fail-closed**: si falta la migración o la service key, nadie entra. Antes, sin `AUTH_USERS` la puerta quedaba abierta.
- Headers de seguridad (`X-Frame-Options: DENY`, HSTS, `nosniff`, etc.) en `next.config.ts`; chequeo de origen en toda petición que muta (`/api` POST/PUT/PATCH/DELETE).
- Vars: `SUPABASE_SERVICE_ROLE_KEY` (obligatoria, sólo servidor) y `AUTH_SECRET` (recomendada; firma el header interno proxy → handlers). `AUTH_USERS` ya no se lee.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completá las claves
npm run dev                  # http://localhost:3000
```

## Base de datos

Ejecutá `supabase_schema.sql` en el SQL Editor de Supabase para crear la tabla `reels` y sus políticas.

## Deploy en Vercel

1. Importá el repo en Vercel.
2. Cargá las variables de entorno de `.env.example` en Project → Settings → Environment Variables (`SUPABASE_SERVICE_ROLE_KEY` es obligatoria; `AUTH_USERS` se puede borrar).
3. Deploy.

Al pasar a la auth nueva, el orden importa: (1) `supabase_migration_auth.sql` + crear el primer admin con `scripts/auth-cli.mjs`, (2) `SUPABASE_SERVICE_ROLE_KEY` en Vercel y en el worker, (3) deploy — todas las sesiones anteriores quedan inválidas —, (4) `supabase_migration_lock_anon.sql`.

> **Transcripción en Vercel**: `/api/transcribe` usa Apify (30-90s por reel). En el plan Hobby las funciones tienen límite de tiempo bajo y puede cortarse. Para transcribir en producción conviene plan Pro (hasta 300s) o correr el backfill localmente (`node backfill.mjs` con el dev server activo).

> **Token de Meta**: usá un token de **larga duración** (60 días). Pegá un token corto fresco en `META_ACCESS_TOKEN` y corré `node exchange_meta_token.js` para convertirlo.
