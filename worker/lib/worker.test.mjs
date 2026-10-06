import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../jobs/automations.mjs';
function memoryDb(tables) {
 return {
  from(table) {
   const filters=[];let mode='read',fields;
   const query={
    select(){return query;},update(value){mode='update';fields=value;return query;},eq(k,v){filters.push((r)=>r[k]===v);return query;},neq(k,v){filters.push((r)=>r[k]!==v);return query;},limit(){return query;},
    single:()=>query.then((rows)=>({data:rows.data[0],error:null})),maybeSingle:()=>query.then((rows)=>({data:rows.data[0]||null,error:null})),
    then(resolve){const rows=(tables[table]||[]).filter((r)=>filters.every((f)=>f(r)));if(mode==='update')rows.forEach((r)=>Object.assign(r,fields));return Promise.resolve({data:rows,error:null}).then(resolve);},
   };return query;
  },
  async rpc(name) {
   if(name==='automation_auto_enroll')return{data:null,error:null};
   assert.equal(name,'automation_claim');
   for(const [kind,table] of [['comment','automation_events'],['followup','followup_jobs']]){
    const next=tables[table].find((r)=>r.status==='queued');
    if(next){next.status='sending';return{data:{kind,id:next.id},error:null};}
   }
   return{data:null,error:null};
  },
 };
}
test('worker: DM exitoso no se repite por respuesta pública fallida; ventana y resultado incierto',async()=>{
 const now=new Date().toISOString();
 const tables={
  automations:[{id:'a',active:true,scope:'media',media_id:'media',dm_text:'Hola',dm_link_url:null,once_per_user:true,reply_enabled:true,reply_texts:['Listo']}],
  automation_events:[{id:'e1',automation_id:'a',status:'queued',commenter_id:'visitor',comment_id:'c1',comment_at:now,attempts:0}],
  leads:[{id:'lead',instagram_user_id:'visitor',qualification:'qualified',opted_out:false,last_inbound_at:now},{id:'closed',instagram_user_id:'other',qualification:'qualified',last_inbound_at:new Date(Date.now()-86400000).toISOString()}],
  followup_sequences:[{id:'s',active:true,required_tag_ids:[],qualified_only:true}],
  followup_enrollments:[{id:'en',status:'active',sequence_id:'s',lead_id:'lead'},{id:'en2',status:'active',sequence_id:'s',lead_id:'closed'}],
  followup_jobs:[{id:'j1',status:'queued',attempts:0,enrollment_id:'en',step:{kind:'audio',audio_url:'https://example.com/a.mp3'}},{id:'j2',status:'queued',attempts:0,enrollment_id:'en2',step:{kind:'text',text:'Hola'}}],
  lead_tag_assignments:[],
 };
 const original=globalThis.fetch;let sends=0;let timeout=false;
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/comments'))return new Response(JSON.stringify({data:[]}));
  if(path.endsWith('/replies'))return new Response(JSON.stringify({error:{code:100,message:'No se pudo responder'}}),{status:400});
  if(path.endsWith('/messages')){sends++;if(timeout)throw new Error('timeout');const payload=JSON.parse(options.body);if(payload.recipient.id)assert.equal(payload.message.attachment.type,'audio');return new Response(JSON.stringify({message_id:`sent-${sends}`}));}
  return new Response(JSON.stringify({access_token:'test-token'}));
 };
 try {
  const db=memoryDb(tables);const ctx={supabase:db,env:{META_ACCESS_TOKEN:'test',META_PAGE_ID:'page'},log:()=>{}};
  await run(ctx);
  assert.equal(tables.automation_events[0].status,'sent');assert.match(tables.automation_events[0].error,/Respuesta pública/);
  assert.equal(tables.followup_jobs[0].status,'sent');assert.equal(tables.followup_jobs[1].status,'blocked');assert.equal(tables.followup_enrollments[0].status,'completed');assert.equal(sends,2);
  tables.automation_events.push({id:'e2',automation_id:'a',status:'queued',commenter_id:'visitor',comment_id:'c2',comment_at:now,attempts:0});
  await run(ctx);assert.equal(tables.automation_events[1].status,'skipped');assert.equal(sends,2);
  timeout=true;
  tables.automation_events.push({id:'e3',automation_id:'a',status:'queued',commenter_id:'new',comment_id:'c3',comment_at:now,attempts:0});
  await run(ctx);assert.equal(tables.automation_events[2].status,'uncertain');assert.equal(sends,3);
  await run(ctx);assert.equal(sends,3);
 }finally{globalThis.fetch=original;}
});
