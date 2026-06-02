require('dotenv').config({ path: './.env.local' });

async function testFetchReels() {
  const token = process.env.META_ACCESS_TOKEN;
  const igAccountId = '17841476480622974'; // From granular scopes
  
  try {
    console.log("Fetching Reels from Meta...");
    const mediaRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,shortcode&limit=5&access_token=${token}`);
    const mediaData = await mediaRes.json();
    
    if (mediaData.error) {
      console.error("API Error fetching media:", mediaData.error);
      return;
    }

    console.log(`Fetched ${mediaData.data.length} media items.`);
    
    // Test fetching insights for the first reel
    const firstReel = mediaData.data.find(m => m.media_type === 'VIDEO');
    if (firstReel) {
      console.log(`Fetching insights for Reel ID: ${firstReel.id}`);
      const insightsRes = await fetch(`https://graph.facebook.com/v20.0/${firstReel.id}/insights?metric=reach,saved,shares,total_interactions&access_token=${token}`);
      const insightsData = await insightsRes.json();
      
      console.log("Reel Insights:");
      console.log(JSON.stringify(insightsData, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

testFetchReels();
