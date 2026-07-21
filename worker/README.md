# Crevy Studio — Worker

Proceso de larga duración (sin puerto HTTP) que corre en el VPS y procesa la
cola de jobs de Crevy Studio contra Supabase. Hoy incluye el **motor de
variantes de video**; más adelante se le suman otros jobs (p. ej. el publicador).

## Arquitectura

- `index.mjs` — orquestador. Carga env con `dotenv`, crea el cliente Supabase
  (URL + anon key) e **importa dinámicamente** todos los `jobs/*.mjs` que
  exporten `{ name, intervalMs, run(ctx) }`. Programa cada uno con `setInterval`
  y un **guard anti-solape** (no re-entra si el tick anterior sigue corriendo).
  `ctx = { supabase, env, log }`.
- `ffmpeg.mjs` — wrapper de [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)
  (spawn del binario embebido). Arma la cadena de filtros: `eq` (saturación /
  contraste), `setpts` + `atempo` (velocidad), `scale` + `crop` (zoom central) y
  `-ss` (recorte del arranque).
- `jobs/variants.mjs` — toma un `variant_jobs` en `pending`, lo marca
  `processing`, baja el video source del bucket `studio`, genera `num_variants`
  variantes sorteando `AppliedVariantParams` dentro de los rangos del job
  (fallback a `DEFAULT_VARIANT_PARAMS`), sube cada mp4 a
  `variants/<jobId>/<i>.mp4` e inserta `media_assets` + `video_variants`.
  Al final marca el job `done` (o `failed` con el error).

Cada job es autónomo: para agregar uno nuevo, dejá un `.mjs` en `jobs/` que
exporte `name`, `intervalMs` y `run(ctx)`.

## Variables de entorno

| Variable                         | Requerida | Descripción                                    |
| -------------------------------- | --------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | sí        | URL del proyecto Supabase.                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | sí        | Anon key (RLS permite anon, igual que la app). |
| `WORKER_POLL_MS`                 | no        | Intervalo de polling en ms (default `20000`).  |

En local basta con copiar el `.env.local` del proyecto principal:

```bash
cp ../.env.local .env.local
```

## Correr en local

```bash
npm install          # baja también el binario de ffmpeg-static
node index.mjs       # arranca el loop de polling
```

`node --check index.mjs` (y el resto de `.mjs`) valida la sintaxis sin ejecutar.

## Deploy en Easypanel (Contabo / VPS)

El worker corre como un **App service** (no necesita dominio ni puerto).

1. En Easypanel, crear un proyecto (o reutilizar el existente) y añadir un
   **App**.
2. **Source**: apuntar al repo y seleccionar el subdirectorio `worker/` como
   build context (Build → *Dockerfile*, path `worker/Dockerfile`). La imagen es
   `node:20-slim` y `ffmpeg-static` trae su propio binario, así que no hace falta
   instalar `ffmpeg` por `apt`.
3. **Environment**: cargar `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (y opcionalmente `WORKER_POLL_MS`).
4. **Network/Ports**: dejar sin puertos publicados — es un worker de fondo.
5. **Resources**: el transcodeo con ffmpeg usa CPU; 1 vCPU / 1 GB alcanza para
   clips cortos de reels.
6. **Deploy**. Verificá en los logs la línea `Worker arriba. Jobs: variants@…`.

Para actualizar: push a la rama configurada y **Deploy** de nuevo (o activar
auto-deploy). El worker se reinicia solo y retoma la cola.

## Notas operativas

- El claim de jobs es optimista (`update ... where status='pending'`): si en el
  futuro corren varias instancias, no se pisan el mismo job.
- Los errores por job se persisten en `variant_jobs.error` y el job queda
  `failed`; el worker sigue vivo para el resto de la cola.
- Los archivos temporales se generan en el tmpdir del SO y se borran siempre
  (`finally`), tanto en éxito como en fallo.
