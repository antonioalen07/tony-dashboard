const fs = require('fs');
require('dotenv').config({ path: './.env.local' });

async function exchangeToken() {
  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const shortToken = process.env.META_ACCESS_TOKEN;

    if (!appId || !appSecret || !shortToken) {
      console.error('Missing META_APP_ID, META_APP_SECRET, or META_ACCESS_TOKEN');
      return;
    }

    console.log('Exchanging token...');
    // 1. Get Long-Lived Token
    const url = `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
    const tokenRes = await fetch(url);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error('Error exchanging token:', tokenData.error);
      return;
    }

    const longLivedToken = tokenData.access_token;
    console.log('Got long-lived token!');

    // 2. Get Facebook Pages
    console.log('Fetching Facebook Pages...');
    const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${longLivedToken}`);
    const pagesData = await pagesRes.json();

    if (pagesData.error || !pagesData.data || pagesData.data.length === 0) {
      console.error('Error fetching pages or no pages found:', pagesData);
      return;
    }

    const pageId = pagesData.data[0].id;
    console.log(`Found Facebook Page ID: ${pageId}`);

    // 3. Get Instagram Business Account ID
    console.log('Fetching Instagram Business Account ID...');
    const igRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}?fields=instagram_business_account&access_token=${longLivedToken}`);
    const igData = await igRes.json();

    if (igData.error || !igData.instagram_business_account) {
      console.error('Error fetching IG account or no IG account linked:', igData);
      return;
    }

    const igAccountId = igData.instagram_business_account.id;
    console.log(`Found Instagram Account ID: ${igAccountId}`);

    // Update .env.local
    let envContent = fs.readFileSync('./.env.local', 'utf8');
    
    // Replace short token with long token
    envContent = envContent.replace(
      new RegExp(`META_ACCESS_TOKEN=.*`),
      `META_ACCESS_TOKEN=${longLivedToken}`
    );

    // Add IG Account ID if not exists
    if (!envContent.includes('META_IG_ACCOUNT_ID=')) {
      envContent += `\nMETA_IG_ACCOUNT_ID=${igAccountId}\n`;
    } else {
      envContent = envContent.replace(
        new RegExp(`META_IG_ACCOUNT_ID=.*`),
        `META_IG_ACCOUNT_ID=${igAccountId}`
      );
    }

    fs.writeFileSync('./.env.local', envContent);
    console.log('Successfully updated .env.local with Long-Lived Token and IG Account ID.');

  } catch (err) {
    console.error('Exception:', err);
  }
}

exchangeToken();
