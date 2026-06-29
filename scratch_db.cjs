require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .rpc('get_policies'); // If it doesn't exist, let's select from pg_policies via a generic query or a raw sql RPC if available, or just direct query

  const { data: policies, error: err } = await supabase
    .from('pg_policies') // Usually not exposed via postgrest unless explicitly mapped, let's try
    .select('*')
    .eq('tablename', 'radiology_orders');

  if (err) {
    console.error('Error fetching pg_policies:', err);
    // Let's do another query: what's the definition of radiology_orders? Let's check if we can query some active orders or users to get their hospital_id.
    const { data: users, error: userErr } = await supabase.from('users').select('*').limit(2);
    console.log('Users:', users, 'Error:', userErr);
  } else {
    console.log('Policies on radiology_orders:', policies);
  }
}

main();
