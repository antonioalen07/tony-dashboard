const { ApifyClient } = require('apify-client');
require('dotenv').config({ path: './.env.local' });

const apifyClient = new ApifyClient({
  token: process.env.APIFY_API_TOKEN,
});

async function test() {
  try {
    console.log('Testing Apify sync for tony.ia_...');
    const input = {
      search: 'tony.ia_',
      searchType: 'user',
      resultsType: 'posts',
      resultsLimit: 2,
    };

    console.log('Calling actor...');
    const run = await apifyClient.actor('apify/instagram-scraper').call(input);
    console.log('Run finished. Fetching items...');
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    console.log(`Fetched ${items.length} items from Apify`);
    if (items.length > 0) {
      console.log('Sample item:', items[0]);
    }
  } catch (error) {
    console.error('Test Error:', error);
  }
}

test();
