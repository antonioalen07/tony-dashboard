-- ============================================================================
-- Migración: Producción de contenido
--
--   1) Resultados de negocio por reel (carga MANUAL): agendas y leads
--      calificados que trajo cada video.
--   2) Tablero de guiones (Kanban) — sección "Guiones".
--   3) Banco de ideas y referencias — misma sección, otra vista.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase.
-- Es idempotente: se puede correr de nuevo sin romper nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Resultados de negocio por reel
--    Se cargan a mano desde el panel de detalle de cada reel. NULL = "todavía
--    no lo medí", que no es lo mismo que 0 (medido y no trajo nada): por eso
--    no llevan DEFAULT.
-- ----------------------------------------------------------------------------
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS bookings INTEGER;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS qualified_leads INTEGER;

COMMENT ON COLUMN public.reels.bookings IS 'Agendas (reuniones) atribuidas a este reel. Carga manual.';
COMMENT ON COLUMN public.reels.qualified_leads IS 'Leads calificados atribuidos a este reel. Carga manual.';

-- ----------------------------------------------------------------------------
-- 2) Guiones (tablero Kanban)
--    status = columna del tablero; position = orden DENTRO de la columna
--    (se mueve por punto medio entre vecinos, por eso es NUMERIC y no INTEGER).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scripts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Guion sin título',
    status TEXT NOT NULL DEFAULT 'borrador',
    format TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    hook TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    cta TEXT NOT NULL DEFAULT '',
    refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    position NUMERIC NOT NULL DEFAULT 1000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scripts_board ON public.scripts(status, position);

-- ----------------------------------------------------------------------------
-- 3) Banco de ideas y referencias
--    kind = 'idea' (algo que se nos ocurrió) | 'reference' (un video que nos
--    gustó y queremos tener a mano). `used` archiva sin borrar.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ideas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'idea',
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ideas_created ON public.ideas(created_at DESC);

-- ----------------------------------------------------------------------------
-- 4) RLS: acceso anon completo (dashboard personal, mismo patrón que reels)
-- ----------------------------------------------------------------------------
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['scripts', 'ideas']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "anon select %s" ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "anon insert %s" ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "anon update %s" ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "anon delete %s" ON public.%I', t, t);
        EXECUTE format('CREATE POLICY "anon select %s" ON public.%I FOR SELECT TO anon USING (true)', t, t);
        EXECUTE format('CREATE POLICY "anon insert %s" ON public.%I FOR INSERT TO anon WITH CHECK (true)', t, t);
        EXECUTE format('CREATE POLICY "anon update %s" ON public.%I FOR UPDATE TO anon USING (true) WITH CHECK (true)', t, t);
        EXECUTE format('CREATE POLICY "anon delete %s" ON public.%I FOR DELETE TO anon USING (true)', t, t);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5) Refrescar el caché de esquema de PostgREST
--    Sin esto, las columnas nuevas de `reels` pueden seguir respondiendo
--    "Could not find the 'bookings' column ... in the schema cache" un rato.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- Verificación rápida:
SELECT 'scripts' AS tabla, count(*) FROM public.scripts
UNION ALL SELECT 'ideas', count(*) FROM public.ideas
UNION ALL SELECT 'reels con agendas', count(*) FROM public.reels WHERE bookings IS NOT NULL;
