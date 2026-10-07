-- BAKO: compatibilidad con leads existentes, bandeja e historias.
-- Ejecutar DESPUÉS de supabase_migration_automations.sql. Reejecutable.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ig_account_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS instagram_user_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification text NOT NULL DEFAULT 'new' CHECK (qualification IN ('new','qualified','customer','unqualified'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS leads_instagram_identity ON public.leads(ig_account_id,instagram_user_id);
-- Los leads de auditoría conservan todos sus datos. Instagram no provee email.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='email') THEN
  ALTER TABLE public.leads ALTER COLUMN email DROP NOT NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='nombre') THEN
  ALTER TABLE public.leads ALTER COLUMN nombre SET DEFAULT 'Contacto Instagram';
  UPDATE public.leads SET display_name=nombre WHERE display_name IS NULL AND nombre IS NOT NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='instagram') THEN
  UPDATE public.leads SET username=trim(leading '@' from instagram) WHERE username IS NULL AND instagram IS NOT NULL AND instagram !~ '[/ ]';
 END IF;
END $$;
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound','outbound'));
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(attachments)='array');
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS story_id text;
CREATE INDEX IF NOT EXISTS lead_messages_history ON public.lead_messages(lead_id,received_at DESC);

CREATE TABLE IF NOT EXISTS public.story_automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, active boolean NOT NULL DEFAULT true,
 keywords text[] NOT NULL DEFAULT '{}', match_mode text NOT NULL DEFAULT 'contains' CHECK(match_mode IN ('contains','exact')), fuzzy boolean NOT NULL DEFAULT true,
 dm_text text NOT NULL DEFAULT '', dm_audio_url text, tag_ids uuid[] NOT NULL DEFAULT '{}', once_per_user boolean NOT NULL DEFAULT true,
 starts_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((dm_audio_url IS NULL AND length(dm_text) BETWEEN 1 AND 1000) OR (dm_audio_url IS NOT NULL AND dm_text=''))
);
CREATE TABLE IF NOT EXISTS public.story_automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), automation_id uuid NOT NULL REFERENCES public.story_automations ON DELETE CASCADE,
 lead_id uuid NOT NULL REFERENCES public.leads ON DELETE CASCADE, inbound_message_id text NOT NULL UNIQUE, story_id text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','blocked','skipped','uncertain')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, sent_at timestamptz, message_id text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_events_queue ON public.story_automation_events(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS story_events_lead ON public.story_automation_events(automation_id,lead_id);
