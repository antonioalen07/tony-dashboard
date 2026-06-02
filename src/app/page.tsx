'use client';

import { useState, useEffect } from 'react';
import MetricCard from '@/components/MetricCard';
import ReachChart from '@/components/ReachChart';
import AudienceChart from '@/components/AudienceChart';
import TopContentList from '@/components/TopContentList';
import { Users, Eye, Bookmark, TrendingUp, Film } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import styles from './page.module.css';

const FOLLOWER_GOAL = 50000;

export default function Dashboard() {
  const [reels, setReels] = useState<any[]>([]);
  const [followers, setFollowers] = useState<number | null>(null);

  useEffect(() => {
    const fetchReels = async () => {
      const { data } = await supabase.from('reels').select('*');
      if (data) setReels(data);
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

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const followerPct = followers ? Math.min((followers / FOLLOWER_GOAL) * 100, 100) : 0;
  const viewsPct = Math.min((totalViews / 1000000) * 100, 100);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting}, Antonio.</h1>
          <p className={styles.subtitle}>Resumen ejecutivo de Crevy Content</p>
        </div>
      </header>

      <div className={styles.metricsGrid}>
        <MetricCard title="Seguidores" value={followers != null ? formatNumber(followers) : 'N/A'} icon={<Users size={18} />} />
        <MetricCard title="Reach Total" value={formatNumber(totalReach)} icon={<Eye size={18} />} />
        <MetricCard title="Total Guardados" value={formatNumber(totalSaves)} icon={<Bookmark size={18} />} />
        <MetricCard title="Engagement Rate" value={avgER} icon={<TrendingUp size={18} />} />
        <MetricCard title="Reels Publicados" value={totalReels.toString()} icon={<Film size={18} />} />
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
