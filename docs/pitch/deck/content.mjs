/**
 * EVERY word and every number in the deck lives here.
 * Edit this file to change the deck; build.mjs only lays it out.
 *
 * Three rules this file keeps:
 *   1. Facts under `FACTS` are re-verified against the repository at build time.
 *      If the code changes, the build fails rather than the deck drifting.
 *   2. Every modelled number carries an `assumption` string that is printed on
 *      the slide beneath it. No bare figures.
 *   3. Anything only the founder knows is a fillIn() marker — rendered in amber
 *      so it is impossible to present by accident.
 */
import { fillIn } from "./blocks.mjs";

/* ══ Facts — asserted against the repo in build.mjs ═══════════════════════ */
export const FACTS = {
  modules: 61, // src/lib/moduleKeys.ts — CANONICAL_MODULE_KEYS
  roles: 14, // src/lib/appRoles.ts — APP_ROLES
  functions: 102, // supabase/functions/*/index.ts
  tables: 546, // CREATE TABLE across supabase/migrations
  rlsTables: 538, // ENABLE ROW LEVEL SECURITY
  policies: 973, // CREATE POLICY
  aiFeatures: 68, // src/lib/aiFeatures.ts — AI_FEATURE_DEFS
  aiCallSites: 94, // callAI() / callAIOrThrow()
  languages: 23, // src/lib/voiceScribeLanguages.ts
  migrations: 551,
  linesSrc: "161k",
  contributors: 1,
};

export const RLS_PCT = Math.round((FACTS.rlsTables / FACTS.tables) * 100); // 98

/* ══ Commercial model ════════════════════════════════════════════════════ */
export const MODEL = {
  perBed: 250, // ₹ / bed / month
  aiMonthly: 3500, // ₹ / hospital / month, median metered drawdown
  implementation: 150000, // ₹ one-time
  avgBeds: 90,
  hospitals: { y1: 4, y2: 14, y3: 35 }, // cumulative
  // India private-sector base, used for the TAM derivation.
  indiaPrivateHospitals: 43486,
  indiaPrivateBedsLakh: 11.8,
  apPopulationShare: 0.037,
};

const yearRevenue = (cum, newSites) =>
  cum * MODEL.avgBeds * MODEL.perBed * 12 + cum * MODEL.aiMonthly * 12 + newSites * MODEL.implementation;

export const PROJECTION = [
  { year: "Year 1", cum: MODEL.hospitals.y1, rev: yearRevenue(MODEL.hospitals.y1, MODEL.hospitals.y1) },
  { year: "Year 2", cum: MODEL.hospitals.y2, rev: yearRevenue(MODEL.hospitals.y2, MODEL.hospitals.y2 - MODEL.hospitals.y1) },
  { year: "Year 3", cum: MODEL.hospitals.y3, rev: yearRevenue(MODEL.hospitals.y3, MODEL.hospitals.y3 - MODEL.hospitals.y2) },
];

export const TAM_CR = Math.round((MODEL.indiaPrivateBedsLakh * 100000 * MODEL.perBed * 12) / 10000000);
export const AP_HOSPITALS = Math.round((MODEL.indiaPrivateHospitals * MODEL.apPopulationShare) / 50) * 50;

/* ══ Module taxonomy — all 61 keys, bucketed ═════════════════════════════ */
/**
 * `short` is what a column header shows — these columns are narrow, and a
 * two-line header collides with the rule beneath it. `name` is used in prose.
 */
