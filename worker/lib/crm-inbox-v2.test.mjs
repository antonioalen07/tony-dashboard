import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const files = ['supabase_migration_automations.sql', 'supabase_migration_automations_crm.sql', 'supabase_migration_crm_inbox_v2.sql', 'supabase_migration_push_tags.sql'];
const sql = await Promise.all(files.map((f) => readFile(new URL(`../../${f}`, import.meta.url), 'utf8')));

async function database() {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE publish_queue(id uuid PRIMARY KEY, status text, ig_media_id text, published_at timestamptz);
        CREATE TABLE app_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
    for (const s of sql) await db.exec(s);
    return db;
}
const lead = async (db, user = 'visitor') => (await db.query('SELECT * FROM leads WHERE instagram_user_id=$1', [user])).rows[0];
const receive = (db, mid, at = 'now()', user = 'visitor') => db.query(`SELECT crm_receive_message('account',$1,$2,'Hola',${at},'[]',NULL,NULL)`, [user, mid]);

test('Sin responder: entra un DM, se responde desde Instagram (eco) y vuelve a entrar otro', async () => {
    const db = await database();
    try {
        await sql.reduce((p, s) => p.then(() => db.exec(s)), Promise.resolve()); // reejecutable
        await receive(db, 'in-1', "now()-interval '5 minutes'");
        assert.equal((await lead(db)).unread, true);
        await db.query("SELECT crm_record_echo('account','visitor','echo-1','Respondido desde el teléfono',now()-interval '4 minutes','[]')");
        let l = await lead(db);
        assert.equal(l.unread, false);
        assert.ok(l.last_reply_at);
        await db.query("SELECT crm_record_echo('account','visitor','echo-1','duplicado',now(),'[]')");
        assert.equal((await db.query("SELECT count(*)::int n FROM lead_messages WHERE direction='outbound'")).rows[0].n, 1);
        await receive(db, 'in-2');
        assert.equal((await lead(db)).unread, true);
        // Marcar como leído a mano y que un mensaje viejo reentregado no lo reabra
        await db.query("UPDATE leads SET unread=false, read_at=now() WHERE instagram_user_id='visitor'");
        await receive(db, 'in-old', "now()-interval '1 hour'");
        assert.equal((await lead(db)).unread, false);
    } finally { await db.close(); }
});

test('Sin responder: un envío manual confirmado cierra la conversación; uno en cola no', async () => {
    const db = await database();
    try {
        await receive(db, 'in-1', "now()-interval '2 minutes'");
        const l = await lead(db);
        const { rows: [row] } = await db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,text) VALUES(gen_random_uuid(),$1,'text','Hola!') RETURNING id", [l.id]);
        assert.equal((await lead(db)).unread, true);
        await db.query("UPDATE inbox_outbox SET status='sent', sent_at=now() WHERE id=$1", [row.id]);
        assert.equal((await lead(db)).unread, false);
    } finally { await db.close(); }
});

test('Imágenes: la bandeja acepta imagen sola y rechaza mezclas', async () => {
    const db = await database();
    try {
        await receive(db, 'in-1');
        const l = await lead(db);
        await db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,image_url) VALUES(gen_random_uuid(),$1,'image','https://example.com/a.jpg')", [l.id]);
        await assert.rejects(db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,text,image_url) VALUES(gen_random_uuid(),$1,'image','texto','https://example.com/a.jpg')", [l.id]));
        await assert.rejects(db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind) VALUES(gen_random_uuid(),$1,'image')", [l.id]));
        await db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,audio_url) VALUES(gen_random_uuid(),$1,'audio','https://example.com/a.mp3')", [l.id]);
    } finally { await db.close(); }
});

test('Backfill: sólo marca pendientes de la última semana', async () => {
    const db = new PGlite();
    try {
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
            CREATE TABLE publish_queue(id uuid PRIMARY KEY, status text, ig_media_id text, published_at timestamptz);
            CREATE TABLE app_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
        await db.exec(sql[0]); await db.exec(sql[1]);
        await receive(db, 'reciente', "now()-interval '1 day'", 'a');
        await receive(db, 'viejo', "now()-interval '30 days'", 'b');
        await receive(db, 'respondido', "now()-interval '2 days'", 'c');
        const c = await lead(db, 'c');
        await db.query("INSERT INTO inbox_outbox(client_id,lead_id,kind,text,status,sent_at) VALUES(gen_random_uuid(),$1,'text','ok','sent',now()-interval '1 day')", [c.id]);
        await db.exec(sql[2]);
        assert.deepEqual([(await lead(db, 'a')).unread, (await lead(db, 'b')).unread, (await lead(db, 'c')).unread], [true, false, false]);
    } finally { await db.close(); }
});

test('Push: borrar una etiqueta la saca del filtro de cada dispositivo', async () => {
    const db = await database();
    try {
        const { rows: [a] } = await db.query("INSERT INTO lead_tags(name) VALUES('B2B') RETURNING id");
        const { rows: [b] } = await db.query("INSERT INTO lead_tags(name) VALUES('Calificado') RETURNING id");
        await db.query("INSERT INTO push_subscriptions(endpoint,p256dh,auth,tag_ids) VALUES('https://push.example/1','k','a',ARRAY[$1,$2]::uuid[])", [a.id, b.id]);
        await db.query('DELETE FROM lead_tags WHERE id=$1', [a.id]);
        const { rows: [s] } = await db.query('SELECT tag_ids FROM push_subscriptions');
        assert.deepEqual(s.tag_ids, [b.id]);
    } finally { await db.close(); }
});
