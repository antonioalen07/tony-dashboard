'use client';
/* Las imágenes de conversaciones llegan desde URLs temporales de Instagram. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, MessageSquare, Mic, Paperclip, RefreshCw, Search, Send, Square, Star, X } from 'lucide-react';
import type { Tag } from '@/lib/automation-types';
import { prepareAudioFile, recordedAudioWav } from '@/lib/crm-audio';
import { localDateTime, scheduledSendAt } from '@/lib/inbox-schedule';
import MigrationBanner from '@/components/MigrationBanner';
import styles from './AutomationInbox.module.css';

type Contact = {
    id: string;
    instagram_user_id: string;
    username: string | null;
    display_name: string | null;
    notes: string;
    starred: boolean;
    qualification: string;
    opted_out: boolean;
    last_inbound_at: string | null;
    tags: Tag[];
};
type Attachment = { type: string; url?: string; payload?: { url?: string } };
type Message = {
    id: string;
    direction: 'inbound' | 'outbound';
    kind: 'text' | 'audio';
    text: string | null;
    audio_url: string | null;
    attachments: Attachment[];
    status: string;
    error: string | null;
    created_at: string;
    scheduled_at?: string | null;
};
type ConversationData = { lead: Contact; messages: Message[]; canReply: boolean; replyBlockedReason: string | null; truncated: boolean };
type InboxData = { leads: Contact[]; total: number; hasMore: boolean };
type InFlight = { key: string; request: number; promise: Promise<void> };
const qualification: Record<string, string> = { new: 'Nuevo', qualified: 'Calificado', customer: 'Cliente', unqualified: 'No calificado' };
const statuses: Record<string, string> = { queued: 'En cola', sending: 'Enviando', sent: 'Enviado', failed: 'Falló', blocked: 'Bloqueado', skipped: 'Omitido', uncertain: 'Revisar en Instagram' };
const label = (contact: Contact) => contact.display_name || (contact.username ? `@${contact.username}` : `Contacto ${contact.instagram_user_id || contact.id.slice(0, 8)}`);
const date = (value: string) => new Date(value).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const safeUrl = (value: string | null | undefined) => {
    if (!value) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; }
};
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api/automations${path}`, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la operación.'), { migrationNeeded: response.status === 428 });
    return data as T;
}

export default function AutomationInbox({ tags, onTagsChange }: { tags: Tag[]; onTagsChange?: () => void }) {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [tag, setTag] = useState('');
    const [starred, setStarred] = useState(false);
    const [quality, setQuality] = useState('');
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [missing, setMissing] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const queryRef = useRef(0);
    const inFlightRef = useRef<InFlight | null>(null);
    const refresh = useCallback((showLoading = false, force = false) => {
        const query = new URLSearchParams({ search, limit: '50', offset: String(page * 50), ...(tag ? { tag } : {}), ...(quality ? { qualification: quality } : {}), ...(starred ? { starred: 'true' } : {}) });
        const key = query.toString();
        const pending = inFlightRef.current;
        if (!force && pending?.key === key && pending.request === queryRef.current) {
            if (showLoading) setLoading(true);
            return pending.promise;
        }
        const request = ++queryRef.current;
        if (showLoading) setLoading(true);
        const promise = (async () => {
            try {
                const data = await api<InboxData>(`/inbox?${query}`);
                if (request !== queryRef.current) return;
                setContacts(data.leads); setTotal(data.total); setHasMore(data.hasMore); setError(''); setMissing(false);
            } catch (e) {
                if (request !== queryRef.current) return;
                const failure = e as Error & { migrationNeeded?: boolean };
                setError(failure.message); setMissing(Boolean(failure.migrationNeeded));
            } finally {
                if (inFlightRef.current?.request === request) inFlightRef.current = null;
                if (request === queryRef.current) setLoading(false);
            }
        })();
        inFlightRef.current = { key, request, promise };
        return promise;
    }, [search, page, tag, quality, starred]);
    useEffect(() => {
        const sequence = queryRef;
        const debounce = window.setTimeout(() => void refresh(true), 250);
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10_000);
        const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', visible);
        window.addEventListener('focus', visible);
        return () => { clearTimeout(debounce); clearInterval(timer); sequence.current++; document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
    }, [refresh]);
    return <section className={styles.inbox} aria-label="Bandeja de conversaciones">
        <div className={styles.toolbar}>
            <label className={styles.search}><Search size={17} /><span className={styles.srOnly}>Buscar contactos</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar nombre, usuario o notas" maxLength={100} /></label>
            <select aria-label="Filtrar por etiqueta" value={tag} onChange={(event) => { setTag(event.target.value); setPage(0); }}><option value="">Todas las etiquetas</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <select aria-label="Filtrar por calificación" value={quality} onChange={(event) => { setQuality(event.target.value); setPage(0); }}><option value="">Todas las calificaciones</option>{Object.entries(qualification).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
            <button className={starred ? styles.selectedFilter : styles.button} type="button" aria-pressed={starred} onClick={() => { setStarred(!starred); setPage(0); }}><Star size={16} fill={starred ? 'currentColor' : 'none'} />Destacados</button>
            <button className={styles.iconButton} type="button" onClick={() => { void refresh(true, true); setRefreshVersion((version) => version + 1); }} aria-label="Actualizar conversaciones"><RefreshCw size={17} /></button>
        </div>
        {missing ? <MigrationBanner file="supabase_migration_automations_crm.sql" onRetry={() => void refresh(true)} /> : error && <p className={styles.error} role="alert">{error}</p>}
        <div className={`${styles.layout} ${selectedId ? styles.hasConversation : ''}`}>
            <aside className={styles.contacts} aria-label="Contactos">
                <div className={styles.listHeader}><strong>Instagram</strong><span>{total} {total === 1 ? 'contacto' : 'contactos'}</span></div>
                {loading && <p className={styles.empty} role="status">Cargando contactos…</p>}
                {!loading && !contacts.length && <div className={styles.empty}><MessageSquare size={24} /><p>{search || tag || quality || starred ? 'No hay contactos con estos filtros.' : 'Tus conversaciones van a aparecer acá cuando recibas mensajes o comentarios.'}</p></div>}
                <div className={styles.contactList}>{contacts.map((contact) => <button key={contact.id} type="button" className={`${styles.contact} ${selectedId === contact.id ? styles.activeContact : ''}`} aria-pressed={selectedId === contact.id} onClick={() => setSelectedId(contact.id)}>
                    <span className={styles.avatar}>{label(contact).replace('@', '').slice(0, 1).toUpperCase()}</span>
                    <span className={styles.contactCopy}><span className={styles.contactName}>{label(contact)}{contact.starred && <Star size={13} fill="currentColor" />}</span><span className={styles.muted}>{qualification[contact.qualification] || contact.qualification}</span><span className={styles.tagRow}>{contact.tags.map((item) => <span className={styles.smallTag} key={item.id}>{item.name}</span>)}</span><span className={styles.timestamp}>{contact.last_inbound_at ? date(contact.last_inbound_at) : 'Sin mensaje entrante todavía'}</span></span>
                </button>)}</div>
                <div className={styles.pagination}><button type="button" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Anterior</button><span>{page + 1}</span><button type="button" disabled={!hasMore || loading} onClick={() => setPage(page + 1)}>Siguiente</button></div>
            </aside>
            {selectedId ? <Conversation key={selectedId} id={selectedId} tags={tags} refreshVersion={refreshVersion} onBack={() => setSelectedId(null)} onChanged={() => void refresh(false, true)} onTagsChange={onTagsChange} /> : <div className={styles.welcome}><MessageSquare size={34} /><h3>Tu bandeja de conversaciones</h3><p>Elegí un contacto para responder, agregar notas y organizar sus etiquetas.</p><span>Podés enviar texto y audio cuando esté abierta la ventana de respuesta de Instagram.</span></div>}
        </div>
    </section>;
}

function Conversation({ id, tags, refreshVersion, onBack, onChanged, onTagsChange }: { id: string; tags: Tag[]; refreshVersion: number; onBack: () => void; onChanged: () => void; onTagsChange?: () => void }) {
    const [data, setData] = useState<ConversationData | null>(null);
    const [error, setError] = useState('');
    const [fetchError, setFetchError] = useState('');
    const [missing, setMissing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [limit, setLimit] = useState(100);
    const [draft, setDraft] = useState<{ display_name: string; notes: string; qualification: string } | null>(null);
    const [createdTags, setCreatedTags] = useState<Tag[]>([]);
    const [tagName, setTagName] = useState('');
    const [addTagId, setAddTagId] = useState('');
    const [kind, setKind] = useState<'text' | 'audio'>('text');
    const [text, setText] = useState('');
    const [audioUrl, setAudioUrl] = useState('');
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [preview, setPreview] = useState('');
    const [recording, setRecording] = useState(false);
    const [preparingAudio, setPreparingAudio] = useState(false);
    const [requestingMicrophone, setRequestingMicrophone] = useState(false);
    const [delivery, setDelivery] = useState<'now' | 'scheduled'>('now');
    const [scheduledAt, setScheduledAt] = useState('');
    const [notice, setNotice] = useState('');
    const [clock, setClock] = useState(() => Date.now());
    const messagesRef = useRef<HTMLDivElement>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previewRef = useRef('');
    const aliveRef = useRef(true);
    const loadedRef = useRef(false);
    const requestRef = useRef(0);
    const inFlightRef = useRef<InFlight | null>(null);
    const sendRef = useRef<{ signature: string; id: string } | null>(null);
    const microphoneRequestRef = useRef(false);
    const refresh = useCallback((force = false) => {
        const key = `${id}:${limit}`;
        const pending = inFlightRef.current;
        if (!force && pending?.key === key && pending.request === requestRef.current) return pending.promise;
        const request = ++requestRef.current;
        const promise = (async () => {
            try {
                const next = await api<ConversationData>(`/inbox/${id}?limit=${limit}`);
                if (!aliveRef.current || request !== requestRef.current) return;
                setData(next); setMissing(false); setFetchError(''); setClock(Date.now());
                if (!loadedRef.current) {
                    setDraft({ display_name: next.lead.display_name || '', notes: next.lead.notes || '', qualification: next.lead.qualification });
                    loadedRef.current = true;
                }
            } catch (e) {
                if (!aliveRef.current || request !== requestRef.current) return;
                const failure = e as Error & { migrationNeeded?: boolean };
                setFetchError(failure.message); setMissing(Boolean(failure.migrationNeeded));
            } finally {
                if (inFlightRef.current?.request === request) inFlightRef.current = null;
                if (aliveRef.current && request === requestRef.current) setLoading(false);
            }
        })();
        inFlightRef.current = { key, request, promise };
        return promise;
    }, [id, limit]);
    useEffect(() => {
        aliveRef.current = true;
        const sequence = requestRef;
        const first = window.setTimeout(() => void refresh(), 0);
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5_000);
        const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', visible);
        window.addEventListener('focus', visible);
        return () => { clearTimeout(first); clearInterval(timer); aliveRef.current = false; sequence.current++; document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
    }, [refresh, refreshVersion]);
    useEffect(() => {
        const node = messagesRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [data?.messages.length]);
    useEffect(() => () => {
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    }, []);
    const allTags = [...tags, ...createdTags.filter((item) => !tags.some((tag) => tag.id === item.id))];
    const report = (e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    async function patch(fields: Record<string, unknown>) {
        setSaving(true); setError(''); setNotice('');
        try {
            await api(`/leads/${id}`, 'PATCH', fields);
            await refresh(true); onChanged(); setNotice('Contacto actualizado.');
        } catch (e) { report(e); } finally { setSaving(false); }
    }
    async function assignTag(tagId: string, method: 'POST' | 'DELETE') {
        if (!tagId) return;
        setSaving(true); setError('');
        try { await api(`/leads/${id}/tags`, method, { tag_id: tagId }); setAddTagId(''); await refresh(true); onChanged(); }
        catch (e) { report(e); } finally { setSaving(false); }
    }
    async function createTag() {
        const name = tagName.trim();
        if (!name || saving) return;
        setSaving(true); setError('');
        try {
            const existing = allTags.find((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            const tag = existing || await api<Tag>('/tags', 'POST', { name });
            if (!existing) { setCreatedTags((previous) => [...previous, tag]); onTagsChange?.(); }
            await api(`/leads/${id}/tags`, 'POST', { tag_id: tag.id });
            setTagName(''); await refresh(true); onChanged();
        } catch (e) { report(e); } finally { setSaving(false); }
    }
    function setChosenAudio(file: File) {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = URL.createObjectURL(file);
        setAudioFile(file); setAudioUrl(''); setPreview(previewRef.current); setError('');
    }
    async function chooseAudio(file: File | null) {
        if (!file) return;
        setPreparingAudio(true); setError('');
        try {
            const prepared = await prepareAudioFile(file);
            if (aliveRef.current) setChosenAudio(prepared);
        } catch (error) { if (aliveRef.current) report(error); }
        finally { if (aliveRef.current) setPreparingAudio(false); }
    }
    function clearAudio() {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = ''; setAudioFile(null); setPreview(''); setAudioUrl('');
    }
    async function startRecording() {
        if (microphoneRequestRef.current || recording || preparingAudio || busy) return;
        setError(''); setNotice('');
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Este navegador no permite grabar. Podés adjuntar un audio o pegar su URL.'); return; }
        const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean }; featurePolicy?: { allowsFeature: (feature: string) => boolean } }).permissionsPolicy || (document as Document & { featurePolicy?: { allowsFeature: (feature: string) => boolean } }).featurePolicy;
        if (policy && !policy.allowsFeature('microphone')) { setError('La grabación no está habilitada en esta página. Podés adjuntar un audio o pegar su URL.'); return; }
        microphoneRequestRef.current = true; setRequestingMicrophone(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!aliveRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
            streamRef.current = stream;
            clearAudio();
            const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
            const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            recorderRef.current = recorder;
            const chunks: Blob[] = [];
            let size = 0;
            recorder.ondataavailable = (event) => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 4_000_000 && recorder.state === 'recording') recorder.stop(); } };
            recorder.onstop = async () => {
                if (recordingTimer.current) clearTimeout(recordingTimer.current);
                stream.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
                if (!aliveRef.current) return;
                setRecording(false); setPreparingAudio(true);
                try {
                    if (!chunks.length) throw new Error('No se capturó audio. Volvé a grabar o adjuntá un archivo.');
                    const audio = await recordedAudioWav(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
                    if (aliveRef.current) setChosenAudio(audio);
                } catch (e) { if (aliveRef.current) report(e); }
                finally { if (aliveRef.current) setPreparingAudio(false); }
            };
            recorder.onerror = () => { stream.getTracks().forEach((track) => track.stop()); if (aliveRef.current) { setRecording(false); setError('No se pudo grabar el audio. Probá adjuntar un archivo.'); } };
            recorder.start(1000); setRecording(true);
            recordingTimer.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 120_000);
        } catch (e) {
            streamRef.current?.getTracks().forEach((track) => track.stop());
            setRecording(false);
            setError(e instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(e.name) ? 'No se habilitó el micrófono. Permití el acceso en el navegador o adjuntá un audio.' : 'No se pudo acceder al micrófono. Podés adjuntar un audio.');
        } finally { microphoneRequestRef.current = false; if (aliveRef.current) setRequestingMicrophone(false); }
    }
    async function sendMessage(event: React.FormEvent) {
        event.preventDefault();
        if (busy || recording || preparingAudio || requestingMicrophone) return;
        setBusy(true); setError(''); setNotice('');
        try {
            if (delivery === 'scheduled' && !Number.isFinite(Date.parse(scheduledAt))) throw new Error('Elegí una fecha y hora válidas para programar el mensaje.');
            const scheduled = delivery === 'scheduled' ? new Date(scheduledAt).toISOString() : null;
            const draftSignature = JSON.stringify({ ...(kind === 'text' ? { kind, text: text.trim() } : { kind, audio_url: audioUrl.trim() }), ...(scheduled ? { scheduled_at: scheduled } : {}) });
            if (scheduled && (audioFile || sendRef.current?.signature !== draftSignature)) scheduledSendAt(scheduled);
            let url = audioUrl.trim();
            if (kind === 'audio' && audioFile) {
                const form = new FormData(); form.set('file', audioFile);
                const response = await fetch('/api/automations/inbox/audio', { method: 'POST', body: form });
                const uploaded = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(uploaded.error || 'No se pudo subir el audio.');
                url = uploaded.url; setAudioUrl(url); setAudioFile(null);
            }
            const payload = { ...(kind === 'text' ? { kind, text: text.trim() } : { kind, audio_url: url }), ...(scheduled ? { scheduled_at: scheduled } : {}) };
            const signature = JSON.stringify(payload);
            if (sendRef.current?.signature !== signature) {
                if (scheduled) scheduledSendAt(scheduled);
                sendRef.current = { signature, id: crypto.randomUUID() };
            }
            await api(`/inbox/${id}/messages`, 'POST', { ...payload, client_id: sendRef.current!.id });
            sendRef.current = null; setText(''); clearAudio(); setDelivery('now'); setScheduledAt('');
            setNotice(scheduled ? `Mensaje programado para ${date(scheduled)}. Podés cancelarlo mientras esté pendiente.` : 'Mensaje en cola. El estado se actualiza cuando se envía.');
            await refresh(true); onChanged();
        } catch (e) { report(e); } finally { setBusy(false); }
    }
    const expires = data?.lead.last_inbound_at ? Date.parse(data.lead.last_inbound_at) + 24 * 60 * 60_000 : 0;
    const canReply = Boolean(data?.canReply && expires > clock && !data.lead.opted_out);
    const canSchedule = Boolean(data?.lead.instagram_user_id && !data.lead.opted_out);
    const audioBusy = busy || preparingAudio || requestingMicrophone;
    async function cancelMessage(message: Message) {
        if (busy || !message.id.startsWith('outbox:')) return;
        setBusy(true); setError('');
        try {
            await api(`/inbox/${id}/messages/${message.id.slice(7)}`, 'DELETE');
            setNotice('Mensaje pendiente cancelado.'); await refresh(true); onChanged();
        } catch (error) { report(error); } finally { setBusy(false); }
    }
    return <div className={styles.conversation}>
        <div className={styles.conversationHeader}><button className={styles.backButton} type="button" onClick={onBack} aria-label="Volver a contactos"><ArrowLeft size={18} /></button><div><h3>{data ? label(data.lead) : 'Conversación'}</h3><span className={styles.muted}>{data?.lead.username && data.lead.display_name ? `@${data.lead.username} · ` : ''}Instagram</span></div>{data && <button className={`${styles.iconButton} ${data.lead.starred ? styles.starred : ''}`} type="button" disabled={saving} onClick={() => void patch({ starred: !data.lead.starred })} aria-label={data.lead.starred ? 'Quitar de destacados' : 'Destacar contacto'} aria-pressed={data.lead.starred}><Star size={19} fill={data.lead.starred ? 'currentColor' : 'none'} /></button>}</div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {fetchError && <p className={styles.error} role="alert">{fetchError}</p>}
        {missing && <MigrationBanner file="supabase_migration_automations_crm.sql" onRetry={() => void refresh()} />}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {loading && <p className={styles.empty} role="status">Cargando conversación…</p>}
        {data && draft && <>
            <details className={styles.profile}>
                <summary>Información del contacto <span>{qualification[data.lead.qualification]}</span></summary>
                <form className={styles.profileForm} onSubmit={(event) => { event.preventDefault(); void patch(draft); }}>
                    <div className={styles.profileFields}><label>Nombre del contacto<input value={draft.display_name} maxLength={120} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} placeholder="Nombre para ubicarlo fácilmente" /></label><label>Calificación<select value={draft.qualification} onChange={(event) => setDraft({ ...draft, qualification: event.target.value })}>{Object.entries(qualification).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
                    <label>Notas<textarea value={draft.notes} maxLength={10000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Interés, empresa, presupuesto o información para el próximo contacto" rows={3} /></label>
                    <div className={styles.row}><button className={styles.button} type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar información'}</button><label className={styles.checkbox}><input type="checkbox" checked={data.lead.opted_out} disabled={saving} onChange={(event) => void patch({ opted_out: event.target.checked })} />No enviar mensajes a este contacto</label></div>
                </form>
                <div className={styles.tagEditor}><strong>Etiquetas</strong><div className={styles.tagRow}>{data.lead.tags.length ? data.lead.tags.map((tag) => <span className={styles.tag} key={tag.id}>{tag.name}<button type="button" disabled={saving} onClick={() => void assignTag(tag.id, 'DELETE')} aria-label={`Quitar etiqueta ${tag.name}`}><X size={12} /></button></span>) : <span className={styles.muted}>Sin etiquetas</span>}</div><div className={styles.tagControls}><select value={addTagId} aria-label="Agregar una etiqueta existente" onChange={(event) => setAddTagId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void assignTag(addTagId, 'POST'); } }}><option value="">Elegí una etiqueta</option>{allTags.filter((tag) => !data.lead.tags.some((assigned) => assigned.id === tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button className={styles.button} type="button" disabled={saving || !addTagId} onClick={() => void assignTag(addTagId, 'POST')}>Agregar</button></div><form className={styles.tagControls} onSubmit={(event) => { event.preventDefault(); void createTag(); }}><input aria-label="Crear etiqueta para este contacto" value={tagName} maxLength={60} onChange={(event) => setTagName(event.target.value)} placeholder="Nueva etiqueta + Enter" /><button className={styles.button} disabled={saving || !tagName.trim()} type="submit">Crear y agregar</button></form></div>
            </details>
            <div className={styles.messages} ref={messagesRef} role="log" aria-label="Historial de conversación" aria-live="polite" aria-relevant="additions">
                {data.truncated && <button type="button" className={styles.historyButton} disabled={limit >= 500} onClick={() => setLimit(Math.min(500, limit + 100))}>{limit >= 500 ? 'Se muestran los últimos 500 mensajes de cada tipo.' : 'Cargar mensajes anteriores'}</button>}
                {!data.messages.length && <p className={styles.empty}>Este contacto todavía no tiene mensajes guardados. Los nuevos mensajes van a aparecer acá.</p>}
                {data.messages.map((message) => <div key={message.id} className={`${styles.message} ${message.direction === 'outbound' ? styles.outbound : styles.inbound}`}>
                    <div className={styles.messageOwner}>{message.direction === 'outbound' ? 'Vos' : label(data.lead)}</div>
                    {message.text && <p>{message.text}</p>}
                    {message.audio_url && safeUrl(message.audio_url) && <audio controls preload="none" src={safeUrl(message.audio_url)!}>Tu navegador no puede reproducir este audio.</audio>}
                    {message.attachments.filter((attachment) => attachment.type !== 'audio').map((attachment, index) => {
                        const url = safeUrl(attachment.url || attachment.payload?.url);
                        return <div className={styles.attachment} key={`${message.id}:${index}`}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{attachment.type === 'image' ? <img src={url} alt="Imagen adjunta al mensaje" loading="lazy" /> : <><Paperclip size={14} />Abrir {attachment.type === 'video' ? 'video' : attachment.type === 'story' ? 'historia' : 'adjunto'}</>}</a> : <span>Adjunto de Instagram ({attachment.type || 'archivo'})</span>}</div>;
                    })}
                    {!message.text && !message.audio_url && !message.attachments.length && <span className={styles.muted}>Mensaje de Instagram</span>}
                    <div className={styles.messageFooter}><time dateTime={message.created_at}>{date(message.created_at)}</time>{message.direction === 'outbound' && <span className={['failed', 'blocked', 'uncertain'].includes(message.status) ? styles.failed : ''}>{statuses[message.status] || message.status}</span>}</div>
                    {message.scheduled_at && <p className={styles.scheduledMessage}><CalendarClock size={14} />Programado: {date(message.scheduled_at)}</p>}
                    {message.id.startsWith('outbox:') && message.status === 'queued' && <button type="button" className={styles.cancelMessage} disabled={busy} onClick={() => void cancelMessage(message)}>Cancelar envío pendiente</button>}
                    {message.error && <p className={styles.messageError}>{message.error}</p>}
                </div>)}
            </div>
            <form className={styles.composer} onSubmit={(event) => void sendMessage(event)}>
                <p className={styles.windowNote}>{canReply ? `Envío inmediato disponible hasta ${date(new Date(expires).toISOString())}.` : data.replyBlockedReason || 'La ventana de respuesta cerró. Esperá un nuevo mensaje del contacto.'}{!canReply && ' Podés preparar un texto o audio sin enviarlo.'}</p>
                <div className={styles.composerModes}>
                    <button type="button" className={kind === 'text' ? styles.selectedFilter : styles.button} disabled={audioBusy || recording} aria-pressed={kind === 'text'} onClick={() => setKind('text')}>Texto</button>
                    <button type="button" className={kind === 'audio' ? styles.selectedFilter : styles.button} disabled={audioBusy || recording} aria-pressed={kind === 'audio'} onClick={() => setKind('audio')}>Audio</button>
                </div>
                {kind === 'text' ? <label className={styles.messageInput}><span className={styles.srOnly}>Escribí tu respuesta</span><textarea value={text} maxLength={1000} placeholder="Escribí tu respuesta…" rows={3} disabled={busy} onChange={(event) => setText(event.target.value)} /><span className={styles.muted}>{text.length}/1000</span></label> : <div className={styles.audioComposer}>
                    <div className={styles.row}>
                        <label className={`${styles.uploadButton} ${audioBusy || recording ? styles.disabled : ''}`}><Paperclip size={15} />Cargar archivo<input aria-label="Cargar archivo de audio" type="file" accept="audio/mpeg,audio/ogg,application/ogg,audio/mp4,audio/aac,audio/wav,.mp3,.ogg,.oga,.opus,.m4a,.wav,.aac" disabled={audioBusy || recording} onChange={(event) => { void chooseAudio(event.target.files?.[0] || null); event.target.value = ''; }} /></label>
                        <button className={styles.button} type="button" disabled={audioBusy} onClick={() => recording ? recorderRef.current?.stop() : void startRecording()}>{recording ? <><Square size={14} />Terminar grabación</> : <><Mic size={15} />{requestingMicrophone ? 'Esperando permiso…' : 'Grabar audio'}</>}</button>
                        {recording && <span className={styles.recording} role="status">Grabando · máximo 2 minutos</span>}
                        {requestingMicrophone && <span className={styles.muted} role="status">Habilitá el micrófono en el aviso del navegador.</span>}
                        {preparingAudio && <span className={styles.muted} role="status">Preparando audio…</span>}
                    </div>
                    {preview && <div className={styles.preview}><audio controls preload="metadata" src={preview} /><span className={styles.muted}>{audioFile?.name || 'Audio adjunto'}</span><button type="button" className={styles.iconButton} disabled={audioBusy || recording} onClick={clearAudio} aria-label="Quitar audio adjunto"><X size={16} /></button></div>}
                    <details className={styles.audioLink}><summary>Usar un enlace de audio</summary><label>URL pública del audio<input type="url" value={audioUrl} maxLength={2048} disabled={audioBusy || recording || Boolean(audioFile)} placeholder="https://…" onChange={(event) => setAudioUrl(event.target.value)} /></label></details>
                    {!preview && safeUrl(audioUrl) && <audio controls preload="none" src={safeUrl(audioUrl)!} />}
                    <span className={styles.muted}>MP3, OGG, M4A, WAV o AAC, hasta 4 MB. MP3, OGG y grabaciones se preparan como WAV de hasta 2 minutos. Escuchalo antes de enviarlo.</span>
                </div>}
                <div className={styles.deliveryControls}>
                    <label>Cuándo enviar<select aria-label="Cuándo enviar el mensaje" value={delivery} disabled={audioBusy || recording} onChange={(event) => { const value = event.target.value as 'now' | 'scheduled'; setDelivery(value); if (value === 'scheduled' && !scheduledAt) setScheduledAt(localDateTime(Date.now() + 60 * 60_000)); }}><option value="now">Ahora</option><option value="scheduled">Elegir fecha y hora</option></select></label>
                    {delivery === 'scheduled' && <label>Fecha y hora local<input type="datetime-local" aria-label="Fecha y hora del mensaje" value={scheduledAt} required disabled={audioBusy || recording} onChange={(event) => setScheduledAt(event.target.value)} /></label>}
                </div>
                {delivery === 'scheduled' && <p className={styles.windowNote}>Se verificará la ventana de 24 horas de Instagram al enviarlo. Si está cerrada o el contacto desactiva los mensajes, quedará bloqueado y se mostrará el motivo.</p>}
                <div className={styles.sendRow}><span className={styles.muted}>{delivery === 'scheduled' ? 'Podés cancelar un envío mientras esté pendiente.' : 'El estado del envío aparece en el historial.'}</span><button type="submit" className={styles.sendButton} disabled={(delivery === 'now' ? !canReply : !canSchedule || !scheduledAt) || audioBusy || recording || (kind === 'text' ? !text.trim() : !audioFile && !audioUrl.trim())}>{delivery === 'scheduled' ? <CalendarClock size={16} /> : <Send size={16} />}{busy ? 'Guardando…' : delivery === 'scheduled' ? 'Programar mensaje' : 'Enviar'}</button></div>
            </form>
        </>}
    </div>;
}
