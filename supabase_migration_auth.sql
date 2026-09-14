-- ============================================================================
-- Dashboard Content — Migración: autenticación propia (usuarios + sesiones)
--
-- Reemplaza la puerta de acceso basada en la variable de entorno AUTH_USERS
-- (cookie = hash de email:clave, imposible de revocar) por:
--   - app_users     usuarios con clave hasheada (scrypt), rol y estado
--   - app_sessions  sesiones revocables (la cookie guarda un token aleatorio;
--                   acá se guarda SOLO su SHA-256)
--   - auth_events   auditoría: logins ok/fallidos, bloqueos, revocaciones, altas
--
-- SEGURIDAD: estas tres tablas tienen RLS activo y NINGUNA política. Ni la
-- anon key ni la key "authenticated" pueden leerlas ni escribirlas. Sólo el
-- servidor, con SUPABASE_SERVICE_ROLE_KEY (que bypassa RLS), las toca.
--
-- Correr en Supabase → SQL Editor. Idempotente.
-- Después: `node scripts/auth-cli.mjs create-user <email> --name "..." --role admin`
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_users (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                text NOT NULL UNIQUE CHECK (email = lower(email) AND email <> ''),
    name                 text NOT NULL DEFAULT '',
    role                 text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    password_hash        text NOT NULL,
    is_active            boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_login_at        timestamptz
);

CREATE TABLE IF NOT EXISTS public.app_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    ip           text,
    user_agent   text
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON public.app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_active_idx ON public.app_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.auth_events (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    type       text NOT NULL,
    email      text,
    user_id    uuid,
    actor_id   uuid,
    ip         text,
    user_agent text,
    detail     jsonb
);
CREATE INDEX IF NOT EXISTS auth_events_at_idx ON public.auth_events(at DESC);
CREATE INDEX IF NOT EXISTS auth_events_email_at_idx ON public.auth_events(email, at DESC);
CREATE INDEX IF NOT EXISTS auth_events_ip_at_idx ON public.auth_events(ip, at DESC);

-- RLS activo y sin políticas = cerrado para anon/authenticated. service_role bypassa.
ALTER TABLE public.app_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_events  ENABLE ROW LEVEL SECURITY;

-- Cinturón y tiradores: además de RLS, sin GRANT para las keys públicas.
REVOKE ALL ON TABLE public.app_users, public.app_sessions, public.auth_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.auth_events_id_seq FROM anon, authenticated;

-- updated_at automático
CREATE OR REPLACE FUNCTION public.app_users_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS app_users_touch_updated_at ON public.app_users;
CREATE TRIGGER app_users_touch_updated_at
    BEFORE UPDATE ON public.app_users
    FOR EACH ROW EXECUTE FUNCTION public.app_users_touch_updated_at();

-- Verificación
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('app_users', 'app_sessions', 'auth_events')
ORDER BY tablename;
