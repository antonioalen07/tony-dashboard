'use client';
import { useEffect, useRef, useState } from 'react';
import { prepareAudioFile } from '@/lib/crm-audio';
import styles from './AutomationAudioAttachment.module.css';

type Props = { value: string; onChange: (url: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean };

export default function AutomationAudioAttachment({ value, onChange, onBusyChange, disabled = false }: Props) {
    const [phase, setPhase] = useState<'preparing' | 'uploading' | null>(null);
    const [error, setError] = useState('');
    const [uploaded, setUploaded] = useState<{ name: string; url: string } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const request = useRef(0);
    const callbacks = useRef({ onChange, onBusyChange });
    useEffect(() => { callbacks.current = { onChange, onBusyChange }; }, [onChange, onBusyChange]);
    useEffect(() => () => { request.current++; controller.current?.abort(); callbacks.current.onBusyChange?.(false); }, []);

    async function upload(file: File) {
        const current = ++request.current;
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        setError(''); setPhase('preparing'); callbacks.current.onBusyChange?.(true);
        try {
            const prepared = await prepareAudioFile(file);
            if (request.current !== current || abort.signal.aborted) return;
            setPhase('uploading');
            const form = new FormData();
            form.set('file', prepared);
            const response = await fetch('/api/automations/inbox/audio', { method: 'POST', body: form, signal: abort.signal });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'No se pudo adjuntar el audio. Volvé a intentar.');
            if (typeof data.url !== 'string' || !data.url.startsWith('https://')) throw new Error('No se recibió el enlace del audio. Volvé a intentar.');
            if (request.current !== current || abort.signal.aborted) return;
            setUploaded({ name: file.name, url: data.url });
            callbacks.current.onChange(data.url);
        } catch (failure) {
            if (request.current === current && !abort.signal.aborted)
                setError(failure instanceof Error ? failure.message : 'No se pudo adjuntar el audio.');
        } finally {
            if (request.current === current) { setPhase(null); callbacks.current.onBusyChange?.(false); }
        }
    }

    const busy = phase !== null;
    return <div className={styles.attachment}>
        <label>Adjuntar archivo de audio
            <input type="file" accept=".mp3,.ogg,.m4a,.wav,.aac,audio/mpeg,audio/ogg,application/ogg,audio/mp4,audio/wav,audio/aac" disabled={disabled || busy} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
            }} />
        </label>
        <p className={styles.help}>MP3, OGG, M4A, WAV o AAC · hasta 4 MB. MP3 y OGG de hasta 2 minutos.</p>
        {busy && <p className={styles.help} role="status">{phase === 'preparing' ? 'Preparando audio…' : 'Adjuntando audio…'}</p>}
        {uploaded?.url === value && <p className={styles.filename}>{uploaded.name} · adjunto</p>}
        <label>O pegá una URL pública del audio
            <input type="url" value={value} maxLength={2048} required disabled={disabled || busy} onChange={(event) => { setError(''); onChange(event.target.value); }} placeholder="https://…" />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {value && <><audio controls src={value} preload="none" className={styles.player} /><button type="button" disabled={disabled || busy} onClick={() => { setUploaded(null); setError(''); onChange(''); }}>Quitar audio</button></>}
    </div>;
}
