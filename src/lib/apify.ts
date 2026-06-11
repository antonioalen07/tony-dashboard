/**
 * Helpers REST asíncronos para Apify (start run + poll + fetch items).
 * Evita esperas sync largas: cada llamada HTTP es corta, así el cliente
 * puede orquestar el polling (compatible con límites de Vercel).
 */

const BASE = 'https://api.apify.com/v2';

const token = () => {
  const t = process.env.APIFY_API_TOKEN;
  if (!t) throw new Error('APIFY_API_TOKEN no configurada');
  return t;
};

export interface ApifyRunRef {
  runId: string;
  datasetId: string;
  status: string;
}

/** Arranca un run del actor sin esperar a que termine. */
export async function startRun(actorId: string, input: object): Promise<ApifyRunRef> {
  const safeActor = actorId.replace('/', '~');
  const res = await fetch(`${BASE}/acts/${safeActor}/runs?token=${token()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok || !json?.data?.id) {
    throw new Error(`Apify startRun falló (${res.status}): ${json?.error?.message || 'sin detalle'}`);
  }
  return {
    runId: json.data.id,
    datasetId: json.data.defaultDatasetId,
    status: json.data.status,
  };
}

/** Estado actual de un run: READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT */
export async function getRunStatus(runId: string): Promise<string> {
  const res = await fetch(`${BASE}/actor-runs/${runId}?token=${token()}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`Apify getRun falló (${res.status})`);
  return json?.data?.status || 'UNKNOWN';
}

export async function getDatasetItems(datasetId: string): Promise<any[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?token=${token()}&clean=true`);
  if (!res.ok) throw new Error(`Apify getItems falló (${res.status})`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

export const isTerminal = (status: string) =>
  ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status);
