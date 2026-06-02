require('dotenv').config({ path: './.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function cleanTable() {
  console.log('Deleting old reels...');
  const { error } = await supabase.from('reels').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) {
    console.error('Error deleting:', error);
  } else {
    console.log('Reels table cleaned! You can now re-sync from Meta.');
  }
}

cleanTable();
