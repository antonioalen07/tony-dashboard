-- ============================================================================
-- Migración: Inspiración (Banger Hunter) + Chat con sesiones
-- Ejecutar UNA vez en el SQL Editor de Supabase.
-- Es idempotente: se puede correr de nuevo sin romper nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Referentes fijos (cuentas que Banger Hunter escanea)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    last_scanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2) Videos virales detectados (bangers guardados)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inspiration_videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instagram_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    caption TEXT,
    cover_url TEXT,
    post_url TEXT,
    posted_at TIMESTAMP WITH TIME ZONE,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    duration_s NUMERIC,
    followers INTEGER,
    account_median NUMERIC,
    multiplier NUMERIC,
    score NUMERIC,
    transcript TEXT,
    adaptation JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3) Chat: sesiones + mensajes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON public.chat_messages(session_id, created_at);

-- ----------------------------------------------------------------------------
-- 4) RLS: acceso anon completo (dashboard personal, mismo patrón que reels)
-- ----------------------------------------------------------------------------
ALTER TABLE public.referents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspiration_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['referents', 'inspiration_videos', 'chat_sessions', 'chat_messages']
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
-- 5) Policy DELETE de reels que faltaba (los borrados se ignoraban en silencio)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.reels;
CREATE POLICY "Allow anonymous delete access"
ON public.reels FOR DELETE
TO anon
USING (true);

-- Verificación rápida:
SELECT 'referents' AS tabla, count(*) FROM public.referents
UNION ALL SELECT 'inspiration_videos', count(*) FROM public.inspiration_videos
UNION ALL SELECT 'chat_sessions', count(*) FROM public.chat_sessions
UNION ALL SELECT 'chat_messages', count(*) FROM public.chat_messages;
