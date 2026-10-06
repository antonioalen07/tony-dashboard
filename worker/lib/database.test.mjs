import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('migración real: duplicados, cupo compartido, recuperación y cancelación',async()=>{
 const db=new PGlite();
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE publish_queue(id uuid primary key,status text,ig_media_id text,published_at timestamptz);');
  const sql=await readFile(new URL('../../supabase_migration_automations.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  const a=(await db.query("INSERT INTO automations(name,scope,keywords,dm_text) VALUES('Ojo','all',ARRAY['ojo'],'Hola') RETURNING id")).rows[0].id;
  const enqueue=async(comment)=>db.query("SELECT automation_enqueue_comment($1,$2,'media','visitor','juan','OJO',now(),'poll','owner')",[a,comment]);
  await enqueue('comment1');await enqueue('comment1');await enqueue('comment2');
  assert.equal((await db.query('SELECT count(*)::int n FROM automation_events')).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM leads')).rows[0].n,1);
  const claim=(await db.query('SELECT automation_claim(1) AS job')).rows[0].job;
  assert.equal(claim.kind,'comment');
  assert.equal((await db.query('SELECT automation_claim(1) AS job')).rows[0].job,null);
  // Si el proceso muere, no habilitar un segundo envío ciegamente.
  await db.query("UPDATE automation_events SET claimed_at=now()-interval '11 minutes' WHERE id=$1",[claim.id]);
  await db.query('SELECT automation_claim(180)');
  assert.equal((await db.query('SELECT status FROM automation_events WHERE id=$1',[claim.id])).rows[0].status,'uncertain');
  assert.equal((await db.query('SELECT automation_claim(180) AS job')).rows[0].job,null);
  await db.query("UPDATE automation_events SET status='sent',dm_sent_at=now() WHERE id=$1",[claim.id]);
  assert.equal((await db.query('SELECT * FROM automation_stats() WHERE status=$1',['sent'])).rows[0].count,1);
  const lead=(await db.query('SELECT id FROM leads')).rows[0].id;
  await db.query("SELECT automation_receive_message('owner','visitor','mid1','Hola',now())");
  await db.query("SELECT automation_receive_message('owner','visitor','mid1','Hola',now()-interval '1 day')");
  assert.equal((await db.query('SELECT count(*)::int n FROM lead_messages')).rows[0].n,1);
  assert.equal((await db.query("SELECT last_inbound_at>now()-interval '1 minute' ok FROM leads")).rows[0].ok,true);
  const sequence=(await db.query(`INSERT INTO followup_sequences(name,steps) VALUES('Prueba','[{"kind":"text","text":"Hola","delay_minutes":0},{"kind":"audio","audio_url":"https://example.com/a.mp3","delay_minutes":10}]') RETURNING id`)).rows[0].id;
  const enrollment=(await db.query('SELECT automation_enroll($1,$2) AS id',[lead,sequence])).rows[0].id;
  assert.equal((await db.query('SELECT count(*)::int n FROM followup_jobs')).rows[0].n,2);
  await assert.rejects(db.query('SELECT automation_enroll($1,$2)',[lead,sequence]),/duplicate/);
  // No considerar una respuesta vieja como respuesta a una secuencia nueva.
  await db.query("SELECT automation_receive_message('owner','visitor','mid-old','Viejo',now()-interval '1 day')");
  assert.equal((await db.query('SELECT status FROM followup_enrollments WHERE id=$1',[enrollment])).rows[0].status,'active');
  await db.query("SELECT automation_receive_message('owner','visitor','mid2','Respondió',now())");
  assert.equal((await db.query('SELECT status FROM followup_enrollments WHERE id=$1',[enrollment])).rows[0].status,'cancelled');
  assert.equal((await db.query("SELECT count(*)::int n FROM followup_jobs WHERE status='cancelled'")).rows[0].n,2);
  const next=(await db.query(`INSERT INTO followup_sequences(name,auto_enroll,qualified_only,steps) VALUES('Automático',true,true,'[{"kind":"text","text":"Hola","delay_minutes":0}]') RETURNING id`)).rows[0].id;
  await db.query('SELECT automation_auto_enroll()');
  assert.equal((await db.query('SELECT count(*)::int n FROM followup_enrollments WHERE sequence_id=$1',[next])).rows[0].n,0);
  await db.query("UPDATE leads SET qualification='qualified'");
  await db.query('SELECT automation_auto_enroll()');await db.query('SELECT automation_auto_enroll()');
  assert.equal((await db.query('SELECT count(*)::int n FROM followup_enrollments WHERE sequence_id=$1',[next])).rows[0].n,1);
  await db.query("UPDATE automation_events SET status='skipped' WHERE status='queued'");
  const follow=(await db.query('SELECT automation_claim(180) job')).rows[0].job;
  assert.equal(follow.kind,'followup');
  const id=(await db.query('SELECT enrollment_id FROM followup_jobs WHERE id=$1',[follow.id])).rows[0].enrollment_id;
  await db.query('SELECT automation_cancel_enrollment($1)',[id]);
  assert.equal((await db.query('SELECT status FROM followup_enrollments WHERE id=$1',[id])).rows[0].status,'cancelled');
  // Funciones privilegiadas cerradas a clientes anon/authenticated.
  assert.equal((await db.query("SELECT has_function_privilege('anon','automation_claim(integer)','EXECUTE') ok")).rows[0].ok,false);
  assert.equal((await db.query("SELECT has_table_privilege('anon','leads','SELECT') ok")).rows[0].ok,false);
 }finally{await db.close();}
});
test('la migración actualiza el esquema v1 del plan original',async()=>{
 const db=new PGlite();
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE publish_queue(id uuid primary key);');
  const plan=await readFile(new URL('../../docs/PLAN_AUTOMATIZACIONES.md',import.meta.url),'utf8');
  const original=plan.match(/```sql\r?\n([\s\S]*?)```/)[1];
  await db.exec(original);
  const sql=await readFile(new URL('../../supabase_migration_automations.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='automation_events'")).rows.map((r)=>r.column_name);
  for(const name of ['lead_id','claimed_at','message_id'])assert.ok(columns.includes(name));
  assert.equal((await db.query('SELECT automation_claim(180) job')).rows[0].job,null);
 }finally{await db.close();}
});
