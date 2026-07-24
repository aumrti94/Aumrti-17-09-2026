const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const projectRef = process.env.SUPABASE_PROJECT_REF;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;
// Pooler requires the user format to be: [db-user].[project-ref]
const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;

async function run() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to database");
    const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20261009000162_platform_contact_settings.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log("Migration executed successfully.");
    
    // Refresh schema cache
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log("PostgREST schema cache reloaded.");
    
  } catch (err) {
    console.error("Error executing migration:", err);
  } finally {
    await client.end();
  }
}

run();
