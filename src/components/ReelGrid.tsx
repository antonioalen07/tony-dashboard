import { FileText, Sparkles, MessageCircle } from 'lucide-react';
import { coverSrc } from '@/lib/covers';
import styles from './ReelGrid.module.css';

interface ReelGridProps {
  reels: any[];
  onSelectReel: (reel: any) => void;
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
        return (
          <div key={reel.id} className={styles.card} onClick={() => onSelectReel(reel)}>
            <img
              src={coverSrc(reel.cover_url)}
              alt=""
              className={styles.cover}
              referrerPolicy="no-referrer"
              loading="lazy"
              // Portada caída: queda la tarjeta neutra, no el ícono de imagen rota.
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
            <div className={styles.badges}>
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
            </div>
            <div className={styles.overlay}>
              <h4 className={styles.title}>{reel.title}</h4>
              <div className={styles.stats}>
                <span>{fmt(reel.views || 0)} vistas</span>
                <span className={styles.comments} title={`${reel.comments || 0} comentarios`}>
                  <MessageCircle size={11} /> {fmt(reel.comments || 0)}
                </span>
                {reel.engagement_rate != null && (
                  <span className={styles.retention}>{reel.engagement_rate}% ER</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
