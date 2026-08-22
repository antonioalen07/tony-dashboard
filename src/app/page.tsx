'use client';

import { useState, useEffect } from 'react';
import MetricCard from '@/components/MetricCard';
import ReachChart from '@/components/ReachChart';
import AudienceChart from '@/components/AudienceChart';
import TopContentList from '@/components/TopContentList';
import { Users, Eye, Bookmark, TrendingUp, Film, MessageCircle } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import styles from './page.module.css';

const FOLLOWER_GOAL = 50000;

/** Delta % de una métrica agregada por mes (mes actual vs anterior). */
function monthlyDelta(reels: any[], metric: (r: any) => number): { trend: 'up' | 'down'; label: string } | null {
  const now = new Date();
  const keyOf = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const curKey = keyOf(now);
  let cur = 0;
  let prev = 0;
  for (const r of reels) {
    if (!r.published_at) continue;
    const k = keyOf(new Date(r.published_at));
    if (k === curKey) cur += metric(r) || 0;
    else if (k === curKey - 1) prev += metric(r) || 0;
  }
  // Sin datos del mes actual (o sin mes anterior) no hay señal: no mostrar delta.
  if (prev <= 0 || cur <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (!Number.isFinite(pct)) return null;
  return { trend: pct >= 0 ? 'up' : 'down', label: `${pct >= 0 ? '+' : ''}${pct}%` };
}

export default function Dashboard() {
  const [reels, setReels] = useState<any[]>([]);
  const [followers, setFollowers] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReels = async () => {
      const { data } = await supabase.from('reels').select('*');
      if (data) setReels(data);
      setLoading(false);
    };

    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/profile');
        const data = await res.json();
        setFollowers(typeof data.followers === 'number' ? data.followers : null);
      } catch {
        setFollowers(null);
      }
    };

    fetchReels();
    fetchProfile();
  }, []);

  // Métricas
  const totalReels = reels.length;
  const totalViews = reels.reduce((sum, r) => sum + (r.views || 0), 0);
  const totalSaves = reels.reduce((sum, r) => sum + (r.saves || 0), 0);
  // "Conversaciones": los comentarios son el único engagement que abre un ida y
  // vuelta, así que se miran aparte de likes/guardados.
  const totalComments = reels.reduce((sum, r) => sum + (r.comments || 0), 0);
  const totalReach = reels.reduce((sum, r) => sum + (r.reach || r.views || 0), 0);

  const reelsWithER = reels.filter((r) => r.engagement_rate);
  const avgER =
    reelsWithER.length > 0
      ? (reelsWithER.reduce((sum, r) => sum + r.engagement_rate, 0) / reelsWithER.length).toFixed(1) + '%'
      : 'N/A';

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
  };

  // Deltas mes actual vs mes pasado (solo si hay datos de ambos meses)
  const reachDelta = monthlyDelta(reels, (r) => r.reach || r.views || 0);
  const savesDelta = monthlyDelta(reels, (r) => r.saves || 0);
  const reelsDelta = monthlyDelta(reels, () => 1);
  const commentsDelta = monthlyDelta(reels, (r) => r.comments || 0);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const followerPct = followers ? Math.min((followers / FOLLOWER_GOAL) * 100, 100) : 0;
  const viewsPct = Math.min((totalViews / 1000000) * 100, 100);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting}, Antonio.</h1>
          <p className={styles.subtitle}>Resumen ejecutivo de Dashboard Content</p>
        </div>
      </header>

      <div className={styles.metricsGrid}>
        <MetricCard
          title="Seguidores"
          value={followers != null ? formatNumber(followers) : 'N/A'}
          icon={<Users size={18} />}
          loading={loading && followers == null}
        />
        <MetricCard
          title="Reach Total"
          value={formatNumber(totalReach)}
          icon={<Eye size={18} />}
          loading={loading}
          {...(reachDelta ? { trend: reachDelta.trend, trendValue: reachDelta.label } : {})}
        />
        <MetricCard
          title="Total Guardados"
          value={formatNumber(totalSaves)}
          icon={<Bookmark size={18} />}
          loading={loading}
          {...(savesDelta ? { trend: savesDelta.trend, trendValue: savesDelta.label } : {})}
        />
        <MetricCard
          title="Conversaciones"
          value={formatNumber(totalComments)}
          icon={<MessageCircle size={18} />}
          loading={loading}
          {...(commentsDelta ? { trend: commentsDelta.trend, trendValue: commentsDelta.label } : {})}
        />
        <MetricCard title="Engagement Rate" value={avgER} icon={<TrendingUp size={18} />} loading={loading} />
        <MetricCard
          title="Reels Publicados"
          value={totalReels.toString()}
          icon={<Film size={18} />}
          loading={loading}
          {...(reelsDelta ? { trend: reelsDelta.trend, trendValue: reelsDelta.label } : {})}
        />
      </div>

      <div className={styles.chartsRow}>
        <div className={styles.reachChartWrapper}>
          <ReachChart reels={reels} />
        </div>
        <div className={styles.goalsWrapper}>
          <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h3 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Objetivos Del Mes
            </h3>

            <div className={styles.goal}>
              <div className={styles.goalHeader}>
                <span>Seguidores Instagram</span>
                <span className="text-secondary">
                  {followers != null ? formatNumber(followers) : '--'} / {formatNumber(FOLLOWER_GOAL)}
                </span>
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${followerPct}%` }} />
              </div>
              <div className={styles.goalFooter}>
                <span>{followerPct.toFixed(0)}% del objetivo</span>
                {followers != null && <span className="text-secondary">Faltan {formatNumber(Math.max(FOLLOWER_GOAL - followers, 0))}</span>}
              </div>
            </div>

            <div className={styles.goal}>
              <div className={styles.goalHeader}>
                <span>Views Orgánicas (total)</span>
                <span className="text-secondary">{formatNumber(totalViews)} / 1.0M</span>
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${viewsPct}%` }} />
              </div>
              <div className={styles.goalFooter}>
                <span>{viewsPct.toFixed(0)}% del objetivo</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.bottomRow}>
        <div className={styles.topContentWrapper}>
          <TopContentList />
        </div>
        <div className={styles.audienceWrapper}>
          <AudienceChart />
        </div>
      </div>
    </div>
  );
}
