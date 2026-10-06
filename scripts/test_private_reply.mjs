/** Prueba de la Fase 0. No envía nada salvo que pases --comment y --text. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--list', '--comment', '--text', '--reply', '--help'].includes(key)) throw new Error(`Argumento desconocido: ${key}`);
    if (key === '--help') { args.help = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}`);
    args[key.slice(2)] = value;
  }
  if (args.help) return args;
  if (args.list && (args.comment || args.text || args.reply)) throw new Error('--list no se combina con envío.');
  if (!args.list && (!args.comment || !args.text?.trim())) throw new Error('Usá --list <media_id> o --comment <comment_id> --text "Prueba BAKO".');
  if (args.text?.length > 1000) throw new Error('El texto no puede superar los 1000 caracteres.');
  for (const id of [args.list, args.comment].filter(Boolean)) if (!/^\d+$/.test(id)) throw new Error('El ID de Meta debe ser numérico.');
  return args;
}

async function graph(path, token, body) {
  const response = await fetch(`${GRAPH_BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    const error = new Error(`Meta (${response.status}): ${result.error?.message || 'Error desconocido'}`);
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node scripts/test_private_reply.mjs --list <media_id>\nnode scripts/test_private_reply.mjs --comment <comment_id> --text "Prueba BAKO" [--reply "Te escribí 📩"]');
    return;
  }
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('Falta META_ACCESS_TOKEN en .env.local.');
  if (args.list) {
    console.log(JSON.stringify(await graph(`${args.list}/comments?fields=id,text,timestamp,from,username&limit=5`, token), null, 2));
    return;
  }
  const pageId = process.env.META_PAGE_ID || '1061609440358642';
  const igId = process.env.META_IG_ACCOUNT_ID || '17841476480622974';
  const page = await graph(`${pageId}?fields=access_token`, token);
  if (!page.access_token) throw new Error('Meta no devolvió un page token.');
  const payload = { recipient: { comment_id: args.comment }, message: { text: args.text } };
  let endpoint = pageId;
  let result;
  try {
    result = await graph(`${endpoint}/messages`, page.access_token, payload);
  } catch (error) {
    // Sólo cambiar de endpoint si Meta confirma que la ruta no existe.
    // Nunca reintentar un timeout: podría haberse enviado el mensaje.
    if (error.code !== 2500 && !(error.code === 100 && /unsupported post request|unknown path|nonexisting field/i.test(error.message))) throw error;
    endpoint = igId;
    result = await graph(`${endpoint}/messages`, page.access_token, payload);
  }
  console.log(`Private Reply: endpoint ${endpoint}/messages`);
  console.log(JSON.stringify(result, null, 2));
  if (args.reply) {
    console.log('Respuesta pública:');
    console.log(JSON.stringify(await graph(`${args.comment}/replies`, page.access_token, { message: args.reply }), null, 2));
  }
  console.log('Confirmá en la cuenta de prueba que llegó el DM antes de continuar con la Fase 1.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Redactar credenciales incluso si Meta las incluyera en su diagnóstico.
    let message = String(error.message);
    for (const secret of [process.env.META_ACCESS_TOKEN, process.env.META_APP_SECRET].filter(Boolean)) message = message.replaceAll(secret, '[REDACTADO]');
    console.error(message);
    process.exitCode = 1;
  });
}
