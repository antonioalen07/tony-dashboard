-- BAKO: automatizaciones, contactos, etiquetas y seguimientos. Reejecutable.
BEGIN;
CREATE TABLE IF NOT EXISTS public.leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ig_account_id text NOT NULL, instagram_user_id text NOT NULL,
 username text, qualification text NOT NULL DEFAULT 'new' CHECK (qualification IN ('new','qualified','customer','unqualified')),
 opted_out boolean NOT NULL DEFAULT false, last_inbound_at timestamptz, notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ig_account_id,instagram_user_id)
);
CREATE TABLE IF NOT EXISTS public.lead_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_name ON public.lead_tags(lower(name));
CREATE TABLE IF NOT EXISTS public.lead_tag_assignments (lead_id uuid REFERENCES public.leads ON DELETE CASCADE, tag_id uuid REFERENCES public.lead_tags ON DELETE CASCADE, PRIMARY KEY(lead_id,tag_id));
CREATE TABLE IF NOT EXISTS public.automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT 'Nueva automatización', active boolean NOT NULL DEFAULT true,
 scope text NOT NULL DEFAULT 'media' CHECK(scope IN ('media','next_publish','all')), media_id text,
 publish_queue_id uuid REFERENCES public.publish_queue ON DELETE SET NULL, keywords text[] NOT NULL DEFAULT '{}',
 match_mode text NOT NULL DEFAULT 'contains' CHECK(match_mode IN ('contains','exact')), fuzzy boolean NOT NULL DEFAULT true,
 dm_text text NOT NULL CHECK(length(dm_text) BETWEEN 1 AND 1000), dm_link_url text, dm_link_label text,
 reply_enabled boolean NOT NULL DEFAULT true, reply_texts text[] NOT NULL DEFAULT '{}', once_per_user boolean NOT NULL DEFAULT true,
 tag_ids uuid[] NOT NULL DEFAULT '{}', starts_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), automation_id uuid NOT NULL REFERENCES public.automations ON DELETE CASCADE,
 comment_id text NOT NULL UNIQUE, media_id text, commenter_id text, commenter_username text, comment_text text, comment_at timestamptz,
 lead_id uuid REFERENCES public.leads ON DELETE SET NULL, source text NOT NULL CHECK(source IN ('webhook','poll')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','skipped','uncertain')),
 skip_reason text, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz, dm_sent_at timestamptz, reply_sent_at timestamptz, reply_comment_id text, message_id text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_events_queue ON public.automation_events(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS automation_events_user ON public.automation_events(automation_id,commenter_id);
CREATE TABLE IF NOT EXISTS public.lead_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads ON DELETE CASCADE,
 meta_message_id text NOT NULL UNIQUE, text text, received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.followup_sequences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, active boolean NOT NULL DEFAULT true,
 required_tag_ids uuid[] NOT NULL DEFAULT '{}', qualified_only boolean NOT NULL DEFAULT false, stop_on_reply boolean NOT NULL DEFAULT true, auto_enroll boolean NOT NULL DEFAULT false,
 steps jsonb NOT NULL CHECK(jsonb_typeof(steps)='array' AND jsonb_array_length(steps) BETWEEN 1 AND 20), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.followup_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads ON DELETE CASCADE,
 sequence_id uuid NOT NULL REFERENCES public.followup_sequences ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','completed')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(lead_id,sequence_id)
);
CREATE TABLE IF NOT EXISTS public.followup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES public.followup_enrollments ON DELETE CASCADE,
 step_index integer NOT NULL, step jsonb NOT NULL, due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','blocked','cancelled','uncertain')),
 attempts integer NOT NULL DEFAULT 0, claimed_at timestamptz, sent_at timestamptz, message_id text, error text,
 UNIQUE(enrollment_id,step_index)
);
CREATE INDEX IF NOT EXISTS followup_jobs_queue ON public.followup_jobs(status,due_at);

