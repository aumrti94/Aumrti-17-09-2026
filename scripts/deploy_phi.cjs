// DANGER — this mints a NEW PHI_MASTER_KEY every time it runs (line ~12) and overwrites the
// existing secret unconditionally. If PHI has already been encrypted under the current key,
// re-running this script replaces that key with one that cannot decrypt it: the existing
// ciphertext becomes permanently unrecoverable, with no re-encryption path. Confirm no PHI is
// currently encrypted under the live PHI_MASTER_KEY before running this a second time. Its
// near-duplicate scripts/deploy_phi.js was removed 2026-09-05 — this is now the only version.
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
