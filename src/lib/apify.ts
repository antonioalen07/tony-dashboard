/**
 * Helpers REST asíncronos para Apify (start run + poll + fetch items).
 * Evita esperas sync largas: cada llamada HTTP es corta, así el cliente
 * puede orquestar el polling (compatible con límites de Vercel).
 *
 * POOL DE KEYS: `APIFY_API_TOKEN`, `APIFY_API_TOKEN_2`, `APIFY_API_TOKEN_3`…
 * Se usan en orden; si Apify rechaza una por crédito/límite agotado (el plan
 * FREE corta en USD 5 por ciclo), se reintenta con la siguiente. Así las keys
 * gratuitas se gastan de a una y la de reserva solo entra cuando hace falta.
 *
 * Un run PERTENECE a la cuenta que lo lanzó: el polling y la lectura del
 * dataset tienen que usar la misma key. Por eso `startRun` devuelve `tokenIdx`
 * y `getRunStatus` / `getDatasetItems` lo reciben.
 */

const BASE = 'https://api.apify.com/v2';

/** Keys configuradas, en orden de preferencia. */
export function apifyTokens(): string[] {
  const keys: string[] = [];
  const first = process.env.APIFY_API_TOKEN;
  if (first) keys.push(first.trim());
  for (let i = 2; i <= 9; i++) {
    const k = process.env[`APIFY_API_TOKEN_${i}`];
    if (k) keys.push(k.trim());
  }
  return keys.filter(Boolean);
}

const tokenAt = (idx: number) => {
  const keys = apifyTokens();
  if (keys.length === 0) throw new Error('APIFY_API_TOKEN no configurada');
  return keys[idx] ?? keys[0];
};

/**
 * ¿El error dice que ESTA key no puede seguir (sin crédito, límite, key
 * inválida)? Ahí conviene probar la siguiente. Otros errores (input inválido,
 * actor inexistente) se repetirían igual con cualquier key: no se reintentan.
 */
export function isQuotaError(status: number, message = ''): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  return /limit|usage|credit|insufficient|exceed|quota|plan|payment|platform-feature-disabled/i.test(message);
}

/**
 * Ejecuta `fn` con cada key del pool hasta que una funcione. `fn` debe tirar un
 * `ApifyError` (o cualquier Error con `status`) para que se decida si saltar.
 */
export async function withApifyToken<T>(fn: (token: string, idx: number) => Promise<T>): Promise<T> {
  const keys = apifyTokens();
  if (keys.length === 0) throw new Error('APIFY_API_TOKEN no configurada');
  let lastErr: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await fn(keys[i], i);
    } catch (e) {
      lastErr = e;
      const err = e as { status?: number; statusCode?: number; message?: string };
      const status = Number(err?.status ?? err?.statusCode ?? 0);
      if (!isQuotaError(status, String(err?.message || ''))) throw e;
      console.warn(`Apify key #${i + 1} rechazada (${status || 'sin status'}): ${err?.message}. Probando la siguiente…`);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : 'sin detalle';
  throw new Error(
    keys.length > 1
      ? `Todas las keys de Apify (${keys.length}) están sin crédito o rechazadas: ${msg}`
      : `Apify rechazó la key (¿sin crédito?): ${msg}`,
  );
}

class ApifyError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface ApifyRunRef {
  runId: string;
  datasetId: string;
  status: string;
  /** Índice de la key que lanzó el run: hay que pasarlo al hacer polling. */
  tokenIdx: number;
}

/** Arranca un run del actor sin esperar a que termine. */
export async function startRun(actorId: string, input: object): Promise<ApifyRunRef> {
  const safeActor = actorId.replace('/', '~');
  return withApifyToken(async (token, tokenIdx) => {
    const res = await fetch(`${BASE}/acts/${safeActor}/runs?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.data?.id) {
      throw new ApifyError(
        `Apify startRun falló (${res.status}): ${json?.error?.message || json?.error?.type || 'sin detalle'}`,
        res.status,
      );
    }
    return {
      runId: json.data.id,
      datasetId: json.data.defaultDatasetId,
      status: json.data.status,
      tokenIdx,
    };
  });
}

/** Estado actual de un run: READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT */
export async function getRunStatus(runId: string, tokenIdx = 0): Promise<string> {
  const res = await fetch(`${BASE}/actor-runs/${runId}?token=${tokenAt(tokenIdx)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`Apify getRun falló (${res.status})`);
  return json?.data?.status || 'UNKNOWN';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- items del actor: forma libre, se normalizan en viral.ts
export async function getDatasetItems(datasetId: string, tokenIdx = 0): Promise<any[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?token=${tokenAt(tokenIdx)}&clean=true`);
  if (!res.ok) throw new Error(`Apify getItems falló (${res.status})`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/**
 * Corre el actor y espera el resultado en UNA llamada (endpoint
 * run-sync-get-dataset-items). Para scrapes cortos de un solo post.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- items del actor: forma libre
export async function runSyncItems(actorId: string, input: object, timeoutSecs = 120): Promise<any[]> {
  const safeActor = actorId.replace('/', '~');
  return withApifyToken(async (token) => {
    const res = await fetch(
      `${BASE}/acts/${safeActor}/run-sync-get-dataset-items?token=${token}&clean=true&timeout=${timeoutSecs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    );
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (json as { error?: { message?: string; type?: string } } | null)?.error;
      const msg = e?.message || e?.type || 'sin detalle';
      throw new ApifyError(`Apify falló (${res.status}): ${msg}`, res.status);
    }
    return Array.isArray(json) ? json : [];
  });
}

export const isTerminal = (status: string) =>
  ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status);
