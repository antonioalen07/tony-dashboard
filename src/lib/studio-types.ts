/**
 * Contrato de datos compartido de Crevy Studio (Historias + Variantes + Calendario).
 *
 * Espejo de las tablas creadas por `supabase_migration_studio.sql`.
 * TODAS las unidades del feature deben importar desde acá — no redefinir shapes.
 */

// ── Assets (bucket "studio") ────────────────────────────────────────────────
export type AssetKind = 'image' | 'video';
export type AssetSource = 'upload' | 'drive' | 'reel';

export interface MediaAsset {
  id: string;
  kind: AssetKind;
  filename: string | null;
  storage_path: string;
  public_url: string;
  source: AssetSource;
  created_at: string;
}

// ── Historias ───────────────────────────────────────────────────────────────
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Una capa de texto sobre un slide. x/y en 0..1 (fracción del lienzo 1080×1920). */
export interface StoryTextLayer {
  text: string;
  font: string;
  size: number; // px sobre el lienzo de 1080×1920
  color: string;
  bold: boolean;
  underline: boolean;
  highlight: string | null; // color de resaltado, o null
  x: number; // 0..1
  y: number; // 0..1
  align: TextAlign;
  /** Interlineado como múltiplo del tamaño (default 1.25). */
  lineHeight?: number;
  /** Ancho de la caja de texto como fracción del lienzo (0..1); habilita wrap y justify. null/undefined = auto. */
  widthPct?: number | null;
  /** Palabras concretas a subrayar (además del subrayado de toda la capa). Case-insensitive. */
  underlineWords?: string[];
  /** Palabras concretas a resaltar (usa el color de `highlight`). Si está vacío y hay `highlight`, se resalta toda la capa. Case-insensitive. */
  highlightWords?: string[];
}

/** Imagen superpuesta sobre un slide (sticker/recorte). Centro en x/y (0..1). */
export interface StoryImageOverlay {
  src: string; // public_url del asset o data URL
  x: number; // centro 0..1
  y: number; // centro 0..1
  w: number; // ancho como fracción del ancho del lienzo
  h: number; // alto como fracción del alto del lienzo
}

/** Un trazo de dibujo a mano alzada. Puntos en 0..1; width en px sobre el lienzo 1080×1920. */
export interface StoryDrawStroke {
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

export interface StorySlide {
  bg_asset_id: string | null;
  /** Brillo del fondo: 1 = normal, <1 más oscuro, >1 más claro. */
  bg_brightness?: number;
  layers: StoryTextLayer[];
  /** Imágenes superpuestas (se dibujan sobre el fondo, debajo del texto). */
  overlays?: StoryImageOverlay[];
  /** Trazos de dibujo (se dibujan por encima de todo). */
  strokes?: StoryDrawStroke[];
}

export interface StoryProject {
  id: string;
  name: string;
  slides: StorySlide[];
  created_at: string;
  updated_at: string;
}

// ── Variantes de video ──────────────────────────────────────────────────────
/**
 * Rangos de re-edición que el worker aplica aleatoriamente por variante.
 * Cada par [min, max]; el worker sortea un valor dentro del rango por variante.
 */
export interface VariantParams {
  saturation: [number, number]; // ej. [0.95, 1.05]
  contrast: [number, number]; // ej. [0.97, 1.03]
  trimStartMs: [number, number]; // ej. [0, 300]
  speed: [number, number]; // ej. [0.98, 1.02]
  zoom: [number, number]; // ej. [1.0, 1.02]
}

export const DEFAULT_VARIANT_PARAMS: VariantParams = {
  saturation: [0.95, 1.05],
  contrast: [0.97, 1.03],
  trimStartMs: [0, 300],
  speed: [0.98, 1.02],
  zoom: [1.0, 1.02],
};

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface VariantJob {
  id: string;
  source_asset_id: string;
  num_variants: number;
  params: VariantParams;
  status: JobStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Valores concretos aplicados a UNA variante (no rangos). */
export interface AppliedVariantParams {
  saturation: number;
  contrast: number;
  trimStartMs: number;
  speed: number;
  zoom: number;
}

export interface VideoVariant {
  id: string;
  job_id: string;
  asset_id: string;
  params: AppliedVariantParams;
  created_at: string;
}

// ── Cola de publicación / calendario ────────────────────────────────────────
export type PublishKind = 'trial_reel' | 'reel' | 'story';
export type PublishStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface PublishQueueItem {
  id: string;
  variant_id: string | null;
  kind: PublishKind;
  scheduled_at: string | null;
  status: PublishStatus;
  ig_media_id: string | null;
  error: string | null;
  published_at: string | null;
  created_at: string;
}

// ── Google Drive ────────────────────────────────────────────────────────────
export interface GoogleTokens {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expiry: string | null;
  updated_at: string;
}

// ── Sentinela de migración (mismo patrón que Inspiración) ────────────────────
/** El API responde 428 cuando faltan las tablas del Studio; la UI muestra banner. */
export const MIGRATION_REQUIRED_STATUS = 428;