export const DOMAINS = [
  {
    name: "Clinical care",
    short: "Clinical care",
    items: [
      "OPD", "IPD", "Day Care", "Emergency", "Operation Theatre",
      "Nursing", "Telemedicine", "Health Packages",
    ],
  },
  {
    name: "Diagnostics & pharmacy",
    short: "Diagnostics",
    items: ["Laboratory", "Radiology", "Blood Bank", "CSSD", "Pharmacy", "Retail Pharmacy"],
  },
  {
    name: "Specialised units",
    short: "Specialty units",
    items: [
      "Dialysis", "Oncology", "IVF", "Dental", "AYUSH", "Physiotherapy",
      "Mental Health", "Chronic Disease", "Neonatal", "Obstetric ANC",
      "Partograph", "Anaesthesia", "Ophthalmology", "Vaccination", "Home Care",
    ],
  },
  {
    name: "Revenue & finance",
    short: "Revenue cycle",
    items: ["Billing", "Insurance & TPA", "PMJAY", "Payments", "Accounts", "Day Closure", "Fixed Assets"],
  },
  {
    name: "Operations, estate & compliance",
    short: "Operations",
    items: [
      "Human Resources", "Inventory", "Biomedical", "Facility Management", "Housekeeping",
      "Ambulance", "Mortuary", "Dietetics", "Medical Records", "Quality & NABH",
      "Infection Control", "HMIS Reporting", "ABDM", "Learning & Training", "CRM",
      "Patient Portal", "Patient Relations", "Unified Inbox", "Analytics",
      "Clinical Intelligence", "Research", "HOD Dashboard", "TV Display",
      "Settings & Masters", "AI Suite",
    ],
  },
];

/* ══ Slides ══════════════════════════════════════════════════════════════ */

export const TITLE = {
  wordmark: "Aumrti",
  headline: "One system for every operation in the hospital",
  sub: "An AI-native hospital operating system built for mid-sized Indian hospitals and nursing homes — from the clinical note to claim settlement, on one record.",
  prepared: "Prepared for the Ratan Tata Innovation Hub · Amaravati, Andhra Pradesh · August 2026",
  founder: "Yeswanth Gottumukkala · Founder",
  contact: `${fillIn("phone")}   ·   ${fillIn("email")}   ·   www.aumrti.com`,
  stats: [
    { value: `${FACTS.modules}`, label: "Hospital modules built" },
    { value: `${FACTS.tables}`, label: "Tables, one schema" },
    { value: `${FACTS.aiFeatures}`, label: "AI features wired in" },
    { value: `${FACTS.languages}`, label: "Indian languages" },
  ],
};

export const PROBLEM = {
  kicker: "Problem",
  headline: "One patient episode, re-entered at every desk it passes",
  sub: "Mid-sized Indian hospitals do not lack software. They run four or five of them, and none of them agree.",
  steps: [
    { num: "01", title: "Front desk", body: "Details captured on paper and re-typed into desk software.", broken: true },
    { num: "02", title: "Consultation", body: "Notes typed late, or rewritten from memory after the visit.", broken: true },
    { num: "03", title: "Diagnostics", body: "Lab, radiology and pharmacy orders carried by hand or phone.", broken: true },
    { num: "04", title: "Ward", body: "Nursing notes on paper; billing clearance chased verbally.", broken: true },
    { num: "05", title: "Discharge", body: "Summary and coding delayed, often assembled from memory.", broken: true },
    { num: "06", title: "Claim", body: "Pre-auth and TPA follow-up run out of Excel and email.", broken: false },
  ],
  impacts: [
    {
      title: "Clinicians pay in time",
      body: "Documentation is done twice — once for the patient, once for the system that will not accept the first copy.",
    },
    {
      title: "The hospital pays in cash",
      body: "Charges missed at the point of care, incomplete coding and slow claim packets turn into denials and write-offs.",
    },
    {
      title: "Everyone pays at audit",
      body: "ABDM, HMIS and NABH all ask for an evidence trail that fragmented systems cannot produce on demand.",
    },
  ],
  quote: fillIn("one verbatim line from a real hospital conversation — doctor, billing head or administrator"),
  quoteAttrib: `${fillIn("role")}, ${fillIn("hospital")} — ${fillIn("month/year")}`,
};

