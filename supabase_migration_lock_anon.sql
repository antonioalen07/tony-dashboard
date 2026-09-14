-- ============================================================================
-- Dashboard Content — Migración: CERRAR la base a la anon key
--
-- Hasta ahora todas las tablas tenían políticas `TO anon USING (true)` y la
-- anon key viajaba al navegador. Eso significa que cualquiera que haya entrado
-- alguna vez a la app tiene, en su navegador, una llave con acceso total a la
-- base — aunque se le cierre la sesión de la app.
--
-- Esta migración deja la anon key sin ningún poder:
--   1. borra TODAS las políticas RLS que apliquen a anon/authenticated/public
--      en las tablas de `public` y en `storage.objects` (bucket studio)
--   2. activa RLS en todas las tablas de `public` (sin políticas = cerrado)
--   3. revoca los GRANT de anon/authenticated sobre tablas, secuencias y
--      funciones de `public`, y los default privileges para tablas futuras
--
-- Lo único que sigue funcionando sin llave es la LECTURA de objetos del bucket
-- público `studio` por URL (/storage/v1/object/public/...), que es lo que usan
-- las <img>/<video> de la app. Listar, subir o borrar ya no.
--
-- ⚠️ ORDEN: correr SÓLO DESPUÉS de que Vercel tenga SUPABASE_SERVICE_ROLE_KEY y
-- el deploy nuevo esté arriba (el servidor y el worker pasan a usar esa key; el
-- navegador ya no habla directo con Supabase, sino vía /api/db).
-- También hay que actualizar el worker (Easypanel) con SUPABASE_SERVICE_ROLE_KEY.
--
-- Idempotente.
-- ============================================================================

-- 1. Políticas abiertas a roles públicos, en public.* y storage.objects
DO $$
DECLARE p record;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE (schemaname = 'public' OR (schemaname = 'storage' AND tablename = 'objects'))
          AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
        RAISE NOTICE 'policy borrada: %.% -> %', p.schemaname, p.tablename, p.policyname;
    END LOOP;
END $$;

-- 2. RLS en todas las tablas de public (las que no lo tenían quedaban abiertas por GRANT)
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;

-- 3. Sin GRANT para las keys públicas (service_role conserva los suyos y bypassa RLS)
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
-- Tablas/secuencias/funciones que se creen de acá en más (por el rol postgres) tampoco.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Verificación: las dos consultas deben devolver 0 filas.
SELECT schemaname, tablename, policyname, roles
FROM pg_policies
WHERE (schemaname = 'public' OR (schemaname = 'storage' AND tablename = 'objects'))
  AND roles && ARRAY['anon', 'authenticated', 'public']::name[];

SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
