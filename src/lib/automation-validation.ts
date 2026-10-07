export class InputError extends Error {
}
const fail = (message: string): never => { throw new InputError(message); };
export function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('Los datos no son válidos'); }
export const uuid = (v: unknown): string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : fail('ID inválido');
function text(v: unknown, label: string, max: number) { return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : fail(`${label}: completá entre 1 y ${max} caracteres`); }
function bool(v: unknown, fallback: boolean) { return v === undefined ? fallback : typeof v === 'boolean' ? v : fail('El valor debe ser verdadero o falso'); }
function list(v: unknown, ids = false): string[] { if (!Array.isArray(v) || v.length > 50)
    fail('Lista inválida (máximo 50 elementos)'); return [...new Set((v as unknown[]).map((x) => ids ? uuid(x) : text(x, 'Elemento', 100)))]; }
function url(v: unknown): string | null { if (v === null || v === '' || v === undefined)
    return null; const s = text(v, 'URL', 2048); try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        fail('Usá una URL http(s) sin credenciales');
}
catch {
    fail('Usá una URL http(s) válida');
} return s; }
export function automationInput(value: unknown) {
    const b = object(value);
    const scope = b.scope;
    if (!['media', 'next_publish', 'all'].includes(String(scope)))
        fail('Elegí dónde se ejecuta');
    const keywords = list(b.keywords);
    if (!keywords.length)
        fail('Agregá al menos una palabra clave');
    const dm_text = text(b.dm_text, 'Mensaje', 1000);
    const dm_link_url = url(b.dm_link_url);
    if ([dm_text, dm_link_url].filter(Boolean).join('\n').length > 1000)
        fail('El mensaje completo, incluido el link, supera los 1000 caracteres');
    if (!['contains', 'exact'].includes(String(b.match_mode)))
        fail('Modo de coincidencia inválido');
    const starts = b.starts_at === undefined ? new Date().toISOString() : String(b.starts_at);
    if (!Number.isFinite(Date.parse(starts)))
        fail('Fecha de inicio inválida');
    return { name: text(b.name, 'Nombre', 120), active: bool(b.active, true), scope, media_id: scope === 'media' ? (/^\d+$/.test(String(b.media_id)) ? String(b.media_id) : fail('Elegí un reel')) : null,
        publish_queue_id: scope === 'next_publish' ? uuid(b.publish_queue_id) : null, keywords, match_mode: b.match_mode, fuzzy: bool(b.fuzzy, true), dm_text, dm_link_url,
        dm_link_label: b.dm_link_label ? text(b.dm_link_label, 'Texto del link', 100) : null, reply_enabled: bool(b.reply_enabled, true), reply_texts: list(b.reply_texts || []), once_per_user: bool(b.once_per_user, true), tag_ids: list(b.tag_ids || [], true), starts_at: starts, updated_at: new Date().toISOString() };
}
export function sequenceInput(value: unknown) {
    const b = object(value);
    if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > 20)
        fail('Agregá entre 1 y 20 pasos');
    const steps = (b.steps as unknown[]).map((v) => {
        const s = object(v);
        if (!Number.isInteger(s.delay_minutes) || Number(s.delay_minutes) < 0 || Number(s.delay_minutes) > 525600)
            fail('La demora debe ser un número entero de minutos entre 0 y 525600');
        if (!['text', 'audio'].includes(String(s.kind)))
            fail('Tipo de mensaje inválido');
        return { kind: s.kind, delay_minutes: s.delay_minutes, text: s.kind === 'text' ? text(s.text, 'Mensaje', 1000) : '', audio_url: s.kind === 'audio' ? url(s.audio_url) || fail('Completá la URL del audio') : '' };
    });
    return { name: text(b.name, 'Nombre', 120), active: bool(b.active, true), auto_enroll: bool(b.auto_enroll, false), required_tag_ids: list(b.required_tag_ids || [], true), qualified_only: bool(b.qualified_only, false), stop_on_reply: bool(b.stop_on_reply, true), steps, updated_at: new Date().toISOString() };
}
export function leadInput(value: unknown) {
    const b = object(value);
    const out: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('qualification' in b) {
        if (!['new', 'qualified', 'customer', 'unqualified'].includes(String(b.qualification)))
            fail('Calificación inválida');
        out.qualification = b.qualification;
    }
    if ('opted_out' in b)
        out.opted_out = bool(b.opted_out, false);
    if ('starred' in b)
        out.starred = bool(b.starred, false);
    if ('display_name' in b) {
        if (b.display_name !== null && (typeof b.display_name !== 'string' || b.display_name.length > 120))
            fail('Nombre: máximo 120 caracteres');
        out.display_name = typeof b.display_name === 'string' ? b.display_name.trim() || null : null;
    }
    if ('notes' in b) {
        if (typeof b.notes !== 'string' || b.notes.length > 10000)
            fail('Notas: máximo 10000 caracteres');
        out.notes = b.notes;
    }
    return out;
}
export const tagName = (v: unknown) => text(v, 'Etiqueta', 60);
export function storyInput(value: unknown) {
    const b = object(value);
    if (!['contains', 'exact'].includes(String(b.match_mode))) fail('Modo de coincidencia inválido');
    const dm_audio_url = url(b.dm_audio_url);
    if (dm_audio_url && b.dm_text) fail('Elegí texto o audio para esta respuesta');
    const dm_text = dm_audio_url ? '' : text(b.dm_text, 'Mensaje', 1000);
    const starts_at = b.starts_at === undefined ? new Date().toISOString() : String(b.starts_at);
    if (!Number.isFinite(Date.parse(starts_at))) fail('Fecha de inicio inválida');
    return { name: text(b.name, 'Nombre', 120), active: bool(b.active, true), keywords: list(b.keywords || []), match_mode: b.match_mode,
        fuzzy: bool(b.fuzzy, true), dm_text, dm_audio_url, tag_ids: list(b.tag_ids || [], true), once_per_user: bool(b.once_per_user, true), starts_at, updated_at: new Date().toISOString() };
}
