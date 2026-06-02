import { useState } from 'react';
import { X, ExternalLink, Sparkles, FileText, Download, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import styles from './ReelDetailPanel.module.css';

interface ReelDetailPanelProps {
  reel: any;
  onClose: () => void;
}

export default function ReelDetailPanel({ reel: initialReel, onClose }: ReelDetailPanelProps) {
  const [reel, setReel] = useState(initialReel);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const refreshReel = async () => {
    const { data: updatedReel } = await supabase.from('reels').select('*').eq('id', reel.id).single();
    if (updatedReel) setReel(updatedReel);
  };

  const handleTranscribe = async () => {
    setIsTranscribing(true);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reel.id }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshReel();
      } else {
        alert('Error transcribiendo: ' + data.error);
      }
    } catch (e) {
      alert('Error en llamada a red');
    }
    setIsTranscribing(false);
  };

  const handleDownloadTranscript = () => {
    if (!reel.transcript) return;
    const blob = new Blob([reel.transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-${reel.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reel.id })
      });
      const data = await res.json();
      if (data.success) {
        await refreshReel();
      } else {
        alert('Error analizando: ' + data.error);
      }
    } catch (e) {
      alert('Error en llamada a red');
    }
    setIsAnalyzing(false);
  };

  if (!reel) return null;

  return (
    <div className={styles.panelOverlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={20} />
        </button>

        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.thumbnailWrapper}>
              <img src={reel.cover_url ? `https://wsrv.nl/?url=${encodeURIComponent(reel.cover_url)}` : ''} alt="" className={styles.thumbnail} referrerPolicy="no-referrer" />
            </div>
            <div className={styles.headerInfo}>
              <h2 className={styles.title}>{reel.title || 'Sin título'}</h2>
              <span className={styles.date}>{new Date(reel.published_at).toLocaleDateString()}</span>
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>VIEWS</span>
              <span className={styles.statValue}>{reel.views || 0}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>LIKES</span>
              <span className={styles.statValue}>{reel.likes || 0}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>COMMENTS</span>
              <span className={styles.statValue}>{reel.comments || 0}</span>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Métricas Privadas (Meta API Oficial)</h3>
            <div className={styles.privateGrid}>
              <div className={styles.inputGroup}>
                <label>REACH</label>
                <span>{reel.reach || 'N/A'}</span>
              </div>
              <div className={styles.inputGroup}>
                <label>SAVES</label>
                <span>{reel.saves || 'N/A'}</span>
              </div>
              <div className={styles.inputGroup}>
                <label>SHARES</label>
                <span>{reel.shares || 'N/A'}</span>
              </div>
              <div className={styles.inputGroup}>
                <label>ER %</label>
                <span>{reel.engagement_rate ? reel.engagement_rate + '%' : 'N/A'}</span>
              </div>
            </div>
          </div>

          {reel.video_url && (
             <a href={reel.video_url} target="_blank" rel="noreferrer" className={styles.externalLink}>
               <ExternalLink size={16} /> Ver en Instagram
             </a>
          )}

          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className={styles.sectionTitle} style={{ marginBottom: 0 }}>
                <Sparkles size={16} className="text-secondary" /> Análisis IA
              </h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleTranscribe}
                  disabled={isTranscribing}
                  className={styles.editBtn}
                  title="Transcribir el audio del reel (Apify + ElevenLabs)"
                >
                  {isTranscribing ? <Loader2 size={14} className={styles.spin} /> : <FileText size={14} />}
                  {reel.transcript ? 'Re-transcribir' : 'Transcribir'}
                </button>
                {reel.transcript && (
                  <button
                    onClick={handleDownloadTranscript}
                    className={styles.editBtn}
                    title="Descargar Transcripción (.txt)"
                  >
                    <Download size={14} /> Descargar
                  </button>
                )}
                <button onClick={handleAnalyze} disabled={isAnalyzing} className={styles.editBtn}>
                  {isAnalyzing ? <Loader2 size={14} className={styles.spin} /> : <Sparkles size={14} />}
                  {reel.ai_analysis && reel.ai_analysis.length > 0 ? 'Regenerar' : 'Generar'}
                </button>
              </div>
            </div>

            {reel.ai_analysis && reel.ai_analysis.length > 0 ? (
              <div className={styles.aiList}>
                {reel.ai_analysis.map((point: string, idx: number) => (
                  <div key={idx} className={styles.aiItem}>
                    <div className={styles.aiNumber}>{idx + 1}</div>
                    <p>{point}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyState}>No hay análisis generado para este video.</p>
            )}
          </div>

          {reel.improvement && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <AlertCircle size={16} className="text-secondary" /> Puntos de Mejora
              </h3>
              <div className={styles.improvementBox}>
                <p>{reel.improvement}</p>
              </div>
            </div>
          )}

          {reel.transcript && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <FileText size={16} className="text-secondary" /> Transcripción
              </h3>
              <div className={styles.transcriptBox}>{reel.transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
