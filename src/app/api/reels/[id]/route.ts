import { requireRole } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import {
  curationInput, curationPatch, hasCurationColumns, isActiveReel, isReelId,
  CURATION_MIGRATION_MESSAGE, ReelCurationInputError,
} from '@/lib/reel-curation';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    const { id } = await context.params;
    if (!isReelId(id)) throw new ReelCurationInputError('ID de reel inválido');
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new ReelCurationInputError('Los datos no son JSON válido'); }
    const input = curationInput(body, id);
    const { data: reel, error } = await supabase.from('reels').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error('No se pudo consultar el reel. Intentá nuevamente.');
    if (!reel) return Response.json({ error: 'Reel no encontrado' }, { status: 404 });
    if (!hasCurationColumns(reel)) {
      return Response.json({ error: CURATION_MIGRATION_MESSAGE, code: 'REEL_CURATION_MIGRATION_REQUIRED' }, { status: 428 });
    }
    if (input.action === 'allow_transcript' && !isActiveReel(reel)) {
      return Response.json({ error: 'Primero mostrá el reel y quitá la marca de repetido.' }, { status: 409 });
    }
    if (input.canonical_reel_id) {
      const { data: original, error: originalError } = await supabase.from('reels').select('*')
        .eq('id', input.canonical_reel_id).maybeSingle();
      if (originalError) throw new Error('No se pudo consultar el reel original. Intentá nuevamente.');
      if (!original || !isActiveReel(original) || original.transcript_suppressed) {
        throw new ReelCurationInputError('El original debe ser un reel activo, sin marca de repetido ni transcripción desactivada');
      }
    }
    const patch = { ...curationPatch(input.action, input.canonical_reel_id), updated_at: new Date().toISOString() };
    let query = supabase.from('reels').update(patch).eq('id', id);
    // Una acción concurrente no puede reactivar una transcripción excluida.
    if (input.action === 'allow_transcript') query = query.eq('is_hidden', false).eq('is_duplicate', false);
    const { data: updated, error: updateError } = await query.select('*').maybeSingle();
    if (updateError) throw new Error('No se pudo guardar el cambio. Intentá nuevamente.');
    if (!updated) return Response.json({ error: 'El reel cambió. Volvé a cargarlo e intentá nuevamente.' }, { status: 409 });
    return Response.json({ reel: updated });
  } catch (error) {
    if (!(error instanceof ReelCurationInputError)) console.error('[reel-curation]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo guardar el cambio' },
      { status: error instanceof ReelCurationInputError ? 400 : 503 });
  }
}
