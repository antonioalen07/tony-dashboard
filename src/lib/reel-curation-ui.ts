import type { ReelCuration } from './reel-curation';

interface CuratedReel extends ReelCuration {
  id: string;
  transcript?: string | null;
  ai_analysis?: string[] | null;
  improvement?: string | null;
}

type CurationFields = Omit<CuratedReel, 'id'>;
export interface ReelCurationReads {
  revision: number;
  updates: Map<string, { revision: number; fields: CurationFields }>;
}

const CURATION_FIELDS = ['is_hidden', 'is_duplicate', 'transcript_suppressed', 'canonical_reel_id', 'transcript', 'ai_analysis', 'improvement'] as const;

export function createReelCurationReads(): ReelCurationReads {
  return { revision: 0, updates: new Map() };
}

/** Sólo se recuerdan decisiones y textos; una respuesta PATCH no pisa métricas nuevas. */
export function rememberReelCuration(reads: ReelCurationReads, reel: CuratedReel): CurationFields {
  const fields = Object.fromEntries(CURATION_FIELDS.filter((key) => key in reel).map((key) => [key, reel[key]])) as CurationFields;
  if (fields.ai_analysis) fields.ai_analysis = [...fields.ai_analysis];
  reads.updates.set(reel.id, { revision: ++reads.revision, fields });
  return fields;
}

export function applyReelCuration<T extends CuratedReel>(reel: T, fields: CurationFields): T {
  return { ...reel, ...fields };
}

/** Un SELECT iniciado antes del cambio puede traer métricas nuevas con flags viejos. */
export function reconcileReelRead<T extends CuratedReel>(reel: T, readRevision: number, reads: ReelCurationReads): T {
  const update = reads.updates.get(reel.id);
  return update && update.revision > readRevision ? applyReelCuration(reel, update.fields) : reel;
}

export function reconcileReelsRead<T extends CuratedReel>(reels: T[], readRevision: number, reads: ReelCurationReads): T[] {
  return reels.map((reel) => reconcileReelRead(reel, readRevision, reads));
}
