-- BAKO: curación persistente de reels. Ejecutar en el SQL Editor de Supabase.
-- Re-ejecutable. Conserva todas las publicaciones y sus métricas.
BEGIN;

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transcript_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_reel_id uuid REFERENCES public.reels(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reels_canonical_not_self' AND conrelid = 'public.reels'::regclass) THEN
    ALTER TABLE public.reels ADD CONSTRAINT reels_canonical_not_self CHECK (canonical_reel_id IS DISTINCT FROM id);
  END IF;
END $$;

-- La sincronización actualiza sólo metadatos y métricas. Las marcas se conservan.
-- Este trigger impide que una transcripción/análisis en curso o un escritor
-- antiguo regenere contenido que el usuario acaba de excluir.
CREATE OR REPLACE FUNCTION public.enforce_reel_curation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_duplicate OR NEW.transcript_suppressed THEN
    NEW.transcript := NULL;
    NEW.ai_analysis := NULL;
    NEW.improvement := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reels_enforce_curation ON public.reels;
CREATE TRIGGER reels_enforce_curation BEFORE INSERT OR UPDATE ON public.reels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reel_curation();

REVOKE ALL ON FUNCTION public.enforce_reel_curation() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.reels.is_hidden IS 'Oculto en listas de contenido y excluido del contexto IA; se conservan sus métricas.';
COMMENT ON COLUMN public.reels.is_duplicate IS 'Publicación repetida excluida del catálogo principal y del contexto IA.';
COMMENT ON COLUMN public.reels.transcript_suppressed IS 'No regenerar ni almacenar transcripción/análisis hasta restauración explícita.';

NOTIFY pgrst, 'reload schema';
COMMIT;
