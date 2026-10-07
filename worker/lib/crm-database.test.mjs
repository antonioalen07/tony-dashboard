import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const baseSql = await readFile(new URL('../../supabase_migration_automations.sql', import.meta.url), 'utf8');
const crmSql = await readFile(new URL('../../supabase_migration_automations_crm.sql', import.meta.url), 'utf8');
const legacyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function legacyDatabase() {
    const db = new PGlite();
    await db.exec(`
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE publish_queue(id uuid PRIMARY KEY, status text, ig_media_id text, published_at timestamptz);
        CREATE TABLE leads(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL, email text NOT NULL UNIQUE,
            rubro text, instagram text, nivel integer NOT NULL DEFAULT 1, interacciones integer NOT NULL DEFAULT 1,
            origen text DEFAULT 'auditoria', created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(), telefono text
        );
    `);
    await db.query(`INSERT INTO leads(id,nombre,email,rubro,instagram,nivel,interacciones,telefono)
        VALUES($1,'Cliente anterior','anterior@example.com','Comercio','@cliente_anterior',3,9,'12345')`, [legacyId]);
    await db.exec(baseSql);
    await db.exec(crmSql);
    return db;
}

async function count(db, table) {
    return (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
}

test('CRM: migra dos veces el esquema legacy sin perder datos y habilita contactos sin email', async () => {
    const db = await legacyDatabase();
    try {
        await db.query("UPDATE leads SET display_name='Nombre personalizado', notes='Información previa', starred=true WHERE id=$1", [legacyId]);
        // Reaplicar la pareja completa también restaura los RPC ampliados.
        await db.exec(baseSql);
        await db.exec(crmSql);
        await db.exec(crmSql);
        const preserved = (await db.query('SELECT * FROM leads WHERE id=$1', [legacyId])).rows[0];
        for (const [field, value] of Object.entries({ nombre: 'Cliente anterior', email: 'anterior@example.com', rubro: 'Comercio', instagram: '@cliente_anterior', nivel: 3, interacciones: 9, telefono: '12345', username: 'cliente_anterior', display_name: 'Nombre personalizado', notes: 'Información previa', starred: true }))
            assert.equal(preserved[field], value, field);
        const receive = () => db.query("SELECT crm_receive_message('account','visitor','mid1','Hola',now(),'[]',NULL,NULL)");
        await receive(); await receive();
        await db.query("SELECT crm_receive_message('account','visitor-2','mid2','Hola',now(),'[]',NULL,NULL)");
        assert.equal(await count(db, 'leads'), 3);
        assert.equal(await count(db, 'lead_messages'), 2);
        const contact = (await db.query("SELECT nombre,email,ig_account_id,instagram_user_id FROM leads WHERE instagram_user_id='visitor'")).rows[0];
        assert.equal(contact.nombre, 'Contacto Instagram');
        assert.equal(contact.email, null);
        assert.equal(contact.ig_account_id, 'account');
        const automation = (await db.query("INSERT INTO automations(name,scope,keywords,dm_text) VALUES('Guía','all',ARRAY['guia'],'Hola') RETURNING id")).rows[0].id;
        await db.query("SELECT automation_enqueue_comment($1,'comment1','media','commenter','usuario','guia',now(),'webhook','account')", [automation]);
        await db.query("SELECT automation_enqueue_comment($1,'comment1','media','commenter','usuario','guia',now(),'webhook','account')", [automation]);
        assert.equal(await count(db, 'automation_events'), 1);
        assert.equal(await count(db, 'leads'), 4);
        assert.equal((await db.query("SELECT has_function_privilege('anon','crm_receive_message(text,text,text,text,timestamptz,jsonb,text,uuid)','EXECUTE') ok")).rows[0].ok, false);
        assert.equal((await db.query("SELECT has_function_privilege('authenticated','automation_claim(integer)','EXECUTE') ok")).rows[0].ok, false);
        for (const table of ['story_automations', 'story_automation_events', 'inbox_outbox']) {
            assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) ok', ['anon', table, 'SELECT'])).rows[0].ok, false);
            assert.equal((await db.query('SELECT relrowsecurity enabled FROM pg_class WHERE relname=$1', [table])).rows[0].enabled, true);
        }
    }
    finally { await db.close(); }
});

