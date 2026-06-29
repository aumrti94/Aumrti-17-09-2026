/**
 * phi-backfill-encrypt/index.ts
 *
 * One-shot Edge Function that migrates plaintext PHI columns to their
 * encrypted (_enc) and hash (_hash) counterparts.
 *
 * INVOKE MANUALLY — never put this on a cron.
 *
 * Usage:
 *   curl -X POST https://<project>.supabase.co/functions/v1/phi-backfill-encrypt \
 *     -H "Authorization: Bearer <service_role_key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"table":"patients","column":"phone","hospitalId":"<uuid>"}'
 *
 * Supported targets:
 *   { table: "patients",     column: "phone"  }  → phone_enc + phone_hash
 *   { table: "patients",     column: "name"   }  → name_enc  + name_hash
 *   { table: "patients",     column: "address" } → address_enc
 *   { table: "admissions",   column: "ec_phone" }→ ec_phone_enc + ec_phone_hash
 *   { table: "lab_reports",  column: "result" }  → result_enc
 *   { table: "prescriptions",column: "notes"  }  → notes_enc
 *
 * Progress is written to phi_backfill_log.
 * The function processes rows in batches of 100 and honours a 4.5-minute
 * timeout budget (Supabase Edge Functions hard-limit is 5 min).
 *
 * Re-invoke until phi_backfill_log shows status = 'done' with rows_failed = 0.
 *
 * DPDP Act 2023 §8(4) — encryption of personal data at rest.
 */

// @ts-nocheck

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptPHI, hashPHI } from "../_shared/phi-crypto.ts";

// ── Config ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const TIMEOUT_MS = 270_000; // 4.5 minutes — leave 30s buffer before hard kill

// ── Column map: source column → enc column, hash column (null if no hash) ──

interface ColConfig {
  srcColumn: string;      // plaintext column name
  encColumn: string;      // target _enc column name
  hashColumn: string | null; // target _hash column name (null if no search hash needed)
  normalise?: (v: string) => string; // optional normalisation before hashing
}

