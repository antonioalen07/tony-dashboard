/**
 * Detección de virales — port exacto de monitor_viral/scraper.py (production-tested).
 *
 * Score 0-100:
 *   55% velocidad relativa  (views/h vs mediana de la cuenta; 3x la mediana = 100 pts)
 *   25% penetración         (views/followers, escala logarítmica)
 *   20% frescura            (decay exponencial k=0.384; ~0 a las 12 horas)
 *
 * Umbral viral ("banger"): score >= 60.
 */

export const VIRAL_THRESHOLD = 60;

export interface NormalizedPost {
  instagram_id: string;
  username: string;
  caption: string;
  post_url: string;
  cover_url: string;
  posted_at: string | null;
  views: number;
  likes: number;
  comments: number;
  duration_s: number | null;
}

export interface ScoredPost extends NormalizedPost {
  views_per_hour: number;
  score: number;
  multiplier: number; // views / mediana de views de la cuenta
  account_median: number;
  followers: number | null;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Normaliza un item del actor apify/instagram-scraper (resultsType: posts). */
export function normalizeInstagramItem(item: any, username: string): NormalizedPost | null {
  const id = item?.id || item?.shortCode;
  if (!id) return null;
  const views = item.videoPlayCount ?? item.videoViewCount ?? item.playCount ?? 0;
  return {
    instagram_id: String(id),
    username: item.ownerUsername || username,
    caption: item.caption || '',
    post_url: item.url || (item.shortCode ? `https://www.instagram.com/reel/${item.shortCode}/` : ''),
    cover_url: item.displayUrl || '',
    posted_at: item.timestamp || null,
    views: Number(views) || 0,
    likes: Number(item.likesCount) || 0,
    comments: Number(item.commentsCount) || 0,
    duration_s: item.videoDuration != null ? Number(item.videoDuration) : null,
  };
}

const hoursSince = (iso: string | null, now: number): number => {
  if (!iso) return 24 * 30;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 24 * 30;
  return Math.max(0, (now - t) / 3_600_000);
};

/**
 * Calcula el score de cada post relativo a su propia cuenta.
 * Si followers no está disponible, el componente de penetración (25%) se
 * renormaliza sobre los 75 puntos restantes para no castigar el score.
 */
export function scorePosts(posts: NormalizedPost[], followers: number | null): ScoredPost[] {
  const now = Date.now();
  const withVph = posts.map((p) => ({
    ...p,
    views_per_hour: p.views / Math.max(0.1, hoursSince(p.posted_at, now)),
  }));

  const medianVph = median(withVph.map((p) => p.views_per_hour));
  const medianViews = median(withVph.map((p) => p.views).filter((v) => v > 0));
  const hasFollowers = followers != null && followers > 0;

  return withVph
    .map((p) => {
      const hours = hoursSince(p.posted_at, now);

      // 55% velocidad relativa: 3x la mediana de la cuenta = componente lleno
      const ratio = p.views_per_hour / Math.max(1, medianVph);
      const velocity = Math.min(100, (ratio / 3) * 100) * 0.55;

      // 25% penetración (log) — solo si conocemos followers
      let penetration = 0;
      if (hasFollowers) {
        const pen = p.views / Math.max(1, followers!);
        penetration = Math.min(100, (Math.log10(pen * 100 + 1) / Math.log10(101)) * 100) * 0.25;
      }

      // 20% frescura: decay exponencial, ~0 a las 12h
      const freshness = Math.exp(-0.384 * hours) * 100 * 0.2;

      let score = velocity + penetration + freshness;
      if (!hasFollowers) score = score * (100 / 75); // renormalizar sin penetración
      score = Math.min(100, Math.max(0, score));

      return {
        ...p,
        score: Math.round(score * 10) / 10,
        multiplier: medianViews > 0 ? Math.round((p.views / medianViews) * 10) / 10 : 0,
        account_median: medianViews,
        followers: hasFollowers ? followers! : null,
      };
    })
    .sort((a, b) => b.score - a.score);
}