-- También actualiza una instalación que ya haya corrido la migración v1 del plan.
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS tag_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.automation_events ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads ON DELETE SET NULL;
ALTER TABLE public.automation_events ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.automation_events ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_status_check;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_status_check CHECK(status IN ('queued','sending','sent','failed','skipped','uncertain'));
ALTER TABLE public.followup_sequences ADD COLUMN IF NOT EXISTS auto_enroll boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.automation_remove_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE automations SET tag_ids=array_remove(tag_ids,OLD.id) WHERE OLD.id=ANY(tag_ids);
 UPDATE followup_sequences SET required_tag_ids=array_remove(required_tag_ids,OLD.id) WHERE OLD.id=ANY(required_tag_ids);
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS automation_remove_tag ON public.lead_tags;
CREATE TRIGGER automation_remove_tag AFTER DELETE ON public.lead_tags FOR EACH ROW EXECUTE FUNCTION public.automation_remove_tag();

CREATE OR REPLACE FUNCTION public.automation_stats()
RETURNS TABLE(automation_id uuid,status text,count bigint) LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT automation_id,status,count(*) FROM automation_events GROUP BY automation_id,status;
$$;
CREATE OR REPLACE FUNCTION public.automation_cancel_enrollment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE followup_enrollments SET status='cancelled' WHERE id=p_id;
 UPDATE followup_jobs SET status='cancelled',error='Cancelado por vos' WHERE enrollment_id=p_id AND status IN ('queued','blocked');