export const SOLUTION = {
  kicker: "Solution",
  headline: "One record, one audit trail, one login",
  sub: "Not a suite of products that integrate — one system whose modules share the same patient, encounter and ledger.",
  pillars: [
    {
      title: "One patient record",
      body: "Registered once. Every module — ward, lab, pharmacy, billing, claims — reads and writes the same encounter.",
    },
    {
      title: "One audit trail",
      body: "Every clinical and financial action is logged against that encounter, so NABH evidence and claim documentation come out of routine work.",
    },
    {
      title: "One login, role-aware",
      body: `A single sign-in resolves to what that person may see. ${FACTS.roles} roles, gated at the route and again in the database.`,
    },
  ],
  spokes: [
    { title: "Clinical care", body: "OPD, IPD, Emergency, OT, Nursing, Day Care, Telemedicine" },
    { title: "Diagnostics & pharmacy", body: "Lab, Radiology, Blood Bank, CSSD, Pharmacy" },
    { title: "Revenue cycle", body: "Billing, Insurance & TPA, PMJAY, Payments, Accounts" },
    { title: "Operations & estate", body: "HR, Biomedical, Facility, Housekeeping, Inventory, MRD" },
    { title: "Compliance & intelligence", body: "NABH, ABDM, HMIS, Analytics, Clinical Intelligence" },
  ],
};

export const PRODUCT = {
  kicker: "Your product, in plain language",
  headline: "One patient's day, from the inside",
  sub: "No acronyms. This is what actually happens when a hospital runs on Aumrti.",
  steps: [
    { num: "Morning", title: "The patient is registered once", body: "Identity, ABHA and history captured at the desk. Every screen after this reads that same record." },
    { num: "Consultation", title: "The doctor speaks; the note writes itself", body: "Dictation in the doctor's own language becomes a structured note." },
    { num: "Same hour", title: "Orders travel on their own", body: "Lab, radiology and pharmacy receive them the moment they are signed. Nothing is carried, nothing re-typed." },
    { num: "Ward", title: "The ward sees the whole picture", body: "Vitals, drug chart, nursing notes and an early-warning score sit on one screen for the nurse on duty." },
    { num: "Discharge", title: "The summary assembles itself", body: "Drafted from the episode that just happened, coded, and handed to the doctor to check and sign." },
    { num: "After", title: "The bill and the claim follow", body: "Charges captured as they occurred; the claim packet is built from the same record. The patient gets a WhatsApp update." },
  ],
  close: "The hospital does not change how it works. The record simply stops being re-typed.",
};

export const DEPTH = {
  kicker: "Depth",
  headline: `${FACTS.modules} modules, five domains, one schema`,
  sub: "Breadth is not the claim. The claim is that these share a spine — a ward charge, a lab result and a claim line all point at the same encounter.",
  note: "Full module index and per-domain detail in the appendix.",
};

export const ARCHITECTURE = {
  kicker: "How it was built",
  headline: "Three layers, one system of record",
  sub: "Every layer sits on one encounter spine. That single choice is what holds the depth on the previous slide together.",
  layers: [
    {
      name: "Interaction",
      note: "What the hospital touches.",
      items: [
        `Web & tablet | Role-aware screens for ${FACTS.roles} roles, tablet-first at the nurse station`,
        "Offline queue | Writes survive a dropped connection and sync when it returns",
        "WhatsApp | Structured, logged patient and staff messaging — not a personal phone",
      ],
    },
    {
      name: "Intelligence",
      note: "Governed at one seam, never in the browser.",
      items: [
        `Single AI chokepoint | ${FACTS.functions} server functions; provider keys never reach the client`,
        "Prompt registry & cost attribution | Every call versioned, costed and attributable",
        "Deterministic safety guard | Runs after the model — it never asks the model to grade itself",
      ],
    },
    {
      name: "System of record",
      note: "One encounter spine underneath everything.",
      items: [
        `One Postgres schema | ${FACTS.tables} tables, ${FACTS.migrations} migrations, one encounter spine`,
        `Tenant isolation | ${FACTS.rlsTables} tables row-level secured, ${FACTS.policies} policies`,
        "PHI protection & audit | AES-256-GCM envelope encryption, every access logged",
      ],
    },
  ],
};

