# Crevy Studio — Handoff para continuar el build (sesión nueva)

> Este repo (`C:\dev\brand-dashboard`) es la copia **fuera de OneDrive**, creada para que el spawn de worktrees paralelos funcione (dentro de OneDrive fallaba con EEXIST por locks de sincronización). La copia vieja en OneDrive queda como respaldo, ya no se usa.

## Cómo retomar (pegá esto en la sesión nueva abierta en C:\dev\brand-dashboard)

> "Leé STUDIO_HANDOFF.md y el plan en `C:\Users\ANTONIO 2\.claude\plans\breezy-brewing-lake.md`. Retomá el build de Crevy Studio: lanzá las unidades 3 a 8 como agentes paralelos (isolation worktree, background) usando los prompts de este doc, y después hacé la pasada de integración."

## Estado actual (hecho)

- **Fase 0 (base)** — commit `ceecff8` en `main` (local y remoto). Incluye:
  - `supabase_migration_studio.sql` (6 tablas + bucket Storage `studio`, RLS anon).
  - `src/lib/studio-types.ts` (contrato TS compartido).
  - `jszip` en deps; env vars de Google/worker en `.env.example`.
- **Migración YA corrida** en Supabase (verificado: las 6 tablas responden 200 y el bucket `studio` existe).
- **Unidad 1 (Nav + MigrationBanner)** — rama `feat/studio-01-nav` pusheada. Lista para PR.
- **Unidad 2 (Assets API + Storage)** — rama `feat/studio-02-assets` pusheada. Lista para PR.
- `.env.local` y `Google.txt` ya están en este repo (gitignoreados). Credenciales Google reales cargadas en `.env.local` (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI). `PUBLISH_DRY_RUN=1`.

## Pendiente

- **Unidades 3–8**: lanzarlas como agentes paralelos (prompts abajo).
- **Pasada de integración** (post-merge): cablear `DrivePicker` (Unidad 4) dentro del editor de Historias (Unidad 3); smoke test del flujo completo; README.
- **Acciones del usuario**:
  1. `gh auth login` (para que los agentes/PRs se creen solos; el `git push` ya funciona sin esto).
  2. Google Cloud Console: agregar redirect URI `http://localhost:3000/api/google/callback`, habilitar Drive API, agregarse como test user.
  3. ~~Meta: confirmar permiso de publicación~~ ✅ **hecho (2026-08-07)**. El token
     ya tiene `instagram_content_publish` + `publish_video` con `target_ids` al IG
     `17841476480622974`. Todo el proceso de generar/renovar el token de Meta está
     documentado en **`INFORME_SISTEMA.md` §5** (diagnóstico, renovación y System User
     token permanente). **Leer §5.1 antes de debuggear**: `/me/accounts` vacío es
     normal, este setup no usa Páginas de Facebook.
  4. Deploy del `worker/` en Easypanel (Contabo) cuando esté (README lo explica).
  5. **Para publicar de verdad** (hoy NO publica, está en dry run — ver `INFORME_SISTEMA.md` §5.4):
     en Easypanel, **borrar** la env `PUBLISH_DRY_RUN` (ponerla en `0` no alcanza: el
     código chequea `!== undefined`) y **agregar** `META_ACCESS_TOKEN` al worker — no
     hereda las env de Vercel. El publicador corre cada 15 min, no al instante.

---

## Bloque compartido (incluir en CADA prompt de agente)

