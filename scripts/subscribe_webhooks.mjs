import {config} from 'dotenv';
import {fileURLToPath} from 'node:url';
import {createMeta} from '../worker/lib/meta.mjs';
config({path:fileURLToPath(new URL('../.env.local',import.meta.url)),quiet:true});
const meta=createMeta(process.env);
const page=process.env.META_PAGE_ID||'1061609440358642';
try {
 const result=await meta.post(`${page}/subscribed_apps`,{subscribed_fields:'feed'});
 console.log('Suscripción de la página:',JSON.stringify(result));
 console.log('Apps suscriptas:',JSON.stringify(await meta.pageGet(`${page}/subscribed_apps`)));
 console.log('En la consola de Meta, suscribí también comments y messages del objeto Instagram.');
} catch(error) {console.error(error.message);process.exitCode=1;}