export const INDIA = {
  kicker: "Built for India",
  headline: "The compliance surface is wired, not roadmapped",
  sub: "These are not integrations we intend to build. They exist in the codebase today — what remains on several of them is certification, and we say so.",
  chips: [
    { label: "NABH", note: "Evidence generated from real clinical events; quality indicators mirrored between database and app so the dashboard and the criterion score cannot disagree." },
    { label: "ABDM & ABHA", note: "Ten gateway functions built to the NHA Integration Guide, with a sandbox-to-production switch. Certification is the next step, not the build." },
    { label: "FHIR R4", note: "Eight resource types for record sharing, export and care-context linking." },
    { label: "PMJAY · CGHS · HCX · ESI", note: "Eligibility checks, pre-authorisation and claim submission against the payer schemes Indian hospitals actually bill." },
    { label: "HMIS & IDSP", note: "Statutory reporting produced from routine work rather than as a separate month-end exercise." },
    { label: "GST e-invoicing", note: "IRN generation through the NIC IRP, with rates driven from the service master — never hardcoded." },
    { label: "DPDP-grade PHI", note: "AES-256-GCM envelope encryption, per-hospital keys, thirteen encrypted column families, and every access audited." },
    { label: `${FACTS.languages} Indian languages`, note: "Voice capture on the Bhashini and Sarvam stacks, with medical-term correction tuned to Indian-accented English." },
    { label: "Alerts & escalation", note: "Clinical deterioration, insurance SLA breaches and NABH indicator drift each raise an alert with an escalation ladder behind it." },
  ],
};

export const USP = {
  kicker: "Unique selling proposition",
  headline: "AI inside the workflow, with a net that does not trust it",
  sub: "Anyone can add a chatbot to a hospital system. The difference is what happens to the model's output before a clinician ever sees it.",
  points: [
    {
      title: "AI is native to the workflow",
      body: `${FACTS.aiFeatures} catalogued AI features wired into ${FACTS.aiCallSites} call sites inside the screens where the work already happens — not a separate assistant a doctor has to remember to open.`,
    },
    {
      title: "Indic-accented medical speech correction",
      body: "Phonetic bucketing tuned to Indian-English drug and diagnosis terms — \"parasetamall\" resolves to paracetamol — gated so a collision can never silently rewrite a drug name.",
    },
    {
      title: "A deterministic net under every model output",
      body: "Allergy cross-reactivity, Schedule H and X controls, per-dose ceilings and paediatric flags. Pure, synchronous code that runs after the model, and never asks the model whether it was right.",
    },
    {
      title: "Safety AI cannot be switched off by a budget",
      body: "Deterioration, drug-interaction and critical-finding detection are structurally exempt from a hospital's AI cost cap. A cap that could throttle those would be a safety mechanism wearing a billing costume.",
    },
    {
      title: "Attestation is a database record",
      body: "When a doctor accepts AI-drafted clinical content, the system stores who signed it and whether they edited it first. Medico-legally, that record is the difference.",
    },
  ],
};

export const COMPETITION = {
  kicker: "Competition & barrier to entry",
  headline: "The feature is copyable. The combination is not.",
  headers: ["Capability", "Legacy HMS", "Scribe-only AI", "Claim-only tools", "Aumrti"],
  rows: [
    ["End-to-end patient journey", { text: "Partial", tone: "part" }, { text: "No", tone: "no" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }],
    ["Multilingual AI at the point of care", { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }],
    ["Insurance, TPA and PMJAY depth", { text: "Partial", tone: "part" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }, { text: "Yes", tone: "yes" }],
    ["ABDM, NABH and HMIS built in", { text: "Partial", tone: "part" }, { text: "No", tone: "no" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }],
    ["One schema, one audit trail", { text: "Partial", tone: "part" }, { text: "No", tone: "no" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }],
    [`All ${FACTS.modules} modules under one login`, { text: "No", tone: "no" }, { text: "No", tone: "no" }, { text: "No", tone: "no" }, { text: "Yes", tone: "yes" }],
  ],
  moat: `Any single feature is replicable in months. The combination is not — workflow depth across ${FACTS.modules} modules, one schema, one audit trail.`,
  rebuild: {
    title: "What a fast follower would actually have to rebuild",
    bullets: [
      `A ${FACTS.tables}-table schema where a ward charge, a lab result and a claim line already refer to the same encounter`,
      `${FACTS.policies} tenant-isolation policies, written before the first customer rather than retrofitted after the first breach`,
      "Indian workflow edge cases across sixty-one modules — NDPS registers, Form F, MLC, day-care packages, TPA query cycles",
      "The clinical safety layer, and the attestation trail that makes AI output medico-legally defensible",
    ],
    note: "Categories we compete with: legacy on-premise HMS · AI scribe point tools · revenue-cycle and claim desks.",
  },
};

