'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import KeywordChips from './KeywordChips';
import styles from './StoryAutomationEditor.module.css';

export type StoryRule = {
    id: string;
    name: string;
    active: boolean;
    keywords: string[];
    match_mode: 'contains' | 'exact';
    fuzzy: boolean;
    dm_text: string;
    dm_audio_url: string | null;
    tag_ids: string[];
    once_per_user: boolean;
    starts_at: string;
    created_at: string;
    updated_at: string;
    stats?: Record<string, number>;
};

type Props = {
    onSaved: () => void;
    onCancel: () => void;
    tags: { id: string; name: string }[];
    rule?: StoryRule;
};

function emptyRule(): StoryRule {
    return { id: '', name: 'Respuesta a historias', active: true, keywords: [], match_mode: 'contains', fuzzy: true, dm_text: '', dm_audio_url: null, tag_ids: [], once_per_user: true, starts_at: new Date().toISOString(), created_at: '', updated_at: '' };
}

function audioUrl(value: string) {
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && Boolean(parsed.hostname);
    } catch { return false; }
}

export default function StoryAutomationEditor({ onSaved, onCancel, tags, rule }: Props) {
    const id = useId();
    const [draft, setDraft] = useState<StoryRule>(() => rule ? { ...rule, keywords: [...rule.keywords], tag_ids: [...rule.tag_ids] } : emptyRule());
    const [kind, setKind] = useState<'text' | 'audio'>(() => rule?.dm_audio_url ? 'audio' : 'text');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const text = draft.dm_text.trim();
        const audio = (draft.dm_audio_url || '').trim();
        if (!draft.name.trim() || draft.name.trim().length > 120) { setError('Completá un nombre de hasta 120 caracteres.'); return; }
        if (kind === 'text' && (!text || text.length > 1000)) { setError('Escribí un mensaje de entre 1 y 1000 caracteres.'); return; }
        if (kind === 'audio' && (!audioUrl(audio) || audio.length > 2048)) { setError('Usá una URL pública http(s) para el audio, sin credenciales.'); return; }
        setBusy(true);
        setError('');
        try {
            const response = await fetch(`/api/automations/stories${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, {
                method: draft.id ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: draft.name.trim(), active: draft.active, keywords: draft.keywords, match_mode: draft.match_mode, fuzzy: draft.fuzzy, dm_text: kind === 'text' ? text : '', dm_audio_url: kind === 'audio' ? audio : null, tag_ids: draft.tag_ids, once_per_user: draft.once_per_user, starts_at: draft.starts_at }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'No se pudo guardar la automatización. Intentá de nuevo.');
            onSaved();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'No se pudo guardar la automatización.');
        } finally { setBusy(false); }
    }

    return <form className={styles.form} onSubmit={save} aria-busy={busy}>
        <p className={styles.intro}>Respondé por DM cuando alguien conteste una de tus historias de Instagram.</p>
        <fieldset className={styles.fields} disabled={busy}>
            <label className={styles.label} htmlFor={`${id}-name`}>Nombre de la automatización
                <input id={`${id}-name`} className={styles.input} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={120} required />
            </label>
            <KeywordChips value={draft.keywords} onChange={(keywords) => setDraft((current) => ({ ...current, keywords }))} label="Palabras en la respuesta a la historia" />
            <p className={styles.hint}>{draft.keywords.length ? 'Se activa cuando la respuesta coincide con alguna de estas palabras o frases.' : 'Sin palabras clave, se activa con cualquier respuesta a tus historias.'}</p>
            {draft.keywords.length > 0 && <div className={styles.match}>
                <label className={styles.label} htmlFor={`${id}-match`}>Coincidencia
                    <select id={`${id}-match`} className={styles.input} value={draft.match_mode} onChange={(event) => setDraft({ ...draft, match_mode: event.target.value as StoryRule['match_mode'] })}>
                        <option value="contains">La respuesta contiene la palabra</option>
                        <option value="exact">La respuesta es exactamente la palabra</option>
                    </select>
                </label>
                <label className={styles.check}><input type="checkbox" checked={draft.fuzzy} onChange={(event) => setDraft({ ...draft, fuzzy: event.target.checked })} /> Tolerar errores de escritura</label>
            </div>}
            <section className={styles.section} aria-labelledby={`${id}-message-heading`}>
                <h3 id={`${id}-message-heading`}>Mensaje automático</h3>
                <label className={styles.label} htmlFor={`${id}-kind`}>Tipo de mensaje
                    <select id={`${id}-kind`} className={styles.input} value={kind} onChange={(event) => setKind(event.target.value as 'text' | 'audio')}><option value="text">Texto</option><option value="audio">Audio</option></select>
                </label>
                {kind === 'text' ? <label className={styles.label} htmlFor={`${id}-text`}>Texto del DM
                    <textarea id={`${id}-text`} className={styles.textarea} value={draft.dm_text} onChange={(event) => setDraft({ ...draft, dm_text: event.target.value })} placeholder="¡Gracias por responder! Te comparto la información…" maxLength={1000} required />
                    <span className={styles.counter}>{draft.dm_text.length}/1000</span>
                </label> : <label className={styles.label} htmlFor={`${id}-audio`}>URL pública del audio
                    <input id={`${id}-audio`} className={styles.input} type="url" value={draft.dm_audio_url || ''} onChange={(event) => setDraft({ ...draft, dm_audio_url: event.target.value })} placeholder="https://tusitio.com/audio.mp3" maxLength={2048} required aria-describedby={`${id}-audio-hint`} />
                    <span id={`${id}-audio-hint`} className={styles.hint}>Pegá el enlace de un archivo de audio accesible sin iniciar sesión. Se envía como adjunto por DM.</span>
                </label>}
            </section>
            <fieldset className={styles.tags}>
                <legend>Etiquetas del contacto</legend>
                <p className={styles.hint}>Se agregan cuando la respuesta activa esta automatización.</p>
                {tags.length ? <div className={styles.tagList}>{tags.map((tag) => <label className={styles.check} key={tag.id}><input type="checkbox" checked={draft.tag_ids.includes(tag.id)} onChange={(event) => setDraft({ ...draft, tag_ids: event.target.checked ? [...draft.tag_ids, tag.id] : draft.tag_ids.filter((saved) => saved !== tag.id) })} /> {tag.name}</label>)}</div> : <p className={styles.hint}>Podés crear etiquetas en la sección Etiquetas y seleccionarlas acá.</p>}
            </fieldset>
            <label className={styles.check}><input type="checkbox" checked={draft.once_per_user} onChange={(event) => setDraft({ ...draft, once_per_user: event.target.checked })} /> Una respuesta automática por contacto</label>
            <label className={styles.check}><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Automatización activa</label>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.footer}><button type="submit" disabled={busy} className={styles.primary}>{busy ? 'Guardando…' : 'Guardar automatización'}</button><button type="button" disabled={busy} className={styles.cancel} onClick={onCancel}>Cancelar</button></div>
    </form>;
}
