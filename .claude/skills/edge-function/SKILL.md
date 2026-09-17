---
name: edge-function
description: Use when creating or modifying a Supabase Edge Function in supabase/functions/ — any server-side Deno endpoint, webhook receiver, scheduled job, external API integration (ABDM, HCX, PMJAY, Razorpay, WhatsApp, Bhashini), or AI proxy. Covers the required CORS/auth/response skeleton, the service-role tenant-scoping trap, PHI redaction in logs, and secrets handling.
---

# Supabase Edge Functions

109 functions live in `supabase/functions/`. They run on Deno, not Node — imports are URLs, there
is no `node_modules`, and `process.env` does not exist.

Exemplars: [cghs-eligibility](../../../supabase/functions/cghs-eligibility/index.ts) for the basic
shape, [upsert-patient-phi](../../../supabase/functions/upsert-patient-phi/index.ts) for a function
that documents its own security posture — copy that habit.

## The skeleton

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  // MANDATORY — without it every browser call fails preflight.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { hospital_id, patient_id } = await req.json();
    if (!hospital_id) return json({ error: "hospital_id required" }, 400);

    // 1. Verify the CALLER with their own JWT, using the anon key.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 2. Confirm the caller actually belongs to the hospital they named.
    const { data: staff } = await anonClient
      .from("users")
      .select("id, hospital_id, role")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!staff || staff.hospital_id !== hospital_id) {
      return json({ error: "Forbidden" }, 403);
    }

    // 3. Only now escalate to service-role for work RLS would block.
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await sb
      .from("some_table")
      .select("*")
      .eq("hospital_id", hospital_id)      // REQUIRED — service role bypasses RLS
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    return json({ data });
  } catch (err) {
    console.error("function-name failed:", sanitizeForLog(String(err)));
    return json({ error: "Internal error" }, 500);
  }
});
```

## The one that bites: service role bypasses RLS

103 of 109 functions use `SUPABASE_SERVICE_ROLE_KEY`. That key ignores every RLS policy, which
means **tenant isolation stops being automatic the moment you use it**. Inside a function, the
`.eq("hospital_id", …)` filter is not defence in depth — it is the only thing standing between one
hospital and another's data.

Two rules follow:

1. **Every service-role query filters by `hospital_id`.** A lookup keyed only on a business
   identifier — beneficiary id, claim number, ABHA address — reads across all tenants.
2. **Never trust a `hospital_id` from the request body on its own.** The caller can send any uuid.
   Verify the caller belongs to it (step 2 above) before using it.

Use the anon client with the caller's JWT wherever the work does not actually need elevation. RLS
then does its job for free.

## PHI must not reach the logs

```typescript
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
console.log("payload", sanitizeForLog(JSON.stringify(body)));
```

Function logs are retained by the platform, so a `console.log(body)` in a patient-facing function is
a DPDP disclosure. The redactor strips Indian mobile numbers, Aadhaar-shaped digits, emails,
encrypted PHI blobs, HMAC hashes, and the common PHI JSON keys.

Apply it at logging and persistence boundaries only — **not** to an AI request payload, where
clinical accuracy needs the full context.

23 of 109 functions import it — every function that touches patient identifiers and logs an error
object. The rest either log nothing PHI-shaped or already extract only `err.name`. If you add a
`console.*` that could carry patient data to a function without the import, add the import too.

Never return a raw error object to the caller either — log the detail, return a generic message.

## Secrets and config

`Deno.env.get("NAME")` only; there is no `process.env` and no `.env` file at runtime. Secrets are
set with `npx supabase secrets set NAME=value` and are never committed.

Always present: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Degrade deliberately when an integration credential is absent. `pmjay-eligibility` is the model: HCX
mode if the feature flag and credentials exist, direct NHA BIS mode if the API key is set, sandbox
mock otherwise — and it says so in its header comment. A missing credential should never 500 a
clinical screen.

## JWT verification

Every function verifies its JWT by default. Opting out is explicit, in `supabase/config.toml`:

```toml
[functions.api-gateway]
verify_jwt = false
```

Only two kinds of function belong there: external webhook receivers that authenticate by signature
instead (Razorpay, HCX, ABDM callbacks), and the public API gateway. A webhook receiver **must**
verify the provider's signature — an unverified endpoint with `verify_jwt = false` is open to the
internet.

## Conventions worth matching

- **Header comment** describing operations, request/response shapes, and a `SECURITY:` block. The
  best functions here do this and it is the fastest way to review one.
- **`// @ts-nocheck`** is common at the top — Deno types and the Supabase client disagree in ways
  that are not worth fighting.
- **`.maybeSingle()`, never `.single()`** — `supabase/functions/` is now at zero `.single()` calls.
- **Pin your `std` version** in the import URL. Existing functions pin `0.168.0` and `0.177.0`;
  match a neighbouring function rather than floating to latest.
- **Shared helpers go in `_shared/`** — 21 modules already there (PHI crypto and redaction, ABDM
  auth/encrypt/audit/rate-limit, AI config and entitlement, safety guard, invoice PDF, WhatsApp,
  translation, platform billing). Check it before writing a helper.

## Deploying

```bash
npm run supabase:deploy -- function-name      # one function
npm run check:db-contract                     # .from()/.rpc() names in functions are scanned too
npm run check:openapi                         # if the function is exposed via api-gateway
```

`supabase/functions/` is inside the `check:db-contract` scan path, so a mistyped table name in a
function fails CI the same as one in `src/`.

Cron jobs, webhook receivers, the AI proxy path, and rate limiting:
[references/patterns.md](references/patterns.md).