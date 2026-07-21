/**
 * Google Drive OAuth (code flow) — REST puro con `fetch`, sin dependencia `googleapis`.
 *
 * Flujo:
 *   buildAuthUrl()        → URL de consentimiento (scope drive.readonly, offline, prompt=consent)
 *   exchangeCode(code)    → intercambia el `code` por tokens (incluye refresh_token)
 *   getValidAccessToken() → devuelve un access_token válido, refrescando y persistiendo si venció
 *
 * Los tokens viven en la tabla `google_tokens` (fila única, ver studio-types.ts).
 */
import { supabase } from '@/utils/supabase';
import type { GoogleTokens } from '@/lib/studio-types';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** La tabla `google_tokens` no existe todavía → la UI debe correr la migración. */
export class MigrationRequiredError extends Error {
  constructor(message = 'Falta correr la migración del Studio') {
    super(message);
    this.name = 'MigrationRequiredError';
  }
}

/** No hay tokens persistidos (o falta refresh_token) → el usuario debe conectar Drive. */
export class NotConnectedError extends Error {
  constructor(message = 'Google Drive no está conectado') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number };
}

interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
}

// ── Config ──────────────────────────────────────────────────────────────────
function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Faltan credenciales de Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI)',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Reconoce el error de Postgres "tabla inexistente" para mapearlo a 428. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01';
}

// ── OAuth ───────────────────────────────────────────────────────────────────
/** URL de consentimiento de Google. `access_type=offline` + `prompt=consent` garantizan refresh_token. */
export function buildAuthUrl(state?: string): string {
  const { clientId, redirectUri } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (state) params.set('state', state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Intercambia el `code` del callback por tokens y los persiste. */
export async function exchangeCode(code: string): Promise<void> {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Intercambio de código falló (${res.status}): ${await res.text()}`);
  }
  const tokens = (await res.json()) as GoogleTokenResponse;
  await persistTokens(tokens);
}

/** Refresca el access_token usando un refresh_token. */
async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = googleConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Refresh de token falló (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Devuelve un access_token válido; refresca y persiste si venció (margen 60s). */
export async function getValidAccessToken(): Promise<string> {
  const row = await loadTokenRow();
  if (!row || !row.refresh_token) throw new NotConnectedError();

  const expiryMs = row.expiry ? new Date(row.expiry).getTime() : 0;
  if (row.access_token && expiryMs - Date.now() > 60_000) {
    return row.access_token;
  }

  const refreshed = await refreshAccessToken(row.refresh_token);
  await persistTokens(
    { ...refreshed, refresh_token: refreshed.refresh_token ?? row.refresh_token },
    row.id,
  );
  return refreshed.access_token;
}

/** ¿Hay una conexión activa (fila con refresh_token)? Para el estado del DrivePicker. */
export async function isConnected(): Promise<boolean> {
  const row = await loadTokenRow();
  return Boolean(row?.refresh_token);
}

// ── Persistencia de tokens (fila única) ─────────────────────────────────────
async function loadTokenRow(): Promise<GoogleTokens | null> {
  const { data, error } = await supabase
    .from('google_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new MigrationRequiredError();
    throw new Error(error.message);
  }
  return (data as GoogleTokens | null) ?? null;
}

async function persistTokens(tokens: GoogleTokenResponse, existingId?: string): Promise<void> {
  const payload: Record<string, unknown> = {
    access_token: tokens.access_token,
    expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Google no reenvía refresh_token en cada refresh: sólo lo pisamos si vino uno nuevo.
  if (tokens.refresh_token) payload.refresh_token = tokens.refresh_token;

  let id = existingId;
  if (!id) id = (await loadTokenRow())?.id;

  const { error } = id
    ? await supabase.from('google_tokens').update(payload).eq('id', id)
    : await supabase.from('google_tokens').insert(payload);

  if (error) {
    if (isMissingTable(error)) throw new MigrationRequiredError();
    throw new Error(error.message);
  }
}

// ── Drive REST ──────────────────────────────────────────────────────────────
/** Lista imágenes del Drive del usuario (`mimeType contains 'image/'`). */
export async function listImageFiles(
  accessToken: string,
  pageToken?: string,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: "mimeType contains 'image/' and trashed = false",
    fields: 'nextPageToken, files(id, name, mimeType, thumbnailLink, imageMediaMetadata)',
    pageSize: '60',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive files.list falló (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
  return { files: json.files ?? [], nextPageToken: json.nextPageToken };
}

async function getFileMeta(accessToken: string, fileId: string): Promise<DriveFileMeta> {
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive files.get falló (${res.status}): ${await res.text()}`);
  return (await res.json()) as DriveFileMeta;
}

/** Baja los bytes de un archivo de Drive (`alt=media`) + su metadata (name/mimeType). */
export async function downloadFile(
  accessToken: string,
  fileId: string,
): Promise<{ bytes: ArrayBuffer; meta: DriveFileMeta }> {
  const meta = await getFileMeta(accessToken, fileId);
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive download falló (${res.status}): ${await res.text()}`);
  const bytes = await res.arrayBuffer();
  return { bytes, meta };
}
