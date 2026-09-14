/**
 * Limpieza de variantes de video (Crevy Studio).
 *
 * Las variantes son material desechable: se generan, se prueban y se publican o
 * se descartan, pero en los dos casos quedan ocupando el bucket `studio` — que
 * es lo que llena la cuota de Storage (cada variante pesa 20-35 MB).
 *
 * Borra TODAS las variantes, publicadas o no:
 *   - los .mp4 de `variants/` y los PNG de texto de `variant-text/` en Storage
 *   - las filas de `video_variants` y sus `media_assets`
 *   - los `variant_jobs` ya terminados (done/failed) — nunca los pending/processing,
 *     que romperían un worker en curso
 *
 * Conserva el historial: las filas de `publish_queue` con status='published'
 * sobreviven con `variant_id = NULL`, así no se pierde el registro de qué se
 * publicó (ig_media_id, published_at, caption). El calendario las lee con
 * `select('*')` sin join, así que se siguen viendo bien.
 *
 * Uso:
 *   node cleanup_variants.mjs           # dry-run: sólo informa
 *   node cleanup_variants.mjs --apply   # ejecuta
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'studio';
const PREFIXES = ['variants', 'variant-text'];

const env = {};
for (const line of fs.readFileSync(path.join(import.meta.dirname, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
// Con la anon key cerrada (supabase_migration_lock_anon.sql) hace falta la service-role key.
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const mb = (b) => (b / 1048576).toFixed(2) + ' MB';

async function rest(method, pathAndQuery, body) {
  const res = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, {
    method, headers: { ...H, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

/** Lista recursiva del bucket: la API sólo devuelve un nivel por llamada. */
async function walk(prefix = '', out = [], depth = 0) {
  if (depth > 6) return out;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${prefix} -> ${res.status}`);
    const items = await res.json();
    if (!items.length) break;
    for (const it of items) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null || it.metadata === null) await walk(p, out, depth + 1);
      else out.push({ path: p, size: it.metadata?.size ?? 0 });
    }
    if (items.length < 1000) break;
    offset += 1000;
  }
  return out;
}

const inList = (ids) => `(${ids.map((i) => `"${i}"`).join(',')})`;

// ── Relevamiento ────────────────────────────────────────────────────────────
const files = (await Promise.all(PREFIXES.map((p) => walk(p)))).flat();
const bytes = files.reduce((a, f) => a + f.size, 0);
const variants = await rest('GET', 'video_variants?select=id,asset_id,job_id');
const assets = await rest('GET', 'media_assets?select=id,storage_path&storage_path=like.variants/*');
const queue = await rest('GET', 'publish_queue?select=id,variant_id,status,ig_media_id');
const jobs = await rest('GET', 'variant_jobs?select=id,status');

const variantIds = variants.map((v) => v.id);
const assetIds = assets.map((a) => a.id);
const queueLinked = queue.filter((q) => q.variant_id && variantIds.includes(q.variant_id));
const keepHistory = queueLinked.filter((q) => q.status === 'published');
const dropQueue = queueLinked.filter((q) => q.status !== 'published');
const staleJobs = jobs.filter((j) => j.status === 'done' || j.status === 'failed');

console.log(APPLY ? '=== EJECUTANDO ===' : '=== DRY-RUN (agregá --apply para ejecutar) ===');
console.log(`Storage variants/ + variant-text/: ${files.length} archivos, ${mb(bytes)}`);
console.log(`video_variants        : ${variants.length} filas`);
console.log(`media_assets variants/: ${assets.length} filas`);
console.log(`publish_queue ligadas : ${queueLinked.length} (${keepHistory.length} publicadas -> se conservan sin variant_id, ${dropQueue.length} se borran)`);
console.log(`variant_jobs done/fail: ${staleJobs.length} de ${jobs.length}`);

if (!APPLY) {
  console.log('\nNo se borró nada.');
  process.exit(0);
}

// ── Ejecución, en orden de dependencias ─────────────────────────────────────
if (keepHistory.length) {
  await rest('PATCH', `publish_queue?id=in.${inList(keepHistory.map((q) => q.id))}`, { variant_id: null });
  console.log(`✓ ${keepHistory.length} publicaciones desligadas (historial conservado)`);
}
if (dropQueue.length) {
  await rest('DELETE', `publish_queue?id=in.${inList(dropQueue.map((q) => q.id))}`);
  console.log(`✓ ${dropQueue.length} filas de publish_queue borradas`);
}
if (variantIds.length) {
  await rest('DELETE', `video_variants?id=in.${inList(variantIds)}`);
  console.log(`✓ ${variantIds.length} filas de video_variants borradas`);
}
if (files.length) {
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: files.map((f) => f.path) }),
  });
  if (!res.ok) throw new Error(`storage delete -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log(`✓ ${files.length} archivos borrados del Storage (${mb(bytes)} liberados)`);
}
if (assetIds.length) {
  await rest('DELETE', `media_assets?id=in.${inList(assetIds)}`);
  console.log(`✓ ${assetIds.length} filas de media_assets borradas`);
}
if (staleJobs.length) {
  await rest('DELETE', `variant_jobs?id=in.${inList(staleJobs.map((j) => j.id))}`);
  console.log(`✓ ${staleJobs.length} variant_jobs terminados borrados`);
}
console.log('\nListo.');