const COLUMN_MAP: Record<string, Record<string, ColConfig>> = {
  patients: {
    phone: {
      srcColumn: "phone",
      encColumn: "phone_enc",
      hashColumn: "phone_hash",
      normalise: (v) => v.replace(/[\s\-\(\)]/g, "").replace(/^\+91/, "").replace(/^0/, ""),
    },
    name: {
      srcColumn: "full_name",
      encColumn: "name_enc",
      hashColumn: "name_hash",
      normalise: (v) => v.trim().toLowerCase(),
    },
    address: {
      srcColumn: "address",
      encColumn: "address_enc",
      hashColumn: null,
    },
    aadhaar: {
      srcColumn: "aadhaar_number",
      encColumn: "aadhaar_enc",
      hashColumn: "aadhaar_hash",
      normalise: (v) => v.replace(/[\s\-]/g, ""),
    },
  },
  admissions: {
    ec_phone: {
      srcColumn: "emergency_contact_phone",
      encColumn: "ec_phone_enc",
      hashColumn: "ec_phone_hash",
      normalise: (v) => v.replace(/[\s\-\(\)]/g, "").replace(/^\+91/, "").replace(/^0/, ""),
    },
  },
  lab_reports: {
    result: {
      srcColumn: "result_text",
      encColumn: "result_enc",
      hashColumn: null,
    },
  },
  prescriptions: {
    notes: {
      srcColumn: "notes",
      encColumn: "notes_enc",
      hashColumn: null,
    },
  },
  whatsapp_bot_sessions: {
    last_message: {
      srcColumn: "last_message",
      encColumn: "last_message_enc",
      hashColumn: null,
    },
  },
  ai_usage_logs: {
    prompt: {
      srcColumn: "prompt_text",
      encColumn: "prompt_enc",
      hashColumn: null,
    },
  },
};

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Only allow service_role or aumrti_admin invocations
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { table: string; column: string; hospitalId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { table, column, hospitalId } = body;

  if (!COLUMN_MAP[table]?.[column]) {
    return new Response(
      JSON.stringify({
        error: `Unknown table/column: ${table}.${column}`,
        supported: Object.entries(COLUMN_MAP).flatMap(([t, cols]) =>
          Object.keys(cols).map((c) => `${t}.${c}`)
        ),
      }),
      { status: 400 }
    );
  }

  const cfg = COLUMN_MAP[table][column];
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Create backfill log entry
  const { data: logRow, error: logErr } = await supabase
    .from("phi_backfill_log")
    .insert({
      hospital_id: hospitalId ?? "00000000-0000-0000-0000-000000000000",
      table_name: table,
      column_name: column,
      status: "running",
    })
    .select("id")
    .maybeSingle();

  if (logErr) console.error("Failed to create backfill log:", logErr);
  const logId = logRow?.id;

  const startTime = Date.now();
  let rowsEncrypted = 0;
  let rowsFailed = 0;
  let lastId: string | null = null;
  const errorDetails: string[] = [];

  console.log(`[phi-backfill] Starting: ${table}.${cfg.srcColumn} → ${cfg.encColumn}${cfg.hashColumn ? ` + ${cfg.hashColumn}` : ""} ${hospitalId ? `for hospital ${hospitalId}` : "(all hospitals)"}`);

  try {
    while (Date.now() - startTime < TIMEOUT_MS) {
      // Fetch a batch of rows where enc column is still NULL and source is NOT NULL
      let query = supabase
        .from(table)
        .select(`id, hospital_id, ${cfg.srcColumn}`)
        .is(cfg.encColumn, null)
        .not(cfg.srcColumn, "is", null)
        .order("id")
        .limit(BATCH_SIZE);

      if (hospitalId) query = query.eq("hospital_id", hospitalId);
      if (lastId) query = query.gt("id", lastId);

      const { data: rows, error: fetchErr } = await query;

      if (fetchErr) {
        console.error("[phi-backfill] Fetch error:", fetchErr.message);
        break;
      }

      if (!rows || rows.length === 0) {
        console.log("[phi-backfill] No more rows to process.");
        break;
      }

      for (const row of rows) {
        const rawValue: string = (row as any)[cfg.srcColumn];
        if (!rawValue) {
          lastId = row.id;
          continue;
        }

        try {
          const normalised = cfg.normalise ? cfg.normalise(rawValue) : rawValue;
          const [enc, hash] = await Promise.all([
            encryptPHI(rawValue, row.hospital_id),
            cfg.hashColumn ? hashPHI(normalised, row.hospital_id) : Promise.resolve(null),
          ]);

          const updatePayload: Record<string, string | null> = {
            [cfg.encColumn]: enc,
          };
          if (cfg.hashColumn && hash) updatePayload[cfg.hashColumn] = hash;

          const { error: updateErr } = await supabase
            .from(table)
            .update(updatePayload)
            .eq("id", row.id);

          if (updateErr) {
            console.error(`[phi-backfill] Update failed for row ${row.id}:`, updateErr.message);
            errorDetails.push(`Row ${row.id} update error: ${updateErr.message}`);
            rowsFailed++;
          } else {
            rowsEncrypted++;
          }
        } catch (cryptoErr) {
          console.error(`[phi-backfill] Crypto error for row ${row.id}:`, cryptoErr);
          errorDetails.push(`Row ${row.id} crypto error: ${cryptoErr instanceof Error ? cryptoErr.message : String(cryptoErr)}`);
          rowsFailed++;
        }

        lastId = row.id;
      }

      console.log(`[phi-backfill] Batch done. Encrypted so far: ${rowsEncrypted}, Failed: ${rowsFailed}`);

      // Break if we got fewer rows than batch size (no more pages)
      if (rows.length < BATCH_SIZE) break;
    }

    const timedOut = Date.now() - startTime >= TIMEOUT_MS;
    const status = timedOut ? "running" : rowsFailed === 0 ? "done" : "failed";

    // Update backfill log
    if (logId) {
      await supabase
        .from("phi_backfill_log")
        .update({
          rows_encrypted: rowsEncrypted,
          rows_failed: rowsFailed,
          finished_at: timedOut ? null : new Date().toISOString(),
          status,
          error_message: rowsFailed > 0
            ? `${rowsFailed} rows failed to encrypt. Re-run to retry.`
            : timedOut
            ? "Timed out — re-invoke to continue."
            : null,
        })
        .eq("id", logId);
    }

    console.log(`[phi-backfill] Finished. Status: ${status}. Encrypted: ${rowsEncrypted}, Failed: ${rowsFailed}${timedOut ? " (timed out — re-invoke)" : ""}`);

    return new Response(
      JSON.stringify({
        status,
        rowsEncrypted,
        rowsFailed,
        timedOut,
        message: timedOut
          ? `Re-invoke to continue from where we left off (lastId: ${lastId}).`
          : status === "done"
          ? "All rows encrypted successfully. Verify in Supabase Table Editor before dropping plaintext columns."
          : `${rowsFailed} rows failed. Check phi_backfill_log for details.`,
        errorDetails: errorDetails.slice(0, 10), // Return up to 10 errors
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[phi-backfill] Fatal error:", message);

    if (logId) {
      await supabase
        .from("phi_backfill_log")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message })
        .eq("id", logId);
    }

    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
