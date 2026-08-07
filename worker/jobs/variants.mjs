// jobs/variants.mjs — motor de variantes de video.
//
// Toma UN variant_jobs en 'pending', lo marca 'processing', baja el video
// source, y por cada variante (i < num_variants) sortea AppliedVariantParams
// dentro de los rangos del job (fallback DEFAULT_VARIANT_PARAMS), re-edita con
// ffmpeg, sube el mp4 al bucket 'studio' en variants/<jobId>/<i>.mp4, e inserta
// media_assets(video, source 'upload') + video_variants.
// Al final marca el job 'done' (o 'failed' con el error).

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcodeVariant, hasAudioStream, probeVideo } from '../ffmpeg.mjs';

const BUCKET = 'studio';

// Fallback local por si no se puede importar studio-types.ts (worker sin TS).
// Debe coincidir con DEFAULT_VARIANT_PARAMS de src/lib/studio-types.ts.
const DEFAULT_VARIANT_PARAMS = {
  saturation: [0.92, 1.08],
  contrast: [0.95, 1.06],
  trimStartMs: [0, 700],
  speed: [0.96, 1.04],
  zoom: [1.03, 1.09],
  trimEndMs: [0, 600],
  rotate: [-0.8, 0.8],
  pan: [-0.7, 0.7],
  pitch: [1, 1],
};

// Debe coincidir con DEFAULT_VARIANT_TEXT_STYLE de src/lib/studio-types.ts.
const DEFAULT_TEXT_STYLE = {
  size: 0.055,
  color: '#ffffff',
  box: true,
  boxColor: '#000000',
  boxOpacity: 0.45,
};

export const name = 'variants';
export const intervalMs = Number(process.env.WORKER_POLL_MS) || 20000;