test('CRM: historias idempotentes guardan audio, etiquetan y respetan una respuesta por persona', async () => {
    const db = await legacyDatabase();
    try {
        const tag = (await db.query("INSERT INTO lead_tags(name) VALUES('B2B') RETURNING id")).rows[0].id;
        const rule = (await db.query("INSERT INTO story_automations(name,keywords,dm_text,tag_ids,starts_at) VALUES('Historias',ARRAY['guia'],'Hola',ARRAY[$1::uuid],now()-interval '1 hour') RETURNING id", [tag])).rows[0].id;
        const receive = (mid, time = 'now()') => db.query(`SELECT crm_receive_message('account','visitor',$1,'guia',${time},$2::jsonb,'story',$3)`, [mid, JSON.stringify([{ type: 'audio', payload: { url: 'https://example.com/a.mp3' } }]), rule]);
        await receive('mid-story-1');
        await receive('mid-story-1');
        const lead = (await db.query("SELECT id FROM leads WHERE instagram_user_id='visitor'")).rows[0].id;
        assert.equal(await count(db, 'lead_messages'), 1);
        assert.equal(await count(db, 'story_automation_events'), 1);
        assert.equal((await db.query('SELECT tag_id FROM lead_tag_assignments WHERE lead_id=$1', [lead])).rows[0].tag_id, tag);
        const stored = (await db.query("SELECT direction,attachments,story_id FROM lead_messages WHERE meta_message_id='mid-story-1'")).rows[0];
        assert.equal(stored.direction, 'inbound');
        assert.equal(stored.attachments[0].type, 'audio');
        assert.equal(stored.story_id, 'story');
        await db.query("UPDATE story_automation_events SET status='sent',sent_at=now()");
        await receive('mid-story-2');
        assert.equal((await db.query("SELECT status FROM story_automation_events WHERE inbound_message_id='mid-story-2'")).rows[0].status, 'skipped');
        const recent = (await db.query('SELECT last_inbound_at FROM leads WHERE id=$1', [lead])).rows[0].last_inbound_at;
        await receive('mid-old', "now()-interval '2 hours'");
        assert.equal(await count(db, 'story_automation_events'), 2, 'mensajes anteriores al inicio no disparan reglas');
        assert.equal(new Date((await db.query('SELECT last_inbound_at FROM leads WHERE id=$1', [lead])).rows[0].last_inbound_at).getTime(), new Date(recent).getTime());
        await db.query('DELETE FROM lead_tags WHERE id=$1', [tag]);
        assert.deepEqual((await db.query('SELECT tag_ids FROM story_automations WHERE id=$1', [rule])).rows[0].tag_ids, []);
        assert.equal(await count(db, 'lead_tag_assignments'), 0);
    }
    finally { await db.close(); }
});

test('CRM: todos los envíos comparten cupo, reclamo y recuperación sin repetir envíos ambiguos', async () => {
    const db = await legacyDatabase();
    try {
        await db.query("SELECT crm_receive_message('account','visitor','initial','Hola',now(),'[]',NULL,NULL)");
        const lead = (await db.query("SELECT id FROM leads WHERE instagram_user_id='visitor'")).rows[0].id;
        const rule = (await db.query("INSERT INTO story_automations(name,dm_text,starts_at) VALUES('Historias','Hola',now()-interval '1 hour') RETURNING id")).rows[0].id;
        await db.query("SELECT crm_receive_message('account','visitor','story-mid','Hola',now(),'[]','story',$1)", [rule]);
        const comment = (await db.query("INSERT INTO automations(name,scope,dm_text) VALUES('Comentarios','all','Hola') RETURNING id")).rows[0].id;
        await db.query("SELECT automation_enqueue_comment($1,'comment','media','visitor','usuario','Hola',now(),'webhook','account')", [comment]);
        const sequence = (await db.query(`INSERT INTO followup_sequences(name,steps) VALUES('Seguimiento','[{"kind":"text","text":"Hola","delay_minutes":0}]') RETURNING id`)).rows[0].id;
        await db.query('SELECT automation_enroll($1,$2)', [lead, sequence]);
        await db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,text) VALUES(gen_random_uuid(),$1,'text','Hola')", [lead]);
        const claim = async (limit) => (await db.query('SELECT automation_claim($1) job', [limit])).rows[0].job;
        assert.equal(await claim(0), null);
        const competing = await Promise.all([claim(1), claim(1)]);
        assert.equal(competing.filter(Boolean).length, 1, 'dos reclamos concurrentes sólo reservan un envío con cupo 1');
        const manual = competing.find(Boolean);
        assert.equal(manual.kind, 'inbox');
        assert.equal(await claim(1), null, 'el reclamo manual ya consume el cupo');
        const story = await claim(2);
        assert.equal(story.kind, 'story');
        assert.equal(await claim(2), null, 'las historias comparten cupo con la bandeja');
        const event = await claim(3);
        assert.equal(event.kind, 'comment');
        assert.equal(await claim(3), null);
        const followup = await claim(4);
        assert.equal(followup.kind, 'followup');
        assert.equal(await claim(4), null);
        for (const table of ['inbox_outbox', 'story_automation_events', 'automation_events', 'followup_jobs'])
            await db.query(`UPDATE ${table} SET claimed_at=now()-interval '11 minutes' WHERE status='sending'`);
        assert.equal(await claim(100), null);
        for (const table of ['inbox_outbox', 'story_automation_events', 'automation_events', 'followup_jobs'])
            assert.equal((await db.query(`SELECT status FROM ${table} LIMIT 1`)).rows[0].status, 'uncertain', table);
        // Una nueva respuesta de historia se registra pero no duplica una salida
        // cuya entrega quedó incierta después de interrumpirse el worker.
        await db.query("SELECT crm_receive_message('account','visitor','another-story','Hola',now(),'[]','story',$1)", [rule]);
        assert.equal((await db.query("SELECT status FROM story_automation_events WHERE inbound_message_id='another-story'")).rows[0].status, 'skipped');
        assert.equal(await claim(100), null);
    }
    finally { await db.close(); }
});
