export const GRAPH_VERSION = 'v23.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export class MetaError extends Error {
  constructor(message, { transient = false, uncertain = false, code = 0 } = {}) { super(message); this.transient = transient; this.uncertain = uncertain; this.code = code; }
}
export function createMeta(env, fetcher = fetch) {
  let pageToken;
  const pageId = env.META_PAGE_ID || '1061609440358642';
  const accountId = env.META_IG_ACCOUNT_ID || '17841476480622974';
  async function request(path, token, body) {
    const url = new URL(path.startsWith('https:') ? path : `${GRAPH_BASE}/${path}`);
    if (url.origin !== 'https://graph.facebook.com') throw new Error('Paginación de Meta inválida');
    url.searchParams.delete('access_token');
    let response;
    try {
      response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    } catch { throw new MetaError('Meta no confirmó el resultado de la solicitud', { transient: !body, uncertain: !!body }); }
    let data;
    try { data = await response.json(); } catch { throw new MetaError('Respuesta inválida de Meta', { transient: !body, uncertain: !!body }); }
    if (!response.ok || data.error) {
      const code = data.error?.code;
      if (code === 190) pageToken = undefined;
      let message = data.error?.message || `Meta respondió ${response.status}`;
      for (const secret of [token, env.META_ACCESS_TOKEN].filter(Boolean)) message = message.replaceAll(secret, '[REDACTADO]');
      throw new MetaError(message, { code, transient: [4, 17, 32, 613, 190].includes(code) || data.error?.is_transient || response.status === 429, uncertain: !!body && response.status >= 500 });
    }
    return data;
  }
  async function getToken() {
    if (!env.META_ACCESS_TOKEN) throw new Error('Falta META_ACCESS_TOKEN');
    if (!pageToken) {
      const data = await request(`${pageId}?fields=access_token`, env.META_ACCESS_TOKEN);
      if (!data.access_token) throw new Error('Meta no devolvió el token de la página');
      pageToken = data.access_token;
    }
    return pageToken;
  }
  return {
    accountId,
    get: (path) => request(path, env.META_ACCESS_TOKEN),
    pageGet: async (path) => request(path, await getToken()),
    post: async (path, body) => request(path, await getToken(), body),
    send: async (body) => {
      // Endpoint configurable tras la prueba; sin fallback automático ante errores ambiguos.
      const endpoint = env.META_MESSAGING_ENDPOINT === 'instagram' ? accountId : pageId;
      const result = await request(`${endpoint}/messages`, await getToken(), body);
      if (!result.message_id) throw new MetaError('Meta no devolvió message_id: revisá el envío', { uncertain: true });
      return result;
    },
  };
}
