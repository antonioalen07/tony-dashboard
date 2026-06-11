'use client';

import { useEffect, useState } from 'react';
import { X, Sparkles, Copy, Check, Loader2, FileText } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { loadWork, saveWork } from '@/lib/workSession';
import type { BangerVideo } from '@/app/inspiracion/page';
import styles from './AdaptPanel.module.css';

interface Adaptation {
  por_que_viralizo?: string;
  aplicabilidad?: string;
  etapa_funnel?: string;
  gancho_visual?: string;
  hook?: string;
  angulo?: string;
  formato?: string;
  guion?: string;
}

interface AdaptPanelProps {
  video: BangerVideo;
  onClose: () => void;
  onSaved: () => void;
}

export default function AdaptPanel({ video, onClose, onSaved }: AdaptPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('');
  const [adaptation, setAdaptation] = useState<Adaptation | null>(video.adaptation || null);
  const [transcript, setTranscript] = useState<string>(video.transcript || '');
  const [copied, setCopied] = useState<string | null>(null);

  // Caché de sesión: si ya se generó el guion de este video (aunque sea efímero
  // y hayas navegado a otra sección), se recupera sin volver a gastar APIs.
  useEffect(() => {
    if (adaptation) return;
    const cached = loadWork<{ adaptation: Adaptation | null; transcript: string }>(
      `adapt:${video.instagram_id}`,
      { adaptation: null, transcript: '' }
    );
    if (cached.adaptation) {
      setAdaptation(cached.adaptation);
      if (cached.transcript && !transcript) setTranscript(cached.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.instagram_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const generate = async () => {
    setLoading(true);
    setStep(transcript ? 'Escribiendo tu guion…' : 'Transcribiendo el video (~1 min)…');
    try {
      const body = video.id ? { id: video.id } : { video };
      const timer = setTimeout(() => setStep('Escribiendo tu guion con tu voz y tu kit de marca…'), 60_000);
      const res = await fetch('/api/inspiration/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'No se pudo generar la adaptación');
      setAdaptation(json.adaptation);
      if (json.transcript) setTranscript(json.transcript);
      // Cachear en la sesión de trabajo para no regenerar al navegar entre secciones
      saveWork(`adapt:${video.instagram_id}`, { adaptation: json.adaptation, transcript: json.transcript || '' });
      if (video.id) onSaved();
      toast('Guion listo 🔥', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    }
    setLoading(false);
    setStep('');
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast('No se pudo copiar', 'error');
    }
  };

  const Section = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h4>{label}</h4>
          <button className={styles.copyBtn} onClick={() => copy(label, value)} aria-label={`Copiar ${label}`}>
            {copied === label ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <p className={styles.sectionText}>{value}</p>
      </div>
    ) : null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar panel">
          <X size={18} />
        </button>

        <div className={styles.content}>
          <header className={styles.header}>
            <h2 className={styles.title}><Sparkles size={18} /> Adaptar a tu marca</h2>
            <p className={styles.meta}>
              Viral de <strong>@{video.username}</strong> · score {Math.round(video.score)}
              {video.multiplier > 0 && <> · {video.multiplier}x su mediana</>}
            </p>
          </header>

          {!adaptation && (
            <div className={styles.starter}>
              <p>
                Se transcribe el video original y se genera un guion nuevo con tu voz, tus pilares
                y tu estructura ganadora (hook → desarrollo → CTA).
              </p>
              <button className={styles.generateBtn} onClick={generate} disabled={loading}>
                {loading ? <Loader2 size={15} className={styles.spin} /> : <Sparkles size={15} />}
                {loading ? step || 'Generando…' : 'Generar mi guion'}
              </button>
              {loading && <p className={styles.stepNote}>Esto consume créditos de Apify, ElevenLabs e IA (solo este video).</p>}
            </div>
          )}

          {adaptation && (
            <>
              <Section label="Por qué viralizó" value={adaptation.por_que_viralizo} />
              {(adaptation.aplicabilidad || adaptation.etapa_funnel) && (
                <div className={styles.applicability} data-level={adaptation.aplicabilidad}>
                  {adaptation.etapa_funnel && (
                    <>Etapa: <strong>{adaptation.etapa_funnel}</strong>{adaptation.aplicabilidad && ' · '}</>
                  )}
                  {adaptation.aplicabilidad && (
                    <>Aplicabilidad a tu marca: <strong>{adaptation.aplicabilidad}</strong></>
                  )}
                </div>
              )}
              <Section label="Gancho visual" value={adaptation.gancho_visual} />
              <Section label="Hook" value={adaptation.hook} />
              <Section label="Ángulo" value={adaptation.angulo} />
              <Section label="Formato" value={adaptation.formato} />

              {adaptation.guion && (
                <div className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h4>Guion completo</h4>
                    <button className={styles.copyBtn} onClick={() => copy('guion', adaptation.guion!)}>
                      {copied === 'guion' ? <Check size={13} /> : <Copy size={13} />}
                      {copied === 'guion' ? 'Copiado' : 'Copiar guion'}
                    </button>
                  </div>
                  <div className={styles.script}>{adaptation.guion}</div>
                </div>
              )}

              <button className={styles.regenBtn} onClick={generate} disabled={loading}>
                {loading ? <Loader2 size={14} className={styles.spin} /> : <Sparkles size={14} />}
                {loading ? step || 'Regenerando…' : 'Regenerar'}
              </button>
            </>
          )}

          {transcript && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h4><FileText size={13} style={{ verticalAlign: '-2px' }} /> Transcripción del original</h4>
                <button className={styles.copyBtn} onClick={() => copy('transcript', transcript)} aria-label="Copiar transcripción">
                  {copied === 'transcript' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              <div className={styles.transcript}>{transcript}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
