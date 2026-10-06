import { checked, enqueueComment, windowOpen, messagePayload } from '../lib/automation-core.mjs';
import { createMeta } from '../lib/meta.mjs';
export const name = 'automations';
export const intervalMs = 15_000;
let lastPoll = 0;
let meta;
async function update(db, table, id, fields) { checked(await db.from(table).update(fields).eq('id', id)); }
async function row(db, table, id) { return checked(await db.from(table).select('*').eq('id', id).single()); }

async function bindPublished(db) {
  const pending = checked(await db.from('automations').select('*').eq('scope', 'next_publish'));
  for (const a of pending) {
    if (!a.publish_queue_id) continue;
    const queue = checked(await db.from('publish_queue').select('status,ig_media_id,published_at').eq('id', a.publish_queue_id).maybeSingle());
    if (queue?.status === 'published' && /^\d+$/.test(queue.ig_media_id || '')) await update(db, 'automations', a.id, { scope: 'media', media_id: queue.ig_media_id, starts_at: queue.published_at || a.starts_at });
  }
}
async function pages(path, consume) {
  let next = path;
  const seen = new Set();
  while (next && !seen.has(next)) {
    seen.add(next);
    const result = await meta.get(next);
    if (await consume(result.data || []) === false) break;
    next = result.paging?.next;
  }
}
async function poll(db, autos, log) {
  const ids = new Set(autos.filter((a) => a.scope === 'media').map((a) => a.media_id));
  const cutoff = Date.now() - 7 * 86400000;
  if (autos.some((a) => a.scope === 'all')) {
    await pages(`${meta.accountId}/media?fields=id,media_product_type,timestamp&limit=50`, async (items) => {
      for (const item of items) if (item.media_product_type === 'REELS' && Date.parse(item.timestamp) >= cutoff) ids.add(item.id);
      return !items.some((item) => Date.parse(item.timestamp) < cutoff);
    });
  }
  for (const id of ids) {
    if (!id) continue;
    // No asumir orden cronológico: recorrer páginas y filtrar cada comentario.
    try {
      await pages(`${id}/comments?fields=id,text,timestamp,from,username&limit=50`, async (items) => {
        for (const c of items) if (Date.parse(c.timestamp) >= cutoff) await enqueueComment(db, { id: c.id, text: c.text, at: c.timestamp, mediaId: id, userId: c.from?.id, username: c.from?.username || c.username }, autos, meta.accountId, 'poll');
      });
    } catch (error) { log(`[automations] Reel ${id}: ${error.message}`); }
  }
}
async function comment(db, id) {
  const e = await row(db, 'automation_events', id);
  const a = await row(db, 'automations', e.automation_id);
  let reason;
  if (!a.active) reason = 'Automatización pausada';
  else if (!e.comment_at || Date.now() - Date.parse(e.comment_at) >= 7 * 86400000) reason = 'Fuera de la ventana de 7 días';
  else if (e.lead_id && (await row(db, 'leads', e.lead_id)).opted_out) reason = 'El contacto pidió no recibir mensajes';
  else if (a.once_per_user && e.commenter_id) {
    const prior = checked(await db.from('automation_events').select('id').eq('automation_id', a.id).eq('commenter_id', e.commenter_id).eq('status', 'sent').limit(1));
    if (prior.length) reason = 'Ya recibió el DM';
  }
  if (reason) { await update(db, 'automation_events', id, { status: 'skipped', skip_reason: reason }); return; }
  const text = [a.dm_text, a.dm_link_url].filter(Boolean).join('\n');
  const sent = await meta.send(messagePayload({ comment_id: e.comment_id }, { kind: 'text', text }));
  // Persistir el DM antes de intentar la respuesta pública.
  try { await update(db, 'automation_events', id, { status: 'sent', dm_sent_at: new Date().toISOString(), message_id: sent.message_id, error: null }); }
  catch { throw Object.assign(new Error('DM enviado; falló registrar el resultado'), { uncertain: true }); }
  if (a.reply_enabled && a.reply_texts.length) {
    try {
      const reply = await meta.post(`${e.comment_id}/replies`, { message: a.reply_texts[Math.floor(Math.random() * a.reply_texts.length)] });
      await update(db, 'automation_events', id, { reply_sent_at: new Date().toISOString(), reply_comment_id: reply.id });
    } catch (error) { await update(db, 'automation_events', id, { error: `DM enviado. Respuesta pública: ${error.message}` }); }
  }
}
async function followup(db, id) {
  const j = await row(db, 'followup_jobs', id);
  const e = await row(db, 'followup_enrollments', j.enrollment_id);
  const s = await row(db, 'followup_sequences', e.sequence_id);
  const l = await row(db, 'leads', e.lead_id);
  let reason;
  if (e.status !== 'active' || !s.active) reason = 'Secuencia pausada o cancelada';
  else if (!windowOpen(l)) reason = l.opted_out ? 'El contacto pidió no recibir mensajes' : 'Ventana de 24 horas cerrada';
  else if (s.qualified_only && l.qualification !== 'qualified' && l.qualification !== 'customer') reason = 'El contacto no está calificado';
  else {
    const tags = checked(await db.from('lead_tag_assignments').select('tag_id').eq('lead_id', l.id));
    if (!s.required_tag_ids.every((t) => tags.some((x) => x.tag_id === t))) reason = 'El contacto no tiene las etiquetas requeridas';
  }
  if (reason) { await update(db, 'followup_jobs', id, { status: 'blocked', error: reason }); return; }
  const sent = await meta.send(messagePayload({ id: l.instagram_user_id }, j.step));
  try { await update(db, 'followup_jobs', id, { status: 'sent', sent_at: new Date().toISOString(), message_id: sent.message_id, error: null }); }
  catch { throw Object.assign(new Error('Mensaje enviado; falló registrar el resultado'), { uncertain: true }); }
  const remaining = checked(await db.from('followup_jobs').select('id').eq('enrollment_id', e.id).neq('status', 'sent').limit(1));
  if (!remaining.length) await update(db, 'followup_enrollments', e.id, { status: 'completed' });
}
export async function run({ supabase: db, env, log }) {
  if (!env.META_ACCESS_TOKEN) return;
  meta ||= createMeta(env);
  try { await bindPublished(db); } catch (error) { if (['42P01', 'PGRST205'].includes(error.code)) return; throw error; }
  checked(await db.rpc('automation_auto_enroll'));
  if (Date.now() - lastPoll >= 300_000) {
    try {
      const autos = checked(await db.from('automations').select('*').eq('active', true));
      await poll(db, autos, log);
      lastPoll = Date.now();
    } catch (error) { log(`[automations] Polling: ${error.message}`); lastPoll = Date.now() - 240_000; }
  }
  const hourly = Number(env.AUTOMATION_MAX_DM_PER_HOUR || 180);
  if (!Number.isInteger(hourly) || hourly < 0) throw new Error('AUTOMATION_MAX_DM_PER_HOUR inválido');
  let processed = 0;
  for (let i = 0; i < 10; i++) {
    const claim = checked(await db.rpc('automation_claim', { p_limit: hourly }));
    if (!claim) break;
    const table = claim.kind === 'comment' ? 'automation_events' : 'followup_jobs';
    try { await (claim.kind === 'comment' ? comment : followup)(db, claim.id); }
    catch (error) {
      const current = await row(db, table, claim.id);
      // Un DM confirmado nunca se reenvía por un error posterior.
      if (current.status === 'sent') { log(`[automations] Resultado registrado; error posterior: ${error.message}`); continue; }
      const attempts = current.attempts + 1;
      const status = error.uncertain || !(error.transient || error.code) ? 'uncertain' : error.transient && attempts < 4 ? 'queued' : 'failed';
      await update(db, table, claim.id, { status, attempts, error: error.message, ...(status === 'queued' ? { [table === 'automation_events' ? 'next_attempt_at' : 'due_at']: new Date(Date.now() + 2 ** attempts * 60000).toISOString() } : {}) });
    }
    processed++;
  }
  if (processed) log(`[automations] ${processed} trabajos procesados`);
}