END $$;
CREATE OR REPLACE FUNCTION public.automation_auto_enroll()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate record;
BEGIN
 PERFORM pg_advisory_xact_lock(73481024);
 FOR candidate IN
  SELECT l.id AS lead,s.id AS sequence FROM leads l CROSS JOIN followup_sequences s
  WHERE s.active AND s.auto_enroll AND NOT l.opted_out AND l.last_inbound_at>now()-interval '24 hours'
  AND (NOT s.qualified_only OR l.qualification IN ('qualified','customer'))
  AND NOT EXISTS(SELECT 1 FROM unnest(s.required_tag_ids) t WHERE NOT EXISTS(SELECT 1 FROM lead_tag_assignments a WHERE a.lead_id=l.id AND a.tag_id=t))
  AND NOT EXISTS(SELECT 1 FROM followup_enrollments e WHERE e.lead_id=l.id AND e.sequence_id=s.id) LIMIT 100
 LOOP
  BEGIN PERFORM automation_enroll(candidate.lead,candidate.sequence); EXCEPTION WHEN unique_violation THEN NULL; END;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.automation_enqueue_comment(p_automation uuid,p_comment text,p_media text,p_user text,p_username text,p_text text,p_at timestamptz,p_source text,p_account text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a automations; l uuid; e uuid; done boolean;
BEGIN
 SELECT * INTO a FROM automations WHERE id=p_automation AND active;
 IF a.id IS NULL OR p_at<a.starts_at OR p_user=p_account THEN RETURN; END IF;
 IF p_user IS NOT NULL THEN
  INSERT INTO leads(ig_account_id,instagram_user_id,username) VALUES(p_account,p_user,p_username)
  ON CONFLICT(ig_account_id,instagram_user_id) DO UPDATE SET username=coalesce(excluded.username,leads.username),updated_at=now() RETURNING id INTO l;
 END IF;
 SELECT EXISTS(SELECT 1 FROM automation_events WHERE automation_id=a.id AND commenter_id=p_user AND status='sent') INTO done;
 INSERT INTO automation_events(automation_id,comment_id,media_id,commenter_id,commenter_username,comment_text,comment_at,source,lead_id,status,skip_reason)
 VALUES(a.id,p_comment,p_media,p_user,p_username,p_text,p_at,p_source,l,CASE WHEN a.once_per_user AND done THEN 'skipped' ELSE 'queued' END,CASE WHEN a.once_per_user AND done THEN 'Ya recibió el DM' END)
 ON CONFLICT(comment_id) DO NOTHING RETURNING id INTO e;
 IF e IS NOT NULL AND l IS NOT NULL THEN
  INSERT INTO lead_tag_assignments SELECT l,t.id FROM lead_tags t WHERE t.id=ANY(a.tag_ids) ON CONFLICT DO NOTHING;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.automation_receive_message(p_account text,p_user text,p_mid text,p_text text,p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l uuid; inserted uuid;
BEGIN
 INSERT INTO leads(ig_account_id,instagram_user_id) VALUES(p_account,p_user) ON CONFLICT(ig_account_id,instagram_user_id) DO UPDATE SET updated_at=now() RETURNING id INTO l;
 INSERT INTO lead_messages(lead_id,meta_message_id,text,received_at) VALUES(l,p_mid,p_text,p_at) ON CONFLICT(meta_message_id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN RETURN; END IF;
 UPDATE leads SET last_inbound_at=greatest(last_inbound_at,p_at),updated_at=now() WHERE id=l;
 UPDATE followup_jobs j SET status='cancelled',error='El contacto respondió' FROM followup_enrollments e,followup_sequences s
 WHERE j.enrollment_id=e.id AND e.sequence_id=s.id AND e.lead_id=l AND s.stop_on_reply AND e.created_at<=p_at AND j.status='queued';
 UPDATE followup_enrollments e SET status='cancelled' FROM followup_sequences s WHERE e.sequence_id=s.id AND e.lead_id=l AND s.stop_on_reply AND e.created_at<=p_at AND e.status='active';
END $$;

CREATE OR REPLACE FUNCTION public.automation_enroll(p_lead uuid,p_sequence uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s followup_sequences; e uuid; item jsonb; n integer=0; due timestamptz=now();
BEGIN
 SELECT * INTO s FROM followup_sequences WHERE id=p_sequence AND active;
 IF s.id IS NULL THEN RAISE EXCEPTION 'La secuencia no está activa'; END IF;
 IF NOT EXISTS(SELECT 1 FROM leads WHERE id=p_lead AND NOT opted_out) THEN RAISE EXCEPTION 'El contacto no está disponible'; END IF;
 INSERT INTO followup_enrollments(lead_id,sequence_id) VALUES(p_lead,p_sequence) RETURNING id INTO e;
 FOR item IN SELECT value FROM jsonb_array_elements(s.steps) LOOP
  due=due+make_interval(mins => (item->>'delay_minutes')::integer);
  INSERT INTO followup_jobs(enrollment_id,step_index,step,due_at) VALUES(e,n,item,due); n=n+1;
 END LOOP;
 RETURN e;
END $$;

-- Un único lock serializa el reclamo entre réplicas y comparte el cupo de DM.
CREATE OR REPLACE FUNCTION public.automation_claim(p_limit integer DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used integer; ev automation_events; job followup_jobs;
BEGIN
 PERFORM pg_advisory_xact_lock(73481023);
 UPDATE automation_events SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 UPDATE followup_jobs SET status='uncertain',error='Envío interrumpido: revisá Instagram antes de reenviar' WHERE status='sending' AND claimed_at<now()-interval '10 minutes';
 SELECT (SELECT count(*) FROM automation_events WHERE greatest(dm_sent_at,claimed_at)>now()-interval '1 hour') +
 (SELECT count(*) FROM followup_jobs WHERE greatest(sent_at,claimed_at)>now()-interval '1 hour') INTO used;
 IF used>=greatest(0,p_limit) THEN RETURN NULL; END IF;
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

DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['leads','lead_tags','lead_tag_assignments','automations','automation_events','lead_messages','followup_sequences','followup_enrollments','followup_jobs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('automation_enqueue_comment','automation_receive_message','automation_enroll','automation_claim','automation_stats','automation_cancel_enrollment','automation_auto_enroll','automation_remove_tag') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
COMMIT;
