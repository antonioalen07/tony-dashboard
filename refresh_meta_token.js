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

  const longToken = data.access_token;
  const days = data.expires_in ? Math.round(data.expires_in / 86400) : '≈60';
  console.log(`✓ Token de larga duración obtenido (expira en ${days} días).`);

  // 2) (Opcional) descubrir el IG account id; no es bloqueante
  let igId = null;
  try {
    const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=instagram_business_account&access_token=${longToken}`);
    const pages = await pagesRes.json();
    const page = pages.data?.find((p) => p.instagram_business_account);
    if (page) igId = page.instagram_business_account.id;
  } catch {}
  if (igId) console.log(`✓ IG account id detectado: ${igId}`);
  else console.log('• No se detectó IG account vía páginas; se usará el id por defecto del código.');

  // 3) Escribir .env.local
  let env = fs.readFileSync('./.env.local', 'utf8');
  env = env.replace(/META_ACCESS_TOKEN=.*/, `META_ACCESS_TOKEN=${longToken}`);
  if (igId) {
    if (/META_IG_ACCOUNT_ID=/.test(env)) env = env.replace(/META_IG_ACCOUNT_ID=.*/, `META_IG_ACCOUNT_ID=${igId}`);
    else env += `\nMETA_IG_ACCOUNT_ID=${igId}\n`;
  }
  fs.writeFileSync('./.env.local', env);
  console.log('✓ .env.local actualizado. Reiniciá el dev server (y actualizá la var en Vercel).');
})();
