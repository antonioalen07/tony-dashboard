import { pickAutomation } from './match.mjs';
export function checked(result) { if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code }); return result.data; }
export async function enqueueComment(db, comment, automations, accountId, source) {
  const automation = pickAutomation(comment, automations, accountId);
  if (!automation) return;
  checked(await db.rpc('automation_enqueue_comment', { p_automation: automation.id, p_comment: comment.id, p_media: comment.mediaId, p_user: comment.userId || null, p_username: comment.username || null, p_text: comment.text || '', p_at: comment.at, p_source: source, p_account: accountId }));
}
export function windowOpen(lead, now = Date.now()) {
  const at = Date.parse(lead?.last_inbound_at || '');
  return !lead?.opted_out && Number.isFinite(at) && at <= now && now - at < 24 * 60 * 60 * 1000;
}
export function messagePayload(recipient, step) {
  return { recipient, message: step.kind === 'audio' ? { attachment: { type: 'audio', payload: { url: step.audio_url } } } : { text: step.text } };
}
