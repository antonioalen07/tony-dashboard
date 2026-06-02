import styles from './ReelGrid.module.css';

interface ReelGridProps {
  reels: any[];
  onSelectReel: (reel: any) => void;
}

export default function ReelGrid({ reels, onSelectReel }: ReelGridProps) {
  if (reels.length === 0) {
    return <div style={{ color: 'var(--text-secondary)' }}>No hay reels sincronizados.</div>;
  }

  return (
    <div className={styles.grid}>
      {reels.map((reel) => (
        <div key={reel.id} className={styles.card} onClick={() => onSelectReel(reel)}>
          <img src={reel.cover_url ? `https://wsrv.nl/?url=${encodeURIComponent(reel.cover_url)}` : ''} alt={reel.title} className={styles.cover} referrerPolicy="no-referrer" />
          <div className={styles.overlay}>
            <h4 className={styles.title}>{reel.title}</h4>
            <div className={styles.stats}>
              <span>{reel.views} vistas</span>
              {reel.retention && <span className={styles.retention}>{reel.retention} ret</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
