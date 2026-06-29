const fs = require('fs');

async function run() {
  const envText = fs.readFileSync('.env.local', 'utf-8');
  const urlMatch = envText.match(/VITE_SUPABASE_URL=([^\r\n]+)/);
  const keyMatch = envText.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/);

  const res = await fetch(`${urlMatch[1]}/rest/v1/phi_backfill_log?select=*&order=started_at.desc&limit=5`, {
    headers: {
      'Authorization': `Bearer ${keyMatch[1]}`,
      'apikey': keyMatch[1]
    }
  });
  console.log(await res.text());
}
run();
