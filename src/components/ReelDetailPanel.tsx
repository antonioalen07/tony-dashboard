import { useEffect, useRef, useState } from 'react';
import {
  X, ExternalLink, Sparkles, FileText, Download, Copy, Check, AlertCircle, Loader2,
  CalendarCheck, UserCheck,
} from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import { PRODUCTION_MIGRATION, isMissingSchema } from '@/lib/scripts-types';
import styles from './ReelDetailPanel.module.css';

/** Campo de carga manual: vacío = "todavía no lo medí"; 0 = "medido, no trajo nada". */
const parseCount = (raw: string): number | null => {
  const value = raw.trim();
  if (value === '') return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const asInput = (value: unknown): string => (value == null ? '' : String(value));

interface ReelDetailPanelProps {
  reel: any;
  onClose: () => void;
  medianViews?: number;
  /** Promedio de la cuenta de comentarios por cada 1.000 de alcance. */
  avgCommentRate?: number;
}

export default function ReelDetailPanel({ reel: initialReel, onClose, medianViews = 0, avgCommentRate = 0 }: ReelDetailPanelProps) {
  const { toast } = useToast();
  const [reel, setReel] = useState(initialReel);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Resultados de negocio: se cargan a mano, uno por uno, cuando se cierran las
  // consultas que trajo el video. Meta no los conoce; solo vos.
  const [bookings, setBookings] = useState(asInput(initialReel.bookings));
  const [leads, setLeads] = useState(asInput(initialReel.qualified_leads));
  const [bizState, setBizState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [bizMissing, setBizMissing] = useState(false);
  // Lo tipeado y lo ya guardado, para poder vaciar el pendiente al cerrar.
  const draft = useRef({ bookings: asInput(initialReel.bookings), leads: asInput(initialReel.qualified_leads) });
  const saved = useRef({ bookings: asInput(initialReel.bookings), leads: asInput(initialReel.qualified_leads) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveBusiness = async () => {
    const next = draft.current;
    if (next.bookings === saved.current.bookings && next.leads === saved.current.leads) return;

    const payload = {
      bookings: parseCount(next.bookings),
      qualified_leads: parseCount(next.leads),
    };

    setBizState('saving');
    const { error } = await supabase.from('reels').update(payload).eq('id', reel.id);

    if (error) {
      setBizState('error');
      if (isMissingSchema(error)) setBizMissing(true);
      else toast('No se pudieron guardar los resultados', 'error');
      return;
    }

    saved.current = { ...next };
    setBizMissing(false);
    setBizState('saved');
    setReel((prev: any) => ({ ...prev, ...payload }));
  };

  // Cerrar con Escape no dispara el blur de los inputs: se guarda igual.
  useEffect(() => {
    return () => {
      const next = draft.current;
      if (next.bookings === saved.current.bookings && next.leads === saved.current.leads) return;
      supabase
        .from('reels')
        .update({ bookings: parseCount(next.bookings), qualified_leads: parseCount(next.leads) })
        .eq('id', initialReel.id)
        .then(() => {});
    };
  }, [initialReel.id]);

  const refreshReel = async () => {
    const { data: updatedReel } = await supabase.from('reels').select('*').eq('id', reel.id).single();
    if (updatedReel) setReel(updatedReel);
  };

  const vsMedian =
    medianViews > 0 && reel.views > 0 ? Math.round((reel.views / medianViews) * 10) / 10 : null;

  // Tasa de conversación: comentarios por cada 1.000 de alcance. Normaliza el
  // conteo crudo, que por definición premia siempre al reel que más vistas tuvo.
  const commentBase = reel.reach || reel.views || 0;
  const commentRate = commentBase > 0 ? ((reel.comments || 0) * 1000) / commentBase : null;
  const vsAvgComments =
    commentRate != null && avgCommentRate > 0
      ? Math.round((commentRate / avgCommentRate) * 10) / 10
      : null;

  // Lectura del dato cargado a mano: cuánto rinde el alcance y cuánta de la
  // conversación terminó en una reunión.
  const bookingsCount = parseCount(bookings);
  const bookingRate =
    bookingsCount != null && commentBase > 0 ? (bookingsCount * 1000) / commentBase : null;
  const commentToBooking =
    bookingsCount != null && (reel.comments || 0) > 0 ? (bookingsCount * 100) / reel.comments : null;

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(reel.transcript || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('No se pudo copiar', 'error');
    }
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
        toast('Transcripción lista', 'success');
      } else {
        toast('Error transcribiendo: ' + data.error, 'error');
      }
    } catch (e) {
      toast('Error en llamada a red', 'error');
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
        toast('Análisis generado', 'success');
      } else {
        toast('Error analizando: ' + data.error, 'error');
      }
    } catch (e) {
      toast('Error en llamada a red', 'error');
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
              {vsMedian != null && (
                <span
                  className={styles.medianChip}
                  data-good={vsMedian >= 1}
                  title={`Mediana de tus reels: ${medianViews.toLocaleString('es')} vistas`}
                >
                  {vsMedian}x tu mediana de vistas
                </span>
              )}
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>VISTAS</span>
              <span className={styles.statValue}>{reel.views || 0}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>LIKES</span>
              <span className={styles.statValue}>{reel.likes || 0}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>COMENTARIOS</span>
              <span className={styles.statValue}>{reel.comments || 0}</span>
              {commentRate != null && (
                <span className={styles.statSub}>
                  {commentRate.toFixed(1)} por 1k de alcance
                  {vsAvgComments != null ? ` · ${vsAvgComments}x tu promedio` : ''}
                </span>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <CalendarCheck size={16} className="text-secondary" /> Resultados de negocio
            </h3>
            <p className={styles.bizHint}>
              Carga manual: cuando termines de atender las consultas que trajo este video, anotá
              cuántas agendas y cuántos leads calificados salieron de acá. Dejalo vacío mientras no
              lo hayas medido.
            </p>

            <div className={styles.bizGrid}>
              <label className={styles.bizField}>
                <span className={styles.bizLabel}><CalendarCheck size={13} /> Agendas</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className={styles.bizInput}
                  value={bookings}
                  placeholder="—"
                  onChange={(e) => {
                    setBookings(e.target.value);
                    draft.current = { ...draft.current, bookings: e.target.value };
                    setBizState('idle');
                  }}
                  onBlur={saveBusiness}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </label>

              <label className={styles.bizField}>
                <span className={styles.bizLabel}><UserCheck size={13} /> Leads calificados</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className={styles.bizInput}
                  value={leads}
                  placeholder="—"
                  onChange={(e) => {
                    setLeads(e.target.value);
                    draft.current = { ...draft.current, leads: e.target.value };
                    setBizState('idle');
                  }}
                  onBlur={saveBusiness}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </label>
            </div>

            <div className={styles.bizFoot}>
              <span className={styles.bizState} data-state={bizState}>
                {bizState === 'saving' && <><Loader2 size={12} className={styles.spin} /> Guardando…</>}
                {bizState === 'saved' && <><Check size={12} /> Guardado</>}
                {bizState === 'error' && !bizMissing && 'No se pudo guardar'}
                {bizState === 'idle' && 'Se guarda al salir del campo'}
              </span>
              {bookingsCount != null && bookingsCount > 0 && (
                <span className={styles.bizDerived}>
                  {bookingRate != null && `${bookingRate.toFixed(1)} agendas por 1k de alcance`}
                  {commentToBooking != null && ` · ${commentToBooking.toFixed(0)}% de los comentarios`}
                </span>
              )}
            </div>

            {bizMissing && (
              <p className={styles.bizMissing}>
                Falta correr <code>{PRODUCTION_MIGRATION}</code> en el SQL Editor de Supabase para que
                estas dos columnas existan. Hasta entonces no se guardan.
              </p>
            )}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className={styles.sectionTitle}>
                  <FileText size={16} className="text-secondary" /> Transcripción
                </h3>
                <button onClick={handleCopyTranscript} className={styles.editBtn} title="Copiar transcripción">
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiada' : 'Copiar'}
                </button>
              </div>
              <div className={styles.transcriptBox}>{reel.transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
