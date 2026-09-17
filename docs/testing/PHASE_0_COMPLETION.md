# Phase 0 — harness, decisions, inventory: completion record

**Phase:** 0 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-11
**Estimate in the plan:** 0.5 ew, "should be the shortest phase here."

Phase 0 was skipped when Phase 1 was run first; only the two items Phase 1 could not run
without were done at the time. This closes the rest.

**Result: seven of eight items complete. The exit gate has one criterion that QA cannot close
alone** — D1–D9 ratification — plus one that is now mechanically true but rests on product
decisions nobody has signed (§3).

---

## 1. The eight items

| # | Item | Status |
|---|---|---|
| 1 | `test`, `test:watch`, `test:coverage`, `test:e2e` scripts | ✅ All four in `package.json`. `test:e2e` runs `playwright test` and **fails until Phase 3** creates `playwright.config.ts` — the plan puts the script here and the config there. |
| 2 | `npm i -D @testing-library/user-event` | ✅ `^14.6.7`. Nothing imports it yet; it is needed the moment a component test types into a field. |
| 3 | `coverage.include` + numeric thresholds | ✅ `src/lib/**`, four global numbers, **plus 13 per-file gates**. Enforcement verified by deliberately raising one until the run failed, then restoring it. |
| 4 | `tests` job in CI | ✅ Separate job from `checks`, running `npm run test:coverage` — not a bare `vitest run`, or the thresholds would never be evaluated and coverage could fall to zero while the job stayed green. `checks` also gained `check:inventory`. |
| 5 | `KNOWN_BUGS.md` register seeded | ✅ [KNOWN_BUGS.md](KNOWN_BUGS.md). The eight prior defects are 001–008, sourced from [TEST_STRATEGY_RECOMMENDATION.md](TEST_STRATEGY_RECOMMENDATION.md) §"Correction 1"; 011 is D3's dual vocabularies; 100+ are the Phase 1 findings. 009–010 left unused so the series can absorb another without renumbering. |
| 6 | `generate-test-inventory.mjs` + `check:inventory` | ✅ [INVENTORY.generated.md](INVENTORY.generated.md), 1,143 lines. Staleness detection verified by tampering with the output until the check failed. |
| 7 | Correct the module count in CLAUDE.md | ✅ 61 → **67**, confirmed against the generator's own parse of `ALL_MODULES`. README corrected too — it said 61 as well. |
| 8 | Land D1 | ✅ In full, including dispatch. See §2. |

## 2. D1 — what actually landed

**The plan's premise needed correcting first.** It said repointing Settings › Notifications at
`alert_escalation_rules` would "lose in-app and WhatsApp escalation". It would not: the config
key was written by the settings page and **read by nothing**, and the escalation function only
ever sent SMS and email. There was no in-app or WhatsApp escalation to lose. What the screen
had was a control that looked like it worked — on the Code Blue row.

Five parts, all in this change:

1. **[20261106000005](../../supabase/migrations/20261106000005_alert_escalation_channels_and_quiet_hours.sql)** — `escalation_channels` constrained to
   `sms | email | in_app | whatsapp` (it was unconstrained text, which is how `whatsapp` came
   to be a *default* for a channel with no dispatcher); per-rule quiet hours; a unique index on
   `(hospital_id, alert_type, severity)` so the screen can upsert instead of appending a
   duplicate rule per save — without it, N saves would have meant N pages per alert.
2. **RLS repair, same migration.** Both historical policies on `alert_escalation_rules` and
   `alert_escalation_log` were `USING`-only. `USING` governs read/update/delete; `WITH CHECK`
   governs insert. A user of hospital A could insert a rule carrying hospital B's id — a
   cross-tenant write on the table deciding who gets paged about another tenant's critical
   alerts. Both policies now state both.
3. **[20261106000006](../../supabase/migrations/20261106000006_migrate_notification_config.sql)** — data migration, built around one asymmetry: live
   rules are only ever **widened** (their channel list gains what the hospital picked, nothing
   else changes); rules that do not exist are created. Letting the inert config overwrite live
   routing could have lengthened an SLA, deactivated a rule, or dropped sms/email — each of
   those is a silenced escalation. The old key is renamed, not deleted.
4. **[alert-escalation](../../supabase/functions/alert-escalation/index.ts)** — now dispatches all four channels and honours quiet hours.
5. **[SettingsNotificationsPage](../../src/pages/settings/SettingsNotificationsPage.tsx)** rewritten against the table;
   [alertEscalationRules.ts](../../src/lib/alertEscalationRules.ts) holds the pure mapping, with 28 tests at 100%
   line/branch/function; `notificationConfig.ts` deleted.

