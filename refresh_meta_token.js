/**
 * Convierte un token de Meta de CORTA duración en uno de LARGA duración (~60 días)
 * y lo escribe en .env.local. No falla si no hay Página de Facebook vinculada
 * (ya tenemos el IG account id por defecto en el código).
 *
 * Uso:
 *   1) Conseguí un token corto fresco (Graph API Explorer) y pegalo en
 *      META_ACCESS_TOKEN dentro de .env.local
 *   2) node refresh_meta_token.js
 */
const fs = require('fs');
require('dotenv').config({ path: './.env.local' });

(async () => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const shortToken = process.env.META_ACCESS_TOKEN;

  if (!appId || !appSecret || !shortToken) {
    console.error('Faltan META_APP_ID, META_APP_SECRET o META_ACCESS_TOKEN en .env.local');
    process.exit(1);
  }

  // 1) Intercambio short -> long
  const url =
    `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.error('Error en el intercambio:', data.error.message);
    console.error('→ El token corto probablemente venció. Generá uno nuevo y reintentá.');
    process.exit(1);
  }

  const longUserToken = data.access_token;
  const days = data.expires_in ? Math.round(data.expires_in / 86400) : '≈60';
  console.log(`✓ Token de usuario de larga duración obtenido (expira en ${days} días).`);

  // 2) Buscar la Página vinculada para sacar un PAGE TOKEN PERMANENTE.
  //    Requiere que el token corto se haya generado con los permisos:
  //    pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights, business_management
  let igId = null;
  let pageToken = null;
  try {
    const pagesRes = await fetch(
      `https://graph.facebook.com/v20.0/me/accounts?fields=name,access_token,instagram_business_account&access_token=${longUserToken}`
    );
    const pages = await pagesRes.json();
    const page = pages.data?.find((p) => p.instagram_business_account) || pages.data?.[0];
    if (page) {
      if (page.instagram_business_account) igId = page.instagram_business_account.id;
      if (page.access_token) pageToken = page.access_token; // este NO expira
      console.log(`✓ Página detectada: ${page.name}${igId ? ' | IG ' + igId : ''}`);
    }
  } catch {}

  // Preferimos el page token (permanente); si no hay, usamos el de usuario (60 días).
  const finalToken = pageToken || longUserToken;
  if (pageToken) console.log('✓ PAGE TOKEN PERMANENTE obtenido (no expira). Usá este en Vercel.');
  else console.log('• No apareció Página con permisos → queda el token de 60 días.\n  (Regenerá el token corto tildando pages_show_list + pages_read_engagement para el permanente.)');

  // 3) Escribir .env.local
  let env = fs.readFileSync('./.env.local', 'utf8');
  env = env.replace(/META_ACCESS_TOKEN=.*/, `META_ACCESS_TOKEN=${finalToken}`);
  if (igId) {
    if (/META_IG_ACCOUNT_ID=/.test(env)) env = env.replace(/META_IG_ACCOUNT_ID=.*/, `META_IG_ACCOUNT_ID=${igId}`);
    else env += `\nMETA_IG_ACCOUNT_ID=${igId}\n`;
  }
  fs.writeFileSync('./.env.local', env);
  console.log('✓ .env.local actualizado. Copiá META_ACCESS_TOKEN a Vercel y redeploy.');
})();