export async function run(ctx) {
  const { supabase, log } = ctx;

  // 1) Tomar UN job pending (el más viejo).
  const { data: jobs, error: pickErr } = await supabase
    .from('variant_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (pickErr) throw new Error(`No pude leer variant_jobs: ${pickErr.message}`);
  if (!jobs || jobs.length === 0) return; // nada que hacer

  const job = jobs[0];

  // Claim optimista: sólo pasa a processing si sigue pending (evita doble toma).
  const { data: claimed, error: claimErr } = await supabase
    .from('variant_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id');

  if (claimErr) throw new Error(`No pude reclamar el job ${job.id}: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return; // otro worker lo tomó

  log(`job ${job.id}: procesando (${job.num_variants} variantes)`);

  let tmpDir;
  try {
    // 2) Resolver el asset source.
    const { data: asset, error: assetErr } = await supabase
      .from('media_assets')
      .select('*')
      .eq('id', job.source_asset_id)
      .single();
    if (assetErr || !asset) {
      throw new Error(`asset source ${job.source_asset_id} no encontrado: ${assetErr?.message || 'null'}`);
    }
    if (asset.kind !== 'video') {
      throw new Error(`asset source ${asset.id} no es video (kind=${asset.kind})`);
    }

    tmpDir = await mkdtemp(join(tmpdir(), 'crevy-variants-'));
    const sourcePath = join(tmpDir, 'source.mp4');

    // 3) Bajar el source (storage.download por storage_path; fallback a public_url).
    const buf = await downloadAsset(supabase, asset, log);
    await writeFile(sourcePath, buf);

    const audio = await hasAudioStream(sourcePath);
    const { durationSec, width, height, hasVideo } = await probeVideo(sourcePath);
    if (!hasVideo) throw new Error('el video source no tiene stream de video (¿archivo corrupto?)');
    log(`job ${job.id}: source ${buf.length} bytes, ${width}x${height}, audio=${audio}, dur=${durationSec ?? '?'}s`);

    const ranges = normalizeParams(job.params);
    const numVariants = clampInt(job.num_variants, 1, 20, 1);
    const mirror = ['none', 'some', 'all'].includes(job.params?.mirror) ? job.params.mirror : 'none';
    const textStyle = { ...DEFAULT_TEXT_STYLE, ...(job.params?.textStyle || {}) };
    const texts = Array.isArray(job.params?.texts) ? job.params.texts : [];

    // 4) Generar cada variante.
    for (let i = 0; i < numVariants; i++) {
      const applied = sampleApplied(ranges);
      // Espejado: 'some' alterna (mitad sí, mitad no) para poder comparar.
      applied.mirror = mirror === 'all' || (mirror === 'some' && i % 2 === 1);
      const t = texts[i];
      applied.text = t && String(t.text || '').trim()
        ? {
            text: String(t.text),
            position: t.position || 'top',
            startSec: Number(t.startSec) || 0,
            endSec: Number.isFinite(Number(t.endSec)) ? Number(t.endSec) : null,
            style: textStyle,
          }
        : null;

      // El PNG del texto lo rasteriza el navegador al crear el job; acá sólo lo
      // bajamos. Si falla, la variante sale sin texto en vez de romper el job.
      let overlayPath = null;
      if (applied.text && t.overlayUrl) {
        overlayPath = await downloadOverlay(t.overlayUrl, join(tmpDir, `overlay-${i}.png`), log);
      }

      const outPath = join(tmpDir, `variant-${i}.mp4`);
      await transcodeVariant(sourcePath, outPath, applied, {
        hasAudio: audio, log, overlayPath, durationSec, width, height,
      });

      // ffmpeg puede salir 0 y dejar igual un mp4 sin stream de video (pasó con
      // scale2ref). Verificamos antes de subir: mejor fallar el job que
      // entregar variantes rotas como si estuvieran bien.
      const out = await probeVideo(outPath);
      if (!out.hasVideo) {
        throw new Error(`la variante ${i + 1} salió sin stream de video (filtros: ${applied.text ? 'con' : 'sin'} texto)`);
      }

      const outBuf = await readFile(outPath);
      const storagePath = `variants/${job.id}/${i}.mp4`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, outBuf, { contentType: 'video/mp4', upsert: true });
      if (upErr) throw new Error(`upload de variante ${i} falló: ${upErr.message}`);

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error(`no obtuve public_url para ${storagePath}`);

      // media_assets(video, source 'upload')
      const { data: mediaRow, error: mediaErr } = await supabase
        .from('media_assets')
        .insert({
          kind: 'video',
          filename: `${i}.mp4`,
          storage_path: storagePath,
          public_url: publicUrl,
          source: 'upload',
        })
        .select('id')
        .single();
      if (mediaErr || !mediaRow) {
        throw new Error(`insert media_assets variante ${i} falló: ${mediaErr?.message || 'null'}`);
      }

      // video_variants
      const { error: vvErr } = await supabase
        .from('video_variants')
        .insert({ job_id: job.id, asset_id: mediaRow.id, params: applied });
      if (vvErr) throw new Error(`insert video_variants ${i} falló: ${vvErr.message}`);

      log(`job ${job.id}: variante ${i} lista → ${storagePath}`);
    }

    // 5) Job done.
    await supabase
      .from('variant_jobs')
      .update({ status: 'done', error: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    log(`job ${job.id}: done (${numVariants} variantes)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`job ${job.id}: FAILED — ${msg}`);
    await supabase
      .from('variant_jobs')
      .update({ status: 'failed', error: msg.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', job.id);
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function downloadAsset(supabase, asset, log) {
  // Preferimos storage.download por storage_path (autoritativo dentro del bucket).
  if (asset.storage_path) {
    const { data, error } = await supabase.storage.from(BUCKET).download(asset.storage_path);
    if (!error && data) {
      const ab = await data.arrayBuffer();
      return Buffer.from(ab);
    }
    log(`download por storage_path falló (${error?.message || 'null'}), pruebo public_url`);
  }
  // Fallback: fetch al public_url (bucket público).
  if (asset.public_url) {
    const res = await fetch(asset.public_url);
    if (!res.ok) throw new Error(`fetch public_url ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  throw new Error(`asset ${asset.id} sin storage_path ni public_url utilizables`);
}

/** Baja el PNG del texto de una variante. Devuelve la ruta local o null. */
async function downloadOverlay(url, destPath, log) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
    return destPath;
  } catch (err) {
    log(`AVISO: no pude bajar el texto ${url} (${err.message}); la variante sale sin texto.`);
    return null;
  }
}

/** Normaliza params del job a rangos válidos [min,max], con fallback al default. */
function normalizeParams(params) {
  const p = params && typeof params === 'object' ? params : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_VARIANT_PARAMS)) {
    const def = DEFAULT_VARIANT_PARAMS[key];
    const val = p[key];
    if (Array.isArray(val) && val.length === 2 && Number.isFinite(Number(val[0])) && Number.isFinite(Number(val[1]))) {
      const min = Number(val[0]);
      const max = Number(val[1]);
      out[key] = min <= max ? [min, max] : [max, min];
    } else {
      out[key] = def;
    }
  }
  return out;
}

/** Sortea un AppliedVariantParams concreto dentro de los rangos. */
function sampleApplied(ranges) {
  return {
    saturation: round4(rand(ranges.saturation)),
    contrast: round4(rand(ranges.contrast)),
    trimStartMs: Math.round(rand(ranges.trimStartMs)),
    speed: round4(rand(ranges.speed)),
    zoom: round4(rand(ranges.zoom)),
    trimEndMs: Math.round(rand(ranges.trimEndMs)),
    rotate: round4(rand(ranges.rotate)),
    panX: round4(rand(ranges.pan)),
    panY: round4(rand(ranges.pan)),
    pitch: round4(rand(ranges.pitch)),
  };
}

function rand([min, max]) {
  return min + Math.random() * (max - min);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function clampInt(v, min, max, fallback) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
