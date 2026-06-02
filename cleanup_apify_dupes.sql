-- ============================================================================
-- Limpieza de duplicados de Apify  ->  ejecutar UNA vez en el SQL Editor de
-- Supabase (corre como service_role, así que salta RLS y sí borra).
--
-- Contexto: cada reel quedó duplicado. Las filas de Apify usan el PK de media
-- de Instagram (19 dígitos, empiezan por "3"); las de Meta Graph API tienen
-- 17 dígitos (17xx/18xx) y traen las métricas reales (reach, saves). Borramos
-- solo las de Apify.
-- ============================================================================

-- 1) Previsualizar lo que se va a borrar (opcional, revisa antes):
SELECT instagram_id, title, reach, saves
FROM public.reels
WHERE length(instagram_id) >= 19
ORDER BY published_at DESC;

-- 2) Borrar los duplicados de Apify:
DELETE FROM public.reels
WHERE length(instagram_id) >= 19;

-- 3) Verificar (debería quedar ~20):
SELECT count(*) AS reels_restantes FROM public.reels;
