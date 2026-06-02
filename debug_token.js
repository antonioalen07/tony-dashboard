require('dotenv').config({ path: './.env.local' });

async function debugToken() {
  const token = process.env.META_ACCESS_TOKEN;
  
  if (!token) {
    console.error("No token found");
    return;
  }

  try {
    // 1. Check token info (scopes, who it belongs to)
    console.log("Checking token scopes...");
    const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
    const debugData = await debugRes.json();
    console.log("Token Data:", JSON.stringify(debugData.data, null, 2));

    if (debugData.data && debugData.data.scopes) {
       console.log("Granted Scopes:", debugData.data.scopes);
    }

    // 2. See what pages are returned
    console.log("\nFetching /me/accounts...");
    const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${token}`);
    const pagesData = await pagesRes.json();
    console.log("Pages Data:", JSON.stringify(pagesData, null, 2));

  } catch (err) {
    console.error("Error debugging token:", err);
  }
}

debugToken();
