-- BAKO: foto y nombre de Instagram de cada contacto, e historial sincronizado con Meta.
-- Ejecutar DESPUÉS de supabase_migration_crm_inbox_v2.sql. Reejecutable.
BEGIN;
-- Perfil público de Instagram (API de perfil de usuario de mensajería). La URL de la foto
-- vence a los pocos días: se vuelve a pedir cada 3 (profile_fetched_at).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ig_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS profile_pic_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS profile_fetched_at timestamptz;
-- Última vez que se trajo la conversación desde Meta (mensajes enviados desde la app
-- de Instagram antes de que BAKO guardara los ecos, o webhooks perdidos).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS history_synced_at timestamptz;

-- Importa mensajes de la API de conversaciones en orden cronológico, sin duplicar
-- (meta_message_id es el mismo id que llega por webhook). Devuelve cuántos agregó.
-- No genera avisos push (notified_at) y actualiza last_inbound_at si faltaba alguno.
CREATE OR REPLACE FUNCTION public.crm_import_history(p_lead uuid, p_messages jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m jsonb; n integer := 0; inserted uuid; latest timestamptz;
BEGIN
 FOR m IN SELECT value FROM jsonb_array_elements(p_messages) ORDER BY (value->>'at')::timestamptz LOOP
  INSERT INTO lead_messages(lead_id,meta_message_id,text,received_at,attachments,direction,notified_at)
  VALUES(p_lead, m->>'mid', nullif(m->>'text',''), (m->>'at')::timestamptz, coalesce(m->'attachments','[]'::jsonb),
         CASE WHEN m->>'direction'='outbound' THEN 'outbound' ELSE 'inbound' END, now())
  ON CONFLICT(meta_message_id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NOT NULL THEN n := n + 1; END IF;
 END LOOP;
 SELECT max((value->>'at')::timestamptz) INTO latest FROM jsonb_array_elements(p_messages) WHERE value->>'direction'<>'outbound';
 UPDATE leads SET history_synced_at=now(),
  last_inbound_at=CASE WHEN latest IS NOT NULL AND (last_inbound_at IS NULL OR latest>last_inbound_at) THEN latest ELSE last_inbound_at END
 WHERE id=p_lead;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.crm_import_history(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_import_history(uuid,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
