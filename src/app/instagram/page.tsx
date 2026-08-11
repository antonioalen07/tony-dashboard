'use client';

import { useMemo, useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import ReelGrid from '@/components/ReelGrid';
import ReelDetailPanel from '@/components/ReelDetailPanel';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import { median } from '@/lib/viral';
import styles from './page.module.css';

type SortMode = 'recent' | 'views' | 'er';

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'recent', label: 'Recientes' },
  { key: 'views', label: 'Más vistos' },
  { key: 'er', label: 'Mejor ER' },
];

export default function InstagramIntelligence() {
  const { toast } = useToast();
  const [selectedReel, setSelectedReel] = useState<any>(null);
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('recent');

  const fetchReels = async () => {
    const { data } = await supabase
      .from('reels')
      .select('*')
      .order('published_at', { ascending: false });
    if (data) setReels(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchReels();
  }, []);

  const sortedReels = useMemo(() => {
    const copy = [...reels];
    if (sort === 'views') copy.sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (sort === 'er') copy.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    return copy;
  }, [reels, sort]);

  const medianViews = useMemo(
    () => median(reels.map((r) => r.views || 0).filter((v: number) => v > 0)),
    [reels]
  );

  // Enriquecimiento automático: transcribe + analiza los reels que aún no lo estén.
  const enrichReel = async (id: string, needTranscript: boolean) => {
    if (needTranscript) {
      await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    }
    await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const handleSync = async () => {
    setSyncing(true);
    setStatus('Sincronizando métricas desde Meta…');
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) {
        setStatus(null);
        toast('Error en la sincronización: ' + data.error, 'error');
        setSyncing(false);
        return;
      }

      const { data: fresh } = await supabase
        .from('reels')
        .select('*')
        .order('published_at', { ascending: false });
      const all = fresh || [];
      setReels(all);

      const pending = all.filter(
        (r) => (r.instagram_id || '').length < 19 && (!r.ai_analysis || r.ai_analysis.length === 0 || !r.transcript)
      );

      for (let i = 0; i < pending.length; i++) {
        const r = pending[i];
        setStatus(`Procesando ${i + 1}/${pending.length}: transcripción + análisis IA…`);
        await enrichReel(r.id, !r.transcript);
      }

      await fetchReels();
      setStatus(null);
      toast(`Sincronización lista: ${data.syncedCount} reels, ${pending.length} enriquecidos`, 'success');
    } catch (e) {
      setStatus(null);
      toast('Error en la llamada de red', 'error');
    }
    setSyncing(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard Content</h1>
          <p className={styles.subtitle}>Análisis profundo de tus Reels</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className={styles.syncBtn}>
          <RefreshCw size={16} className={syncing ? styles.spin : ''} />
          {syncing ? 'Sincronizando…' : 'Sincronizar Reels'}
        </button>
      </header>

      <div className={styles.filters}>
        <div className={styles.filterLeft}>
          <span className={styles.filterText}>Todos los reels ({reels.length})</span>
          <div className={styles.sortGroup} role="group" aria-label="Ordenar reels">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`${styles.sortBtn} ${sort === s.key ? styles.sortActive : ''}`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {status && <span className={styles.statusText}>{status}</span>}
      </div>

      <div className={styles.gridContainer}>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Cargando reels desde Supabase…</p>
        ) : (
          <ReelGrid reels={sortedReels} onSelectReel={setSelectedReel} />
        )}
      </div>

      {selectedReel && (
        <ReelDetailPanel
          reel={selectedReel}
          medianViews={medianViews}
          onClose={() => {
            setSelectedReel(null);
            fetchReels();
          }}
        />
      )}
    </div>
  );
}
