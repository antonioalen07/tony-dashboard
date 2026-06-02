-- Run this in your Supabase SQL Editor

CREATE TABLE public.reels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instagram_id TEXT UNIQUE NOT NULL,
    title TEXT,
    cover_url TEXT,
    video_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    
    -- Public Metrics (from Apify)
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    
    -- Private Metrics (Manual Entry)
    reach INTEGER,
    saves INTEGER,
    shares INTEGER,
    engagement_rate NUMERIC,
    retention TEXT,
    
    -- AI Analysis
    ai_analysis JSONB,
    improvement TEXT,
    transcript TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Turn on RLS but allow anon access for now (since this is a personal dashboard)
ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access"
ON public.reels FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow anonymous insert access"
ON public.reels FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anonymous update access"
ON public.reels FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Sin esta política, DELETE con la anon key se ignora silenciosamente (0 filas,
-- sin error). Necesaria si quieres borrar reels desde la app/scripts.
CREATE POLICY "Allow anonymous delete access"
ON public.reels FOR DELETE
TO anon
USING (true);
