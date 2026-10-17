-- BAKO: la bandeja se ordena por el último mensaje (entrante o saliente), como WhatsApp.
-- Antes se ordenaba por leads.updated_at, que en esta base lo cambia un trigger heredado
-- ante cualquier edición (p. ej. al cargar las fotos de perfil) y mezclaba el orden.
-- Ejecutar DESPUÉS de supabase_migration_crm_inbox_v3.sql. Reejecutable.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_activity ON public.leads(ig_account_id, last_activity_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.crm_track_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE leads SET last_activity_at=greatest(coalesce(last_activity_at,'-infinity'),NEW.received_at) WHERE id=NEW.lead_id;
 IF NEW.direction='outbound' THEN
  PERFORM crm_mark_replied(NEW.lead_id, NEW.received_at);
 ELSE
  UPDATE leads SET unread=true WHERE id=NEW.lead_id
   AND NEW.received_at>greatest(coalesce(last_reply_at,'-infinity'),coalesce(read_at,'-infinity'));
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.crm_track_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
  UPDATE leads SET last_activity_at=greatest(coalesce(last_activity_at,'-infinity'),coalesce(NEW.sent_at,now())) WHERE id=NEW.lead_id;
  PERFORM crm_mark_replied(NEW.lead_id, coalesce(NEW.sent_at, now()));
 END IF;
 RETURN NEW;
END $$;

-- Completar lo que ya existe.
UPDATE public.leads l SET last_activity_at=x.at FROM (
 SELECT lead_id, max(at) at FROM (
  SELECT lead_id, received_at at FROM public.lead_messages
  UNION ALL SELECT lead_id, sent_at FROM public.inbox_outbox WHERE status='sent' AND sent_at IS NOT NULL
 ) s GROUP BY lead_id
) x WHERE x.lead_id=l.id AND (l.last_activity_at IS NULL OR l.last_activity_at<x.at);

NOTIFY pgrst, 'reload schema';
COMMIT;
