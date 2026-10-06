'use client';
/* Las portadas son URLs firmadas de Meta/Storage, como en los selectores del repo. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, Plus, X, Tag as TagIcon, Users, Clock, MessageSquare } from 'lucide-react';
import MigrationBanner from '@/components/MigrationBanner';
import type { Automation, Tag, Lead, Sequence, Step, Activity, Followup } from '@/lib/automation-types';
import styles from './page.module.css';
type Media = {
    instagram_id: string;
    title: string;
    cover_url: string | null;
};
type Pending = {
    id: string;
    caption: string | null;
    scheduled_at: string | null;
};
type Detail = {
    messages: {
        id: string;
        text: string;
        received_at: string;
    }[];
    events: Activity[];
    enrollments: {
        id: string;
        status: string;
        followup_sequences: {
            name: string;
        };
        followup_jobs: Followup[];
    }[];
};
const status: Record<string, string> = { queued: 'En cola', sending: 'Enviando', sent: 'Enviado', failed: 'Falló', skipped: 'Omitido', blocked: 'Bloqueado', cancelled: 'Cancelado', uncertain: 'Revisá el resultado en Instagram', active: 'Activa', completed: 'Completada' };
const qualification: Record<string, string> = { new: 'Nuevo', qualified: 'Calificado', customer: 'Cliente', unqualified: 'No calificado' };
const date = (value: string) => new Date(value).toLocaleString('es-AR');
const emptyAutomation = (): Automation => ({ id: '', name: 'Nueva automatización', active: true, scope: 'media', media_id: null, publish_queue_id: null, keywords: [], match_mode: 'contains', fuzzy: true, dm_text: '', dm_link_url: null, dm_link_label: null, reply_enabled: true, reply_texts: ['¡Te lo mandé por DM! 📩', 'Revisá tus mensajes 👀', '¡Listo! Te escribí por privado 🙌'], once_per_user: true, tag_ids: [], starts_at: new Date().toISOString(), created_at: '', updated_at: '' });
const emptyStep = (): Step => ({ kind: 'text', delay_minutes: 60, text: '', audio_url: '' });
const emptySequence = (): Sequence => ({ id: '', name: 'Nuevo seguimiento', active: true, auto_enroll: false, required_tag_ids: [], qualified_only: true, stop_on_reply: true, steps: [emptyStep()] });
async function api<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
    const r = await fetch(`/api/automations${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok)
        throw Object.assign(new Error(data.error || 'No se pudo completar la operación'), { migrationNeeded: r.status === 428 });
    return data;
}
function ToggleTags({ tags, value, onChange }: {
    tags: Tag[];
    value: string[];
    onChange: (v: string[]) => void;
}) { return <div className={styles.chips}>{tags.map((t) => <label className={styles.check} key={t.id}><input type="checkbox" checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))}/>{t.name}</label>)}</div>; }
function Panel({ title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.focus(); const key = (e: KeyboardEvent) => { if (e.key === 'Escape')
        onClose(); if (e.key === 'Tab') {
        const list = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,[tabindex="0"]');
        if (!list?.length)
            return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    } }; document.addEventListener('keydown', key); const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previous?.focus(); }; }, [onClose]);
    return <div className={styles.overlay}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={styles.panel}><div className={styles.row}><h2>{title}</h2><button onClick={onClose} aria-label="Cerrar editor"><X size={20}/></button></div>{children}</div></div>;
}
export default function AutomationsPage() {
    const [tab, setTab] = useState('automations');
    const [autos, setAutos] = useState<Automation[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [sequences, setSequences] = useState<Sequence[]>([]);
    const [events, setEvents] = useState<Activity[]>([]);
    const [jobs, setJobs] = useState<Followup[]>([]);
    const [media, setMedia] = useState<Media[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<Automation | null>(null);
    const [seq, setSeq] = useState<Sequence | null>(null);
    const [contact, setContact] = useState<Lead | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [keywords, setKeywords] = useState('');
    const [tagName, setTagName] = useState('');
    const [tagEdit, setTagEdit] = useState<Tag | null>(null);
    const [filter, setFilter] = useState('');
    const [search, setSearch] = useState('');
    const [leadTag, setLeadTag] = useState('');
    const [leadQuality, setLeadQuality] = useState('');
    const [page, setPage] = useState(0);
    const [sequenceId, setSequenceId] = useState('');
    const closeDraft = useCallback(() => setDraft(null), []);
    const closeSeq = useCallback(() => setSeq(null), []);
    const closeContact = useCallback(() => { setContact(null); setDetail(null); }, []);
    const report = useCallback((e: unknown) => { const err = e as Error & {
        migrationNeeded?: boolean;
    }; setError(err.message); if (err.migrationNeeded)
        setMissing(true); }, []);
    const load = useCallback(() => Promise.all([api<Automation[]>(), api<Tag[]>('/tags'), api<Sequence[]>('/sequences'), api<Activity[]>('/events'), api<Followup[]>('/followups'), api<{
            reels: Media[];
            pending: Pending[];
        }>('/media')])
        .then(([a, t, s, e, j, m]) => { setAutos(a); setTags(t); setSequences(s); setEvents(e); setJobs(j); setMedia(m.reels); setPending(m.pending); setMissing(false); })
        .catch(report).finally(() => setLoading(false)), [report]);
    useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible')
        void load(); }, 10000); return () => clearInterval(timer); }, [load]);
    useEffect(() => { let cancelled = false; const query = new URLSearchParams({ search, offset: String(page * 50), ...(leadTag ? { tag: leadTag } : {}), ...(leadQuality ? { qualification: leadQuality } : {}) }); api<Lead[]>(`/leads?${query}`).then((l) => { if (!cancelled)
        setLeads(l); }).catch(report); return () => { cancelled = true; }; }, [search, page, leadTag, leadQuality, report, autos]);
    useEffect(() => { Promise.resolve().then(() => { const q = new URLSearchParams(window.location.search); if (q.get('queue')) {
        setDraft({ ...emptyAutomation(), scope: 'next_publish', publish_queue_id: q.get('queue'), keywords: q.get('keyword') ? [q.get('keyword')!] : [] });
        setKeywords(q.get('keyword') || '');
    } }); }, []);
    async function mutate(path: string, method: string, body?: unknown) { setBusy(true); setError(''); try {
        await api(path, method, body);
        await load();
        return true;
    }
    catch (e) {
        report(e);
        return false;
    }
    finally {
        setBusy(false);
    } }
    function edit(a: Automation) { setDraft({ ...a }); setKeywords(a.keywords.join(', ')); setError(''); }
    async function openLead(l: Lead) { setContact({ ...l }); setDetail(null); setSequenceId(''); try {
        setDetail(await api<Detail>(`/leads/${l.id}`));
    }
    catch (e) {
        report(e);
    } }
    const activity = events.filter((e) => !filter || e.automation_id === filter);
    return <main className={styles.page}>
  <header className={styles.header}><div><h1><Zap size={27}/> Automatizaciones</h1><p className={styles.muted}>Convertí comentarios en conversaciones y acompañá a tus contactos.</p></div>{tab === 'automations' && <button className={styles.primary} onClick={() => edit(emptyAutomation())}><Plus size={16}/> Nueva automatización</button>}{tab === 'sequences' && <button className={styles.primary} onClick={() => setSeq(emptySequence())}><Plus size={16}/> Nuevo seguimiento</button>}</header>
  <nav className={styles.tabs} aria-label="Secciones de automatización">{[['automations', 'Comment → DM'], ['leads', 'Contactos'], ['tags', 'Etiquetas'], ['sequences', 'Seguimientos'], ['activity', 'Actividad']].map(([key, label]) => <button key={key} className={tab === key ? styles.selected : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
  {error && <div className={styles.error} role="alert">{error}</div>}{missing && <MigrationBanner file="supabase_migration_automations.sql" onRetry={() => void load()}/>}
  {loading ? <p role="status">Cargando automatizaciones…</p> : !missing && <>
   {tab === 'automations' && <><div className={styles.cards}>{autos.map((a) => <article className={styles.card} key={a.id}><div className={styles.row}>{a.reel?.cover_url && <img src={a.reel.cover_url} alt="Portada del reel"/>}<h3>{a.name}</h3><button disabled={busy} onClick={() => void mutate(`/${a.id}`, 'PATCH', { active: !a.active })}>{a.active ? 'Activa · Pausar' : 'Pausada · Activar'}</button></div><p className={styles.muted}>{a.scope === 'all' ? 'Todos tus reels' : a.scope === 'next_publish' ? 'Próxima publicación' : a.reel?.title || `Reel ${a.media_id}`}</p><div className={styles.chips}>{a.keywords.map((k) => <span className={styles.chip} key={k}>{k}</span>)}</div><p>{a.dm_text}</p><p className={styles.muted}>{Object.values(a.stats || {}).reduce((n, x) => n + x, 0)} detectados · {a.stats?.sent || 0} enviados · {a.stats?.failed || 0} fallidos · {a.stats?.uncertain || 0} por revisar</p><div className={styles.row}><button onClick={() => edit(a)}>Editar</button><button disabled={busy} onClick={() => { if (window.confirm(`¿Borrar “${a.name}” y su actividad?`))
            void mutate(`/${a.id}`, 'DELETE'); }}>Borrar</button></div></article>)}</div>{!autos.length && <div className={styles.empty}>Respondé por privado cuando alguien comenta una palabra clave.<p><button onClick={() => edit(emptyAutomation())}>Crear la primera</button></p></div>}</>}
   {tab === 'tags' && <><form className={styles.row} onSubmit={async (e) => { e.preventDefault(); if (await mutate(tagEdit ? `/tags/${tagEdit.id}` : '/tags', tagEdit ? 'PATCH' : 'POST', { name: tagName })) {
            setTagName('');
            setTagEdit(null);
        } }}><label><TagIcon size={16}/> <input aria-label="Nombre de etiqueta" value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="B2B, B2C, Muy calificado…" maxLength={60} required/></label><button disabled={busy} className={styles.primary}>{tagEdit ? 'Guardar nombre' : 'Crear etiqueta'}</button>{tagEdit && <button type="button" onClick={() => { setTagEdit(null); setTagName(''); }}>Cancelar</button>}</form><div className={styles.cards}>{tags.map((t) => <article className={styles.card} key={t.id}><h3>{t.name}</h3><div className={styles.row}><button onClick={() => { setTagEdit(t); setTagName(t.name); }}>Renombrar</button><button disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar la etiqueta “${t.name}” de todos los contactos?`))
            void mutate(`/tags/${t.id}`, 'DELETE'); }}>Eliminar</button></div></article>)}</div>{!tags.length && <p className={styles.empty}>Creá tus propias etiquetas y asignalas a contactos o automatizaciones.</p>}</>}
   {tab === 'leads' && <><div className={styles.row}><input aria-label="Buscar contacto" placeholder="Buscar usuario…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}/><select aria-label="Filtrar por etiqueta" value={leadTag} onChange={(e) => { setLeadTag(e.target.value); setPage(0); }}><option value="">Todas las etiquetas</option>{tags.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select><select aria-label="Filtrar por calificación" value={leadQuality} onChange={(e) => { setLeadQuality(e.target.value); setPage(0); }}><option value="">Todas las calificaciones</option>{Object.entries(qualification).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></div><div className={styles.cards}>{leads.map((l) => <article key={l.id} className={styles.card}><h3><Users size={16}/> @{l.username || l.instagram_user_id}</h3><p>{qualification[l.qualification]}{l.opted_out ? ' · No recibir mensajes' : ''}</p><div className={styles.chips}>{l.tags.map((t) => <span key={t.id} className={styles.chip}>{t.name}</span>)}</div><p className={styles.muted}>{l.last_inbound_at ? `Último mensaje: ${date(l.last_inbound_at)}` : 'Todavía no respondió por DM'}</p><button onClick={() => void openLead(l)}>Ver contacto</button></article>)}</div>{!leads.length && <p className={styles.empty}>Los contactos aparecen cuando comentan o te escriben por DM.</p>}<div className={styles.row}><button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1}</span><button disabled={leads.length < 50} onClick={() => setPage(page + 1)}>Siguiente</button></div></>}
   {tab === 'sequences' && <><p className={styles.muted}>Los mensajes se envían dentro de las 24 horas desde el último DM entrante. Si la ventana cierra, el paso queda bloqueado para revisión.</p><div className={styles.cards}>{sequences.map((s) => <article className={styles.card} key={s.id}><h3><Clock size={16}/> {s.name}</h3><p>{s.steps.length} pasos · {s.auto_enroll ? 'Inscripción automática' : 'Inscripción desde el contacto'}</p><p className={styles.muted}>{s.steps.map((p) => `${p.delay_minutes} min → ${p.kind === 'audio' ? 'Audio' : 'Texto'}`).join(' · ')}</p><div className={styles.row}><button onClick={() => setSeq({ ...s, steps: s.steps.map((p) => ({ ...p })) })}>Editar</button><button disabled={busy} onClick={() => void mutate(`/sequences/${s.id}`, 'PATCH', { active: !s.active })}>{s.active ? 'Pausar' : 'Activar'}</button><button disabled={busy} onClick={() => { if (window.confirm(`¿Borrar “${s.name}” y sus seguimientos pendientes?`))
            void mutate(`/sequences/${s.id}`, 'DELETE'); }}>Borrar</button></div></article>)}</div>{!sequences.length && <p className={styles.empty}>Creá una secuencia para enviar textos o audios con la demora que elijas.</p>}<h2>Envíos de seguimiento</h2><div className={styles.list}>{jobs.map((j) => <div className={styles.event} key={j.id}><div>{j.step.kind === 'audio' ? 'Audio' : j.step.text}<p className={styles.muted}>{date(j.due_at)}</p></div><div>{status[j.status] || j.status}{j.error && <p className={styles.muted}>{j.error}</p>}{['failed', 'blocked'].includes(j.status) && <button disabled={busy} onClick={() => void mutate(`/followups/${j.id}/retry`, 'POST')}>Reintentar</button>}</div></div>)}</div></>}
   {(tab === 'activity' || tab === 'automations') && <><div className={styles.row}><h2><MessageSquare size={18}/> Actividad reciente</h2><select value={filter} aria-label="Filtrar actividad" onChange={(e) => setFilter(e.target.value)}><option value="">Todas las automatizaciones</option>{autos.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></div><div className={styles.list}>{activity.map((e) => <div className={styles.event} key={e.id}><div><strong>@{e.commenter_username || 'Usuario de Instagram'}</strong><p>“{e.comment_text}”</p><span className={styles.muted}>{date(e.created_at)}</span></div><div>{status[e.status] || e.status}{(e.error || e.skip_reason) && <p className={styles.muted}>{e.error || e.skip_reason}</p>}{e.status === 'failed' && <button disabled={busy} onClick={() => void mutate(`/events/${e.id}/retry`, 'POST')}>Reintentar</button>}</div></div>)}</div>{!activity.length && <p className={styles.empty}>La actividad de tus comentarios va a aparecer acá.</p>}</>}
  </>}
  {draft && <Panel title={draft.id ? 'Editar automatización' : 'Nueva automatización'} onClose={closeDraft}><form onSubmit={async (e) => { e.preventDefault(); const keys = [...new Set(keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean))]; if (await mutate(draft.id ? `/${draft.id}` : '', draft.id ? 'PATCH' : 'POST', { ...draft, keywords: keys, reply_texts: draft.reply_texts.map((t) => t.trim()).filter(Boolean) }))
            setDraft(null); }}>
   <label>Nombre<input value={draft.name} maxLength={120} required onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
   <fieldset><legend>1. Dónde</legend><select aria-label="Alcance" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Automation['scope'] })}><option value="media">Un reel puntual</option><option value="next_publish">El próximo que publique</option><option value="all">Todos mis reels</option></select>{draft.scope === 'media' && <select aria-label="Reel" required value={draft.media_id || ''} onChange={(e) => setDraft({ ...draft, media_id: e.target.value })}><option value="">Elegí un reel</option>{media.map((m) => <option value={m.instagram_id} key={m.instagram_id}>{m.title || m.instagram_id}</option>)}{draft.media_id && !media.some((m) => m.instagram_id === draft.media_id) && <option value={draft.media_id}>Reel {draft.media_id}</option>}</select>}{draft.scope === 'next_publish' && <select aria-label="Publicación pendiente" required value={draft.publish_queue_id || ''} onChange={(e) => setDraft({ ...draft, publish_queue_id: e.target.value })}><option value="">Elegí una publicación del calendario</option>{pending.map((p) => <option value={p.id} key={p.id}>{p.caption?.slice(0, 90) || 'Sin caption'} {p.scheduled_at ? date(p.scheduled_at) : ''}</option>)}</select>}</fieldset>
   <fieldset><legend>2. Palabras clave</legend><label>Separalas con coma o Enter<textarea value={keywords} required onChange={(e) => setKeywords(e.target.value)} placeholder="OJO, guía"/></label><div className={styles.chips}>{keywords.split(/[,\n]/).filter((k) => k.trim()).map((k, i) => <span className={styles.chip} key={i}>{k.trim()}</span>)}</div><select aria-label="Modo de coincidencia" value={draft.match_mode} onChange={(e) => setDraft({ ...draft, match_mode: e.target.value as Automation['match_mode'] })}><option value="contains">Contiene la palabra</option><option value="exact">Es exactamente la palabra</option></select><label className={styles.check}><input type="checkbox" checked={draft.fuzzy} onChange={(e) => setDraft({ ...draft, fuzzy: e.target.checked })}/>Tolerar errores de tipeo</label><label className={styles.check}><input type="checkbox" checked={draft.once_per_user} onChange={(e) => setDraft({ ...draft, once_per_user: e.target.checked })}/>Un DM por persona en esta automatización</label></fieldset>
   <fieldset><legend>3. Respuesta pública</legend><label className={styles.check}><input type="checkbox" checked={draft.reply_enabled} onChange={(e) => setDraft({ ...draft, reply_enabled: e.target.checked })}/>Responder el comentario</label>{draft.reply_enabled && <label>Una frase por línea<textarea value={draft.reply_texts.join('\n')} onChange={(e) => setDraft({ ...draft, reply_texts: e.target.value.split('\n') })}/></label>}</fieldset>
   <fieldset><legend>4. El DM</legend><label>Mensaje<textarea value={draft.dm_text} required maxLength={1000} onChange={(e) => setDraft({ ...draft, dm_text: e.target.value })}/></label><span className={styles.muted}>{[draft.dm_text, draft.dm_link_url].filter(Boolean).join('\n').length}/1000 caracteres, incluido el link</span><label>Link opcional<input type="url" value={draft.dm_link_url || ''} onChange={(e) => setDraft({ ...draft, dm_link_url: e.target.value || null })}/></label><div className={styles.preview}>{draft.dm_text || 'Así va a verse tu mensaje…'}{draft.dm_link_url && <> <br />{draft.dm_link_url}</>}</div></fieldset>
   <fieldset><legend>5. Etiquetas del contacto</legend><ToggleTags tags={tags} value={draft.tag_ids} onChange={(v) => setDraft({ ...draft, tag_ids: v })}/>{!tags.length && <p className={styles.muted}>Creá etiquetas desde la pestaña Etiquetas.</p>}</fieldset>
   {error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.footer}><button className={styles.primary} disabled={busy}>{busy ? 'Guardando…' : 'Guardar automatización'}</button><button type="button" onClick={closeDraft}>Cancelar</button></div>
  </form></Panel>}
  {seq && <Panel title={seq.id ? 'Editar seguimiento' : 'Nuevo seguimiento'} onClose={closeSeq}><form onSubmit={async (e) => { e.preventDefault(); if (await mutate(seq.id ? `/sequences/${seq.id}` : '/sequences', seq.id ? 'PATCH' : 'POST', seq))
            setSeq(null); }}><label>Nombre<input required value={seq.name} maxLength={120} onChange={(e) => setSeq({ ...seq, name: e.target.value })}/></label><fieldset><legend>Condiciones</legend><label className={styles.check}><input type="checkbox" checked={seq.auto_enroll} onChange={(e) => setSeq({ ...seq, auto_enroll: e.target.checked })}/>Inscribir automáticamente a contactos que cumplan estas condiciones</label><label className={styles.check}><input type="checkbox" checked={seq.qualified_only} onChange={(e) => setSeq({ ...seq, qualified_only: e.target.checked })}/>Sólo calificados o clientes</label><label className={styles.check}><input type="checkbox" checked={seq.stop_on_reply} onChange={(e) => setSeq({ ...seq, stop_on_reply: e.target.checked })}/>Detener cuando el contacto responda</label><p className={styles.muted}>Debe tener todas las etiquetas seleccionadas. La inscripción automática requiere un DM entrante reciente.</p><ToggleTags tags={tags} value={seq.required_tag_ids} onChange={(v) => setSeq({ ...seq, required_tag_ids: v })}/></fieldset>
   {seq.steps.map((step, i) => <fieldset key={i}><legend>Paso {i + 1}</legend><label>Demora desde {i === 0 ? 'la inscripción' : 'el horario del paso anterior'} (minutos)<input type="number" min={0} max={525600} required value={step.delay_minutes} onChange={(e) => setSeq({ ...seq, steps: seq.steps.map((s, n) => n === i ? { ...s, delay_minutes: Number(e.target.value) } : s) })}/></label><select aria-label={`Tipo de mensaje del paso ${i + 1}`} value={step.kind} onChange={(e) => setSeq({ ...seq, steps: seq.steps.map((s, n) => n === i ? { ...s, kind: e.target.value as Step['kind'] } : s) })}><option value="text">Texto</option><option value="audio">Audio</option></select>{step.kind === 'text' ? <label>Mensaje<textarea required maxLength={1000} value={step.text} onChange={(e) => setSeq({ ...seq, steps: seq.steps.map((s, n) => n === i ? { ...s, text: e.target.value } : s) })}/></label> : <><label>URL pública del audio<input required type="url" value={step.audio_url} onChange={(e) => setSeq({ ...seq, steps: seq.steps.map((s, n) => n === i ? { ...s, audio_url: e.target.value } : s) })}/></label><p className={styles.muted}>Usá un archivo MP3, M4A o WAV accesible sin login. Meta valida el formato y el tamaño al enviarlo.</p>{step.audio_url && <audio controls className={styles.audio} src={step.audio_url} preload="none"/>}</>}<button type="button" disabled={seq.steps.length === 1} onClick={() => setSeq({ ...seq, steps: seq.steps.filter((_, n) => n !== i) })}>Quitar paso</button></fieldset>)}<button type="button" disabled={seq.steps.length >= 20} onClick={() => setSeq({ ...seq, steps: [...seq.steps, emptyStep()] })}>Agregar paso</button><p className={styles.muted}>Los pasos ya inscriptos conservan su mensaje y horario; editar afecta nuevas inscripciones.</p>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.footer}><button disabled={busy} className={styles.primary}>Guardar seguimiento</button><button type="button" onClick={closeSeq}>Cancelar</button></div></form></Panel>}
  {contact && <Panel title={`@${contact.username || contact.instagram_user_id}`} onClose={closeContact}><label>Calificación<select value={contact.qualification} onChange={(e) => setContact({ ...contact, qualification: e.target.value })}>{Object.entries(qualification).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={contact.opted_out} onChange={(e) => setContact({ ...contact, opted_out: e.target.checked })}/>No enviar mensajes a este contacto</label><label>Notas<textarea value={contact.notes} maxLength={10000} onChange={(e) => setContact({ ...contact, notes: e.target.value })}/></label><button disabled={busy} onClick={() => void mutate(`/leads/${contact.id}`, 'PATCH', { qualification: contact.qualification, opted_out: contact.opted_out, notes: contact.notes })}>Guardar contacto</button><fieldset><legend>Etiquetas</legend>{tags.map((t) => <label className={styles.check} key={t.id}><input type="checkbox" disabled={busy} checked={contact.tags.some((x) => x.id === t.id)} onChange={async (e) => { const add = e.target.checked; if (await mutate(`/leads/${contact.id}/tags`, add ? 'POST' : 'DELETE', { tag_id: t.id }))
        setContact({ ...contact, tags: add ? [...contact.tags, t] : contact.tags.filter((x) => x.id !== t.id) }); }}/>{t.name}</label>)}</fieldset><fieldset><legend>Inscribir en seguimiento</legend><select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label="Secuencia"><option value="">Elegí una secuencia</option>{sequences.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button disabled={busy || !sequenceId || contact.opted_out} onClick={async () => { if (await mutate('/enrollments', 'POST', { lead_id: contact.id, sequence_id: sequenceId }))
        setDetail(await api<Detail>(`/leads/${contact.id}`)); }}>Programar seguimiento</button></fieldset>{error && <p className={styles.error} role="alert">{error}</p>}<h3>Historial</h3>{!detail ? <p>Cargando historial…</p> : <>{detail.messages.map((m) => <div className={styles.preview} key={m.id}>{m.text || 'Mensaje con adjunto'}<p className={styles.muted}>{date(m.received_at)}</p></div>)}{detail.events.map((e) => <p key={e.id}>Comentario “{e.comment_text}” · {status[e.status]} · {date(e.created_at)}</p>)}{detail.enrollments.map((e) => <fieldset key={e.id}><legend>{e.followup_sequences.name}</legend><p>{status[e.status]}</p>{e.followup_jobs.map((j) => <p key={j.id}>{date(j.due_at)} · {status[j.status]}{j.error ? ` · ${j.error}` : ''}</p>)}{e.status === 'active' && <button disabled={busy} onClick={async () => { if (await mutate(`/enrollments/${e.id}`, 'DELETE'))
        setDetail(await api<Detail>(`/leads/${contact.id}`)); }}>Cancelar seguimiento</button>}</fieldset>)}</>}</Panel>}
 </main>;
}
