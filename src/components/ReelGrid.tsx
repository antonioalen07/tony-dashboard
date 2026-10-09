import { FileText, Sparkles, MessageCircle, CalendarCheck, EyeOff, Copy, FileX2 } from 'lucide-react';
import { coverSrc } from '@/lib/covers';
import type { ReelCuration } from '@/lib/reel-curation';
import styles from './ReelGrid.module.css';

export interface InstagramReel extends ReelCuration {
  id: string;
  instagram_id?: string | null;
  title?: string | null;
  cover_url?: string | null;
  video_url?: string | null;
  published_at?: string | null;
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
  engagement_rate?: number | null;
  bookings?: number | null;
  qualified_leads?: number | null;
  transcript?: string | null;
  ai_analysis?: string[] | null;
  improvement?: string | null;
}

interface ReelGridProps {
  reels: InstagramReel[];
  onSelectReel: (reel: InstagramReel) => void;
}

const fmt = (n: number) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
};

export default function ReelGrid({ reels, onSelectReel }: ReelGridProps) {
  if (reels.length === 0) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
        No hay reels sincronizados todavía. Tocá <strong>Sincronizar Reels</strong> para traerlos
        desde tu cuenta: se transcriben y analizan solos.
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {reels.map((reel) => {
        const hasTranscript = Boolean(reel.transcript && String(reel.transcript).trim());
        const hasAnalysis = Boolean(reel.ai_analysis && reel.ai_analysis.length);
        // Agendas cargadas a mano: el dato que dice si el video vendió algo.
        const bookings = typeof reel.bookings === 'number' ? reel.bookings : null;
        return (
          <button key={reel.id} type="button" className={styles.card} onClick={() => onSelectReel(reel)} aria-label={`Abrir reel: ${(reel.title || 'Sin título').split('\n')[0].slice(0, 100)}`}>
            <img
              src={coverSrc(reel.cover_url)}
              alt=""
              className={styles.cover}
              referrerPolicy="no-referrer"
              loading="lazy"
              // Portada caída: queda la tarjeta neutra, no el ícono de imagen rota.
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
            <span className={styles.badges}>
              {reel.is_hidden && <span className={styles.badge} title="Oculto en el panel"><EyeOff size={11} /><span className={styles.srOnly}>Oculto</span></span>}
              {reel.is_duplicate && <span className={styles.badge} title="Repetido · excluido de IA"><Copy size={11} /><span className={styles.srOnly}>Repetido</span></span>}
              {reel.transcript_suppressed && <span className={styles.badge} title="Transcripción desactivada"><FileX2 size={11} /><span className={styles.srOnly}>Transcripción desactivada</span></span>}
              {hasTranscript && (
                <span className={styles.badge} title="Transcripción lista">
                  <FileText size={11} />
                </span>
              )}
              {hasAnalysis && (
                <span className={`${styles.badge} ${styles.badgeAccent}`} title="Análisis IA listo">
                  <Sparkles size={11} />
                </span>
              )}
            </span>
            <span className={styles.overlay}>
              <span className={styles.title}>{reel.title || 'Sin título'}</span>
              <span className={styles.stats}>
                <span>{fmt(reel.views || 0)} vistas</span>
                <span className={styles.comments} title={`${reel.comments || 0} comentarios`}>
                  <MessageCircle size={11} /> {fmt(reel.comments || 0)}
                </span>
                {bookings != null && bookings > 0 && (
                  <span
                    className={styles.bookings}
                    title={`${bookings} agenda${bookings === 1 ? '' : 's'}${
                      typeof reel.qualified_leads === 'number'
                        ? ` · ${reel.qualified_leads} leads calificados`
                        : ''
                    }`}
                  >
                    <CalendarCheck size={11} /> {bookings}
                  </span>
                )}
                {reel.engagement_rate != null && (
                  <span className={styles.retention}>{reel.engagement_rate}% ER</span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
