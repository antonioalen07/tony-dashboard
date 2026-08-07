import { randomUUID } from 'node:crypto';

/**
 * Unidad 7 — Publicador Meta (Crevy Studio).
 *
 * Recorre `publish_queue` buscando items `pending` cuyo `scheduled_at` ya venció,
 * resuelve la URL pública del video (video_variants → media_assets) y los publica
 * como Reels vía la Graph API de Instagram.
 *
 * Modo DRY RUN (por defecto, y activo siempre que la env `PUBLISH_DRY_RUN` esté
 * presente): NO llama a la Graph API — sólo loguea el payload exacto y marca el
 * item como `published` con un `ig_media_id` sintético `DRYRUN-<uuid>`.
 *
 * Modo REAL (SÓLO cuando `PUBLISH_DRY_RUN` no está seteada en absoluto): crea el
 * contenedor, espera a que su `status_code` sea `FINISHED` y llama a `media_publish`.
 *
 * Además, en cada corrida limpia del Storage los objetos de items publicados hace
 * más de 7 días (el registro de calendario en la DB se conserva).
 *
 * Contrato del loader (Unidad 5): export { name, intervalMs, run(ctx) }
 * con ctx = { supabase, env, log }.
 */

const GRAPH_VERSION = 'v20.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const STORAGE_BUCKET = 'studio';
const FALLBACK_IG_ACCOUNT_ID = '17841476480622974';
const CLEANUP_AFTER_DAYS = 7;

// Poll del estado del contenedor en modo real.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60; // ~5 min

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * DRY RUN es el comportamiento por defecto y seguro.
 *
 * Se publica de verdad cuando `PUBLISH_DRY_RUN` está ausente **o apagada
 * explícitamente** (`''`, `'0'`, `'false'`, `'no'`). Cualquier otro valor mantiene
 * el modo simulado.
 *
 * El string vacío cuenta como apagada a propósito: paneles como Easypanel a veces
 * "borran" una variable dejando la clave con valor vacío, lo que con un chequeo de
 * `!== undefined` dejaba el worker en dry run para siempre sin forma de notarlo.
 */
function isDryRun(env) {
  const raw = env.PUBLISH_DRY_RUN;
  if (raw === undefined) return false;
  return !['', '0', 'false', 'no'].includes(String(raw).trim().toLowerCase());
}

/** Construye el payload de creación de contenedor, idéntico en dry-run y real. */
function buildContainerPayload(item, videoUrl) {
  const payload = {
    media_type: 'REELS',
    video_url: videoUrl,
  };
  // Texto del post. Instagram corta en 2200 caracteres, así que lo recortamos
  // acá en vez de dejar que la Graph API rechace el contenedor entero.
  const caption = String(item.caption ?? '').trim();
  if (caption) payload.caption = caption.slice(0, 2200);
  if (item.kind === 'trial_reel') {
    // Reel de prueba: se gradúa manualmente (no auto-publica al feed).
    payload.trial_params = { graduation_strategy: 'MANUAL' };
  }
  return payload;
}

/** Resuelve la URL pública y el storage_path del video de un item de la cola. */
async function resolveAsset(supabase, item) {
  if (!item.variant_id) {
    throw new Error('item sin variant_id — no hay video que publicar');
  }
  const { data: variant, error: vErr } = await supabase
    .from('video_variants')
    .select('asset_id')
    .eq('id', item.variant_id)
    .single();
  if (vErr) throw new Error(`no se pudo resolver la variante: ${vErr.message}`);
  if (!variant?.asset_id) throw new Error('la variante no apunta a ningún asset');

  const { data: asset, error: aErr } = await supabase
    .from('media_assets')
    .select('public_url, storage_path')
    .eq('id', variant.asset_id)
    .single();
  if (aErr) throw new Error(`no se pudo resolver el asset: ${aErr.message}`);
  if (!asset?.public_url) throw new Error('el asset no tiene public_url');

  return asset;
}

/** Flujo real de la Graph API: contenedor → poll FINISHED → media_publish. */
async function publishReal(env, log, payload) {
  const igAccountId = env.META_IG_ACCOUNT_ID || FALLBACK_IG_ACCOUNT_ID;
  const token = env.META_ACCESS_TOKEN;
  if (!token) throw new Error('falta META_ACCESS_TOKEN para publicar en modo real');

  // 1) Crear contenedor.
  const createBody = new URLSearchParams({ ...payloadToStringMap(payload), access_token: token });
  const createRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media`, {
    method: 'POST',
    body: createBody,
  });
  const createJson = await createRes.json();
  if (createJson.error) {
    throw new Error(`Graph create container: ${createJson.error.message || JSON.stringify(createJson.error)}`);
  }
  const containerId = createJson.id;
  if (!containerId) throw new Error('Graph create container: sin id en la respuesta');
  log(`[publisher] contenedor creado ${containerId}, esperando procesamiento…`);

  // 2) Poll del status_code hasta FINISHED.
  let finished = false;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    const statusJson = await statusRes.json();
    if (statusJson.error) {
      throw new Error(`Graph status: ${statusJson.error.message || JSON.stringify(statusJson.error)}`);
    }
    const code = statusJson.status_code;
    if (code === 'FINISHED') {
      finished = true;
      break;
    }
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`el contenedor terminó en estado ${code}: ${statusJson.status || ''}`);
    }
  }
  if (!finished) throw new Error('timeout esperando que el contenedor llegue a FINISHED');

  // 3) Publicar.
  const publishBody = new URLSearchParams({ creation_id: containerId, access_token: token });
  const publishRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish`, {
    method: 'POST',
    body: publishBody,
  });
  const publishJson = await publishRes.json();
  if (publishJson.error) {
    throw new Error(`Graph media_publish: ${publishJson.error.message || JSON.stringify(publishJson.error)}`);
  }
  if (!publishJson.id) throw new Error('Graph media_publish: sin id en la respuesta');
  return publishJson.id;
}

