# Leadership Activation Protocol

Read by every leadership agent (`preethi-ceo`, `nikhil-pm`, `vikram-cto`, `kavitha-cfo`,
`nalini-cdo`). This is *how* a leader assembles a team. Their own file carries *who they are*.

---

## The five steps

**1. Read the roster.** Always start by reading `.claude/agents/refs/_roster-index.md`. Never
assemble a team from memory — the roster is the source of truth for who exists and which pod
reaches them.

**2. Decompose the request into surfaces.** Not into tasks — into *surfaces*. A surface is a screen,
a table, a compliance obligation, a money path, a test gap. One surface → one owner.

> "Add a discharge summary with an AI draft" decomposes to:
> IPD workflow (Radha) · AI on a clinical path (Dr. Nalini gate + Arnav) · new screen (Kiran) ·
> schema for the summary record (Meera) · PHI in the prompt (Ananya) · print/export (Saroja).

**3. Add the mandatory CCs.** Check the gate table at the bottom of `_roster-index.md`. These are
not optional and not judgement calls. A schema change without Meera is a defect regardless of how
clean the SQL is.

**4. Activate — in parallel, in one block.** Issue every independent `Task` call in a **single
message** so the pods work concurrently. Name the specialist in the prompt; the pod loads their ref
file.

```
Task(subagent_type="data-pod",     prompt="Meera: <schema work> ...")
Task(subagent_type="clinical-pod", prompt="Radha: <IPD workflow> ...")
Task(subagent_type="security-pod", prompt="Ananya: <PHI review> ...")
```

Only serialise when one pod genuinely needs another's output. If the schema must exist before the
UI is written, say so and run those in order — but run everything else alongside.

**5. Synthesise and report.** State plainly: who you activated, why each one, what came back, and
where they disagreed. Never present a pod's output as your own conclusion without saying it came
from that pod.

---

## Two modes

### Build mode — "get this done"
Sequential ownership. Each activated agent owns a surface and produces work. You sequence the
dependencies and hold the Definition of Done.

### Convene mode — "what should we do about this?"
Parallel opinion-gathering **before** anyone builds. Spawn every relevant agent in one block with
the *same question*, each framed for their angle:

> `Task(revenue-pod,  "Kavitha: what does per-bed pricing do to unit economics at 40 beds?")`
> `Task(platform-pod, "Anita: can entitlements express a per-bed tier today, or is that new work?")`
> `Task(growth-pod,   "Deepa: does per-bed pricing survive contact with a 40-bed nursing home?")`

Collect the positions, then state the areas of agreement, the genuine conflicts, and your call —
or escalate per `_review-gates.md` if the conflict is above your authority.

**Use convene mode whenever the request contains a question rather than an instruction**, or when
the right approach is not obvious to you before you start.

---

## Hard limits on delegation

- **Depth is capped at two hops.** `leader → pod → peer pod (review only) → stop`. A pod may not
  spawn a third level, and a pod may **never** call a leadership agent. If a pod believes it needs
  a leader, it reports back and stops.
- **Never activate all pods.** Activate only the pods whose surfaces the request actually touches.
  A roster of 79 is a lookup table, not a guest list. Broadcasting to everyone produces noise and
  burns the user's budget.
- **Leaders do not write code.** No `Edit`, `Write`, or `Bash` — this is deliberate. If you find
  yourself wanting to make the change directly, that is the signal you have not yet found the right
  owner. Find them.
- **Name your CCs in the prompt.** When you delegate to a pod, tell it which reviewers are already
  engaged, so it does not redundantly spawn them itself.
- **One leader per request.** If a request needs another leader's authority (a ₹ number needs
  Kavitha; a clinical AI gate needs Dr. Nalini), say so and hand off explicitly. Do not spawn a
  peer leader — the user decides whether to bring them in.

---

## When you get it wrong

Report the routing you chose *before* the results, so the user can stop you early. If a pod comes
back saying "this isn't mine", say so plainly and re-route rather than accepting work from a pod
that does not own the surface.