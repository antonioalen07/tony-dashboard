import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeta} from './meta.mjs';
import {windowOpen,messagePayload} from './automation-core.mjs';
const env={META_ACCESS_TOKEN:'secret-system',META_PAGE_ID:'page'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('timeout de envío queda incierto y no reintenta ni cambia endpoint',async()=>{
 let calls=0;
 const meta=createMeta(env,async()=>{if(++calls===1)return response({access_token:'secret-page'});throw new Error('timeout');});
 await assert.rejects(meta.send(messagePayload({id:'visitor'},{kind:'text',text:'Hola'})),(e)=>e.uncertain&&!e.transient);
 assert.equal(calls,2);
});
test('rate limit confirmado es transitorio y credenciales se redactan',async()=>{
 const meta=createMeta(env,async(url)=>url.pathname.endsWith('/messages')?response({error:{code:4,message:'Rate limit secret-page secret-system'}},429):response({access_token:'secret-page'}));
 await assert.rejects(meta.send({}),(e)=>e.transient&&!e.uncertain&&!e.message.includes('secret-'));
});
test('audio usa adjunto nativo y ventana exige un mensaje entrante',()=>{
 assert.deepEqual(messagePayload({id:'x'},{kind:'audio',audio_url:'https://example.com/a.mp3'}),{recipient:{id:'x'},message:{attachment:{type:'audio',payload:{url:'https://example.com/a.mp3'}}}});
 const now=Date.now();
 assert.equal(windowOpen({last_inbound_at:new Date(now-1000).toISOString()},now),true);
 for(const lead of [{},{last_inbound_at:new Date(now-86400000).toISOString()},{last_inbound_at:new Date(now+1000).toISOString()},{last_inbound_at:new Date(now-1000).toISOString(),opted_out:true}])assert.equal(windowOpen(lead,now),false);
});
test('rechazo de servidor y respuesta sin confirmación no reenvían',async()=>{
 for(const answer of [response({},200),response({},500)]) {
  const meta=createMeta(env,async(url)=>url.pathname.endsWith('/messages')?answer:response({access_token:'secret-page'}));
  await assert.rejects(meta.send({}),(e)=>e.uncertain);
 }
});
