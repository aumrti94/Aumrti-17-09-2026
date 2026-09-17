# Cross-Module Notifications — Correctness and Duplicates

**Status:** Analysis, grounded in the actual code. Not a plan — flagging for a decision.
**Date:** 2026-09-10

---

## Architecture found: three parallel systems, not one

There is no single "notify" choke point in Aumrti. Three separate mechanisms exist, built at
different times, that don't talk to each other:

| System | Table(s) | Who writes to it | Dedup / retry? |
|---|---|---|---|
| **In-app clinical alerts** | `clinical_alerts` | 48+ files, directly, across nearly every module | **No.** No unique constraint in the schema, no dedup key. |
| **Generic external dispatch** | `notification_queue` | Only [supabase/functions/webhook-dispatcher/index.ts](../../supabase/functions/webhook-dispatcher/index.ts) | Yes — `dedup_key` unique index, exponential back-off, dead-letter after max retries ([notification-dispatcher](../../supabase/functions/notification-dispatcher/index.ts)). The one well-built piece. |
| **Critical-alert escalation** | `alert_escalation_rules` / `alert_escalation_log` | [alert-escalation edge function](../../supabase/functions/alert-escalation/index.ts), cron every 5 min | Yes — explicit 30-minute cool-off per alert via `alert_escalation_log` lookup before re-sending. |

Plus a handful of call sites (`whatsapp-send.ts`, `AIDigestTab.tsx`, `MobileAppPage.tsx`,
`daily-leakage-scan`) that call `send-sms` / `send-whatsapp-meta` / `send-push-notification`
**directly**, bypassing `notification_queue` entirely — the dispatcher's own comment calls this
"backward-compatible," i.e. a known, intentional bypass of the dedup/retry guarantee.

---

## Correctness gap: two disconnected alert-routing configs

This is the more serious finding. There are **two separate settings screens that both look like
"configure who gets alerted and how"**, and only one of them is wired to anything that fires:

1. **`Settings → Notifications`** ([SettingsNotificationsPage.tsx](../../src/pages/settings/SettingsNotificationsPage.tsx)) writes an `AlertRule[]` to `hospital_settings.notification_config` — per alert type: `recipients` (role names like "Doctor", "CMO"), `channel` (`in_app` / `whatsapp` / `both`), `escalationMin`, `escalateTo`. The shipped defaults include exactly the alerts you'd expect a hospital to care about most: **Code Blue → both channels, escalate to CMO in 5 min**; Critical Lab Value; Bed Occupancy >90%.

   I traced every reader of this config (`mergeAlerts` / `NOTIFICATION_CONFIG_KEY`) — the only
   consumer is the settings page itself, reading back what it just saved to render the form.
   **Nothing in the codebase reads this config to actually route or escalate a real alert.** A
   hospital admin who configures "Code Blue → SMS the CMO in 5 minutes" here is configuring
   something that, as far as I can find, has no effect.

2. **`alert_escalation_rules`** (a separate DB table, surfaced in a *different* screen,
   [NotificationsPage.tsx](../../src/pages/notifications/NotificationsPage.tsx)) has a different
   shape entirely — `escalate_after_minutes`, `escalation_channels` (sms/email only, no
   whatsapp/in-app), `notify_roles`, `sms_numbers`, `email_addresses`. This is the table the
   **real, running** `alert-escalation` cron job reads, and it genuinely sends SMS (MSG91/Twilio)
   and email (Resend), with proper dedup.

Two admin screens, two schemas, one of them actually connected to a live SMS/email pipeline, one
of them a form that saves to a JSON blob nobody reads back. There's no indication in the UI that
they're different systems — nothing tells a hospital admin that configuring the first one does
nothing.

---

## Duplicate gap: proven, not hypothetical

`clinical_alerts`' `CREATE TABLE` (migration `20260322092601`) has no unique constraint at all —
worth noting that the very same migration file gives `staff_attendance` a
`UNIQUE (user_id, attendance_date)` constraint, so the team clearly knows how to dedupe at the DB
layer when they choose to. `clinical_alerts` just never got one.

