const fs = require('fs');

async function runBackfill() {
  const envText = fs.readFileSync('.env.local', 'utf-8');
  const urlMatch = envText.match(/VITE_SUPABASE_URL=([^\r\n]+)/);
  const keyMatch = envText.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/);

  if (!urlMatch || !keyMatch) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    return;
  }

  const url = `${urlMatch[1]}/functions/v1/phi-backfill-encrypt`;
  const headers = {
    'Authorization': `Bearer ${keyMatch[1]}`,
    'Content-Type': 'application/json'
  };

  const targets = [
    { table: 'patients', column: 'phone' },
  ];

  for (const target of targets) {
    console.log(`Starting backfill for ${target.table}.${target.column}...`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(target)
      });
      const data = await res.json();
      console.log(`Result for ${target.table}.${target.column}:`, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Error for ${target.table}.${target.column}:`, err.message);
    }
  }
}

runBackfill();
