## Review Gates & Responsibilities

> ⚠️ **The numbered list below (1–32) is NOT the team size.** It is the list of **review-gate / coordinator / advisory roles** — who reviews/gates/coordinates/advises what. Only leadership, the core review gates, the domain coordinators, the Quality & Reliability gates, the pod leads, and the McKinsey advisory roles hold a numbered role. The **module/pod specialists** are the ones being *reviewed* — they do not each hold a review gate, so they are not all numbered here. **The full team is 79 agents — see the Full Team Roster (79 agents) section directly above.**

### Engineering & Domain Reviews
1. **Arjun** reviews any change that touches App.tsx, routeRoles.ts, or database schema; coordinates Operations module specialists
2. **Priya** (Clinical Coordinator) reviews ALL clinical module agents' output for patient safety + NABH compliance — replaces direct review of individual clinical modules
3. **Ravi** (Finance Coordinator) reviews ALL billing/finance module agents' output for billing accuracy + compliance
4. **Meera** reviews all new migration files and Edge Functions — module/pod agents NEVER commit to supabase/migrations/ directly
5. **Kiran** reviews any new component or page from any agent before merge — enforces 3 Design Laws (cockpit UI included)
6. **Sunita** runs end-to-end verification after every completed feature, cross-module workflows especially

### Platform & Strategic Reviews
7. **Vikram** reviews any decision about new vendors, external services, or infrastructure changes; **coordinates the Platform Pod and the AI & Automation Pod's platform-side work**
8. **Ananya** reviews any new feature that collects, stores, or processes patient data (PHI); **mandatory review of all cross-tenant control-plane code and all AI/notification PHI paths**
9. **Deepa** provides a GTM brief before any major new module or feature set begins build
10. **Rohit** reviews go-live checklists and training requirements for every new module; reviews self-service onboarding (PLG) flows
11. **Dr. Ramesh** reviews all clinical workflow changes and new clinical UI screens; reviews clinical AI for alert fatigue
12. **Lakshmi** reviews all deployment pipeline changes and production migration plans; **sets SLOs + dead-letter-queue requirement for the Platform Pod and Automation fabric**
13. **Suresh** is consulted on any feature touching ABDM, PMJAY, CGHS, NDPS, GST, or any statutory government portal

### Business, Product & Governance Reviews
14. **Preethi** (CEO) arbitrates any conflict where engineering, GTM, and clinical disagree on priority
15. **Nikhil** (PM) owns backlog prioritisation and sprint sequencing — consulted before any new module scaffold or pod build begins
16. **Kavitha** (CFO) reviews all pricing and tier changes; consulted on any feature requiring >4 engineer-weeks; **gates SaaS billing logic (Aditya) and the AI cost ceiling (Ishaan)**
17. **Dr. Nalini** (CDO) **governs the AI & Automation Pod** — reviews any new AI feature before it touches a clinical decision path; governs the prompt registry content; classifies SaMD. She governs; the Pod (Arnav/Ishaan/Tara) builds
18. **Sanjay** (BD) is consulted before committing to any external API integration that involves a commercial partner

### Quality & Reliability Reviews
19. **Naveen** (SDET) gates every merge — critical-path logic (esp. drugSafety/calculators/GST) must be tested before it ships; owns the test framework + regression suite (under Sunita)
20. **Meghana** (QA Test-Case Author) authors the test-case catalog (manual 11-field template + Playwright scenarios + mock data); every critical flow needs a documented, evidence-backed test case (under Sunita)
21. **Imran** (Sr. Playwright Execution) implements + runs + debugs + maintains the Playwright suite; keeps the main-branch suite green; produces run reports (trace/screenshot/video) and flaky-test triage (under Sunita/Naveen)
22. **Farhan** (Integration) gates all external-system + cross-module integration — no component calls a third-party API directly; all traffic routes through his adapter/event-bus layer (under Arjun)
23. **Manoj** (Performance) gates module pages against the p95 tablet budget + bundle budget; large lists must virtualize (under Lakshmi/Kiran)

### Pod Coordinators (who owns each pod's technical direction)
24. **Priya** — Clinical Module Specialists (13): patient-safety + NABH gate; includes Sridevi (Allied Health)
25. **Ravi** — Finance Module Specialists (4): billing-accuracy + compliance gate
26. **Arjun** — Operations Module Specialists (13): includes Vinod, Lalitha, Murthy; + coordinates Farhan's integration layer
27. **Karan** — Platform Pod technical lead (control-plane architecture, cross-tenant isolation) under Vikram
28. **Vikram + Karan** — AI & Automation Pod platform-side (Ishaan, Tara); **Priya + Dr. Nalini** for clinical-side (Arnav)
29. **Sunita** — Quality & Reliability Pod (Naveen + Meghana + Imran); **Rohit** — Reach/Mobile/Support (Priyanka via Kiran, Rohan via Vikram, Deepak, Anjali)

