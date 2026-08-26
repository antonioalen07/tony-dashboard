@AGENTS.md

# Dashboard Content

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
- **Token de Meta**: dura ~60 días. Renovación: token corto del Graph Explorer →
  `META_ACCESS_TOKEN` en `.env.local` → `node refresh_meta_token.js` → copiar el
  resultado a Vercel + redeploy. El de Vercel debe ser siempre el LARGO.
- **Supabase usa la anon key también en el servidor.** Un DELETE sin policy se
  ignora en silencio (ya hubo un "borrado fantasma" de duplicados).
- **Vercel Hobby**: `/api/transcribe` y `/api/inspiration/adapt` pueden cortarse
  por timeout (Apify tarda 30-90s). Correr en local o pasar a Pro.

## Nombres (no renombrar por las tuyas)

El **producto** se llama **Dashboard Content** (UI, metadata, docs). **Crevy es
la empresa** y se mantiene a propósito en `src/lib/brand.ts` y en el prompt de
`/api/chat`. La app de Meta registrada como "Crevy Content" y el módulo interno
"Crevy Studio" también quedan como están.

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

## Al hacer cambios de UI

El contenido más ancho que el área útil debe poder alcanzarse (scroll), nunca
recortarse: hubo botones inalcanzables salvo a pantalla completa por un
`overflow-x: hidden`. Verificar en el rango de portátil (~1280px) además de
mobile.
