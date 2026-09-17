---
name: platform-control-plane
description: Use when working on the SaaS control plane — subscription plans and pricing, trials, entitlements and module gating, add-on SKUs, tenant provisioning, Razorpay billing and webhooks, dunning, or the platform admin cockpit. This is how Aumrti bills hospitals as customers, distinct from how a hospital bills its own patients.
---

# Platform control plane

Two billing systems live in this repo and they must never be confused:

| | Skill |
|---|---|
| A hospital billing **its patients** | [billing-and-gst](../billing-and-gst/SKILL.md) |
| Aumrti billing **hospitals** | this one |

Control-plane tables are `platform_*` and `hospital_subscriptions`; the money helpers are
`platformBilling.ts`, not `billTotals.ts`.

## The rule that outranks the rest

**A subscription lockout is read-only, never a lockout screen.**

> A live hospital must never lose the ability to read its own medical records over a billing
> dispute.

Writes are refused; reads, exports, and printing keep working. There is no configuration under
which an unpaid invoice hides a patient's chart. Anything that would block a read is wrong,
regardless of how overdue the account is.

```typescript
import { resolveSubscriptionAccess, SUBSCRIPTION_GRACE_DAYS,
         SUBSCRIPTION_BLOCKED_MESSAGE } from "@/lib/subscriptionAccess";

const access = resolveSubscriptionAccess(subscription, new Date(), graceDays);
// { blocked, reason, graceEndsAt, inGrace }
```

`reason` is `"trial_expired" | "suspended" | "cancelled" | "past_due"`.
`SUBSCRIPTION_BLOCKED_MESSAGE` is the single message shown wherever a write is refused — don't write
a second wording.

How the states resolve — the fail-open branches are deliberate, not oversights:

- **No subscription row** → allowed. Never lock out on missing data.
- **`suspended` / `cancelled`** → blocked immediately, no grace.
- **`trial`** with no `trial_ends_at` → allowed; an open-ended trial never auto-blocks.
- **`trial`** past its end → `inGrace` until `trial_ends_at + graceDays`, then blocked.
- **`past_due`** with no `past_due_since` → allowed; the webhook stamps that anchor, and until it
  does there is nothing to count from.
- An unparseable date → allowed.

`SUBSCRIPTION_GRACE_DAYS` (3) is only the fallback. The live value is
`platform_billing_settings.access_grace_days`, configured at /platform → Payments and threaded in
as `graceDays`. Don't hardcode 3.

Client-side enforcement is `subscriptionLock.ts` — `setSubscriptionLock`, `isSubscriptionLocked`,
and `shouldBlockRequest(url, method)`, which lets reads through and refuses writes.

## Entitlements — three layers, one resolution

Access is the composition of **plan** → **hospital overrides** → **role permissions**. All three
resolve in one place; never re-derive one of them locally.

```typescript
import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";
import { useModuleAccess } from "@/components/access/useModuleAccess";

const { enabledModules, isLoading } = useSubscriptionConfig();
const { tabAllowed, actionAllowed } = useModuleAccess();
```

`isModuleKeyAllowed(moduleKey, enabledModules)` has an important shape: a module in `ALWAYS_ENABLED`
is always allowed, and a key **not** in `CANONICAL_MODULE_KEYS` is treated as untracked and
therefore allowed. New modules are opt-in to gating — if you want a module gated, register its key
in `moduleKeys.ts`, or it ships enabled for everyone.

`resolveEntitlement` in `entitlementResolve.ts` produces the `EntitlementMap`
(`{ [module]: { tabs, actions } }`); `applyUserOverrides` in `moduleRegistry.ts` layers per-user
grants on top. `PERMISSION_MODULES` is the module catalogue and `LEGACY_MODULE_PARENT` maps
retired keys to their current parent — check it before assuming a key is unknown.

Entitlement gating is commercial, not security. The security boundary is RLS.

## Pricing

```typescript
import { resolveEffectivePrice, effectiveMonthlyAmount, isOverrideActive,
         type BillingCycle, type PlanPricing } from "@/lib/platformBilling";
```

Plan price is not a single column. It composes:

- Base `price_monthly` / `price_yearly` on the plan.
- **Bed-band pricing (v3)** — `beds_included`, `bed_block_size`, `price_per_bed_block`, and its
  yearly counterpart. `beds_included: null` means bed count never affects this plan's price.
- **Time-bounded overrides** — negotiated pricing per hospital. `isOverrideActive(o, asOf)` decides
  whether one applies today; an expired override must fall back to list price, not linger.
- **Add-ons** — `addonsMonthlyTotal` / `addonsYearlyTotal` / `activeSkus` from `addons.ts`.
- `is_custom_price` marks plans quoted manually; don't compute a number for these.

Always go through `resolveEffectivePrice`. Platform invoices carry GST too, and it is
**inclusive** — `InclusiveGstSplit` in `platformBilling.ts` handles extracting tax from a
tax-inclusive figure, which is the opposite direction from patient billing. Don't reuse
`splitGst` here.

## Subscription lifecycle

`trial → active → past_due → suspended → cancelled`, driven by Razorpay webhooks
(`razorpay-subscription-webhook`, `razorpay-webhook`) plus scheduled jobs (`trial-lifecycle-cron`,
`dunning-processor`, `lifecycle-nudge-scan`, `mrr-snapshot-job`, `churn-remediation-scan`).

Webhook rules from [edge-function](../edge-function/SKILL.md) apply in full — verify the signature
over the raw body, be idempotent on the provider's event id, return 2xx fast. A double-processed
subscription webhook charges a hospital twice.

State transitions are driven **by the webhook**, not by the UI optimistically. `past_due_since` in
particular is the anchor the entire grace calculation depends on.

Provisioning a new tenant is `register-hospital` / `setup-hospital`; teardown is `delete-hospital`
and `purge-orphaned-users`. Provisioning creates the hospital row, the first admin user, and the
default entitlements — all three, or the tenant exists but nobody can sign in.

## Platform admin vs hospital staff

The cockpit under `src/pages/platform/` is Aumrti-internal and crosses tenants by design. It is the
one place hospital-scoped assumptions do not hold.

- Gate on `useAumrtiAdmin`, not on a hospital role.
- Platform staff tables (`platform_incidents`, `platform_support_tickets`, `platform_feature_flags`,
  …) legitimately FK to `auth.users(id)` and are listed in the `check:user-fk` ALLOWLIST. That is
  the documented exception to the `public.users` rule.
- Impersonation (`admin-impersonate-start`, `@/lib/impersonation`) must be audited, time-bounded,
  and visibly indicated in the UI while active.
- Cross-tenant aggregates are for platform screens only. Never let one leak into a hospital-facing
  view.

## Before you call it done

```bash
npm run lint
npm run check:db-contract
```

`resolveSubscriptionAccess`, `resolveEffectivePrice`, `isOverrideActive`, `addonsMonthlyTotal`, and
`isModuleKeyAllowed` are pure — test the boundaries, especially grace-period edges and expiring
overrides.

Feature flags, PLG/self-serve, usage metering, and the analytics surface:
[references/patterns.md](references/patterns.md).