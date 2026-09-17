# Platform patterns — detail

## Two flag systems — don't cross them

They look alike and answer different questions:

| System | Question | Surface |
|---|---|---|
| **Entitlement** | Is this hospital *paying* for it? | `useSubscriptionConfig`, `useModuleAccess`, `plan_features`, `hospital_feature_overrides`, `product_modes` |
| **Feature flag** | Is this in-progress feature *visible* here yet? | `usePlatformFeatureFlag` → `resolve_feature_flag` RPC, `platform_feature_flags` |

```typescript
const { enabled, isLoading } = usePlatformFeatureFlag("new_icu_workspace");
```

Staged rollout is independent of billing. Gating an unfinished feature behind an entitlement means
a hospital that *pays* for it still can't see it — and the fix looks like a billing bug. Gating a
paid module behind a rollout flag means it silently ships to everyone.

`usePlatformFeatureFlag` defaults to `false` while loading (hide the unfinished thing), whereas
`useAIFeature` defaults to `true` (don't flash paid UI off). That asymmetry is deliberate — match
it when adding a new gate.

## API platform

`apiPlatform.ts` defines the public API surface: `ApiEnvironment` (`sandbox | production`),
`API_SCOPES`, `SCOPE_DESCRIPTIONS`, and `PHI_SCOPES`.

`PHI_SCOPES` is the subset that grants access to patient data. Treat granting one as a distinct,
audited decision — showing it in the same checkbox list as a read-only catalogue scope is how a
hospital admin gives an integrator more than they meant to.

Keys are issued per environment. A sandbox key must never resolve against production data.
Rate limiting is `checkApiRateLimit` with a `key:{api_key_id}` semantic key and the default
`"closed"` failure policy — a metered API should deny when the counter is unavailable.

`api-gateway` runs with `verify_jwt = false` (it authenticates by API key instead) and is the one
function whose route registry drives the published OpenAPI spec. Changing a route means
`npm run check:openapi` must pass — a spec describing endpoints that no longer behave that way is
worse than no spec, because integrators build against it.

## Usage metering

Metered dimensions include beds (bed-band pricing), staff seats, storage, AI spend, and ASR audio
seconds. Plan caps are `max_beds`, `max_staff`, `storage_included_gb`.

Exceeding a cap should **nudge, then bill** — never hard-stop a clinical action. A hospital that
admits one patient over its bed band is still running a ward; the correct response is an overage
line on the next invoice and a prompt to upgrade, not a refused admission.

Metering writes belong on the server, where the tenant is derived from the JWT — a client-reported
usage number is a client-controlled invoice.

## Product-led growth

`trackEvent(eventName, context?)` records product analytics. Event names should be stable and
coarse — a name derived from a variable produces an unqueryable long tail. No PHI in the context
object; product analytics is not a clinical audit trail and is routinely exported.

`useProductMode` / `productMode` drives self-serve vs enterprise presentation. Lifecycle automation
runs server-side: `lifecycle-nudge-scan`, `nps-survey-dispatch` / `nps-survey-respond`,
`churn-remediation-scan`, `donor-reengagement`.

Onboarding lives in `src/components/onboarding/`. Time-to-first-value is the metric that matters —
a hospital that hasn't registered a patient by the end of the trial will not convert, and
`trial-lifecycle-cron` is where that nudge belongs.

## Dunning

`dunning-processor` handles failed renewals. The sequence is retry → notify → grace → suspend, and
every step is reversible by payment.

Anchor everything on `past_due_since`. It is stamped by the webhook, and if it is absent
`resolveSubscriptionAccess` returns *allowed* — deliberately, since there is nothing to count from.
Never synthesise that timestamp client-side to "fix" a hospital showing as unblocked; that
backdates a lockout.

Notifications go to billing contacts, not to clinical staff. A nurse should never see a payment
failure notice.

## Platform analytics

`mrr-snapshot-job` writes periodic MRR snapshots; `platform-utils.ts` and the RevOps screens read
them. Snapshots are point-in-time and are **not** recomputed retroactively — a plan price change
today must not rewrite last month's MRR.

Cross-tenant aggregation is legitimate on these screens and nowhere else. Keep such queries inside
`src/pages/platform/` and `platform_*` tables so an audit can see the boundary.

## Testing

Pure and worth covering:

- `resolveSubscriptionAccess` — every status; missing row; open-ended trial; missing
  `past_due_since`; unparseable dates; exactly at `graceEndsAt` vs one ms past. The fail-open
  branches are the ones a refactor breaks, and breaking them locks a hospital out of its records.
- `resolveEffectivePrice` / `effectiveMonthlyAmount` — bed bands at exactly `beds_included`, one
  over, and one block over; yearly vs monthly; `is_custom_price`.
- `isOverrideActive` — starting today, ending today, expired.
- `addonsMonthlyTotal` / `addonsYearlyTotal` / `activeSkus` — empty, null entries, inactive rows.
- `isModuleKeyAllowed` — `ALWAYS_ENABLED`, untracked key (allowed), tracked-but-absent (denied).

Inclusive-GST extraction round-trips: given a tax-inclusive total, the split must reconstruct it
exactly. This is the opposite direction from patient billing and is easy to get backwards.

## Checklist

- [ ] Lockout refuses **writes only** — reads, exports and printing still work
- [ ] `SUBSCRIPTION_BLOCKED_MESSAGE` reused, not re-worded
- [ ] Grace days read from config, not the `SUBSCRIPTION_GRACE_DAYS` fallback
- [ ] Fail-open branches preserved (no subscription, no anchor, bad date → allowed)
- [ ] Entitlement vs rollout flag chosen correctly
- [ ] New gated module registered in `moduleKeys.ts`, or it ships enabled for everyone
- [ ] Pricing via `resolveEffectivePrice`; platform GST is **inclusive**, not `splitGst`
- [ ] Lifecycle transitions driven by verified, idempotent webhooks
- [ ] Caps nudge and bill; never hard-stop a clinical action
- [ ] Platform-only screens gated on `useAumrtiAdmin`; impersonation audited and visible
- [ ] No PHI in `trackEvent`; no billing notices to clinical staff
