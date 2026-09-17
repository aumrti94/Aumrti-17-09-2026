# Planning "Don't Miss Anything" — UI, Modules, Settings, Connectivity, DB, Edge Functions

**Status:** Methodology / brainstorm. Not a plan with dates or owners yet.
**Date:** 2026-09-10

---

## First, the honest scale problem

Counted directly from the repo:

| Surface | Count |
|---|---|
| Edge functions | 109 |
| Pages | 217 |
| Components | 568 |
| Migrations | 612 |
| `src/lib` logic files | 187 |

"Don't miss any text box, button, module, setting, or connection" across 568 components and 109
edge functions is not a document you write once — held in a person's head, or a hand-typed
checklist, something *will* drop. The only way "don't miss anything" is actually true is if the
checklist itself is generated from the same source of truth the app runs on, so a new button or
module shows up on the checklist automatically the moment it's added to the code — not because
someone remembered to write it down.

That's the core idea behind everything below: **build the inventory from the code's own
registries, not from memory.**

---

## Step 1 — Generate the master inventory from source, per layer

Aumrti already has the registries this needs — they're not something to build from scratch, just
to point a coverage matrix at:

| Layer | Source of truth already in the repo | What it gives the inventory |
|---|---|---|
| Modules | `src/lib/modules.ts` (`ALL_MODULES`) | Every module's name, route, category, allowed roles — one row per module, generated, not guessed |
| Settings | `src/lib/settingsCatalog.ts` | Every settings screen and its fields |
| Routes / pages | The router + `src/pages/**` | Every screen that exists, cross-checked against the module registry (a page with no module entry, or vice versa, is itself a finding) |
| DB tables | `src/integrations/supabase/types.ts` (generated) | Every table, column, and relationship — the same file `check:db-contract` already validates queries against |
| Edge functions | `supabase/functions/*` directory listing | Every server-side endpoint |
| Cross-module connectivity | `source_module` / `source_record_id` / `*_dedupe_key` columns (the pattern found repeatedly in the billing/notification analysis) | Every point where one module's data is consumed by another |
| Buttons / text boxes | Not separately catalogued today — would need to come from a static scan of each page's interactive elements, or be captured as Playwright page-object inventories as E2E coverage is built | The one layer with no existing registry — this is the part that has to be built, not just pointed at |

Everything except the last row already exists as data in the codebase. The actual new work is:
(a) writing the script that turns these five existing registries into one coverage matrix, and
(b) building the missing UI-element inventory as Playwright page objects are written — which
doubles as the E2E test scaffolding itself, not a separate document.

---

## Step 2 — Define positive/negative per layer, grounded in the bugs already found this session

"Positive and negative" means something different at each layer. Using what's already been
found in this conversation as concrete examples, rather than abstract categories:

| Layer | Positive case | Negative case (real example already found) |
|---|---|---|
| Text box / form field | Valid input saves and round-trips correctly | Invalid input rejected; **the `notification_config` form saves without error but nothing ever reads it back** — a form that "works" in the sense of not crashing, while being functionally dead |
| Button / action | Click produces the correct state change | Disabled state honored; double-click doesn't double-fire; **`LabTATPanel`'s implicit "raise alert" action fires again on every reload with no duplicate check** |
| Module | Loads correctly for an entitled role | Blocked correctly for a non-entitled role/tenant; a module gated by `check:rls-coverage` actually enforces it live, not just structurally |
| Settings | Saved value changes real behavior | Saved value that changes **nothing** — exactly the `Settings → Notifications` dead-config bug found earlier; a settings screen with no verified consumer is a negative case waiting to be found everywhere else too |
| Cross-module connectivity | Service delivered in module A correctly appears billed/claimed in module B | The handoff silently drops (revenue leakage) or double-fires (duplicate bill/alert); **two independent implementations of the same handoff decision disagree** — `LeakageScanner`'s substring match vs. the dedupe-key approach used elsewhere |
| DB table | RLS isolation holds for hospital A vs. hospital B | A service-role or cross-tenant path bypasses RLS; a `CHECK` constraint value (**`bill_status = 'insurance_pending'`**) is declared but never actually reachable in practice |
| Edge function | Valid authenticated request succeeds | Missing auth rejected; malformed payload doesn't 500 with a stack trace; PHI never appears in logs; retry/dead-letter behaves correctly under repeated failure |

The pattern across every negative-case example above: **the bug was never a crash.** Every one of
these is code that runs successfully and looks fine in a demo — a form that saves, a scan that
completes, a bill that has a balance — while being silently wrong or silently disconnected. That's
the thing a "does it crash" smoke test won't catch, and it's why the negative-case column has to be
written deliberately per layer rather than inferred from "did it error."

---

## Step 3 — Don't try to do all of it in one pass

Even with the inventory generated, 217 pages × several elements each × positive/negative, plus 109
edge functions, plus every cross-module handoff, is not a single testing sprint — it's the same
scale question the original brainstorm's five philosophies were built around. The inventory from
Step 1 doesn't replace that sequencing decision, it feeds it: once every module/setting/table/
function is a row in one matrix, it can be **sorted by the same risk tiers already agreed on** —
patient-safety and multi-tenant isolation first, revenue-critical second, everything else after —
instead of working through it alphabetically or module-by-module by whoever's free.

Track it as a living matrix (module × layer × positive/negative × status), not a one-time
document — consistent with the "coverage only goes up" ratchet already stated in CLAUDE.md. A row
gets added automatically when a new module/table/function is added to its registry; it doesn't get
added by someone remembering to update a doc.

---

## What I'd do next, concretely

The one thing I can build right now, directly, without needing a team decision first: **generate
the actual master inventory** — pull `ALL_MODULES`, `settingsCatalog`, the DB schema, and the
edge-functions directory into one matrix, cross-referenced against what currently has any test
coverage at all (today: close to nothing, per the earlier brainstorm). That turns "don't miss
anything" from an instruction into a trackable artifact — the thing every subsequent testing pass
gets checked off against, rather than re-litigated from memory each time.

I haven't built it yet — flagging it as the concrete next step rather than assuming you want it
built before you've seen the shape of the plan.