CREATE TABLE IF NOT EXISTS public.inbox_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL UNIQUE, lead_id uuid NOT NULL REFERENCES public.leads ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('text','audio')), text text, audio_url text,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','blocked','uncertain')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, sent_at timestamptz, message_id text, error text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='text' AND length(text) BETWEEN 1 AND 1000 AND audio_url IS NULL) OR (kind='audio' AND audio_url IS NOT NULL AND coalesce(text,'')=''))
);
CREATE INDEX IF NOT EXISTS inbox_outbox_queue ON public.inbox_outbox(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS inbox_outbox_lead ON public.inbox_outbox(lead_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_receive_message(p_account text,p_user text,p_mid text,p_text text,p_at timestamptz,p_attachments jsonb,p_story_id text,p_rule uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l uuid; inserted uuid; rule story_automations; done boolean;
BEGIN
 INSERT INTO leads(ig_account_id,instagram_user_id) VALUES(p_account,p_user)
 ON CONFLICT(ig_account_id,instagram_user_id) DO UPDATE SET updated_at=now() RETURNING id INTO l;
 INSERT INTO lead_messages(lead_id,meta_message_id,text,received_at,attachments,story_id)
 VALUES(l,p_mid,p_text,p_at,coalesce(p_attachments,'[]'),p_story_id) ON CONFLICT(meta_message_id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN RETURN; END IF;
 UPDATE leads SET last_inbound_at=greatest(last_inbound_at,p_at),updated_at=now() WHERE id=l;
 UPDATE followup_jobs j SET status='cancelled',error='El contacto respondió' FROM followup_enrollments e,followup_sequences s
 WHERE j.enrollment_id=e.id AND e.sequence_id=s.id AND e.lead_id=l AND s.stop_on_reply AND e.created_at<=p_at AND j.status='queued';
 UPDATE followup_enrollments e SET status='cancelled' FROM followup_sequences s WHERE e.sequence_id=s.id AND e.lead_id=l AND s.stop_on_reply AND e.created_at<=p_at AND e.status='active';
 IF p_story_id IS NULL OR p_rule IS NULL THEN RETURN; END IF;
 SELECT * INTO rule FROM story_automations WHERE id=p_rule AND active AND starts_at<=p_at;
 IF rule.id IS NULL THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM story_automation_events WHERE automation_id=rule.id AND lead_id=l AND status IN ('sent','sending','uncertain')) INTO done;
 INSERT INTO story_automation_events(automation_id,lead_id,inbound_message_id,story_id,status,error)
 VALUES(rule.id,l,p_mid,p_story_id,CASE WHEN rule.once_per_user AND done THEN 'skipped' ELSE 'queued' END,CASE WHEN rule.once_per_user AND done THEN 'Ya recibió la respuesta' END);
 INSERT INTO lead_tag_assignments SELECT l,t.id FROM lead_tags t WHERE t.id=ANY(rule.tag_ids) ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION public.automation_remove_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE automations SET tag_ids=array_remove(tag_ids,OLD.id) WHERE OLD.id=ANY(tag_ids);
 UPDATE story_automations SET tag_ids=array_remove(tag_ids,OLD.id) WHERE OLD.id=ANY(tag_ids);
 UPDATE followup_sequences SET required_tag_ids=array_remove(required_tag_ids,OLD.id) WHERE OLD.id=ANY(required_tag_ids);
 RETURN OLD;
END $$;

-- Todas las salidas comparten cupo y lock entre réplicas. Manual tiene prioridad.
CREATE OR REPLACE FUNCTION public.automation_claim(p_limit integer DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used integer; ev automation_events; job followup_jobs; story story_automation_events; manual inbox_outbox;
BEGIN
 PERFORM pg_advisory_xact_lock(73481023);
 UPDATE automation_events SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 UPDATE followup_jobs SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 UPDATE story_automation_events SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 UPDATE inbox_outbox SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 SELECT (SELECT count(*) FROM automation_events WHERE greatest(dm_sent_at,claimed_at)>now()-interval '1 hour') +
 (SELECT count(*) FROM followup_jobs WHERE greatest(sent_at,claimed_at)>now()-interval '1 hour') +
 (SELECT count(*) FROM story_automation_events WHERE greatest(sent_at,claimed_at)>now()-interval '1 hour') +
 (SELECT count(*) FROM inbox_outbox WHERE greatest(sent_at,claimed_at)>now()-interval '1 hour') INTO used;
 IF used>=greatest(0,p_limit) THEN RETURN NULL; END IF;
 SELECT * INTO manual FROM inbox_outbox WHERE status='queued' AND next_attempt_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF manual.id IS NOT NULL THEN
  UPDATE inbox_outbox SET status='sending',claimed_at=now() WHERE id=manual.id;
  RETURN jsonb_build_object('kind','inbox','id',manual.id);
 END IF;
 SELECT e.* INTO story FROM story_automation_events e JOIN story_automations a ON a.id=e.automation_id WHERE e.status='queued' AND e.next_attempt_at<=now() AND a.active
 AND NOT EXISTS(SELECT 1 FROM story_automation_events x WHERE x.automation_id=e.automation_id AND x.lead_id=e.lead_id AND x.id<>e.id AND x.status IN ('sending','uncertain'))
 ORDER BY e.created_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED;
 IF story.id IS NOT NULL THEN
  UPDATE story_automation_events SET status='sending',claimed_at=now() WHERE id=story.id;
  RETURN jsonb_build_object('kind','story','id',story.id);
 END IF;
 SELECT e.* INTO ev FROM automation_events e JOIN automations a ON a.id=e.automation_id WHERE e.status='queued' AND e.next_attempt_at<=now() AND a.active
 AND NOT EXISTS(SELECT 1 FROM automation_events x WHERE x.automation_id=e.automation_id AND x.commenter_id=e.commenter_id AND x.id<>e.id AND x.status IN ('sending','uncertain'))
 ORDER BY e.created_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED;
 IF ev.id IS NOT NULL THEN
  UPDATE automation_events SET status='sending',claimed_at=now() WHERE id=ev.id;
  RETURN jsonb_build_object('kind','comment','id',ev.id);
 END IF;
 SELECT j.* INTO job FROM followup_jobs j JOIN followup_enrollments e ON e.id=j.enrollment_id JOIN followup_sequences s ON s.id=e.sequence_id
 WHERE j.status='queued' AND j.due_at<=now() AND e.status='active' AND s.active
 AND NOT EXISTS(SELECT 1 FROM followup_jobs prev WHERE prev.enrollment_id=j.enrollment_id AND prev.step_index<j.step_index AND prev.status<>'sent')
 ORDER BY j.due_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF job.id IS NOT NULL THEN
  UPDATE followup_jobs SET status='sending',claimed_at=now() WHERE id=job.id;
  RETURN jsonb_build_object('kind','followup','id',job.id);
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['story_automations','story_automation_events','inbox_outbox'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.crm_receive_message(text,text,text,text,timestamptz,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_receive_message(text,text,text,text,timestamptz,jsonb,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
