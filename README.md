# Crevy Content

Centro de mando de contenido de Instagram para la marca personal **Crevy** (`tony.ia_`).
Next.js 16 + React 19 + Supabase + OpenRouter (Claude 3.5 Haiku) + Apify + ElevenLabs + Meta Graph API.

## Qué hace

- **Dashboard**: seguidores, reach, guardados, ER, reach mes a mes y audiencia por país (datos reales).
- **Instagram**: sincroniza Reels desde la Meta API. Al sincronizar, los reels nuevos se **transcriben** (Apify + ElevenLabs) y se **analizan** con IA automáticamente.
- **AI Chat**: preguntale a Claude qué te está funcionando y por qué, qué hooks/ángulos/guiones probar. Razona sobre transcripciones + análisis + métricas reales.
- Tema claro/oscuro con toggle.

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
