/** Vista previa local con datos ficticios. No usa Supabase ni Meta. Ctrl+C para cerrar. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const id='11111111-1111-4111-8111-111111111111';const now=new Date().toISOString();
const tag={id,name:'B2B'};
const automation={id,name:'Guía de IA para tu negocio',active:true,scope:'all',media_id:null,publish_queue_id:null,keywords:['OJO','guía'],match_mode:'contains',fuzzy:true,dm_text:'¡Acá tenés la guía! Contame qué querés automatizar en tu negocio.',dm_link_url:'https://example.com/guia',reply_enabled:true,reply_texts:['¡Te lo mandé por DM!'],once_per_user:true,tag_ids:[id],starts_at:now,created_at:now,updated_at:now,stats:{sent:124,failed:2,skipped:18}};
const sequence={id,name:'Seguimiento de consultas B2B',active:true,auto_enroll:true,required_tag_ids:[id],qualified_only:true,stop_on_reply:true,steps:[{kind:'text',text:'¿Pudiste ver la guía?',delay_minutes:60,audio_url:''},{kind:'audio',text:'',audio_url:'https://example.com/audio.mp3',delay_minutes:120}]};
const fixtures={
 '/api/automations':[automation],'/api/automations/tags':[tag,{id:'22222222-2222-4222-8222-222222222222',name:'Muy calificado'}],
 '/api/automations/leads':[{id,instagram_user_id:'12345',username:'cliente.prueba',qualification:'qualified',opted_out:false,notes:'Consulta por automatización de ventas.',last_inbound_at:now,tags:[tag]}],
 '/api/automations/sequences':[sequence],
 '/api/automations/events':[{id,automation_id:id,commenter_username:'cliente.prueba',comment_text:'Quiero la guía OJO!',status:'sent',created_at:now}],
 '/api/automations/followups':[{id,status:'blocked',due_at:now,error:'Ventana de 24 horas cerrada',step:sequence.steps[0],enrollment_id:id}],
 '/api/automations/media':{reels:[],pending:[]},'/api/me':{email:'preview@example.com',name:'Vista previa',role:'member'},
 [`/api/automations/leads/${id}`]:{messages:[{id,text:'Quiero automatizar mi negocio',received_at:now}],events:[],enrollments:[]},
};
createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'){res.writeHead(405);res.end('Vista previa de sólo lectura');return;}
  if(path in fixtures){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixtures[path]));return;}
  const staticFile=path.startsWith('/_next/static/');
  if(!staticFile&&path!=='/automatizaciones'&&path!=='/'){res.writeHead(404);res.end();return;}
  if(path.split('/').includes('..')||path.includes('%'))throw new Error('Ruta inválida');
  const target=staticFile?new URL(`.next/static/${path.slice('/_next/static/'.length)}`,root):new URL('.next/server/app/automatizaciones.html',root);
  const mime=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';
  res.setHeader('Content-Type',`${mime}; charset=utf-8`);
  res.end(await readFile(fileURLToPath(target)));
 }catch{res.writeHead(404);res.end();}
}).listen(3106,'127.0.0.1',()=>console.log('Vista previa con datos ficticios: http://127.0.0.1:3106/automatizaciones'));
