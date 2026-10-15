'use client';
/* La vista previa usa la URL pública del Storage, como el resto del CRM. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { prepareImageFile, uploadImageFile } from '@/lib/crm-image';
import styles from './AutomationImageAttachment.module.css';

type Props = { value: string; onChange: (url: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean };

/** Imagen de un paso de seguimiento: se sube apenas se elige, como el audio. */
export default function AutomationImageAttachment({ value, onChange, onBusyChange, disabled = false }: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const callbacks = useRef({ onChange, onBusyChange });
    useEffect(() => { callbacks.current = { onChange, onBusyChange }; }, [onChange, onBusyChange]);
    useEffect(() => () => { controller.current?.abort(); callbacks.current.onBusyChange?.(false); }, []);

    async function upload(file: File) {
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        setError(''); setBusy(true); callbacks.current.onBusyChange?.(true);
        try {
            const url = await uploadImageFile(await prepareImageFile(file), abort.signal);
            if (!abort.signal.aborted) callbacks.current.onChange(url);
        } catch (failure) {
            if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo adjuntar la imagen.');
        } finally {
            if (controller.current === abort) { setBusy(false); callbacks.current.onBusyChange?.(false); }
        }
    }

    return <div className={styles.attachment}>
        {value ? <div className={styles.preview}>
            <img src={value} alt="Imagen del paso" />
            <button type="button" className={styles.remove} disabled={disabled || busy} onClick={() => { setError(''); onChange(''); }} aria-label="Quitar imagen"><X size={15} /></button>
        </div> : <label className={`${styles.drop} ${disabled || busy ? styles.disabled : ''}`}>
            <ImagePlus size={20} />
            <span>{busy ? 'Subiendo imagen…' : 'Elegir imagen'}</span>
            <small>JPG, PNG, GIF o WEBP · se ajusta sola al tamaño de Instagram</small>
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic" disabled={disabled || busy} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
            }} />
        </label>}
        {value && <p className={styles.help}>Instagram la manda sola, sin texto. Si querés acompañarla, agregá un paso de texto con demora 0.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
    </div>;
}
