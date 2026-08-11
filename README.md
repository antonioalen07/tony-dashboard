# Dashboard Content

Centro de mando de contenido de Instagram para la marca personal (`tony.ia_`).
Next.js 16 + React 19 + Supabase + OpenRouter (Claude 3.5 Haiku) + Apify + ElevenLabs + Meta Graph API.

## Qué hace

- **Dashboard**: seguidores, reach, guardados, ER, deltas vs mes pasado, reach mes a mes y audiencia por país (datos reales).
- **Instagram**: sincroniza Reels desde la Meta API. Al sincronizar, los reels nuevos se **transcriben** (Apify + ElevenLabs) y se **analizan** con IA automáticamente. Orden por recientes/vistos/ER y badges de cobertura.
- **Inspiración (Banger Hunter)**: escaneá a tus referentes fijos o investigá cualquier cuenta puntual. Detecta videos virales con la fórmula del monitor_viral (score 0-100: velocidad vs mediana de la cuenta + penetración + frescura; banger = ≥60) y **adapta el guion a tu marca** (transcribe el viral y lo reescribe con tu voz, pilares y kit de marca).
- **AI Chat**: estratega personal con tu kit de marca completo (avatar, pilares, variables probadas). Sesiones persistentes y retomables. Razona sobre transcripciones + análisis + métricas reales.
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
2. Cargá las variables de entorno de `.env.example` en Project → Settings → Environment Variables.
3. Deploy.

> **Transcripción en Vercel**: `/api/transcribe` usa Apify (30-90s por reel). En el plan Hobby las funciones tienen límite de tiempo bajo y puede cortarse. Para transcribir en producción conviene plan Pro (hasta 300s) o correr el backfill localmente (`node backfill.mjs` con el dev server activo).

> **Token de Meta**: usá un token de **larga duración** (60 días). Pegá un token corto fresco en `META_ACCESS_TOKEN` y corré `node exchange_meta_token.js` para convertirlo.
