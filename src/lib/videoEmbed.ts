/**
 * Reconocimiento de links de video para las referencias de un guion.
 *
 * Devuelve, cuando se puede, la URL de EMBED del proveedor: así el video se
 * previsualiza sin salir del tablero. Si no se reconoce el proveedor el link
 * sigue siendo útil — se abre en una pestaña nueva — solo que sin preview.
 */

export type EmbedProvider = 'instagram' | 'youtube' | 'tiktok' | 'vimeo' | 'drive' | 'other';

export interface EmbedInfo {
  provider: EmbedProvider;
  /** Nombre legible del proveedor, para el chip del link. */
  providerLabel: string;
  /** URL para el iframe, o null si no hay preview posible. */
  embedUrl: string | null;
  /** Proporción ancho/alto del iframe. */
  ratio: number;
  /** Ancho máximo del preview en px (los embeds verticales no deben estirarse). */
  maxWidth: number;
  /** URL normalizada (con protocolo) para el enlace externo. */
  href: string;
}

const PROVIDER_LABEL: Record<EmbedProvider, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  vimeo: 'Vimeo',
  drive: 'Drive',
  other: 'Link',
};

/** Pegar "instagram.com/reel/xxx" sin protocolo es lo normal; no rompas por eso. */
export function normalizeUrl(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, '')}`;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(normalizeUrl(raw));
  } catch {
    return null;
  }
}

export function describeLink(raw: string): EmbedInfo {
  const href = normalizeUrl(raw);
  const url = parseUrl(raw);
  const fallback: EmbedInfo = {
    provider: 'other',
    providerLabel: PROVIDER_LABEL.other,
    embedUrl: null,
    ratio: 16 / 9,
    maxWidth: 640,
    href,
  };
  if (!url) return fallback;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const path = url.pathname;

  // ── Instagram: reels, posts e IGTV ────────────────────────────────────────
  if (host.endsWith('instagram.com')) {
    const m = path.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (m) {
      // "reels" (plural) existe en la URL del feed pero no en la de embed.
      const kind = m[1] === 'reels' ? 'reel' : m[1];
      return {
        provider: 'instagram',
        providerLabel: PROVIDER_LABEL.instagram,
        embedUrl: `https://www.instagram.com/${kind}/${m[2]}/embed/captioned/`,
        // El embed de Instagram trae cabecera y pie propios: forzarlo a 9/16
        // recorta el video. Es una tarjeta alta, no un video vertical puro.
        ratio: 0.56,
        maxWidth: 420,
        href,
      };
    }
    return { ...fallback, provider: 'instagram', providerLabel: PROVIDER_LABEL.instagram };
  }

  // ── YouTube: watch, youtu.be, shorts y embed ──────────────────────────────
  if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('youtube-nocookie.com')) {
    let id = '';
    let vertical = false;
    if (host === 'youtu.be') {
      id = path.slice(1).split('/')[0];
    } else {
      const shorts = path.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      const embed = path.match(/\/(?:embed|v)\/([A-Za-z0-9_-]+)/);
      if (shorts) {
        id = shorts[1];
        vertical = true;
      } else if (embed) {
        id = embed[1];
      } else {
        id = url.searchParams.get('v') || '';
      }
    }
    if (id) {
      return {
        provider: 'youtube',
        providerLabel: PROVIDER_LABEL.youtube,
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        ratio: vertical ? 9 / 16 : 16 / 9,
        maxWidth: vertical ? 340 : 640,
        href,
      };
    }
    return { ...fallback, provider: 'youtube', providerLabel: PROVIDER_LABEL.youtube };
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  if (host.endsWith('tiktok.com')) {
    const m = path.match(/\/video\/(\d+)/);
    if (m) {
      return {
        provider: 'tiktok',
        providerLabel: PROVIDER_LABEL.tiktok,
        embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}`,
        // El player de TikTok también agrega chrome alrededor del video.
        ratio: 0.6,
        maxWidth: 340,
        href,
      };
    }
    // Los links cortos (vm.tiktok.com/...) redirigen: no hay id que extraer.
    return { ...fallback, provider: 'tiktok', providerLabel: PROVIDER_LABEL.tiktok };
  }

  // ── Vimeo ─────────────────────────────────────────────────────────────────
  if (host.endsWith('vimeo.com')) {
    const m = path.match(/\/(\d+)/);
    if (m) {
      return {
        provider: 'vimeo',
        providerLabel: PROVIDER_LABEL.vimeo,
        embedUrl: `https://player.vimeo.com/video/${m[1]}`,
        ratio: 16 / 9,
        maxWidth: 640,
        href,
      };
    }
    return { ...fallback, provider: 'vimeo', providerLabel: PROVIDER_LABEL.vimeo };
  }

  // ── Google Drive ──────────────────────────────────────────────────────────
  if (host.endsWith('drive.google.com')) {
    const m = path.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      return {
        provider: 'drive',
        providerLabel: PROVIDER_LABEL.drive,
        embedUrl: `https://drive.google.com/file/d/${m[1]}/preview`,
        ratio: 9 / 16,
        maxWidth: 340,
        href,
      };
    }
    return { ...fallback, provider: 'drive', providerLabel: PROVIDER_LABEL.drive };
  }

  return fallback;
}

/** Texto corto del link para mostrar cuando no hay etiqueta escrita a mano. */
export function shortLabel(raw: string): string {
  const url = parseUrl(raw);
  if (!url) return raw;
  const host = url.hostname.replace(/^www\./i, '');
  const path = url.pathname.replace(/\/$/, '');
  const compact = `${host}${path}`;
  return compact.length > 52 ? `${compact.slice(0, 51)}…` : compact;
}