That gap is real, not theoretical — [LabTATPanel.tsx](../../src/components/lab/LabTATPanel.tsx)
(lines 91–100) inserts a fresh `clinical_alerts` row for **every** overdue lab order on **every**
call to `load()`, with no check for whether an alert for that order already exists:

```ts
const overdue = list.filter(p => p.risk === "overdue");
overdue.forEach(p => {
  (supabase as any).from("clinical_alerts").insert({ ... }).then(() => {}, () => {});
});
```

`load()` fires on mount and (per the file) on manual refresh — every time a nurse or lab tech
opens or refreshes this panel while an order is still overdue, a duplicate alert gets created for
the same order. There's no DB constraint to catch it either. I checked this one file concretely;
the same "poll/reload → re-insert with no existing-alert check" shape is worth auditing across the
other 47 files that insert into `clinical_alerts` directly — not all of them will have this
pattern (`ancillaryGateChecks.ts`'s override-audit insert, for example, only fires once per
explicit user action, which is safe by construction), but the ones triggered by a `load()`/polling
function rather than a one-shot user action are the ones to check first.

By contrast, `notification_queue` and `alert_escalation_log` both got this right — dedup key /
cool-off lookup before sending. It's not that the codebase doesn't know the pattern; `clinical_alerts` (the most-used, most-modules-touch-it table of the three) is the one that didn't get it.

---

## How to handle / test this for go-live

1. **Decide which escalation config is canonical and retire or wire the other.** Given
   `alert_escalation_rules` is the one actually connected to a live SMS/email pipeline, either
   point `Settings → Notifications` at that table (so the UI a hospital admin is more likely to
   find first isn't inert), or remove/relabel it so it can't be mistaken for the thing that fires.
   This is a product decision, not a testing task, but it's a go-live blocker in its own right —
   a hospital assuming Code Blue escalation is configured when it isn't is a patient-safety gap,
   not a UX papercut.
2. **Add a dedup mechanism to `clinical_alerts`** — either a DB-level unique constraint on
   `(hospital_id, alert_type, <source entity id>)` for a time bucket, mirroring what
   `notification_queue.dedup_key` already does, or a check-before-insert convention enforced at
   the call sites. Given 48 call sites, a DB constraint is more reliable than trusting every
   caller to remember the check.
3. **Audit the poll/reload-triggered alert sites specifically** (`LabTATPanel.tsx` confirmed;
   `RadiologyTATPanel.tsx`, `LabTrendPanel.tsx`, and any other `*TATPanel`/`*Trend*` component are
   the natural next places to check, since TAT-breach alerts are the pattern most likely to be
   raised from a `load()` called on every visit or timer tick).
4. **Unit test what's already pure and isolated:** `mergeAlerts` in `notificationConfig.ts` is
   already written to be unit-testable per its own doc comment — but note that testing it in
   isolation currently proves nothing about real alert delivery, since nothing consumes its
   output. Worth deferring that unit test until (1) is resolved, so it isn't testing a dead path.
5. **Integration-test the two live pipelines directly, not the unwired one:**
   - Fire the same alert-raising condition twice in a row (simulate two `load()` calls against a
     seeded overdue order) and assert exactly one `clinical_alerts` row exists — the automated
     version of the bug caught above.
   - Seed an `alert_escalation_rules` row + an unacknowledged critical alert past its SLA, run
     `alert-escalation`, and assert one `alert_escalation_log` row is written and a second run
     within 30 minutes produces zero more — proving the cool-off actually holds.
   - For Code Blue specifically: whichever config ends up canonical after (1), write one
     end-to-end test that raises a Code Blue alert and asserts a real outbound SMS/WhatsApp/email
     attempt was made (mocking only the third-party provider call, not the internal routing) —
     this is the test that would have caught the disconnect found above.

---

## Not done here

No code was changed. Whether to consolidate the two config systems, and which one to keep, is a
product/CTO-level decision — not something to resolve inside a testing pass.