export const REVENUE = {
  kicker: "Revenue model",
  headline: "Per-bed subscription, metered AI, one-time implementation",
  sub: "All three mechanics — subscription, metered AI wallet with dunning, and implementation billing — are already implemented in the platform, not planned.",
  lines: [
    {
      stat: "₹250",
      title: "Per bed, per month",
      body: "Recurring subscription across every module the hospital's plan enables.",
      assumption: "A 100-bed hospital pays ₹25,000/month — inside the ₹20,000–₹35,000 band our own pricing rule fixes as viable for a Tier-2 hospital.",
    },
    {
      stat: "₹3,500",
      title: "AI drawdown, per month",
      body: "Metered from a prepaid wallet. Safety AI is never charged against it.",
      assumption: "Median usage, billed on inference actuals plus margin. Our internal ceiling holds median AI cost under ₹2,000/hospital/month.",
    },
    {
      stat: "₹1.5 L",
      title: "Implementation, one-time",
      body: "Migration, training by role, and on-site go-live support.",
      assumption: "About three weeks of work at a 100-bed site. Charged once, on new sites only.",
    },
  ],
  projectionAssumption:
    "Average site 90 beds; cumulative hospitals 4 → 14 → 35. Beds × ₹250 × 12, plus AI drawdown, plus implementation on new sites only. No price escalation assumed.",
  burn: {
    title: "Where the cash goes",
    bullets: [
      "Engineering and clinical-safety salaries — the largest line by far, and most of what the ask is for",
      "AI inference, billed to us in USD against pricing set in INR — the margin most exposed to FX",
      "On-site go-live — Tier-2 implementations need people on the floor, not a webinar",
      "ABDM milestone certification and an independent security review",
    ],
  },
};

export const MARKET = {
  kicker: "Target market",
  headline: "Sized from beds and price, not from a market report",
  sub: "Sized bottom-up on purpose. Analyst totals for Indian hospital software vary by an order of magnitude and would not survive this panel's questions.",
  funnel: [
    {
      tier: "TAM",
      value: `₹${TAM_CR} Cr / year`,
      body: `${MODEL.indiaPrivateHospitals.toLocaleString("en-IN")} private hospitals in India, ~${MODEL.indiaPrivateBedsLakh} lakh private beds.`,
      assumption: `Bed and hospital counts from national health-infrastructure estimates (CBHI lineage), converted at ₹${MODEL.perBed}/bed/month. Subscription only.`,
    },
    {
      tier: "SAM",
      value: `~${AP_HOSPITALS.toLocaleString("en-IN")} hospitals`,
      body: "Private hospitals and nursing homes in Andhra Pradesh, 50–300 bed band.",
      assumption: "Derived by population share — AP is ~3.7% of India — not surveyed. To be validated against the AP Clinical Establishments register.",
    },
    {
      tier: "SOM",
      value: "35 hospitals by Year 3",
      body: `≈2% of that AP base, at ₹${(PROJECTION[2].rev / 10000000).toFixed(2)} Cr revenue.`,
      assumption: "Bottom-up from what one small team can onboard and support: 4 sites, then 14, then 35.",
    },
  ],
  buyer: {
    title: "Who actually signs",
    bullets: [
      "50–300 bed private hospital or nursing home, Tier-2 or Tier-3",
      "The promoter decides; the CFO tests it on claims and GST",
      "The medical director decides whether clinicians will trust it",
      "Budget exists already — the AMC line, plus what NABH costs them",
    ],
  },
  channels: {
    title: "How we reach them",
    bullets: [
      "An AP design-partner hospital through RTIH — the first reference",
      "NABH consultants and CA firms, revenue share capped at 20%",
      "PMJAY empanelment — what makes a hospital shop for software",
      "A WhatsApp-and-field motion, the channel administrators answer",
    ],
  },
};

