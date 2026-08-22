-- ============================================================================
-- Dashboard Content — migración: caption de la cola + configuración de la IA
--
-- Re-ejecutable: todo es IF NOT EXISTS / ON CONFLICT. Correr entero en el
-- SQL Editor de Supabase.
--
-- 1) Repara `publish_queue.caption`: la columna venía en
--    supabase_migration_studio.sql pero esta base quedó atrasada, así que al
--    guardar un caption PostgREST respondía "Could not find the 'caption'
--    column" y el texto se perdía.
-- 2) Crea `ai_settings`: los bloques del prompt del estratega de IA, editables
--    desde la app (Chat → Entrenamiento de la IA). Fila única id='default'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Caption de la cola de publicación
-- ----------------------------------------------------------------------------
ALTER TABLE public.publish_queue
    ADD COLUMN IF NOT EXISTS caption TEXT;

-- ----------------------------------------------------------------------------
-- 2) Configuración editable del prompt de la IA
--
-- `blocks` es JSONB { [blockId]: string }. Solo guarda los bloques que el
-- usuario tocó: los que falten caen al default definido en
-- src/lib/promptConfig.ts. Así, agregar un bloque nuevo al código NO necesita
-- otra migración.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_settings (
    id         TEXT PRIMARY KEY DEFAULT 'default',
    blocks     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.ai_settings (id, blocks)
VALUES ('default', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- RLS: mismo patrón abierto que el resto del dashboard (app personal, anon key).
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_settings anon all" ON public.ai_settings;
CREATE POLICY "ai_settings anon all" ON public.ai_settings
    FOR ALL USING (true) WITH CHECK (true);