```
Sos un worker de una migración paralela. Implementás UNA unidad del feature "Crevy Studio".
PROYECTO: Crevy Content, dashboard de Instagram. Next.js 16.2.6 (App Router), React 19, TS, CSS Modules, Supabase (@supabase/supabase-js, anon). Alias @/* → src/*.
Checkout principal (para copiar .env.local): C:\dev\brand-dashboard
Tu worktree branchea de main (commit ceecff8) con la base incluida (supabase_migration_studio.sql, src/lib/studio-types.ts, jszip).

AGENTS.md del repo: este Next.js 16 tiene breaking changes. ANTES de escribir route handlers leé node_modules/next/dist/docs/. Los params de rutas dinámicas son ASYNC: `{ params }: { params: Promise<{ id: string }> }` + `const { id } = await params;`.

CONVENCIONES:
- Páginas nuevas: 'use client' en src/app/<ruta>/page.tsx + page.module.css. Superficies clase global `glass-panel`. Colores SOLO var(--token) de globals.css. Referencia: src/app/inspiracion/page.tsx, src/app/instagram/page.tsx.
- Toasts: `import { useToast } from '@/components/Toast'`. Supabase: `import { supabase } from '@/utils/supabase'` (anon). Auth automática vía src/proxy.ts.
- Tipos SIEMPRE de `@/lib/studio-types`. Banner de migración: `@/components/MigrationBanner` (existe en main).
- Jobs largos: patrón "start + poll del cliente" (mirá runScan() en inspiracion/page.tsx).

CONTRATO DE DATOS (tablas ya creadas, ver src/lib/studio-types.ts):
media_assets(id, kind image|video, filename, storage_path, public_url, source upload|drive|reel, created_at) · bucket público 'studio'.
story_projects(id, name, slides JSONB=StorySlide[], created_at, updated_at).
variant_jobs(id, source_asset_id→media_assets, num_variants, params JSONB=VariantParams, status, error, timestamps).
video_variants(id, job_id→variant_jobs, asset_id→media_assets, params JSONB=AppliedVariantParams, created_at).
publish_queue(id, variant_id→video_variants, kind trial_reel|reel|story, scheduled_at, status, ig_media_id, error, published_at, created_at).
google_tokens(id, access_token, refresh_token, expiry, updated_at) — fila única.

CONTRATO ASSETS API (Unidad 2, ya en rama feat/studio-02-assets; si no está en tu worktree usá el fallback indicado):
POST /api/assets (multipart file,kind) → {id,public_url,storage_path} · GET /api/assets?kind= → MediaAsset[] · DELETE /api/assets/:id.

CONTRATO WORKER (Unidad 5): worker/index.mjs carga dinámicamente cada worker/jobs/*.mjs que exporte {name, intervalMs, run(ctx)} con ctx={supabase, env, log}.

E2E:
1. cp "C:/dev/brand-dashboard/.env.local" .env.local
2. node_modules: `cmd //c mklink //J node_modules "C:\dev\brand-dashboard\node_modules"` (package.json raíz congelado → seguro), o `npm install`.
3. "Unit tests" = no hay runner: `npx tsc --noEmit` y `npm run lint` deben pasar.
4. (si tu unidad tiene UI) `npm run dev -- -p <PUERTO>` y con el navegador integrado abrí http://localhost:<PUERTO>/<ruta>, ejercitá y sacá screenshot.
5. La base Supabase es REAL y compartida: borrá lo de prueba. NO toques `reels` salvo lectura.