export const MILESTONES = {
  kicker: "Milestones",
  headline: "Built without funding. The next stage cannot be.",
  sub: "Everything on the left was reached solo and self-funded. Everything on the right needs a hospital that will let us in.",
  achieved: {
    title: "Reached so far",
    bullets: [
      `${FACTS.modules} hospital modules built on one schema — ${FACTS.tables} tables, ${FACTS.functions} server functions`,
      `${FACTS.aiFeatures} AI features wired in, with a deterministic clinical safety layer beneath them`,
      "ABDM gateway integration running against the NHA sandbox across ten functions",
      "Patient-safety and money-handling libraries held under ratcheted CI floors — a regression fails the build",
      `MSME (Udyam) registered — ${fillIn("Udyam number")}`,
    ],
  },
  phases: [
    {
      title: "0–6 months",
      body: "First design-partner hospital live in Andhra Pradesh. Baseline instrumented on day one: clinician minutes per encounter, discharge turnaround, claim-packet completeness. Hardening list closed before go-live.",
    },
    {
      title: "6–12 months",
      body: "ABDM M1–M3 milestone certification. Three paying sites beyond the design partner. First measured evidence — the numbers this deck deliberately does not yet claim.",
    },
    {
      title: "Year 3",
      body: "35 hospitals, a team of roughly twelve, and a go-live playbook repeatable by someone who is not the founder.",
    },
    {
      title: "Year 5",
      body: "State-scale deployment across district and mid-sized hospitals, plus adjacent segments — day-care chains, dialysis and diagnostics networks.",
    },
  ],
};

export const CANDOUR = {
  kicker: "Boundaries",
  headline: "What we do not claim",
  sub: "Each was in an earlier draft and cut because the codebase does not support it. Listed rather than deleted.",
  points: [
    {
      title: "Not proven in production",
      body: "Zero live deployments. Every efficiency benefit here is architectural until a pilot measures it — and that measurement is exactly what we are asking RTIH for.",
    },
    {
      title: "Not machine learning",
      body: "No trained models, no learned weights. Risk scoring is language-model prompts over engineered features; escalation scores are deterministic and guideline-derived — NEWS2, SOFA, APACHE II. Safer at this stage. Still not ML.",
    },
    {
      title: "Not autonomous",
      body: "Nothing allocates a bed, a theatre slot or a nurse without a person acting. Nurse-to-patient requirements are computed from NABH ratios against live acuity and presented for a decision.",
    },
    {
      title: "Not project-wide test coverage",
      body: "The 91% figure belongs to six chosen files — drug safety, clinical calculators, billing, GST, currency, quality indicators — under ratcheted CI. Real discipline, and a real limit.",
    },
  ],
  hardening:
    "A self-audit also produced a short hardening list — tenant-isolation policies on a few configuration tables, dependency advisories, and offline sync wired to one screen so far. All close before any pilot goes live.",
};

export const TEAM = {
  kicker: "Team, funding so far, and the ask",
  headline: "One founder to here. Three hires to a pilot.",
  founder: {
    title: "Yeswanth Gottumukkala — Founder",
    body: `Problem discovery, product direction, full-stack engineering, AI workflow design and compliance surfaces. Architected and built end to end by one person — ${FACTS.linesSrc} lines across ${FACTS.modules} modules.`,
    note: `${fillIn("degree / prior company")} · ${fillIn("years of experience")} · ${fillIn("months full-time")}`,
  },
  hires: {
    title: "First three hires, in order",
    bullets: [
      "Engineer — platform hardening and multi-site deployment",
      "Clinical safety lead — AI evaluation, guardrails, attestation",
      "Hospital operations — onboarding, training, TPA mapping, go-live",
    ],
  },
  funding: {
    title: "Funding so far",
    bullets: [
      `Self-funded — ${fillIn("personal capital")}, no external investment`,
      "MSME (Udyam) registered; incorporation planned alongside incubation",
      "Pre-revenue by choice — we have not sold what we have not measured",
    ],
  },
  ask: {
    title: "The ask",
    amount: "₹1 crore",
    horizon: "18-month runway",
    bullets: [
      "Incubation and mentorship at RTIH Amaravati",
      "A design-partner hospital in Andhra Pradesh, to validate against live operations",
      "Seed or grant support for the first three hires and platform hardening",
    ],
    use: [
      { label: "Team — three hires", pct: 45 },
      { label: "Product & compliance", pct: 20 },
      { label: "Pilot deployment", pct: 15 },
      { label: "GTM & working capital", pct: 20 },
    ],
    assumption:
      "From an 18-month budget: three loaded salaries, on-site go-live at three pilot sites, ABDM certification, an independent security review, and inference at pilot volume.",
  },
  closing: "A pilot that works in Andhra Pradesh is directly replicable across the state.",
};

