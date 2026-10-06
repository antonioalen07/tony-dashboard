// jobs/retention.mjs — política de retención del Storage (corre sola, cada hora).
//
// Las variantes son material desechable y son lo que llena la cuota (20-35 MB
// cada una). Regla, pedida así el 6-oct-2026:
//
//   - PROGRAMADA (en el calendario: pending / publishing / failed) → NO se toca.
//   - PUBLICADA → se borra el video. La fila de publish_queue se conserva con
//     variant_id = NULL, así el historial del calendario no se pierde.
//   - NUNCA ENVIADA al calendario a las 48 h de generada → se borra.
//
// Y lo que queda colgando:
//   - generaciones sin variantes (terminadas hace +48 h) → job + PNG de textos
//   - videos base (sources/ y uploads/) que ninguna generación usa, +48 h → fila + archivo
//   - archivos de variants/ de jobs que ya no existen
//
// Ojo con las cascadas (media_assets → variant_jobs → video_variants →
// publish_queue, todas ON DELETE CASCADE): un video base sólo se borra si NO
// queda ningún job que lo use, si no arrastraría las variantes programadas.
//
// Uso manual (mismo código que la tarea automática):
//   node jobs/retention.mjs --now           # dry-run, sin espera de 48 h
//   node jobs/retention.mjs --now --apply   # ejecuta
//   node jobs/retention.mjs --apply         # ejecuta con la regla normal de 48 h

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BUCKET = 'studio';
const NEVER_SENT_HOURS = 48;
/** Estados de publish_queue que cuentan como "programada": se conserva. */
const KEEP_STATUSES = new Set(['pending', 'publishing', 'failed']);

export const name = 'retention';
export const intervalMs = 60 * 60 * 1000;

export async function run(ctx) {
  const stats = await runRetention(ctx.supabase, { log: ctx.log });
  if (stats.deletedVariants || stats.deletedJobs || stats.deletedSources || stats.deletedFiles) {
    ctx.log(`[retention] ${summary(stats)}`);
  }
}

export default { name, intervalMs, run };

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const summary = (s) =>
  `${s.deletedVariants} variante(s) (${s.publishedDetached} publicadas → historial conservado), ` +
  `${s.deletedJobs} generación(es), ${s.deletedSources} video(s) base, ` +
  `${s.deletedFiles} archivo(s) · ${mb(s.freedBytes)} liberados · conservadas ${s.keptScheduled} programadas`;

/** Lista recursiva de un prefijo del bucket. */
async function walk(supabase, prefix, depth = 0) {
  if (depth > 6) return [];
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (!it.metadata) out.push(...(await walk(supabase, p, depth + 1)));
      else out.push({ path: p, size: Number(it.metadata.size) || 0, at: it.created_at });
    }
    if (data.length < 1000) break;
  }
  return out;
}

const chunks = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function pathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ log?: Function, neverSentHours?: number, dryRun?: boolean }} [opts]
 */