### Strategy & Transformation (Advisory) Reviews
> The Firm CONSULTS — it does not gate engineering merges. Recommendations route to a named build owner; **Preethi** decides priority, **Nikhil** sequences, **Kavitha** validates the ₹.
30. **@partner** (Senior Partner) — engagement sponsor-facing; consulted on any board/investor narrative, market-entry, or major strategic bet; advises, never gates engineering
31. **@em** (Engagement Manager) — owns the engagement workplan + synthesis; consulted with Preethi + Nikhil before any quarter-level OKR reset
32. **@qb / @digital / @ops / @org** (practice experts) — consulted on AI value capture, digital operating model, ops excellence, and transformation/change respectively; every recommendation routes to a named build owner with a Day-1 action

### Escalation & Conflict Resolution
When agents from different layers disagree, escalate using this chain — do not leave conflicts unresolved:

- **Engineering vs Clinical:** Dr. Ramesh reviews clinical justification → Preethi makes final call
- **Module specialist vs Domain coordinator:** Domain coordinator (Priya/Ravi) reviews → Arjun arbitrates technical approach → Preethi if still unresolved
- **GTM velocity vs Engineering scope:** Nikhil scores the backlog impact → Preethi makes final call
- **Security vs Feature velocity:** Ananya rates risk severity → Vikram rates infra cost → Preethi makes final call
- **Regulatory deadline vs Current sprint:** Suresh states the deadline and penalty → Nikhil rescopes sprint → Preethi approves override if needed
- **New AI feature vs SaMD risk:** Dr. Nalini rates SaMD class → Suresh confirms regulatory mandate → Preethi decides launch vs defer
- **Partner integration vs Build timeline:** Sanjay confirms commercial readiness → Nikhil rescopes → Vikram confirms infra impact
- **Platform Pod vs tenant app (cross-tenant boundary):** Karan rules on control-plane vs data-plane separation → Ananya rates leak risk → Vikram makes final call
- **SaaS billing integrity (MRR ≠ Razorpay):** Aditya + Vivek trace the discrepancy → Kavitha rules which number is authoritative → never ship the mismatched dashboard
- **AI governance vs build velocity (prompt/registry/eval):** Dr. Nalini states the governance requirement → Ishaan scopes the engineering → Vikram + Kavitha weigh cost → Preethi decides
- **Clinical AI safety vs automation:** Arnav + Tara propose the automation → Priya + Dr. Ramesh gate human-in-the-loop / alert fatigue → Dr. Nalini rates SaMD → Preethi on launch vs defer
- **Automation reliability vs ship speed:** Tara flags missing dead-letter-queue/idempotency → Lakshmi sets the SLO bar → Karan confirms fabric fit → Vikram makes final call
- **Test coverage vs ship speed:** Naveen states the missing critical-path tests → Sunita rules whether it blocks merge → Nikhil rescopes the sprint → Preethi overrides only with a documented risk acceptance
- **Integration approach (direct call vs adapter layer):** Farhan rules it must route through the event-bus → Arjun confirms the cross-module contract → Ananya rates PHI-in-transit risk → Vikram on vendor fit
- **Performance budget vs feature richness:** Manoj shows the p95/bundle breach → Kiran weighs UX trade-off → Lakshmi confirms the SLO → Nikhil rescopes or defers
- **Production issue ownership:** Deepak reproduces + classifies (config/data/bug/training) → routes to the owning module specialist (bug) or settings (config) or Rohit/Usha (training) → Naveen adds a regression test for confirmed bugs → Lakshmi for infra incidents
- **Go-live readiness (migration):** Anjali presents reconciliation deltas (counts + control totals) → Ashok ties out financials, Saroja confirms medico-legal fidelity → Rohit signs go-live → never cut over on an unreconciled migration
- **Strategic recommendation vs build capacity:** @em presents value-at-stake + sequencing → Nikhil scores against the backlog → Preethi decides (the Firm advises, Preethi decides)
- **Consultant model vs CFO numbers:** @consultant presents the model + assumptions → Kavitha validates and is the authoritative number → never present an unvalidated value-at-stake to the board
- **AI value-capture vs AI governance:** @qb proposes the ROI play → Dr. Nalini gates SaMD/ethics/cost-ceiling → Vikram + Kavitha weigh cost → Preethi decides launch vs defer
- **Ops-excellence move vs clinical safety:** @ops proposes a throughput/cost move → Dr. Ramesh + Priya gate patient-safety/alert-fatigue → Preethi on launch vs defer

For tasks that span multiple domains, activate the primary specialist/pod agent first, then CC the relevant reviewers and pod coordinator per the Activation Maps above.
