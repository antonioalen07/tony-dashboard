export function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
export function matches(text, automation) {
  const normalized = normalize(text);
  if (!normalized) return false;
  return automation.keywords.some((keyword) => {
    const key = normalize(keyword);
    if (!key) return false;
    if (automation.match_mode === 'exact') return normalized === key || (automation.fuzzy && key.length >= 3 && distance(normalized, key) <= 1);
    if (` ${normalized} `.includes(` ${key} `)) return true;
    return automation.fuzzy && key.length >= 3 && !key.includes(' ') && normalized.split(' ').some((word) => distance(word, key) <= 1);
  });
}
export function pickAutomation(comment, automations, accountId) {
  if (!comment.id || !comment.at || comment.userId === accountId || !Number.isFinite(Date.parse(comment.at))) return null;
  return [...automations].sort((a, b) => ({ media: 0, next_publish: 1, all: 2 }[a.scope] - { media: 0, next_publish: 1, all: 2 }[b.scope]) || a.created_at.localeCompare(b.created_at)).find((a) => a.active && a.scope !== 'next_publish' && (a.scope === 'all' || a.media_id === comment.mediaId) && Date.parse(comment.at) >= Date.parse(a.starts_at) && matches(comment.text, a)) || null;
}
