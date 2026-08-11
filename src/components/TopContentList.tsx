'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { Eye, Bookmark } from 'lucide-react';
import { coverSrc } from '@/lib/covers';
import styles from './TopContentList.module.css';

const formatNumber = (num: number) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
};

export default function TopContentList() {
  const [topReels, setTopReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTopReels = async () => {
      const { data } = await supabase
        .from('reels')
        .select('*')
        .order('views', { ascending: false })
        .limit(4);
      if (data) setTopReels(data);
      setLoading(false);
    };
    fetchTopReels();
  }, []);

  return (
    <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.heading}>Top Contenidos</h3>
          <p className={styles.sub}>Reels con mayor alcance e interacción</p>
        </div>
        <a href="/instagram" className={styles.viewAll}>Ver todo →</a>
      </div>

      {loading ? (
        <div className={styles.list}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${styles.listItem} ${styles.skeleton}`}>
              <span className={styles.rank}>{i + 1}</span>
              <div className={styles.thumbSkeleton} />
              <div style={{ flex: 1 }}>
                <div className={styles.lineSkeleton} style={{ width: '70%' }} />
                <div className={styles.lineSkeleton} style={{ width: '40%', marginTop: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : topReels.length === 0 ? (
        <div className={styles.empty}>
          Aún no hay reels. Ve a <a href="/instagram" className={styles.viewAll}>Instagram</a> y sincroniza.
        </div>
      ) : (
        <div className={styles.list}>
          {topReels.map((reel, idx) => (
            <a key={reel.id} href="/instagram" className={styles.listItem}>
              <span className={styles.rank}>{idx + 1}</span>
              <img
                src={coverSrc(reel.cover_url, 120)}
                alt=""
                className={styles.thumbnail}
                referrerPolicy="no-referrer"
                loading="lazy"
                // Portada caída: dejamos el recuadro neutro en vez del ícono roto.
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
              <div className={styles.info}>
                <span className={styles.title}>{(reel.title || 'Reel sin título').split('\n')[0]}</span>
                <div className={styles.metrics}>
                  <span className={styles.metric}><Eye size={13} /> {formatNumber(reel.views || reel.reach || 0)}</span>
                  <span className={styles.metric}><Bookmark size={13} /> {formatNumber(reel.saves || 0)}</span>
                </div>
              </div>
              {reel.engagement_rate != null && (
                <span className={styles.erBadge}>{reel.engagement_rate}%</span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
