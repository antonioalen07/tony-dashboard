'use client';

import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import ReelGrid from '@/components/ReelGrid';
import ReelDetailPanel from '@/components/ReelDetailPanel';
import { supabase } from '@/utils/supabase';
import styles from './page.module.css';

export default function InstagramIntelligence() {
  const [selectedReel, setSelectedReel] = useState<any>(null);
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
        alert('Error en la sincronización: ' + data.error);
        setSyncing(false);
        return;
      }

      // Traer el estado actual y detectar pendientes de enriquecer.
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
      setStatus(`Listo. ${data.syncedCount} reels sincronizados, ${pending.length} enriquecidos.`);
      setTimeout(() => setStatus(null), 6000);
    } catch (e) {
      setStatus(null);
      alert('Error en la llamada de red');
    }
    setSyncing(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Crevy Content</h1>
          <p className={styles.subtitle}>Análisis profundo de tus Reels</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className={styles.syncBtn}>
          <RefreshCw size={16} className={syncing ? styles.spin : ''} />
          {syncing ? 'Sincronizando…' : 'Sincronizar Reels'}
        </button>
      </header>

      <div className={styles.filters}>
        <span className={styles.filterText}>Todos los reels ({reels.length})</span>
        {status && <span className={styles.statusText}>{status}</span>}
      </div>

      <div className={styles.gridContainer}>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Cargando reels desde Supabase…</p>
        ) : (
          <ReelGrid reels={reels} onSelectReel={setSelectedReel} />
        )}
      </div>

      {selectedReel && (
        <ReelDetailPanel
          reel={selectedReel}
          onClose={() => {
            setSelectedReel(null);
            fetchReels();
          }}
        />
      )}
    </div>
  );
}
