/** Las marcas son opcionales hasta que se ejecute la migración de curación. */
export interface ReelCuration {
  is_hidden?: boolean;
  is_duplicate?: boolean;
  transcript_suppressed?: boolean;
  canonical_reel_id?: string | null;
}

export function isActiveReel(reel: ReelCuration): boolean {
  return !reel.is_hidden && !reel.is_duplicate;
}

export function canEnrichReel(reel: ReelCuration): boolean {
  return isActiveReel(reel) && !reel.transcript_suppressed;
}

export function hasCurationColumns(reel: ReelCuration): boolean {
  return ['is_hidden', 'is_duplicate', 'transcript_suppressed', 'canonical_reel_id']
    .every((key) => Object.prototype.hasOwnProperty.call(reel, key));
}

export class ReelCurationInputError extends Error {}

const actions = ['hide', 'show', 'mark_duplicate', 'unmark_duplicate', 'delete_transcript', 'allow_transcript'] as const;
export type ReelCurationAction = typeof actions[number];
export const isReelId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function curationInput(value: unknown, id: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReelCurationInputError('Los datos no son válidos');
  }
  const body = value as Record<string, unknown>;
  if (!actions.includes(body.action as ReelCurationAction)) {
    throw new ReelCurationInputError('Acción de reel inválida');
  }
  if (Object.keys(body).some((key) => !['action', 'canonical_reel_id'].includes(key))) {
    throw new ReelCurationInputError('Usá una acción de curación para modificar el reel');
  }
  const action = body.action as ReelCurationAction;
  const canonical = body.canonical_reel_id ?? null;
  if ('canonical_reel_id' in body && action !== 'mark_duplicate') {
    throw new ReelCurationInputError('El original sólo se indica al marcar un repetido');
  }
  if (canonical !== null && (!isReelId(canonical) || canonical.toLowerCase() === id.toLowerCase())) {
    throw new ReelCurationInputError('Elegí otro reel como original');
  }
  return { action, canonical_reel_id: canonical as string | null };
}

/** Nunca se borran la fila, el ID de Instagram ni sus métricas. */
export function curationPatch(action: ReelCurationAction, canonical: string | null = null): Record<string, unknown> {
  switch (action) {
    case 'hide': return { is_hidden: true };
    case 'show': return { is_hidden: false };
    case 'mark_duplicate': return {
      is_duplicate: true, canonical_reel_id: canonical, transcript_suppressed: true,
      transcript: null, ai_analysis: null, improvement: null,
    };
    case 'unmark_duplicate': return { is_duplicate: false, canonical_reel_id: null, transcript_suppressed: false };
    case 'delete_transcript': return { transcript_suppressed: true, transcript: null, ai_analysis: null, improvement: null };
    case 'allow_transcript': return { transcript_suppressed: false };
  }
}

export const CURATION_MIGRATION_MESSAGE =
  'Falta ejecutar supabase_migration_reel_curation.sql en el SQL Editor de Supabase para guardar estas decisiones.';

export const ENRICHMENT_BLOCKED_MESSAGE =
  'Este reel está oculto, marcado como repetido o tiene la transcripción desactivada. Restauralo desde Instagram para volver a generarla.';
