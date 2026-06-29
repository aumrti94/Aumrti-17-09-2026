const { execSync } = require('child_process');
const crypto = require('crypto');

console.log("1. Pushing DB migrations...");
try {
  execSync('npx dotenv -e .env.local -- supabase db push --include-all', { stdio: 'inherit' });
} catch (e) {
  console.error("Failed to push migrations. They might already be applied or there's an error.");
}

console.log("\n2. Setting PHI_MASTER_KEY...");
const masterKey = crypto.randomBytes(32).toString('hex');
try {
  execSync(`npx dotenv -e .env.local -- supabase secrets set PHI_MASTER_KEY=${masterKey}`, { stdio: 'inherit' });
} catch (e) {
  console.error("Failed to set secret.");
}

console.log("\n3. Deploying phi-backfill-encrypt function...");
try {
  execSync('npx dotenv -e .env.local -- supabase functions deploy phi-backfill-encrypt', { stdio: 'inherit' });
} catch (e) {
  console.error("Failed to deploy function.");
}