**Code Blue does not regress.** `suppressedByQuietHours` checks severity *before* quiet hours
and returns false for `critical` unconditionally. The migration refuses to write quiet hours
onto a critical rule, `toEscalationRuleRow` refuses to send them, `mergeEscalationRules`
refuses to load them off a row that somehow has them, and the UI shows "Always escalates"
instead of a disabled switch. Four layers, each independently asserted.

A side fix worth naming: the recipient loop was `if (phone && sms) … else if (email && email)`,
so a clinician with both a phone and an email, on a rule naming both channels, got only the
SMS — the email branch was unreachable for them. Every channel now fires independently. That
is more notification, never less.

## 3. Product decisions made without a ratifier

D1's named ratifiers are **clinical-pod + Vikram (CTO)**. Neither has signed. Building dispatch
required deciding three things that are product calls, not QA calls. Each is listed here so
ratification is a review of specific choices rather than a rubber stamp:

| Decision | What was chosen | Why | Reversible? |
|---|---|---|---|
| What "in-app escalation" writes | An **audit row** in `alert_escalation_log` + `notification_log`, **not** a second `clinical_alerts` row | The alert being escalated *is* the in-app notification — `NotificationCentre` already surfaces every unacknowledged alert. Raising another row would duplicate a clinical alert, which is KNOWN-BUG-002's exact failure mode, and `clinical_alerts` has no unique constraint to stop it | Yes — one code block |
| WhatsApp message form | Meta **session** message, not an approved template | Escalation targets the hospital's own staff, already engaged with the alert. A template needs Meta approval per alert type. If Meta rejects it for being outside the 24-hour window, that lands in `error_message` and the rule's other channels still carry the escalation | Yes |
| Quiet hours scope | **Per rule**, and impossible on a critical rule | Hospital-wide in the old config. Per-rule lets a ward silence Medication Due overnight without touching Code Blue — the old shape could not express that | Widening to hospital-wide later is additive |

**Five alert types were dropped rather than migrated** — Bed Occupancy > 90%, Drug Stockout,
Large Bill (> ₹50,000), New Admission, OT Starting in 30 min. No code path raises a
`clinical_alerts` row for any of them, so a rule keyed on them could never fire: it would
render as configured, save without error, and escalate nothing. Logged as KNOWN-BUG-112. If the
product wants them, the alert has to be raised first.

## 4. Exit gate status

| Criterion | Status |
|---|---|
| `npm test` exits 0 | ✅ 781 passing, 15 skipped, 13 suites. |
| CI shows a `tests` job on a PR | ✅ `tests` job added; YAML parsed to confirm both jobs and their steps. |
| `vitest.config.ts` has `coverage.include` and four explicit numeric thresholds | ✅ Plus 13 per-file gates. |
| `npm run check:inventory` passes and `INVENTORY.generated.md` is committed | ✅ Both. |
| `grep -rn "notification_config" src/` returns zero | ✅ Zero. The history moved to the migrations, which the `supabase-migration` skill names as the primary design record. |
| D1–D9 each have a named ratifier recorded with a date | ❌ **Names are recorded; no dates, because nobody has signed.** Not something QA can close — see below. |

**The one open criterion.** Every decision D1–D9 has a named ratifier in
[PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §2 and none has signed. D1 is now *implemented*,
which raises the stakes on its ratification rather than lowering them: the code is in the repo,
the migration is written, and three product decisions above are load-bearing. The others
(D2–D9) remain decisions on paper. Recommend Vikram and clinical-pod review §3 of this document
specifically; the rest of §2 can be ratified as a batch.

## 5. Verification

```bash
npm test                     # 781 passed | 15 skipped (796)
npm run test:coverage        # exit 0 — global + 13 per-file thresholds met
npm run lint                 # 0 errors, 1 pre-existing warning (StatusBadge.tsx)
npm run check:rls-coverage   # 565 tables, all with RLS
npm run check:user-fk        # 40 repointed, 16 legitimate auth.users
npm run check:db-contract    # 555 tables, 107 edge functions, all names resolve
npm run check:inventory      # current
npm run build                # built in ~18s
```

Both new migrations are **static-checked only**. `check:rls-coverage`, `check:user-fk` and
`check:db-contract` are text scans over `supabase/migrations/`, not live-database checks —
they run anywhere, and they are the same gates CI runs, but **neither migration has been
applied to a database**. `npm run supabase:push` and a regeneration of `types.ts` are still
required, and the data migration in `20261106000006` has not executed against real rows.
Phase 3's local Supabase makes that testable; today it is unexecuted SQL.