/* ══ Appendix ════════════════════════════════════════════════════════════ */
export const APPENDIX = [
  {
    kicker: "Appendix A1",
    headline: "OPD, Emergency and Telemedicine",
    cards: [
      { title: "OPD", body: "Queue and token flow, consultation workspace, voice-to-SOAP notes, differential-diagnosis support with supporting and contradicting features, AI clarifying questions, prescription with drug-safety checks, order sets, follow-up scheduling." },
      { title: "Emergency", body: "Triage classification, MLC register, mass-casualty mode, SLA clocks on door-to-doctor and door-to-decision, ED-to-mortuary handling, disaster mode." },
      { title: "Telemedicine & teleconsult", body: "Doctor and patient consultation rooms, scheduling, e-prescription, and consultation notes written back to the same encounter as an in-person visit." },
      { title: "Patient access", body: "Patient portal, kiosk check-in, unified inbox, CRM and patient-relations desk, TV display for waiting areas, health packages and bookings." },
    ],
  },
  {
    kicker: "Appendix A2",
    headline: "IPD, Nursing, Operation Theatre and specialised clinical",
    cards: [
      { title: "IPD & Day Care", body: "Admission, bed board, ward transfers, ward rounds, discharge workflow with clearance gates, day-care package procedures and late-discharge handling." },
      { title: "Nursing", body: "Kardex, drug chart and MAR, vitals with NEWS2 early warning, intake–output, nursing notes, shift handover, and NABH acuity-based staffing computed from live scores." },
      { title: "Operation Theatre & Anaesthesia", body: "Scheduling, WHO surgical safety checklist, consumables and implant tracking, anaesthesia record, and post-operative notes." },
      { title: "Specialised units", body: "Dialysis, Oncology with vial-wastage optimisation, IVF and Andrology, Dental, AYUSH, Physiotherapy, Mental Health, Chronic Disease, Neonatal, Obstetric ANC and Partograph, Ophthalmology, Vaccination, Home Care." },
    ],
  },
  {
    kicker: "Appendix A3",
    headline: "Laboratory and Radiology",
    cards: [
      { title: "Laboratory", body: "Order to sample to result, barcode sample integrity, analyser ingestion, auto-verification rules, reflex testing, antibiotic susceptibility, internal QC with Westgard rules, critical-value alerting and narrative reporting." },
      { title: "Radiology", body: "Modality worklist, DICOM handling, structured reporting with AI-suggested impressions, critical-finding escalation, PCPNDT Form F handling, and report distribution." },
      { title: "Blood Bank", body: "Donor registry and re-engagement, component preparation, cross-match and compatibility, bag labelling, issue and transfusion reaction reporting." },
      { title: "CSSD", body: "Instrument set tracking, sterilisation cycle records with load and biological indicators, issue and return against the theatre that used them." },
    ],
  },
  {
    kicker: "Appendix A4",
    headline: "Pharmacy, Inventory and supply",
    cards: [
      { title: "Pharmacy", body: "Indent to dispense against the prescription, batch and expiry control, substitution rules, returns and credit notes, and a retail counter mode with its own stock." },
      { title: "Drug safety", body: "Interaction checking, allergy cross-reactivity, Schedule H and X controls with NDPS register handling, high-alert medication rules, paediatric dose flags and per-dose ceilings." },
      { title: "Inventory & procurement", body: "Multi-store stock, purchase requisition, RFQ and vendor quotation, purchase orders with e-mail dispatch, goods receipt, consumption posting and reorder levels." },
      { title: "Biomedical & assets", body: "Equipment register, preventive maintenance calendars, breakdown and downtime logs, calibration due tracking, AMC contracts, and fixed-asset depreciation posting to accounts." },
    ],
  },
  {
    kicker: "Appendix A5",
    headline: "Billing, Insurance, PMJAY and Accounts",
    cards: [
      { title: "Billing", body: "Charge capture at the point of care, atomic bill numbering, advances and deposits, discount approval tiers with role-based authority, refunds, day closure and locked-day controls, GST with e-invoice IRN generation." },
      { title: "Insurance & TPA", body: "Payer masters, eligibility, pre-authorisation, claim submission and query response, denial appeal drafting, ageing and SLA tracking, payment reconciliation." },
      { title: "Government schemes", body: "PMJAY eligibility and claim submission, CGHS eligibility, ESI claims, and HCX-based exchange with pre-auth and claim callbacks." },
      { title: "Accounts & payments", body: "Double-entry journal posting from clinical events, financial statements, Tally XML export, Razorpay collection with payment links, subscription billing, settlement reconciliation and dunning." },
    ],
  },
  {
    kicker: "Appendix A6",
    headline: "Operations, estate and workforce",
    cards: [
      { title: "Human Resources", body: "Staff register and credentialing with licence-expiry gates, rostering and duty allocation, attendance, leave, payroll engine with statutory components, payslips and exports." },
      { title: "Facility & estate", body: "Facility management for the building itself — utilities, maintenance requests and work orders — plus housekeeping schedules, infection-control rounds and linen handling." },
      { title: "Support services", body: "Ambulance dispatch and trip logs, mortuary register, dietetics with therapeutic diet orders, and learning management for staff training records." },
      { title: "Medical records", body: "MRD coding with ICD-10 assistance, record completion tracking, retention policy enforcement, retrieval requests and medico-legal document handling." },
    ],
  },
  {
    kicker: "Appendix A7",
    headline: "Analytics, quality and clinical intelligence",
    cards: [
      { title: "Analytics", body: "Operational dashboards, HOD and departmental views, CEO and board pack, revenue intelligence, forecasts and population-health views — all computed from live operational tables, never a separate warehouse." },
      { title: "Quality & NABH", body: "Quality indicators mirrored between SQL views and application code so the dashboard and the criterion score cannot disagree; incident and event reporting, clinical audits, QI projects, committee minutes, and the NABH evidence matrix." },
      { title: "Clinical intelligence", body: "Deterioration and sepsis early warning on NEWS2, acuity-based staffing against NABH ratios, lab anomaly detection, no-show and denial risk scoring, and executive anomaly digests." },
      { title: "Reporting out", body: "HMIS portal submission, IDSP alerts, statutory registers and scheduled exports — produced from routine work rather than assembled at month end." },
    ],
  },
  {
    kicker: "Appendix A8",
    headline: "Role- and user-based access",
    intro: `${FACTS.roles} roles, gated twice — once at the route, once again in the database.`,
    cards: [
      { title: "Clinical roles", body: "Doctor, Nurse — clinical modules, own-patient scoping, prescribing rights and attestation authority for AI-drafted content." },
      { title: "Diagnostic & pharmacy roles", body: "Lab Technician, Radiologist, Pharmacist — their own module plus the order queue that feeds it, and nothing on the financial side." },
      { title: "Financial roles", body: "Billing Executive, Billing Staff, Accountant, CFO — billing, insurance, accounts and day closure, with discount authority tiered by role and enforced by a database trigger." },
      { title: "Administrative roles", body: "Hospital Admin, Super Admin, HR Manager, Reception, plus quality and infection-control roles — settings, masters, workforce and accreditation surfaces." },
    ],
    note: "Route-level roles are declared in code; the same boundary is enforced independently by row-level security in Postgres, so a bypassed screen still cannot read another hospital's row.",
  },
  {
    kicker: "Appendix A9",
    headline: `The full module index — all ${FACTS.modules}`,
    note: "Canonical list, read from src/lib/moduleKeys.ts at build time. Counts on the depth slide are derived from this same source.",
  },
];
