-- BAKO: notificaciones sólo para contactos con ciertas etiquetas, por dispositivo.
-- Ejecutar DESPUÉS de supabase_migration_crm_inbox_v2.sql. Reejecutable.
BEGIN;
-- Vacío = avisar de todos los chats. Con etiquetas = sólo contactos que tengan alguna.
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS tag_ids uuid[] NOT NULL DEFAULT '{}';

-- Si se borra una etiqueta, sale de los filtros (si no, ese dispositivo dejaría de recibir avisos).
CREATE OR REPLACE FUNCTION public.push_remove_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE push_subscriptions SET tag_ids=array_remove(tag_ids,OLD.id) WHERE OLD.id=ANY(tag_ids);
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS push_remove_tag ON public.lead_tags;
CREATE TRIGGER push_remove_tag AFTER DELETE ON public.lead_tags FOR EACH ROW EXECUTE FUNCTION public.push_remove_tag();
REVOKE ALL ON FUNCTION public.push_remove_tag() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
