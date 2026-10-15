-- BAKO: imágenes en bandeja y seguimientos, conversaciones sin responder y
-- notificaciones push. Ejecutar DESPUÉS de supabase_migration_automations_crm.sql.
-- Reejecutable.
BEGIN;

-- ── 1) Imágenes en mensajes manuales ─────────────────────────────────────────
-- (Los pasos de seguimiento viven en jsonb: el tipo 'image' se valida en la API.)
ALTER TABLE public.inbox_outbox ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.inbox_outbox DROP CONSTRAINT IF EXISTS inbox_outbox_kind_check;
ALTER TABLE public.inbox_outbox ADD CONSTRAINT inbox_outbox_kind_check CHECK(kind IN ('text','audio','image'));
ALTER TABLE public.inbox_outbox DROP CONSTRAINT IF EXISTS inbox_outbox_check;
ALTER TABLE public.inbox_outbox DROP CONSTRAINT IF EXISTS inbox_outbox_content_check;
ALTER TABLE public.inbox_outbox ADD CONSTRAINT inbox_outbox_content_check CHECK(
 (kind='text' AND length(text) BETWEEN 1 AND 1000 AND audio_url IS NULL AND image_url IS NULL) OR
 (kind='audio' AND audio_url IS NOT NULL AND coalesce(text,'')='' AND image_url IS NULL) OR
 (kind='image' AND image_url IS NOT NULL AND coalesce(text,'')='' AND audio_url IS NULL));

-- ── 2) Sin responder ─────────────────────────────────────────────────────────
-- unread = el contacto escribió después de la última respuesta humana (desde
-- BAKO o desde la app de Instagram) y de la última vez que se marcó como leído.
-- Los DMs automáticos (comentarios, historias, seguimientos) no cuentan como respuesta.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS unread boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_unread ON public.leads(ig_account_id, updated_at DESC) WHERE unread;
-- Push: cada mensaje entrante se notifica una sola vez aunque Meta reintente el webhook.
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_mark_replied(p_lead uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE leads SET last_reply_at=greatest(coalesce(last_reply_at,p_at),p_at),
  unread=CASE WHEN last_inbound_at IS NULL OR last_inbound_at<=p_at THEN false ELSE unread END
 WHERE id=p_lead;
END $$;

CREATE OR REPLACE FUNCTION public.crm_track_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.direction='outbound' THEN
  PERFORM crm_mark_replied(NEW.lead_id, NEW.received_at);
 ELSE
  UPDATE leads SET unread=true WHERE id=NEW.lead_id
   AND NEW.received_at>greatest(coalesce(last_reply_at,'-infinity'),coalesce(read_at,'-infinity'));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_track_messages ON public.lead_messages;
CREATE TRIGGER crm_track_messages AFTER INSERT ON public.lead_messages FOR EACH ROW EXECUTE FUNCTION public.crm_track_messages();

CREATE OR REPLACE FUNCTION public.crm_track_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
  PERFORM crm_mark_replied(NEW.lead_id, coalesce(NEW.sent_at, now()));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_track_outbox ON public.inbox_outbox;
CREATE TRIGGER crm_track_outbox AFTER UPDATE OF status ON public.inbox_outbox FOR EACH ROW EXECUTE FUNCTION public.crm_track_outbox();

-- Eco de Meta: lo que se responde desde la app de Instagram (o lo que manda BAKO).
-- Se guarda como mensaje saliente; la bandeja descarta los que ya conoce por message_id.
CREATE OR REPLACE FUNCTION public.crm_record_echo(p_account text,p_user text,p_mid text,p_text text,p_at timestamptz,p_attachments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l uuid;
BEGIN
 INSERT INTO leads(ig_account_id,instagram_user_id) VALUES(p_account,p_user)
 ON CONFLICT(ig_account_id,instagram_user_id) DO UPDATE SET updated_at=leads.updated_at RETURNING id INTO l;
 INSERT INTO lead_messages(lead_id,meta_message_id,text,received_at,attachments,direction)
 VALUES(l,p_mid,p_text,p_at,coalesce(p_attachments,'[]'),'outbound') ON CONFLICT(meta_message_id) DO NOTHING;
END $$;

-- Una sola vez: lo ya respondido y lo pendiente de la última semana.
UPDATE public.leads l SET last_reply_at=x.at FROM (
 SELECT lead_id, max(at) at FROM (
  SELECT lead_id, sent_at at FROM public.inbox_outbox WHERE status='sent' AND sent_at IS NOT NULL
  UNION ALL SELECT lead_id, received_at FROM public.lead_messages WHERE direction='outbound'
 ) s GROUP BY lead_id
) x WHERE x.lead_id=l.id AND (l.last_reply_at IS NULL OR l.last_reply_at<x.at);
UPDATE public.leads SET unread=true
WHERE NOT unread AND last_inbound_at>now()-interval '7 days'
 AND last_inbound_at>greatest(coalesce(last_reply_at,'-infinity'),coalesce(read_at,'-infinity'));

-- ── 3) Notificaciones push ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint text NOT NULL UNIQUE CHECK(endpoint ~ '^https://'),
 p256dh text NOT NULL, auth text NOT NULL,
 user_id uuid REFERENCES public.app_users ON DELETE CASCADE,
 user_agent text, created_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon,authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('crm_mark_replied','crm_track_messages','crm_track_outbox','crm_record_echo') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
