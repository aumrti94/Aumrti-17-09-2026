# Edge Function patterns — detail

## Webhook receivers

A webhook endpoint runs with `verify_jwt = false`, so the **signature is the only authentication**.
Verify it before parsing, acting, or logging. From
[razorpay-webhook](../../../../supabase/functions/razorpay-webhook/index.ts):

```typescript
const signature = req.headers.get("x-razorpay-signature");
if (!signature) return json({ error: "Missing signature header" }, 401);

const rawBody = await req.text();          // raw text, NOT req.json() — the HMAC is over bytes

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(webhookSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
const computed = Array.from(new Uint8Array(sigBytes))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

if (computed !== signature) return json({ error: "Invalid signature" }, 401);

const event = JSON.parse(rawBody);         // parse only after verifying
```

`req.json()` before verification is the classic mistake — the signature covers the exact bytes, and
re-serialising changes them.

Beyond signatures:

- **Idempotency.** Providers retry. Key on the provider's event id and no-op on a repeat, or a
  retried payment webhook books the payment twice.
- **Return 2xx fast.** Acknowledge, then do slow work. A timeout looks like failure and triggers
  another retry.
- **Register the endpoint in `config.toml`** with `verify_jwt = false`, or every call 401s.

`webhook-dispatcher` and `webhook-dlq-processor` handle outbound webhooks with a dead-letter queue —
use them rather than fetching subscriber URLs inline.

## Rate limiting

```typescript
import { checkApiRateLimit } from "../_shared/api-rate-limit.ts";

const rl = await checkApiRateLimit(sb, `key:${apiKeyId}`, 100, 60, "closed");
if (!rl.allowed) {
  return json({ error: "Rate limit exceeded", retryAfter: rl.retryAfterSeconds }, 429);
}
```

Tumbling window; the window epoch is part of the counter key, so expiry needs no cleanup.

`onError` is the failure policy and it defaults to `"closed"` — if the counter itself is
unavailable, the call is **denied**. Keep `"closed"` for anything metered or paid. `"open"` is only
appropriate where blocking would harm patient care, and then the `degraded` flag on the result
should be logged so the fallback is visible.

ABDM has its own limiter in `_shared/abdm-rate-limit.ts` — the gateway's limits are externally
imposed and stricter.

## Scheduled jobs

Cron functions (`trial-lifecycle-cron`, `daily-leakage-scan`, `mrr-snapshot-job`,
`dunning-processor`, `lifecycle-nudge-scan`, `generate-daily-census`) are invoked by schedule with
no user context. So:

- There is no caller to authenticate and no `hospital_id` in a request body — **iterate hospitals
  explicitly** and scope each query to the current one. This is the easiest place to accidentally
  aggregate across tenants.
- Make the run idempotent and safe to re-run for the same date; schedulers double-fire.
- Log a per-hospital summary with counts only, never rows.
- Wrap per-hospital work so one tenant's failure doesn't abort the rest of the run.
- Times are IST-sensitive — a "daily" job at UTC midnight lands at 05:30 IST, mid-shift.

## AI functions

The AI path is governed; do not call a model provider directly from a new function.

```typescript
import { AIDisabledError, normalizeProviderKey } from "../_shared/ai-config.ts";
import { evaluateSafety, logSafetyFlags } from "../_shared/safety-guard.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
```

- **`ai-proxy`** is the single egress point. It resolves the provider and model, checks entitlement,
  and meters spend. Route through it.
- **Entitlement and budget** — `_shared/ai-entitlement.ts` and `src/lib/aiBudget.ts`. AI is a paid
  feature per hospital plan; an unentitled call must fail cleanly, not silently spend.
- **`safety-guard`** evaluates clinical AI output before it reaches a clinician:
  `evaluateSafety(...)` returns `SafetyFlag[]` with severity `critical | warning | info`, checked
  against `CONTROLLED_DRUGS`, `CROSS_REACTIVE` allergy families, and `DOSE_LIMITS`. Persist flags
  with `logSafetyFlags`. AI output is a suggestion requiring clinician confirmation — never an
  order, never auto-applied.
- **PHI**: send full context to the model (accuracy needs it), redact everything you *log*.
- `AIDisabledError` is the expected control-flow signal when AI is off for a hospital. Catch it and
  degrade the feature; do not surface it as a 500.

## ABDM / HCX integrations

`_shared/` carries `abdm-auth.ts` (gateway tokens), `abdm-encrypt.ts` (JWE), `abdm-audit.ts`, and
`abdm-rate-limit.ts`. Use them rather than re-implementing crypto per function.

The mode-selection pattern from `pmjay-eligibility` is the house standard for any government
integration, and it should be stated in the header comment:

1. Real gateway mode when the feature flag **and** credentials are present.
2. Direct API mode when only an API key is configured.
3. Sandbox mock as fallback.

Sandbox responses must be obviously synthetic. A mock that looks like a real eligibility approval
will eventually be believed by someone at a billing counter.

## Local development

```bash
npx supabase functions serve function-name --env-file .env.local
npm run supabase:deploy -- function-name
npx supabase secrets set PROVIDER_API_KEY=...
```

`supabase/functions/deno.json` holds the shared Deno config. Deno 2 per `config.toml`.

## Checklist

- [ ] `OPTIONS` → CORS preflight handled
- [ ] Caller's JWT verified with the anon client before any privileged work
- [ ] `hospital_id` from the body validated against the caller's own hospital
- [ ] Every service-role query filters `hospital_id`
- [ ] `.maybeSingle()`, never `.single()`
- [ ] `sanitizeForLog` on anything logged that could carry PHI; generic error text to the caller
- [ ] Secrets via `Deno.env.get`; missing credentials degrade rather than 500
- [ ] Webhook: signature verified over the raw body, before parsing; idempotent on event id
- [ ] Cron: iterates hospitals explicitly, idempotent, per-tenant failures isolated
- [ ] Header comment with operations and a `SECURITY:` block
- [ ] `npm run check:db-contract` (and `check:openapi` if gateway-exposed)