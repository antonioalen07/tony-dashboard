# BAKO Studio — Worker

Proceso de larga duración (sin puerto HTTP) que corre en el VPS y procesa la
cola de jobs de BAKO Studio contra Supabase. Incluye el motor de variantes de
video, el publicador, la retención y las automatizaciones de Instagram.

## Arquitectura

- `index.mjs` — orquestador. Carga env con `dotenv`, crea el cliente Supabase
  (URL + service-role key) e **importa dinámicamente** todos los `jobs/*.mjs` que
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
| `SUPABASE_SERVICE_ROLE_KEY`      | sí        | Service-role key (la base está cerrada a anon). Nunca al navegador. |
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
   `SUPABASE_SERVICE_ROLE_KEY` (y opcionalmente `WORKER_POLL_MS`).
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

## Retención del Storage (`jobs/retention.mjs`)

Corre cada hora. Borra las variantes **publicadas** (conserva la fila del
calendario con `variant_id = NULL`) y las **nunca enviadas** al calendario a las
48 h; las **programadas** (`pending` / `publishing` / `failed`) no se tocan.
También limpia generaciones vacías, videos base que ninguna generación usa y
archivos colgados. Reemplaza al viejo `cleanup_variants.mjs` (borraba todo,
incluidas las programadas) y a la limpieza de 7 días que tenía el publicador.

```
node jobs/retention.mjs --now          # qué borraría hoy, sin esperar 48 h (dry-run)
node jobs/retention.mjs --now --apply  # ejecutarlo
```

En los logs aparece `[retention] …` sólo cuando borra algo.

## Automatizaciones (`jobs/automations.mjs`)

Cada 15 segundos vincula automatizaciones del calendario, inscribe contactos en
secuencias elegibles y reclama hasta 10 trabajos con cupo compartido de mensajes.
El polling de comentarios corre cada 5 minutos como respaldo del webhook.
El loader descubre el job automáticamente; no hace falta tocar `index.mjs`.

Con un webhook recibido, el trabajo se reclama en el siguiente ciclo de 15 s
(más el tiempo de envío de Meta y cualquier cupo ocupado). Con polling, un
comentario visible en la API puede esperar hasta 5 min más el procesamiento.
Si no aparece ningún evento pasado ese plazo, revisá las suscripciones de la app
y la página en Meta y que los logs del worker incluyan `automations@15000ms`.
El SQL y el deploy de Vercel no actualizan el proceso del VPS: requiere redeploy.

Ejecutá `supabase_migration_automations.sql` en el SQL Editor de Supabase antes
de usarlo. Requiere `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`META_ACCESS_TOKEN`, `META_IG_ACCOUNT_ID`, `META_PAGE_ID` y, opcionalmente,
`META_MESSAGING_ENDPOINT` (`page` / `instagram`) y `AUTOMATION_MAX_DM_PER_HOUR`
(180 por defecto, 0 suspende envíos). El worker resuelve y cachea el page token.

Los seguimientos usan una ventana conservadora de 24 h desde el último mensaje
entrante. Fuera de ventana quedan bloqueados; no se reactivan solos. La app permite
reintentarlos explícitamente tras revisar el contacto. Una respuesta cancela los
pasos pendientes cuando la secuencia tiene activado detener al responder.
Los audios se envían como adjuntos por URL pública, sin descarga desde el worker.

Un timeout o reinicio durante el envío deja el trabajo `uncertain`: revisá
Instagram antes de intervenir. Nunca se reenvía un DM por fallar su respuesta
pública. Las tablas de automatizaciones no están incluidas en la retención de video.

Desde la raíz del repo: `npm run test:automations` (PostgreSQL local en memoria y
Meta simulado). Estas pruebas no envían mensajes ni modifican Supabase.
Para activar cambios en Easypanel, redeployá el worker después de desplegar la app.

## Descripciones de variantes (`jobs/publisher.mjs`)

La app guarda el borrador en `video_variants.params.caption` y copia la descripción
confirmada a `publish_queue.caption` al enviar al calendario. El publicador usa
esa columna de la fila recién reclamada, conservando saltos de línea y hashtags.
Una descripción vacía es válida; el título quemado del video queda independiente.
Si falta la columna `caption`, la app y el worker bloquean la publicación en lugar
de omitir silenciosamente el texto. La columna pertenece a
`supabase_migration_ai_config.sql`.

Desde la raíz: `npm run test:variants`. Usa datos simulados, sin publicaciones reales.
