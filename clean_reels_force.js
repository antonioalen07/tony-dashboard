require('dotenv').config({ path: './.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function cleanTable() {
  console.log('Fetching all reels to delete...');
  const { data, error: fetchErr } = await supabase.from('reels').select('id');
  
  if (fetchErr) {
    console.error('Error fetching:', fetchErr);
    return;
  }
  
  if (data && data.length > 0) {
    const ids = data.map(r => r.id);
    console.log(`Found ${ids.length} reels. Deleting...`);
    
    // Delete in chunks if necessary, but for small amounts this is fine
    for (let id of ids) {
      await supabase.from('reels').delete().eq('id', id);
    }
    console.log('Reels table completely cleaned!');
  } else {
    console.log('Table is already empty.');
  }
}

cleanTable();
