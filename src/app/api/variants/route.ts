import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { pathFromPublicUrl, removeStorage, walkStorage } from '@/lib/storageAdmin';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/variants?id=<variantId>   → borra UNA variante
 * DELETE /api/variants?jobId=<jobId>    → borra la generación entera: sus
 *   variantes, los PNG de texto, el job y el video base (si ningún otro job lo usa)
 *
 * Borra los archivos del Storage además de las filas: es lo que libera cuota.
 *
 * Ojo con las cascadas de la base (media_assets → variant_jobs → video_variants
 * → publish_queue, todas ON DELETE CASCADE): borrar sin cuidado se llevaría el
 * historial del calendario. Por eso, ANTES de borrar nada:
 *   - publicaciones ya hechas  → se desligan (variant_id = NULL) y se conservan
 *   - pendientes / fallidas    → se borran (= se cancela lo programado)
 *   - una publicándose ahora   → 409, no se toca nada
 * Mismo criterio que cleanup_variants.mjs.
 */

interface QueueRow { id: string; status: string }

async function detachQueue(variantIds: string[]): Promise<{ canceled: number }> {
  if (!variantIds.length) return { canceled: 0 };
  const { data, error } = await supabase
    .from('publish_queue')
    .select('id,status')
    .in('variant_id', variantIds);
  if (error) throw new Error(`No se pudo leer el calendario: ${error.message}`);
  const rows = (data || []) as QueueRow[];
  if (rows.some((r) => r.status === 'publishing')) {
    throw Object.assign(new Error('Una de estas variantes se está publicando en este momento. Esperá a que termine.'), { status: 409 });
  }
  const published = rows.filter((r) => r.status === 'published').map((r) => r.id);
  const drop = rows.filter((r) => r.status !== 'published').map((r) => r.id);
  if (published.length) {
    const { error: e } = await supabase.from('publish_queue').update({ variant_id: null }).in('id', published);
    if (e) throw new Error(`No se pudo conservar el historial del calendario: ${e.message}`);
  }
  if (drop.length) {
    const { error: e } = await supabase.from('publish_queue').delete().in('id', drop);
    if (e) throw new Error(`No se pudieron cancelar las publicaciones pendientes: ${e.message}`);
  }
  return { canceled: drop.length };
}

const sizeOf = (files: { path: string; size: number }[], paths: string[]) => {
  const set = new Set(paths);
  return files.filter((f) => set.has(f.path)).reduce((a, f) => a + f.size, 0);
};

export async function DELETE(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    const id = sp.get('id');
    const jobId = sp.get('jobId');
    if (!id && !jobId) return NextResponse.json({ error: 'Falta id o jobId' }, { status: 400 });

    // ── Una sola variante ───────────────────────────────────────────────────
    if (id) {
      const { data: v, error } = await supabase
        .from('video_variants')
        .select('id, job_id, asset_id, media_assets(storage_path)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!v) return NextResponse.json({ error: 'La variante ya no existe' }, { status: 404 });

      const { canceled } = await detachQueue([v.id]);
      const path = (v.media_assets as unknown as { storage_path: string } | null)?.storage_path ?? '';
      const files = path ? await walkStorage(path.split('/').slice(0, -1).join('/')) : [];

      // Borrar el media_asset cascadea a la fila de video_variants.
      const { error: delErr } = await supabase.from('media_assets').delete().eq('id', v.asset_id);
      if (delErr) throw new Error(`No se pudo borrar la variante: ${delErr.message}`);
      if (path) await removeStorage([path]);

      return NextResponse.json({ success: true, freedBytes: sizeOf(files, [path]), canceledPosts: canceled });
    }

    // ── Generación completa ─────────────────────────────────────────────────
    const { data: job, error: jobErr } = await supabase
      .from('variant_jobs')
      .select('id, status, params, source_asset_id')
      .eq('id', jobId!)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job) return NextResponse.json({ error: 'La generación ya no existe' }, { status: 404 });
    if (job.status === 'pending' || job.status === 'processing') {
      return NextResponse.json(
        { error: 'La generación todavía se está procesando: esperá a que termine para borrarla.' },
        { status: 409 },
      );
    }

    const { data: vs, error: vErr } = await supabase
      .from('video_variants')
      .select('id, asset_id, media_assets(storage_path)')
      .eq('job_id', job.id);
    if (vErr) throw new Error(vErr.message);
    const variants = (vs || []) as unknown as { id: string; asset_id: string; media_assets: { storage_path: string } | null }[];

    const { canceled } = await detachQueue(variants.map((v) => v.id));

    // PNG de los textos quemados (se subieron al crear el job).
    const texts = Array.isArray(job.params?.texts) ? job.params.texts : [];
    const textPaths = texts
      .map((t: { overlayUrl?: string }) => pathFromPublicUrl(t?.overlayUrl))
      .filter((p: string | null): p is string => !!p);

    // Video base: sólo si es un archivo nuestro y ningún otro job lo usa.
    const { data: src } = await supabase
      .from('media_assets').select('id, storage_path').eq('id', job.source_asset_id).maybeSingle();
    const { count: otherJobs } = await supabase
      .from('variant_jobs').select('id', { count: 'exact', head: true })
      .eq('source_asset_id', job.source_asset_id).neq('id', job.id);
    const dropSource = !!src && (otherJobs ?? 0) === 0 && /^(sources|uploads)\//.test(src.storage_path || '');

    // Tamaños antes de borrar (para contar lo liberado).
    const variantFolder = `variants/${job.id}`;
    const [folderFiles, textFiles, srcFiles] = await Promise.all([
      walkStorage(variantFolder),
      textPaths.length ? walkStorage('variant-text') : Promise.resolve([]),
      dropSource ? walkStorage(src!.storage_path.split('/').slice(0, -1).join('/')) : Promise.resolve([]),
    ]);
    const variantPaths = [
      ...folderFiles.map((f) => f.path),
      ...variants.map((v) => v.media_assets?.storage_path || '').filter(Boolean),
    ];

    // Filas: los media_assets de las variantes cascadean video_variants; el job
    // va explícito; el source al final (cascadearía el job si siguiera ahí).
    const assetIds = variants.map((v) => v.asset_id);
    if (assetIds.length) {
      const { error: e } = await supabase.from('media_assets').delete().in('id', assetIds);
      if (e) throw new Error(`No se pudieron borrar las variantes: ${e.message}`);
    }
    const { error: jErr } = await supabase.from('variant_jobs').delete().eq('id', job.id);
    if (jErr) throw new Error(`No se pudo borrar la generación: ${jErr.message}`);
    if (dropSource) await supabase.from('media_assets').delete().eq('id', src!.id);

    // Archivos.
    const sourcePaths = dropSource ? [src!.storage_path] : [];
    await removeStorage([...variantPaths, ...textPaths, ...sourcePaths]);

    const freedBytes =
      sizeOf(folderFiles, variantPaths) + sizeOf(textFiles, textPaths) + sizeOf(srcFiles, sourcePaths);
    return NextResponse.json({
      success: true,
      freedBytes,
      deletedVariants: variants.length,
      deletedSource: dropSource,
      canceledPosts: canceled,
    });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const message = error instanceof Error ? error.message : 'No se pudo borrar';
    console.error('variants DELETE:', message);
    return NextResponse.json({ error: message }, { status });
  }
}
