-- ============================================================================
-- Migración: Crevy Studio (Historias + Variantes de video + Calendario)
-- Ejecutar UNA vez en el SQL Editor de Supabase.
-- Es idempotente: se puede correr de nuevo sin romper nada.
-- No toca la tabla `reels` ni ninguna tabla existente (solo CREATE ... IF NOT EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Assets: imágenes y videos subidos/importados (viven en Storage bucket "studio")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    filename TEXT,
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'drive', 'reel')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2) Proyectos de historias (secuencia de slides 9:16 con capas de texto)
--    slides JSONB: [{ bg_asset_id, layers: [{ text, font, size, color, bold,
--                     underline, highlight, x, y, align }] }]
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.story_projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Nueva secuencia',
    slides JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3) Jobs de generación de variantes (los procesa el worker del VPS)
--    params JSONB: rangos de re-edición (saturación, contraste, trim, velocidad, zoom)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.variant_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
    num_variants INTEGER NOT NULL DEFAULT 5 CHECK (num_variants BETWEEN 1 AND 20),
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_jobs_status
    ON public.variant_jobs(status, created_at);

-- ----------------------------------------------------------------------------
-- 4) Variantes generadas (cada una apunta a un asset de video en el Storage)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.video_variants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES public.variant_jobs(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_variants_job
    ON public.video_variants(job_id, created_at);

-- ----------------------------------------------------------------------------
-- 5) Cola de publicación (calendario). La levanta el publicador del worker.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publish_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    variant_id UUID REFERENCES public.video_variants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'trial_reel' CHECK (kind IN ('trial_reel', 'reel', 'story')),
    scheduled_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    ig_media_id TEXT,
    error TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_queue_due
    ON public.publish_queue(status, scheduled_at);

-- ----------------------------------------------------------------------------
-- 6) Tokens de Google (Drive OAuth). Fila única.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expiry TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7) RLS: acceso anon completo (dashboard personal, mismo patrón que reels)
-- ----------------------------------------------------------------------------
ALTER TABLE public.media_assets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_tokens  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['media_assets', 'story_projects', 'variant_jobs', 'video_variants', 'publish_queue', 'google_tokens']
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
-- 8) Storage: bucket público "studio" + políticas anon sobre sus objetos
--    (video_url para la Graph API debe ser una URL pública -> bucket público)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('studio', 'studio', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
    DROP POLICY IF EXISTS "anon select studio objects" ON storage.objects;
    DROP POLICY IF EXISTS "anon insert studio objects" ON storage.objects;
    DROP POLICY IF EXISTS "anon update studio objects" ON storage.objects;
    DROP POLICY IF EXISTS "anon delete studio objects" ON storage.objects;
    CREATE POLICY "anon select studio objects" ON storage.objects
        FOR SELECT TO anon USING (bucket_id = 'studio');
    CREATE POLICY "anon insert studio objects" ON storage.objects
        FOR INSERT TO anon WITH CHECK (bucket_id = 'studio');
    CREATE POLICY "anon update studio objects" ON storage.objects
        FOR UPDATE TO anon USING (bucket_id = 'studio') WITH CHECK (bucket_id = 'studio');
    CREATE POLICY "anon delete studio objects" ON storage.objects
        FOR DELETE TO anon USING (bucket_id = 'studio');
END $$;

-- ----------------------------------------------------------------------------
-- Verificación rápida:
-- ----------------------------------------------------------------------------
SELECT 'media_assets' AS tabla, count(*) FROM public.media_assets
UNION ALL SELECT 'story_projects', count(*) FROM public.story_projects
UNION ALL SELECT 'variant_jobs', count(*) FROM public.variant_jobs
UNION ALL SELECT 'video_variants', count(*) FROM public.video_variants
UNION ALL SELECT 'publish_queue', count(*) FROM public.publish_queue
UNION ALL SELECT 'google_tokens', count(*) FROM public.google_tokens;
