/**
 * Contrato de datos de la sección "Guiones": tablero Kanban + banco de ideas.
 *
 * Espejo de las tablas creadas por `supabase_migration_produccion.sql`.
 * Todo lo que toque guiones o ideas importa desde acá — no redefinir shapes.
 */

// ── Tablero ─────────────────────────────────────────────────────────────────

/** Columna del tablero. Es el `status` de la fila, no un enum de Postgres:
 *  agregar una etapa nueva no obliga a migrar. */
export type ScriptStatus = 'borrador' | 'listo' | 'grabado' | 'edicion' | 'publicado';

export interface BoardColumn {
  id: ScriptStatus;
  label: string;
  hint: string;
}

/** El orden de este array ES el orden de las columnas en pantalla. */
export const BOARD_COLUMNS: BoardColumn[] = [
  { id: 'borrador', label: 'Borrador', hint: 'Escribiendo el guion' },
  { id: 'listo', label: 'Listo para grabar', hint: 'Guion cerrado, falta cámara' },
  { id: 'grabado', label: 'Grabado', hint: 'Material crudo listo' },
  { id: 'edicion', label: 'En edición', hint: 'Montaje y subtítulos' },
  { id: 'publicado', label: 'Publicado', hint: 'Ya salió' },
];

export const DEFAULT_STATUS: ScriptStatus = 'borrador';

const STATUS_IDS = new Set<string>(BOARD_COLUMNS.map((c) => c.id));

/** Un status desconocido (columna renombrada, fila vieja) no debe esconder la
 *  tarjeta: cae en la primera columna. */
export const normalizeStatus = (value: unknown): ScriptStatus =>
  typeof value === 'string' && STATUS_IDS.has(value) ? (value as ScriptStatus) : DEFAULT_STATUS;

// ── Formato del video ───────────────────────────────────────────────────────

export type ScriptFormat =
  | 'talking_head'
  | 'pantalla_dividida'
  | 'entrevista'
  | 'pantalla'
  | 'b_roll'
  | 'voz_en_off'
  | 'otro';

export interface FormatDef {
  id: ScriptFormat;
  label: string;
  hint: string;
}

export const SCRIPT_FORMATS: FormatDef[] = [
  { id: 'talking_head', label: 'Talking head', hint: 'A cámara, sin apoyos' },
  { id: 'pantalla_dividida', label: 'Pantalla dividida', hint: 'Vos + otro plano al lado' },
  { id: 'entrevista', label: 'Entrevista', hint: 'Pregunta y respuesta, dos voces' },
  { id: 'pantalla', label: 'Mostrando pantalla', hint: 'Screen share o demo' },
  { id: 'b_roll', label: 'B-roll', hint: 'Imágenes de apoyo con voz encima' },
  { id: 'voz_en_off', label: 'Voz en off', hint: 'Sin cara, solo audio + visuales' },
  { id: 'otro', label: 'Otro', hint: 'Formato suelto' },
];

export const formatLabel = (id: string | null | undefined): string =>
  SCRIPT_FORMATS.find((f) => f.id === id)?.label ?? '';

// ── Filas ───────────────────────────────────────────────────────────────────

/** Link de referencia de un guion: el video que inspira la toma. */
export interface ScriptRef {
  url: string;
  /** Nota corta para reconocerlo de un vistazo. Opcional. */
  label?: string;
}

export interface ScriptCard {
  id: string;
  title: string;
  status: ScriptStatus;
  format: ScriptFormat | null;
  tags: string[];
  hook: string;
  body: string;
  cta: string;
  refs: ScriptRef[];
  /** Orden dentro de la columna. Se mueve por punto medio entre vecinos. */
  position: number;
  created_at: string;
  updated_at: string;
}

export type IdeaKind = 'idea' | 'reference';

export interface IdeaItem {
  id: string;
  kind: IdeaKind;
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  /** Archiva sin borrar: la idea ya se usó en un guion. */
  used: boolean;
  created_at: string;
}

// ── Normalizadores (las columnas JSONB pueden venir con cualquier cosa) ──────

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

const toRefs = (value: unknown): ScriptRef[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      if (typeof raw === 'string') return { url: raw };
      const r = raw as { url?: unknown; label?: unknown };
      return typeof r?.url === 'string' ? { url: r.url, label: typeof r.label === 'string' ? r.label : undefined } : null;
    })
    .filter((r): r is ScriptRef => r !== null && r.url.trim() !== '');
};

export function toScriptCard(row: Record<string, unknown>): ScriptCard {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    status: normalizeStatus(row.status),
    format: (SCRIPT_FORMATS.find((f) => f.id === row.format)?.id ?? null) as ScriptFormat | null,
    tags: toStringArray(row.tags),
    hook: typeof row.hook === 'string' ? row.hook : '',
    body: typeof row.body === 'string' ? row.body : '',
    cta: typeof row.cta === 'string' ? row.cta : '',
    refs: toRefs(row.refs),
    position: typeof row.position === 'number' ? row.position : Number(row.position) || 0,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export function toIdeaItem(row: Record<string, unknown>): IdeaItem {
  return {
    id: String(row.id),
    kind: row.kind === 'reference' ? 'reference' : 'idea',
    title: typeof row.title === 'string' ? row.title : '',
    content: typeof row.content === 'string' ? row.content : '',
    url: typeof row.url === 'string' && row.url.trim() !== '' ? row.url : null,
    tags: toStringArray(row.tags),
    used: row.used === true,
    created_at: String(row.created_at ?? ''),
  };
}

// ── Migración pendiente ─────────────────────────────────────────────────────

/**
 * `true` cuando el error de Supabase dice que falta la tabla o la columna, o
 * sea: no se corrió `supabase_migration_produccion.sql`. La UI degrada con un
 * aviso, nunca rompe.
 */
export const isMissingSchema = (err: { code?: string; message?: string } | null | undefined): boolean =>
  !!err &&
  (err.code === '42P01' ||
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST205' ||
    /does not exist|schema cache|could not find the/i.test(err.message || ''));

/** Nombre del archivo que hay que pegar en el SQL Editor. Se muestra en la UI. */
export const PRODUCTION_MIGRATION = 'supabase_migration_produccion.sql';

// ── Orden en el tablero ─────────────────────────────────────────────────────

/** Separación por defecto entre tarjetas consecutivas. */
export const POSITION_STEP = 1000;

/**
 * Posición para insertar entre `before` y `after` (cualquiera puede faltar:
 * insertar al principio o al final de la columna). Devuelve `null` cuando el
 * hueco entre vecinos ya no alcanza y hay que renumerar la columna entera.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before == null && after == null) return POSITION_STEP;
  if (before == null) return (after as number) - POSITION_STEP;
  if (after == null) return before + POSITION_STEP;
  const gap = after - before;
  if (gap <= 0.002) return null;
  return before + gap / 2;
}
