import { matches } from './match.mjs';
import { checked, windowOpen, messagePayload } from './automation-core.mjs';
export function pickStoryAutomation(text, rules, at) {
  if (!Number.isFinite(Date.parse(at))) return null;
  return [...rules].sort((a, b) => Number(!a.keywords.length) - Number(!b.keywords.length) || a.created_at.localeCompare(b.created_at))
    .find((a) => a.active && Date.parse(at) >= Date.parse(a.starts_at) && (!a.keywords.length || matches(text, a))) || null;
}
export function inboundMessage(event, account) {
  const m = event.message;
  if (!m?.mid || m.is_echo || !event.sender?.id || event.sender.id === account || event.recipient?.id !== account || typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp <= 0 || event.timestamp > Date.now() + 60000) return null;
  const attachments = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 20).map((a) => ({ type: String(a.type || 'file'), payload: { url: typeof a.payload?.url === 'string' ? a.payload.url : null } }));
  return { user: event.sender.id, mid: m.mid, text: m.text || '', at: new Date(Math.min(event.timestamp, Date.now())).toISOString(), attachments, storyId: m.reply_to?.story?.id || null };
}
export async function receiveMessage(db, message, account, rules) {
  const rule = message.storyId ? pickStoryAutomation(message.text, rules, message.at) : null;
  checked(await db.rpc('crm_receive_message', { p_account: account, p_user: message.user, p_mid: message.mid, p_text: message.text, p_at: message.at, p_attachments: message.attachments, p_story_id: message.storyId, p_rule: rule?.id || null }));
}
async function row(db, table, id) { return checked(await db.from(table).select('*').eq('id', id).single()); }
async function update(db, table, id, fields) { checked(await db.from(table).update(fields).eq('id', id)); }
export async function deliverCrm(db, meta, kind, id) {
  const table = kind === 'story' ? 'story_automation_events' : 'inbox_outbox';
  const item = await row(db, table, id);
  const lead = await row(db, 'leads', item.lead_id);
  const rule = kind === 'story' ? await row(db, 'story_automations', item.automation_id) : null;
  let reason;
  if (!lead.instagram_user_id || lead.ig_account_id !== meta.accountId) reason = 'El contacto no corresponde al Instagram conectado';
  else if (!windowOpen(lead)) reason = lead.opted_out ? 'El contacto pidió no recibir mensajes' : 'Ventana de 24 horas cerrada';
  else if (rule && !rule.active) reason = 'Automatización pausada';
  else if (rule?.once_per_user) {
    const prior = checked(await db.from(table).select('id').eq('automation_id', rule.id).eq('lead_id', lead.id).in('status', ['sent', 'uncertain']).neq('id', id).limit(1));
    if (prior.length) reason = 'Ya recibió la respuesta';
  }
  if (reason) { await update(db, table, id, { status: 'blocked', error: reason }); return; }
  const step = rule ? (rule.dm_audio_url ? { kind: 'audio', audio_url: rule.dm_audio_url } : { kind: 'text', text: rule.dm_text }) : item;
  const sent = await meta.send(messagePayload({ id: lead.instagram_user_id }, step));
  try { await update(db, table, id, { status: 'sent', sent_at: new Date().toISOString(), message_id: sent.message_id, error: null }); }
  catch { throw Object.assign(new Error('Mensaje enviado; falló registrar el resultado'), { uncertain: true }); }
}