Al terminar:
1. Code review con Skill code-review; arreglá lo que aparezca.
2. tsc + lint.
3. E2E de tu unidad.
4. Commit (terminá el mensaje con: Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>), `git push` de tu rama, y `gh pr create`. Si gh no está autenticado, dejá la rama pusheada y reportá `PR: none — gh sin auth, rama: <rama>`.
5. Terminá con una línea `PR: <url>` o `PR: none — <motivo>`.
```

## Unidades restantes (puerto · rama · tarea)

### Unidad 3 — Editor de historias + ZIP · puerto 3103 · `feat/studio-03-historias`
Archivos: `src/app/historias/page.tsx` (+ css), `src/lib/storyRender.ts`.
CRUD de story_projects (supabase directo). Editor lienzo 9:16: slides (add/borrar/reordenar, 4-6); fondo por slide con input de URL (fallback) + picker progresivo vía GET /api/assets?kind=image (try/catch); capas de texto (texto, font de lista curada, size, color, bold, underline, highlight, align, arrastrar x/y 0..1); Save persiste slides JSONB. `storyRender.ts`: `renderSlideToPng(slide,bgUrl)` canvas 1080×1920 (fondo cover + capas) → Blob PNG; CORS con crossOrigin='anonymous' y proxy wsrv.nl (ver `proxied()` en inspiracion/page.tsx). Botón Exportar → ZIP con JSZip (01.png…) descarga `historias_<nombre>.zip`. Guard 428 con MigrationBanner.
E2E: crear proyecto, 2 slides con fondo, texto, Save (verificar en supabase), Exportar → zip con 2 PNG 1080×1920. Screenshot.

### Unidad 4 — Google Drive OAuth + import · puerto 3104 · `feat/studio-04-google-drive`
Archivos: `src/lib/google.ts`, `src/app/api/google/{auth,callback,files,import}/route.ts`, `src/components/DrivePicker.tsx` (+css).
OAuth code flow REST puro (sin `googleapis`): buildAuthUrl (scope drive.readonly, access_type=offline, prompt=consent), exchangeCode, getValidAccessToken (refresh + persiste en google_tokens). Rutas: auth→redirect; callback→exchange+redirect a /historias?drive=connected; files→Drive files.list (mimeType contains image/); import {fileId}→baja bytes (alt=media)+sube a bucket 'studio'+inserta media_assets source 'drive'. DrivePicker: chequea conexión, si no muestra "Conectar Google Drive"→/api/google/auth; grilla con thumbnails; onPicked(asset). 428 si falta tabla, 401 si no conectado.
E2E best-effort (no bloquear): abrir /api/google/auth debería redirigir a consentimiento de Google (screenshot). Round-trip completo requiere redirect URI registrado + test user. Si no completa, confiar en tsc+lint+review.

### Unidad 5 — Worker base + motor de variantes · (Node, sin puerto) · `feat/studio-05-worker-variants`
Archivos: `worker/{package.json,index.mjs,ffmpeg.mjs,Dockerfile,README.md}`, `worker/jobs/variants.mjs`.
worker/package.json (type module, deps @supabase/supabase-js + ffmpeg-static + dotenv). index.mjs: carga dotenv + supabase (URL+anon), importa dinámicamente TODO worker/jobs/*.mjs {name,intervalMs,run}, setInterval con guard anti-solape, ctx={supabase,env,log}. ffmpeg.mjs: wrapper de ffmpeg-static (spawn) con filtros eq(saturation,contrast)+setpts/atempo(speed)+scale/crop(zoom)+trim(-ss). variants.mjs: toma 1 variant_jobs pending→processing; baja source; por i<num_variants sortea AppliedVariantParams dentro de rangos (fallback DEFAULT_VARIANT_PARAMS), aplica ffmpeg, sube a 'studio' path variants/<jobId>/<i>.mp4, inserta media_assets(video,source 'upload')+video_variants; job→done/failed. Dockerfile node:20-slim. README deploy Easypanel. NO crear worker/jobs/publisher.mjs (es la Unidad 7).
E2E (node): generar mp4 testsrc 3s con ffmpeg-static, subir+media_asset, insertar variant_jobs(2,DEFAULT,pending), correr worker, verificar job done + 2 video_variants + 2 mp4 distintos del source. Limpiar. `node --check` en los .mjs.

### Unidad 6 — UI Variantes · puerto 3106 · `feat/studio-06-variantes-ui`
Archivo: `src/app/variantes/page.tsx` (+css).
Fuente: (a) subir video via POST /api/assets [fallback: pegar URL + insertar media_asset source 'upload']; (b) elegir reel existente (tabla reels, solo lectura) → crear media_asset source 'reel' desde video_url. Config: num_variants 5–10 + rangos avanzados (DEFAULT_VARIANT_PARAMS). Crear variant_jobs pending. Poll (patrón runScan) cada ~4s hasta done/failed + listar video_variants. Grilla: `<video src=public_url>` + descargar + "Enviar al calendario" (inserta publish_queue kind 'trial_reel', pending, scheduled_at null). Guard 428.
E2E: crear job (verificar fila), insertar a mano un video_variants de prueba, verificar grilla + "Enviar al calendario" crea fila en publish_queue. Screenshot.

### Unidad 7 — Publicador Meta · (Node, sin puerto) · `feat/studio-07-publisher`
Archivo: `worker/jobs/publisher.mjs` SOLAMENTE (no crear index.mjs/package.json — son de Unidad 5).
Export {name:'publisher', intervalMs:15*60*1000, run}. run: publish_queue pending con scheduled_at<=now → publishing; resolver public_url (video_variants→media_assets). DRY RUN (default, si env.PUBLISH_DRY_RUN truthy): NO llamar Graph API, loguear payload exacto (media_type=REELS, video_url, + trial_params:{graduation_strategy:'MANUAL'} si kind trial_reel), marcar published con ig_media_id='DRYRUN-<uuid>'. Real (solo si PUBLISH_DRY_RUN sin setear): crear contenedor→poll status_code FINISHED→media_publish→guardar ig_media_id. Errores→failed. Cleanup: borrar objetos de storage de items publicados hace +7 días. IG id env META_IG_ACCOUNT_ID (fallback '17841476480622974'), token META_ACCESS_TOKEN.
E2E (node, SOLO DRY RUN, NUNCA publicar de verdad): script _test_publisher.mjs que inserta media_asset+video_variant+publish_queue(trial_reel, now-1min, pending), ctx con PUBLISH_DRY_RUN=1, corre run(ctx) una vez, verifica published+DRYRUN- y log con trial_params. Limpiar. `node --check`.

### Unidad 8 — Calendario + distribución · puerto 3108 · `feat/studio-08-calendario`
Archivos: `src/lib/distribute.ts`, `src/app/calendario/page.tsx` (+css).
distribute.ts: `distributeUneven(variantIds, {startDate, days})` → [{variant_id, scheduled_at ISO}], reparto DISPAREJO por día (0-3/día no uniforme), hora random 11:00–21:00. Pura. page: grilla mensual de publish_queue agrupada por fecha; badge de status por color (var(--)); editar scheduled_at (persiste); "Publicar ahora" (scheduled_at=now); "Distribuir pendientes" (toma pending con scheduled_at null, corre distributeUneven, UPDATE). Guard 428.
E2E: insertar filas publish_queue (algunas scheduled_at null), verificar grilla + "Distribuir pendientes" asigna fechas disparejas (screenshot antes/después) + editar fecha persiste + "Publicar ahora". Checks de distributeUneven (suma=N, horas en ventana). Limpiar.

## Notas de merge (sin conflictos entre unidades)
Cada unidad toca solo sus archivos. Unidad 5 crea worker/{index,package,ffmpeg,Dockerfile,README}+jobs/variants.mjs; Unidad 7 crea solo worker/jobs/publisher.mjs → sin colisión. Cruces (DrivePicker↔Historias, botón calendario↔Variantes) se resuelven por contrato de datos + la pasada de integración final.
