import { ApifyClient } from 'apify-client';

/**
 * Resuelve el mp4 real de un post/reel de Instagram a partir de su permalink,
 * usando el actor `apify/instagram-scraper`. Devuelve una URL de CDN fresca
 * (Apify re-scrapea al momento, así que no depende de que la URL de Meta venza).
 * Reutilizado por la transcripción y por la generación de variantes desde reels.
 */
export async function resolveInstagramVideoUrl(postUrl: string): Promise<string> {
  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) throw new Error('APIFY_API_TOKEN no configurada');
  if (!postUrl?.startsWith('http')) throw new Error('URL de Instagram inválida');

  const apify = new ApifyClient({ token: apifyToken });
  const run = await apify.actor('apify/instagram-scraper').call({
    directUrls: [postUrl],
    resultsType: 'posts',
    resultsLimit: 1,
    addParentData: false,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  const item: any = items[0];
  const videoUrl: string | undefined = item?.videoUrl || item?.videoUrlBackup || item?.video_url;
  if (!videoUrl) {
    throw new Error('Apify no devolvió la URL del video (¿el post es público y tiene video?)');
  }
  return videoUrl;
}

/**
 * Pipeline compartido de transcripción de un post/reel de Instagram:
 *   permalink -> Apify (obtiene el mp4) -> descarga -> ElevenLabs STT (Scribe).
 * Usado por /api/transcribe (reels propios) y /api/inspiration/adapt (bangers).
 */
export async function transcribeInstagramPost(postUrl: string): Promise<string> {
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) throw new Error('ELEVENLABS_API_KEY no configurada');

  // 1. Apify -> mp4 del post
  const videoUrl = await resolveInstagramVideoUrl(postUrl);

  // 2. Descargar el mp4
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`No se pudo descargar el video (${videoRes.status})`);
  const videoBuffer = await videoRes.arrayBuffer();
  const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

  // 3. ElevenLabs Speech-to-Text (Scribe)
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('file', videoBlob, 'reel.mp4');

  const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey },
    body: form,
  });
  if (!sttRes.ok) {
    const errText = await sttRes.text();
    console.error('ElevenLabs STT error:', errText);
    throw new Error(`ElevenLabs falló (${sttRes.status})`);
  }

  const sttData = await sttRes.json();
  const transcript = (sttData.text || '').trim();
  if (!transcript) throw new Error('La transcripción salió vacía');
  return transcript;
}
