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
  /** Orden de apilado (mayor = más al frente). Sin valor: default por tipo. */
  z?: number;
}

/** Imagen superpuesta sobre un slide (sticker/recorte). Centro en x/y (0..1). */
export interface StoryImageOverlay {
  src: string; // public_url del asset o data URL
  x: number; // centro 0..1
  y: number; // centro 0..1
  w: number; // ancho como fracción del ancho del lienzo
  h: number; // alto como fracción del alto del lienzo
  /** Radio de esquinas 0..0.5 (fracción del lado menor). 0.5 = círculo si la caja es cuadrada. */
  radius?: number;
  /** Aspecto natural (ancho/alto) de la imagen, para el preset "Original". */
  srcRatio?: number;
  /** Orden de apilado (mayor = más al frente). Sin valor: default por tipo. */
  z?: number;
}

/** Un trazo de dibujo a mano alzada. Puntos en 0..1; width en px sobre el lienzo 1080×1920. */
export interface StoryDrawStroke {
  color: string;
  width: number;
  points: { x: number; y: number }[];
  /** Efecto neón: halo brillante alrededor del trazo + núcleo claro. */
  glow?: boolean;
  /** Orden de apilado (mayor = más al frente). Sin valor: default por tipo. */
  z?: number;
}

export interface StorySlide {
  bg_asset_id: string | null;
  /** Brillo del fondo: 1 = normal, <1 más oscuro, >1 más claro. */
  bg_brightness?: number;
  /** Zoom del fondo dentro del encuadre (>=1, default 1). */
  bg_scale?: number;
  /** Desplazamiento del fondo como fracción del lienzo (default 0). Rango útil ±(scale-1)/2. */
  bg_pan_x?: number;
  bg_pan_y?: number;
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
/** Posición vertical del texto quemado sobre la variante. */
export type VariantTextPosition = 'top' | 'center' | 'bottom';

/** Estilo compartido por todos los textos quemados de un job. */
export interface VariantTextStyle {
  /** Tamaño como fracción de la altura del video (0.03–0.12). */
  size: number;
  color: string;
  /** Familia tipográfica (una de STORY_FONTS). */
  font: string;
  /** Caja de fondo detrás del texto (mejora la lectura sobre cualquier imagen). */
  box: boolean;
  boxColor: string;
  boxOpacity: number; // 0..1
}

/** Texto quemado en UNA variante. `text` vacío = esa variante no lleva texto. */
export interface VariantText {
  text: string;
  position: VariantTextPosition;
  /**
   * PNG transparente con el texto ya rasterizado por el navegador, subido al
   * bucket `studio`. El worker sólo lo compone con `overlay` — así no dependemos
   * del soporte de fuentes ni del escapado de `drawtext` del build de ffmpeg.
   */
  overlayUrl?: string | null;
}

export const DEFAULT_VARIANT_TEXT_STYLE: VariantTextStyle = {
  size: 0.055,
  color: '#ffffff',
  font: 'Inter',
  box: true,
  boxColor: '#000000',
  boxOpacity: 0.45,
};

/** Cuántas variantes se espejan horizontalmente. */
export type MirrorMode = 'none' | 'some' | 'all';

/**
 * Rangos de re-edición que el worker aplica aleatoriamente por variante.
 * Cada par [min, max]; el worker sortea un valor dentro del rango por variante.
 *
 * Los rangos por defecto son deliberadamente amplios: los detectores de
 * duplicados de Meta usan embeddings visuales (tipo SSCD), que son robustos a
 * cambios de color/compresión mínimos. Ver INFORME_SISTEMA.md.
 */
export interface VariantParams {
  saturation: [number, number]; // ej. [0.92, 1.08]
  contrast: [number, number]; // ej. [0.95, 1.06]
  trimStartMs: [number, number]; // ej. [0, 700]
  speed: [number, number]; // ej. [0.96, 1.04]
  zoom: [number, number]; // ej. [1.03, 1.09]
  /** Recorte del final en ms: cambia la duración, no solo el arranque. */
  trimEndMs?: [number, number];
  /** Rotación en grados; se compensa con zoom extra para no dejar bordes negros. */
  rotate?: [number, number];
  /** Desplazamiento del encuadre dentro del zoom, como fracción del margen disponible (-1..1). */
  pan?: [number, number];
  /** Cambio de tono del audio como factor (1 = sin cambio). Molesta al fingerprint de audio. */
  pitch?: [number, number];
  /** Espejado horizontal. Ojo: da vuelta cualquier texto que ya esté en el video. */
  mirror?: MirrorMode;
  /** Estilo de los textos quemados. */
  textStyle?: VariantTextStyle;
  /** Texto por variante (índice = nº de variante). Los que falten van sin texto. */
  texts?: VariantText[];
}

export const DEFAULT_VARIANT_PARAMS: VariantParams = {
  saturation: [0.92, 1.08],
  contrast: [0.95, 1.06],
  trimStartMs: [0, 700],
  speed: [0.96, 1.04],
  zoom: [1.03, 1.09],
  trimEndMs: [0, 600],
  rotate: [-0.8, 0.8],
  pan: [-0.7, 0.7],
  pitch: [1, 1],
  mirror: 'none',
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
  trimEndMs?: number;
  rotate?: number;
  panX?: number;
  panY?: number;
  pitch?: number;
  mirror?: boolean;
  /** Texto quemado en esta variante (null = ninguno). */
  text?: (VariantText & { style: VariantTextStyle }) | null;
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