/** Aplana el payload (incluye trial_params anidado) a strings para URLSearchParams. */
function payloadToStringMap(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  }
  return out;
}

/** Marca un item como fallido, tragando errores secundarios del update. */
async function markFailed(supabase, log, item, message) {
  log(`[publisher] item ${item.id} FALLÓ: ${message}`);
  const { error } = await supabase
    .from('publish_queue')
    .update({ status: 'failed', error: message })
    .eq('id', item.id);
  if (error) log(`[publisher] no se pudo marcar failed el item ${item.id}: ${error.message}`);
}

/** Borra del Storage los objetos de items publicados hace más de 7 días. */
async function cleanupOldStorage(supabase, log) {
  const cutoff = new Date(Date.now() - CLEANUP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: oldItems, error } = await supabase
    .from('publish_queue')
    .select('id, variant_id')
    .eq('status', 'published')
    .lt('published_at', cutoff);
  if (error) {
    log(`[publisher] cleanup: no se pudo listar items viejos: ${error.message}`);
    return;
  }
  if (!oldItems || oldItems.length === 0) return;

  const paths = [];
  for (const it of oldItems) {
    if (!it.variant_id) continue;
    const { data: variant } = await supabase
      .from('video_variants')
      .select('asset_id')
      .eq('id', it.variant_id)
      .single();
    if (!variant?.asset_id) continue;
    const { data: asset } = await supabase
      .from('media_assets')
      .select('storage_path')
      .eq('id', variant.asset_id)
      .single();
    if (asset?.storage_path) paths.push(asset.storage_path);
  }
  if (paths.length === 0) return;

  const { error: rmErr } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (rmErr) {
    log(`[publisher] cleanup: error borrando objetos: ${rmErr.message}`);
  } else {
    log(`[publisher] cleanup: ${paths.length} objeto(s) de Storage borrados (publicados hace +${CLEANUP_AFTER_DAYS} días)`);
  }
}

async function run(ctx) {
  const { supabase, env, log } = ctx;
  const dry = isDryRun(env);
  // Logueamos el valor crudo: sin esto, un PUBLISH_DRY_RUN='' es indistinguible
  // de uno ausente en los logs y el diagnóstico se vuelve adivinanza.
  log(
    `[publisher] corriendo en modo ${dry ? 'DRY RUN' : 'REAL'} ` +
      `(PUBLISH_DRY_RUN=${JSON.stringify(env.PUBLISH_DRY_RUN)})`,
  );

  const nowIso = new Date().toISOString();
  const { data: due, error: dueErr } = await supabase
    .from('publish_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true });

  if (dueErr) {
    log(`[publisher] error consultando la cola: ${dueErr.message}`);
    return;
  }

  const items = due || [];
  if (items.length > 0) log(`[publisher] ${items.length} item(s) vencido(s) para publicar`);

  for (const item of items) {
    // Lock optimista: pending → publishing sólo si sigue pending.
    const { data: locked, error: lockErr } = await supabase
      .from('publish_queue')
      .update({ status: 'publishing', error: null })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id');
    if (lockErr) {
      log(`[publisher] no se pudo lockear el item ${item.id}: ${lockErr.message}`);
      continue;
    }
    if (!locked || locked.length === 0) {
      // Otro proceso lo tomó; lo salteamos.
      continue;
    }

    try {
      const asset = await resolveAsset(supabase, item);
      const payload = buildContainerPayload(item, asset.public_url);

      let igMediaId;
      if (dry) {
        // DRY RUN: sólo loguear el payload exacto, sin tocar la Graph API.
        log(`[publisher] DRY RUN item ${item.id} (${item.kind}) → payload ${JSON.stringify(payload)}`);
        igMediaId = `DRYRUN-${randomUUID()}`;
      } else {
        igMediaId = await publishReal(env, log, payload);
      }

      const { error: updErr } = await supabase
        .from('publish_queue')
        .update({
          status: 'published',
          ig_media_id: igMediaId,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', item.id);
      if (updErr) {
        // Se publicó (o simuló) pero no pudimos persistir el estado: dejarlo asentado.
        log(`[publisher] item ${item.id} publicado (${igMediaId}) pero falló el update: ${updErr.message}`);
      } else {
        log(`[publisher] item ${item.id} publicado → ig_media_id=${igMediaId}`);
      }
    } catch (err) {
      await markFailed(supabase, log, item, err?.message ? String(err.message) : String(err));
    }
  }

  await cleanupOldStorage(supabase, log);
}

export const name = 'publisher';
export const intervalMs = 15 * 60 * 1000;
export { run };

export default { name, intervalMs, run };