export async function runRetention(supabase, opts = {}) {
  const log = opts.log || (() => {});
  const dryRun = !!opts.dryRun;
  const cutoff = Date.now() - (opts.neverSentHours ?? NEVER_SENT_HOURS) * 3600e3;
  const old = (iso) => !!iso && new Date(iso).getTime() < cutoff;

  const stats = {
    deletedVariants: 0, publishedDetached: 0, keptScheduled: 0,
    deletedJobs: 0, deletedSources: 0, deletedFiles: 0, freedBytes: 0,
  };

  // ── 1) Variantes: clasificar ─────────────────────────────────────────────
  const { data: variants, error: vErr } = await supabase
    .from('video_variants')
    .select('id, job_id, asset_id, created_at, media_assets(storage_path)');
  if (vErr) throw new Error(`video_variants: ${vErr.message}`);
  const { data: queue, error: qErr } = await supabase
    .from('publish_queue')
    .select('id, variant_id, status')
    .not('variant_id', 'is', null);
  if (qErr) throw new Error(`publish_queue: ${qErr.message}`);

  const rowsByVariant = new Map();
  for (const q of queue || []) {
    if (!rowsByVariant.has(q.variant_id)) rowsByVariant.set(q.variant_id, []);
    rowsByVariant.get(q.variant_id).push(q);
  }

  const toDelete = [];
  const publishedRows = [];
  for (const v of variants || []) {
    const rows = rowsByVariant.get(v.id) || [];
    if (rows.some((r) => KEEP_STATUSES.has(r.status))) { stats.keptScheduled++; continue; }
    if (rows.some((r) => r.status === 'published')) {
      toDelete.push(v);
      publishedRows.push(...rows.filter((r) => r.status === 'published').map((r) => r.id));
      continue;
    }
    if (rows.length === 0 && old(v.created_at)) toDelete.push(v);
  }

  // Tamaños reales (para contar lo liberado y no borrar a ciegas).
  const variantFiles = await walk(supabase, 'variants');
  const sizeByPath = new Map(variantFiles.map((f) => [f.path, f.size]));

  // ── 2) Borrar variantes ──────────────────────────────────────────────────
  const delPaths = toDelete.map((v) => v.media_assets?.storage_path).filter(Boolean);
  stats.deletedVariants = toDelete.length;
  stats.publishedDetached = publishedRows.length;
  stats.freedBytes += delPaths.reduce((a, p) => a + (sizeByPath.get(p) || 0), 0);
  if (!dryRun && toDelete.length) {
    // Primero desligar el historial: si no, la cascada se lo lleva.
    for (const ids of chunks(publishedRows)) {
      const { error } = await supabase.from('publish_queue').update({ variant_id: null }).in('id', ids);
      if (error) throw new Error(`desligar historial: ${error.message}`);
    }
    for (const ids of chunks(toDelete.map((v) => v.asset_id))) {
      const { error } = await supabase.from('media_assets').delete().in('id', ids); // cascadea video_variants
      if (error) throw new Error(`borrar variantes: ${error.message}`);
    }
    for (const paths of chunks(delPaths)) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`borrar archivos de variantes: ${error.message}`);
    }
  }

  // ── 3) Generaciones vacías ───────────────────────────────────────────────
  const deletedIds = new Set(toDelete.map((v) => v.id));
  const remainingByJob = new Map();
  for (const v of variants || []) {
    if (deletedIds.has(v.id)) continue;
    remainingByJob.set(v.job_id, (remainingByJob.get(v.job_id) || 0) + 1);
  }
  const { data: jobs, error: jErr } = await supabase
    .from('variant_jobs')
    .select('id, status, params, source_asset_id, updated_at, created_at');
  if (jErr) throw new Error(`variant_jobs: ${jErr.message}`);
  const emptyJobs = (jobs || []).filter((j) =>
    (j.status === 'done' || j.status === 'failed') &&
    !remainingByJob.get(j.id) &&
    // Una generación recién terminada sin variantes es la que se acaba de vaciar
    // por publicada: se va. Una fallida se deja 48 h para que se vea el error.
    (j.status === 'done' || old(j.updated_at || j.created_at)),
  );
  const keptJobs = (jobs || []).filter((j) => !emptyJobs.includes(j));
  const textPaths = emptyJobs.flatMap((j) =>
    (Array.isArray(j.params?.texts) ? j.params.texts : []).map((t) => pathFromPublicUrl(t?.overlayUrl)).filter(Boolean),
  );
  stats.deletedJobs = emptyJobs.length;
  if (!dryRun && emptyJobs.length) {
    for (const ids of chunks(emptyJobs.map((j) => j.id))) {
      const { error } = await supabase.from('variant_jobs').delete().in('id', ids);
      if (error) throw new Error(`borrar generaciones: ${error.message}`);
    }
  }

  // ── 4) Videos base que ninguna generación usa ────────────────────────────
  const usedSources = new Set(keptJobs.map((j) => j.source_asset_id));
  const { data: srcAssets, error: sErr } = await supabase
    .from('media_assets')
    .select('id, storage_path, created_at')
    .or('storage_path.like.sources/*,storage_path.like.uploads/*');
  if (sErr) throw new Error(`media_assets: ${sErr.message}`);
  const sourceFiles = [...(await walk(supabase, 'sources')), ...(await walk(supabase, 'uploads'))];
  const assetByPath = new Map((srcAssets || []).map((a) => [a.storage_path, a]));
  const dropSourceAssets = (srcAssets || []).filter((a) => !usedSources.has(a.id) && old(a.created_at));
  // Archivos sin fila en la base (subidas a medias, borrados viejos), también tras 48 h.
  const orphanSourceFiles = sourceFiles.filter((f) => !assetByPath.has(f.path) && old(f.at));
  const dropSourcePaths = [...dropSourceAssets.map((a) => a.storage_path), ...orphanSourceFiles.map((f) => f.path)];
  const srcSize = new Map(sourceFiles.map((f) => [f.path, f.size]));
  stats.deletedSources = dropSourceAssets.length + orphanSourceFiles.length;
  stats.freedBytes += dropSourcePaths.reduce((a, p) => a + (srcSize.get(p) || 0), 0);
  if (!dryRun && dropSourceAssets.length) {
    for (const ids of chunks(dropSourceAssets.map((a) => a.id))) {
      const { error } = await supabase.from('media_assets').delete().in('id', ids);
      if (error) throw new Error(`borrar videos base: ${error.message}`);
    }
  }

  // ── 5) Archivos colgados: variantes de jobs inexistentes + textos sin job ─
  const liveJobIds = new Set(keptJobs.map((j) => j.id));
  const deletedSet = new Set(delPaths);
  const orphanVariantFiles = variantFiles.filter((f) => !liveJobIds.has(f.path.split('/')[1]) && !deletedSet.has(f.path));
  const liveTexts = new Set(keptJobs.flatMap((j) =>
    (Array.isArray(j.params?.texts) ? j.params.texts : []).map((t) => pathFromPublicUrl(t?.overlayUrl)).filter(Boolean)));
  const textFiles = await walk(supabase, 'variant-text');
  const textSize = new Map(textFiles.map((f) => [f.path, f.size]));
  const dropTexts = [...new Set([
    ...textPaths,
    ...textFiles.filter((f) => !liveTexts.has(f.path) && old(f.at)).map((f) => f.path),
  ])];
  const extraPaths = [...dropSourcePaths, ...orphanVariantFiles.map((f) => f.path), ...dropTexts];
  stats.freedBytes += orphanVariantFiles.reduce((a, f) => a + f.size, 0) + dropTexts.reduce((a, p) => a + (textSize.get(p) || 0), 0);
  stats.deletedFiles = delPaths.length + extraPaths.length;
  if (!dryRun) {
    for (const paths of chunks(extraPaths)) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`borrar archivos: ${error.message}`);
    }
  }

  if (dryRun) log(`[retention] DRY-RUN: ${summary(stats)}`);
  return stats;
}

// ── Ejecución manual ───────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { default: dotenv } = await import('dotenv');
  const { createClient } = await import('@supabase/supabase-js');
  const here = fileURLToPath(new URL('..', import.meta.url));
  dotenv.config({ path: [resolve(here, '.env.local'), resolve(here, '.env'), resolve(here, '..', '.env.local')] });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const apply = process.argv.includes('--apply');
  const now = process.argv.includes('--now');
  const stats = await runRetention(supabase, {
    log: console.log,
    dryRun: !apply,
    neverSentHours: now ? 0 : NEVER_SENT_HOURS,
  });
  console.log(apply ? `Hecho: ${summary(stats)}` : '(dry-run: agregá --apply para ejecutar)');
}
