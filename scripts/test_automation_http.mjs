/** Prueba HTTP contra el build local, sin credenciales ni mensajes reales. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const reserve=createServer();
await new Promise((resolve)=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port;
await new Promise((resolve)=>reserve.close(resolve));
const server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','127.0.0.1','--port',String(port)],{
 cwd:fileURLToPath(new URL('..',import.meta.url)),windowsHide:true,stdio:'pipe',
 env:{...process.env,META_APP_SECRET:'test-only-secret',META_WEBHOOK_VERIFY_TOKEN:'test-only-verify'},
});
let exited=false;
server.on('exit',()=>{exited=true;});
server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
const base=`http://127.0.0.1:${port}`;
try {
 let ready=false;
 for(let i=0;i<100;i++){
  if(exited)throw new Error('El servidor no pudo arrancar. Revisá permisos de Next.js.');
  try{const r=await fetch(`${base}/api/webhooks/instagram`,{signal:AbortSignal.timeout(1000)});if(r.status===403){ready=true;break;}}catch{}
  await new Promise((resolve)=>setTimeout(resolve,200));
 }
 assert.ok(ready,'El servidor no arrancó a tiempo');
 const valid=await fetch(`${base}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-only-verify&hub.challenge=12345`);
 assert.equal(valid.status,200);assert.equal(await valid.text(),'12345');
 const bad=await fetch(`${base}/api/webhooks/instagram`,{method:'POST',body:'{}'});
 assert.equal(bad.status,401);
 const raw=JSON.stringify({object:'not-instagram',entry:[]});
 const signed=await fetch(`${base}/api/webhooks/instagram`,{method:'POST',body:raw,headers:{'X-Hub-Signature-256':`sha256=${createHmac('sha256','test-only-secret').update(raw).digest('hex')}`}});
 assert.equal(signed.status,200);
 assert.equal((await fetch(`${base}/api/automations`)).status,401);
 assert.equal((await fetch(`${base}/api/automations/health`)).status,401);
 for(const [path,method] of [['/api/chat/context','GET'],['/api/chat','POST'],['/api/reels/11111111-1111-4111-8111-111111111111','PATCH'],['/api/transcribe','POST'],['/api/analyze','POST']]) {
  const response=await fetch(`${base}${path}`,{method,...(method==='GET'?{}:{body:'{}'})});
  assert.equal(response.status,401,`${method} ${path} debe requerir sesión sin tocar IA/base`);
 }
 for(const pathname of ['/privacidad','/eliminacion-datos']) {
  const page=await fetch(`${base}${pathname}`,{redirect:'manual',headers:{Cookie:'bako_session=invalid-session','x-bako-auth':'forged'}});
  assert.equal(page.status,200,`${pathname} debe ser pública aun con cookie inválida`);
  const html=await page.text();
  assert.match(html,/automatizaciones@crevy\.net/);
  assert.match(html,/Crevy/);
  assert.doesNotMatch(html,/Cerrar sesión/);
  assert.equal((await fetch(`${base}${pathname}`,{method:'HEAD',redirect:'manual'})).status,200);
  const child=await fetch(`${base}${pathname}/privado`,{redirect:'manual'});
  assert.equal(child.status,307,'La excepción pública no debe abrir descendientes');
  assert.equal(new URL(child.headers.get('location'),base).pathname,'/login');
 }
 const dashboard=await fetch(base,{redirect:'manual',headers:{'x-bako-auth':'forged'}});
 assert.equal(dashboard.status,307);
 assert.equal(new URL(dashboard.headers.get('location'),base).pathname,'/login');
 const inboxPage=await fetch(`${base}/automatizaciones`,{redirect:'manual'});
 assert.match(inboxPage.headers.get('permissions-policy'),/microphone=\(self\)/);
 assert.equal((await fetch(`${base}/api/automations/inbox/contact/messages/message`,{method:'DELETE'})).status,401);
 const csrf=await fetch(`${base}/api/automations`,{method:'POST',body:'{}',headers:{Origin:'https://foreign.example'}});
 assert.equal(csrf.status,403);
 console.log('HTTP OK: challenge, firmas, páginas legales públicas exactas, dashboard/APIs/curación/chat protegidos y CSRF.');
}finally{server.kill();}
