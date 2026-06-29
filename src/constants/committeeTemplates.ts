// ─── Committee Meeting Templates ──────────────────────────────────────────────
// HTML templates for agenda and minutes, keyed by committee type.
// agendaHtml  — pre-structured agenda items for the meeting.
// minutesHtml — skeleton minutes with placeholder sections for the secretary.
// nabh_chapters — NABH chapter codes relevant to this committee type.
// matchPatterns — lowercase substrings matched against the committee name.

export interface CommitteeTemplate {
  id: string;
  name: string;
  agendaHtml: string;
  minutesHtml: string;
  nabh_chapters: string[];
  matchPatterns: string[];
}

// ─── Shared snippets ───────────────────────────────────────────────────────────

const OPENING_ITEMS = `
  <li><strong>Call to Order &amp; Confirmation of Quorum</strong></li>
  <li><strong>Approval of Minutes of Previous Meeting</strong><br/><small>Amendments, if any, to be recorded</small></li>
  <li><strong>Review of Open Action Items</strong><br/><small>Status of action items from the previous meeting</small></li>`;

const CLOSING_ITEMS = `
  <li><strong>Any Other Business</strong></li>
  <li><strong>Date &amp; Venue of Next Meeting</strong></li>`;

const ACTION_TABLE = `
<h4 style="margin:16px 0 6px;font-weight:600;font-size:14px">Action Items Arising from This Meeting</h4>
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead>
    <tr style="background:#f3f4f6">
      <th style="border:1px solid #d1d5db;padding:5px 8px;text-align:left">#</th>
      <th style="border:1px solid #d1d5db;padding:5px 8px;text-align:left">Action</th>
      <th style="border:1px solid #d1d5db;padding:5px 8px;text-align:left">Responsible</th>
      <th style="border:1px solid #d1d5db;padding:5px 8px;text-align:left">Due Date</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="border:1px solid #d1d5db;padding:5px 8px">1.</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td></tr>
    <tr><td style="border:1px solid #d1d5db;padding:5px 8px">2.</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td></tr>
    <tr><td style="border:1px solid #d1d5db;padding:5px 8px">3.</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:5px 8px">&nbsp;</td></tr>
  </tbody>
</table>`;

const MINUTES_FOOTER = `
<hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb"/>
<p style="font-size:12px;color:#6b7280"><strong>Next Meeting:</strong> [Date and Venue to be confirmed]</p>
<p style="font-size:12px;color:#6b7280"><em>Minutes prepared by: ________________________ &nbsp;|&nbsp; Approved by Chairperson: ________________________</em></p>`;

function section(title: string, placeholder = "[Record discussion and decisions here]"): string {
  return `<h4 style="margin:16px 0 4px;font-weight:600;font-size:14px">${title}</h4><p style="margin:0 0 4px;color:#374151">${placeholder}</p>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

const QUALITY_SAFETY: CommitteeTemplate = {
  id: "quality_safety",
  name: "Quality & Safety Committee",
  matchPatterns: ["quality", "patient safety", "qps"],
  nabh_chapters: ["QPS", "COP"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Review of Incidents &amp; Near-Misses</strong>
    <ul style="margin-top:4px">
      <li>Incident summary — type, severity, department distribution</li>
      <li>Root cause analysis updates on serious events</li>
      <li>Sentinel event review (if applicable)</li>
    </ul>
  </li>
  <li><strong>CAPA Status Update</strong>
    <ul style="margin-top:4px">
      <li>Open CAPAs — status and target closure dates</li>
      <li>CAPAs due for closure — effectiveness verified?</li>
    </ul>
  </li>
  <li><strong>Quality Indicators Review</strong>
    <ul style="margin-top:4px">
      <li>Key performance indicators dashboard</li>
      <li>Patient safety indicators (falls, pressure injuries, medication errors)</li>
      <li>Trend analysis vs. previous period</li>
    </ul>
  </li>
  <li><strong>IPC Update</strong>
    <ul style="margin-top:4px">
      <li>HAI surveillance summary</li>
      <li>Hand hygiene compliance audit result</li>
      <li>Bundle compliance rates</li>
    </ul>
  </li>
  <li><strong>Audit Findings Review</strong>
    <ul style="margin-top:4px">
      <li>Summary of clinical and process audits conducted</li>
      <li>Non-conformances and improvement plans</li>
    </ul>
  </li>
  <li><strong>Risk Register Review</strong><br/><small>New risks added; existing risk ratings reviewed</small></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong> [List names and designations]<br/><strong>Quorum:</strong> [Met / Not Met — quorum requirement: __ members]")}
${section("2. Approval of Previous Minutes", "[Approved without amendments / Approved with the following amendments: ...]")}
${section("3. Open Action Items Review", "[Summary of action item statuses — carried over, completed, deferred, with reasons]")}
${section("4. Review of Incidents & Near-Misses", "<strong>Discussion:</strong> [Number and nature of incidents, departments affected, RCA status]<br/><strong>Decision/Recommendation:</strong>")}
${section("5. CAPA Status Update", "<strong>Discussion:</strong> [CAPAs reviewed, new ones opened, closures approved]<br/><strong>Decision/Recommendation:</strong>")}
${section("6. Quality Indicators Review", "<strong>Discussion:</strong> [KPI highlights, deviations from targets, trend observations]<br/><strong>Decision/Recommendation:</strong>")}
${section("7. IPC Update", "<strong>Discussion:</strong> [HAI rates, hand hygiene compliance %, bundle adherence]<br/><strong>Decision/Recommendation:</strong>")}
${section("8. Audit Findings Review", "<strong>Discussion:</strong><br/><strong>Decision/Recommendation:</strong>")}
${section("9. Risk Register Review", "<strong>Discussion:</strong><br/><strong>New Risks Identified:</strong>")}
${section("10. Any Other Business", "[Items raised]")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const IPC: CommitteeTemplate = {
  id: "ipc",
  name: "IPC Committee",
  matchPatterns: ["ipc", "infection control", "infection prevention"],
  nabh_chapters: ["HIC", "QPS"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>HAI Surveillance Data Review</strong>
    <ul style="margin-top:4px">
      <li>CLABSI rate (per 1,000 central line days)</li>
      <li>CAUTI rate (per 1,000 catheter days)</li>
      <li>VAP rate (per 1,000 ventilator days)</li>
      <li>SSI rate by procedure type</li>
      <li>Comparison with NABH benchmarks</li>
    </ul>
  </li>
  <li><strong>Antibiotic Stewardship Update</strong>
    <ul style="margin-top:4px">
      <li>Antibiotic consumption data (DDD/100 bed-days)</li>
      <li>Culture &amp; sensitivity patterns — resistance trends</li>
      <li>Restricted antibiotic usage review</li>
    </ul>
  </li>
  <li><strong>Hand Hygiene Compliance Audit</strong>
    <ul style="margin-top:4px">
      <li>WHO 5-moments compliance by department</li>
      <li>Improvement actions from previous audit</li>
    </ul>
  </li>
  <li><strong>Environmental Rounds Report</strong>
    <ul style="margin-top:4px">
      <li>Terminal cleaning compliance</li>
      <li>Linen &amp; laundry audit</li>
      <li>Fumigation / ATP testing results</li>
    </ul>
  </li>
  <li><strong>Bundle Compliance Report</strong>
    <ul style="margin-top:4px">
      <li>CLABSI prevention bundle adherence</li>
      <li>CAUTI prevention bundle adherence</li>
      <li>VAP prevention bundle adherence</li>
    </ul>
  </li>
  <li><strong>Outbreak &amp; Cluster Update</strong><br/><small>Active outbreaks, containment measures, resolution status</small></li>
  <li><strong>Biomedical Waste Compliance</strong></li>
  <li><strong>IPC Training &amp; Awareness Update</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong> [List names]<br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. HAI Surveillance Data", "<strong>CLABSI:</strong> [Rate] — <strong>CAUTI:</strong> [Rate] — <strong>VAP:</strong> [Rate] — <strong>SSI:</strong> [Rate]<br/><strong>Discussion:</strong><br/><strong>Decision/Recommendation:</strong>")}
${section("5. Antibiotic Stewardship Update", "<strong>Discussion:</strong> [Consumption data, resistance patterns, policy adherence]<br/><strong>Decision/Recommendation:</strong>")}
${section("6. Hand Hygiene Compliance", "<strong>Overall compliance:</strong> [%]<br/><strong>Department-wise highlights:</strong><br/><strong>Action plan for departments below target:</strong>")}
${section("7. Environmental Rounds Report", "<strong>Discussion:</strong><br/><strong>Non-conformances noted:</strong><br/><strong>Corrective actions:</strong>")}
${section("8. Bundle Compliance", "<strong>CLABSI bundle:</strong> [%] &nbsp;|&nbsp; <strong>CAUTI bundle:</strong> [%] &nbsp;|&nbsp; <strong>VAP bundle:</strong> [%]<br/><strong>Gaps and improvement plan:</strong>")}
${section("9. Outbreak / Cluster Update")}
${section("10. Biomedical Waste Compliance")}
${section("11. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const OT: CommitteeTemplate = {
  id: "ot",
  name: "OT Committee",
  matchPatterns: ["ot committee", "operation theatre", "surgical committee", "perioperative"],
  nabh_chapters: ["COP", "HIC", "FMS"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>OT Utilisation &amp; Scheduling Review</strong>
    <ul style="margin-top:4px">
      <li>OT utilisation rate by theatre</li>
      <li>Elective vs. emergency case mix</li>
      <li>First-case on-time starts</li>
      <li>Turnover time analysis</li>
    </ul>
  </li>
  <li><strong>Surgical Site Infection (SSI) Rates</strong>
    <ul style="margin-top:4px">
      <li>SSI rates by procedure and surgeon</li>
      <li>Antibiotic prophylaxis compliance</li>
    </ul>
  </li>
  <li><strong>Surgical Safety Checklist Compliance</strong>
    <ul style="margin-top:4px">
      <li>WHO Surgical Safety Checklist audit results</li>
      <li>Time-out compliance</li>
    </ul>
  </li>
  <li><strong>Consent &amp; Documentation Audit</strong></li>
  <li><strong>Case Cancellations Analysis</strong>
    <ul style="margin-top:4px">
      <li>Number and reasons for cancellations</li>
      <li>Corrective measures</li>
    </ul>
  </li>
  <li><strong>Equipment &amp; Sterilisation Compliance</strong></li>
  <li><strong>Adverse Events / Near-Misses in OT</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong> [List names]<br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. OT Utilisation & Scheduling", "<strong>Utilisation rate:</strong> [%]<br/><strong>First-case on-time starts:</strong> [%]<br/><strong>Discussion &amp; decisions:</strong>")}
${section("5. SSI Rates", "<strong>Overall SSI rate:</strong><br/><strong>Discussion of high-SSI procedures:</strong><br/><strong>Antibiotic prophylaxis compliance:</strong> [%]")}
${section("6. Surgical Safety Checklist Compliance", "<strong>Compliance rate:</strong> [%]<br/><strong>Gaps identified:</strong><br/><strong>Corrective action:</strong>")}
${section("7. Consent & Documentation Audit")}
${section("8. Case Cancellations", "<strong>Total cancellations:</strong><br/><strong>Reasons breakdown:</strong><br/><strong>Actions to reduce:</strong>")}
${section("9. Equipment & Sterilisation")}
${section("10. Adverse Events / Near-Misses")}
${section("11. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const PHARMACY_THERAPEUTICS: CommitteeTemplate = {
  id: "pharmacy_therapeutics",
  name: "Pharmacy & Therapeutics Committee",
  matchPatterns: ["pharmacy", "therapeutics", "p&t", "drug"],
  nabh_chapters: ["MOM", "QPS"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Drug Utilisation Review</strong>
    <ul style="margin-top:4px">
      <li>High-cost drug utilisation analysis</li>
      <li>Top 10 drugs by volume and expenditure</li>
      <li>Generic vs. branded prescribing ratio</li>
    </ul>
  </li>
  <li><strong>Formulary Management</strong>
    <ul style="margin-top:4px">
      <li>Proposed formulary additions — evidence review</li>
      <li>Drugs to be deleted or restricted</li>
      <li>Non-formulary drug requests review</li>
    </ul>
  </li>
  <li><strong>Adverse Drug Reaction (ADR) Report</strong>
    <ul style="margin-top:4px">
      <li>ADRs reported in the period</li>
      <li>Serious/unexpected reactions — pharmacovigilance</li>
    </ul>
  </li>
  <li><strong>Medication Errors Review</strong>
    <ul style="margin-top:4px">
      <li>Error types, severity, contributing factors</li>
      <li>Near-misses caught at dispensing/administration</li>
    </ul>
  </li>
  <li><strong>High-Alert Medications Update</strong>
    <ul style="margin-top:4px">
      <li>LASA drug list review</li>
      <li>Double-check compliance for high-alert drugs</li>
    </ul>
  </li>
  <li><strong>Antibiotic Stewardship Report</strong></li>
  <li><strong>Pharmacy KPIs &amp; Stock Management</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong> [List names]<br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. Drug Utilisation Review", "<strong>Key findings:</strong><br/><strong>Decision/Recommendation:</strong>")}
${section("5. Formulary Management", "<strong>Proposed additions:</strong><br/><strong>Decision (approved/rejected/deferred):</strong><br/><strong>Deletions:</strong>")}
${section("6. ADR Report", "<strong>Total ADRs reported:</strong><br/><strong>Serious reactions:</strong><br/><strong>Actions taken:</strong>")}
${section("7. Medication Errors Review", "<strong>Total errors:</strong><br/><strong>Root causes identified:</strong><br/><strong>Corrective actions:</strong>")}
${section("8. High-Alert Medications Update", "<strong>LASA list changes:</strong><br/><strong>Double-check compliance:</strong> [%]")}
${section("9. Antibiotic Stewardship Report")}
${section("10. Pharmacy KPIs")}
${section("11. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const MORTALITY_MORBIDITY: CommitteeTemplate = {
  id: "mortality_morbidity",
  name: "Mortality & Morbidity Committee",
  matchPatterns: ["mortality", "morbidity", "m&m", "death"],
  nabh_chapters: ["QPS", "COP", "AAC"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  <li><strong>Confirmation of Quorum &amp; Opening</strong></li>
  <li><strong>Approval of Previous Meeting Minutes</strong></li>
  <li><strong>Mortality Review</strong>
    <ul style="margin-top:4px">
      <li>Death cases from the review period (anonymised summaries)</li>
      <li>Preventable vs. non-preventable deaths classification</li>
      <li>Gross Death Rate &amp; Net Death Rate</li>
    </ul>
  </li>
  <li><strong>Morbidity Case Presentations</strong>
    <ul style="margin-top:4px">
      <li>Selected complex/complicated cases for peer review</li>
      <li>Adverse outcomes (re-admissions, ICU transfers, return to OT)</li>
    </ul>
  </li>
  <li><strong>Root Cause Analysis Discussion</strong>
    <ul style="margin-top:4px">
      <li>System failures vs. individual factors</li>
      <li>Contributing factors identified</li>
    </ul>
  </li>
  <li><strong>Lessons Learned &amp; Recommendations</strong>
    <ul style="margin-top:4px">
      <li>Protocol gaps identified</li>
      <li>Educational needs</li>
      <li>System improvements proposed</li>
    </ul>
  </li>
  <li><strong>Follow-up on Previous Recommendations</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong> [List names — confidentiality reminder issued]<br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Mortality Review", "<strong>Total deaths in period:</strong><br/><strong>Preventable:</strong> &nbsp; <strong>Non-preventable:</strong><br/><strong>Gross Death Rate:</strong> &nbsp; <strong>Net Death Rate:</strong><br/><strong>Case summaries reviewed:</strong><br/><strong>Discussion &amp; classification:</strong>")}
${section("4. Morbidity Case Presentations", "<strong>Cases presented:</strong><br/><strong>Discussion:</strong><br/><strong>Recommendations:</strong>")}
${section("5. Root Cause Analysis", "<strong>Contributing factors identified:</strong><br/><strong>System issues vs. individual factors:</strong>")}
${section("6. Lessons Learned & Recommendations", "<strong>Protocol/guideline gaps:</strong><br/><strong>Training needs:</strong><br/><strong>System improvements proposed:</strong>")}
${section("7. Follow-up on Previous Recommendations")}
${section("8. Any Other Business")}
${ACTION_TABLE}
<p style="font-size:11px;color:#9ca3af;margin-top:12px"><em>⚠️ These minutes are CONFIDENTIAL — for Quality Improvement purposes only. Not to be used in legal proceedings.</em></p>
${MINUTES_FOOTER}`,
};

const BLOOD_TRANSFUSION: CommitteeTemplate = {
  id: "blood_transfusion",
  name: "Blood Transfusion Committee",
  matchPatterns: ["blood transfusion", "blood bank", "transfusion"],
  nabh_chapters: ["COP", "MOM"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Blood Component Utilisation Review</strong>
    <ul style="margin-top:4px">
      <li>PRBC, FFP, platelets, cryoprecipitate usage data</li>
      <li>Wastage and expiry report</li>
      <li>Crossmatch-to-Transfusion (C:T) ratio</li>
    </ul>
  </li>
  <li><strong>Transfusion Reactions Report</strong>
    <ul style="margin-top:4px">
      <li>Type and severity of reactions</li>
      <li>Investigation outcomes</li>
      <li>Haemovigilance reporting</li>
    </ul>
  </li>
  <li><strong>Blood Bank TAT &amp; Quality Metrics</strong>
    <ul style="margin-top:4px">
      <li>Turnaround time for emergency and routine requests</li>
      <li>Compatibility testing compliance</li>
    </ul>
  </li>
  <li><strong>Blood Inventory &amp; Supply Management</strong></li>
  <li><strong>Massive Transfusion Protocol Review</strong></li>
  <li><strong>Consent for Transfusion Compliance</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. Blood Component Utilisation", "<strong>PRBC units:</strong> &nbsp; <strong>FFP units:</strong> &nbsp; <strong>Platelets:</strong><br/><strong>C:T ratio:</strong> &nbsp; <strong>Wastage:</strong><br/><strong>Discussion:</strong>")}
${section("5. Transfusion Reactions", "<strong>Total reactions:</strong><br/><strong>Type/severity breakdown:</strong><br/><strong>Investigation outcomes &amp; actions:</strong>")}
${section("6. Blood Bank TAT & Quality Metrics", "<strong>Emergency TAT (mean):</strong><br/><strong>Routine TAT (mean):</strong><br/><strong>Issues identified:</strong>")}
${section("7. Blood Inventory & Supply")}
${section("8. MTP Review")}
${section("9. Consent for Transfusion Compliance", "<strong>Compliance rate:</strong> [%]")}
${section("10. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const ETHICS: CommitteeTemplate = {
  id: "ethics",
  name: "Ethics Committee",
  matchPatterns: ["ethics", "ethical"],
  nabh_chapters: ["PRE", "COP"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Ethics Consultation Cases Review</strong>
    <ul style="margin-top:4px">
      <li>Cases referred to the committee (anonymised)</li>
      <li>Recommendations issued and their outcomes</li>
    </ul>
  </li>
  <li><strong>Informed Consent Compliance Audit</strong>
    <ul style="margin-top:4px">
      <li>Consent documentation quality</li>
      <li>Patient education practices</li>
    </ul>
  </li>
  <li><strong>Patient Rights Review</strong>
    <ul style="margin-top:4px">
      <li>Patient complaints related to rights violations</li>
      <li>Advance directives / DNR compliance</li>
    </ul>
  </li>
  <li><strong>Research &amp; Clinical Trials (if applicable)</strong>
    <ul style="margin-top:4px">
      <li>New study approvals / amendments</li>
      <li>Ongoing study safety reviews</li>
    </ul>
  </li>
  <li><strong>Policy Review</strong><br/><small>Policies related to ethics, consent, end-of-life care</small></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]<br/><em>Reminder: deliberations of this committee are confidential</em>")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. Ethics Consultation Cases", "<strong>Cases reviewed:</strong><br/><strong>Recommendations issued:</strong><br/><strong>Outcomes (if known):</strong>")}
${section("5. Informed Consent Compliance Audit", "<strong>Compliance rate:</strong> [%]<br/><strong>Issues identified:</strong><br/><strong>Corrective actions:</strong>")}
${section("6. Patient Rights Review", "<strong>Complaints related to rights:</strong><br/><strong>DNR/advance directive issues:</strong>")}
${section("7. Research & Clinical Trials")}
${section("8. Policy Review", "<strong>Policies reviewed/approved:</strong>")}
${section("9. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const NABH_STEERING: CommitteeTemplate = {
  id: "nabh_steering",
  name: "NABH Steering Committee",
  matchPatterns: ["nabh", "steering", "accreditation"],
  nabh_chapters: ["QPS", "ROM"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>NABH Accreditation Status &amp; Roadmap</strong>
    <ul style="margin-top:4px">
      <li>Overall accreditation readiness score</li>
      <li>Chapter-wise compliance summary</li>
      <li>Timeline to next assessment / re-accreditation</li>
    </ul>
  </li>
  <li><strong>Internal Audit Findings</strong>
    <ul style="margin-top:4px">
      <li>High-priority non-conformances</li>
      <li>Trend in closure of non-conformances</li>
    </ul>
  </li>
  <li><strong>Chapter-wise Review</strong>
    <ul style="margin-top:4px">
      <li>Chapters with compliance &lt;70% — deep dive</li>
      <li>Evidence documentation status</li>
    </ul>
  </li>
  <li><strong>Committee Activity Report</strong><br/><small>Meeting frequencies, quorum compliance, action item closure rates for all sub-committees</small></li>
  <li><strong>Patient Safety Indicators &amp; KPIs</strong></li>
  <li><strong>Training &amp; Competency Status</strong></li>
  <li><strong>External Assessment Preparation</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. NABH Accreditation Status", "<strong>Overall readiness score:</strong> [%]<br/><strong>Chapters below threshold:</strong><br/><strong>Key milestones:</strong>")}
${section("5. Internal Audit Findings", "<strong>High-priority NCs:</strong><br/><strong>NC closure rate:</strong> [%]<br/><strong>Escalation needed for:</strong>")}
${section("6. Chapter-wise Review", "<strong>Chapters reviewed:</strong><br/><strong>Discussion:</strong><br/><strong>Actions assigned:</strong>")}
${section("7. Committee Activity Report")}
${section("8. Patient Safety Indicators")}
${section("9. Training & Competency Status")}
${section("10. External Assessment Preparation")}
${section("11. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const BMW: CommitteeTemplate = {
  id: "bmw",
  name: "Biomedical Waste Committee",
  matchPatterns: ["biomedical waste", "bio-medical waste", "bmw", "waste management"],
  nabh_chapters: ["FMS", "HIC"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>BMW Generation &amp; Segregation Data</strong>
    <ul style="margin-top:4px">
      <li>Category-wise waste quantities (kg/day)</li>
      <li>Comparison with previous period and benchmarks</li>
    </ul>
  </li>
  <li><strong>Segregation Compliance Audit</strong>
    <ul style="margin-top:4px">
      <li>Department-wise segregation compliance</li>
      <li>Non-conformances observed in colour-coded bin usage</li>
    </ul>
  </li>
  <li><strong>Authorised Vendor Performance Review</strong>
    <ul style="margin-top:4px">
      <li>Collection frequency and documentation</li>
      <li>Treatment / disposal certificates</li>
    </ul>
  </li>
  <li><strong>Waste Treatment Equipment Compliance</strong></li>
  <li><strong>Staff Training &amp; Awareness</strong></li>
  <li><strong>CPCB / SPCB Compliance Status</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. BMW Generation Data", "<strong>Total waste generated:</strong> [kg/day]<br/><strong>Category breakdown:</strong><br/><strong>Trend vs. previous period:</strong>")}
${section("5. Segregation Compliance Audit", "<strong>Overall compliance:</strong> [%]<br/><strong>Non-compliant departments:</strong><br/><strong>Corrective actions:</strong>")}
${section("6. Vendor Performance", "<strong>Collection frequency adherence:</strong><br/><strong>Documentation status:</strong><br/><strong>Issues raised:</strong>")}
${section("7. Treatment Equipment Compliance")}
${section("8. Staff Training Status")}
${section("9. CPCB / SPCB Compliance")}
${section("10. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const DISASTER_MANAGEMENT: CommitteeTemplate = {
  id: "disaster_management",
  name: "Disaster Management Committee",
  matchPatterns: ["disaster", "emergency preparedness", "mass casualty"],
  nabh_chapters: ["FMS"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Review of Disaster / Emergency Events</strong>
    <ul style="margin-top:4px">
      <li>Incidents that triggered emergency protocols</li>
      <li>Response evaluation and lessons learned</li>
    </ul>
  </li>
  <li><strong>Mock Drill Report</strong>
    <ul style="margin-top:4px">
      <li>Drill conducted (fire / mass casualty / chemical spill)</li>
      <li>Gaps identified, response time evaluation</li>
    </ul>
  </li>
  <li><strong>Mass Casualty Incident (MCI) Preparedness</strong>
    <ul style="margin-top:4px">
      <li>MCI plan review and update status</li>
      <li>Triage area readiness</li>
    </ul>
  </li>
  <li><strong>Fire Safety Compliance</strong>
    <ul style="margin-top:4px">
      <li>Fire extinguisher inspection status</li>
      <li>Fire exit and suppression system compliance</li>
    </ul>
  </li>
  <li><strong>Utility Failure Contingency</strong><br/><small>Power, water, oxygen, IT — failover plan status</small></li>
  <li><strong>Training &amp; Awareness Update</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. Emergency Events Review")}
${section("5. Mock Drill Report", "<strong>Drill type and date:</strong><br/><strong>Participation rate:</strong><br/><strong>Response time:</strong><br/><strong>Gaps identified:</strong><br/><strong>Corrective actions:</strong>")}
${section("6. MCI Preparedness")}
${section("7. Fire Safety Compliance", "<strong>Fire extinguisher status:</strong><br/><strong>Fire exit compliance:</strong><br/><strong>Suppression system status:</strong>")}
${section("8. Utility Failure Contingency")}
${section("9. Training & Awareness")}
${section("10. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

const GENERIC: CommitteeTemplate = {
  id: "generic",
  name: "General Committee",
  matchPatterns: [],
  nabh_chapters: ["ROM"],
  agendaHtml: `
<ol style="padding-left:20px;line-height:1.8">
  ${OPENING_ITEMS}
  <li><strong>Review of Key Performance Indicators</strong>
    <ul style="margin-top:4px">
      <li>Departmental KPI dashboard</li>
      <li>Variance analysis</li>
    </ul>
  </li>
  <li><strong>Incident &amp; Issue Review</strong></li>
  <li><strong>Policy / Protocol Updates</strong></li>
  <li><strong>Resource &amp; Infrastructure Update</strong></li>
  ${CLOSING_ITEMS}
</ol>`,
  minutesHtml: `
${section("1. Attendance & Quorum", "<strong>Members Present:</strong><br/><strong>Quorum:</strong> [Met / Not Met]")}
${section("2. Approval of Previous Minutes")}
${section("3. Open Action Items Review")}
${section("4. KPI Review", "<strong>Discussion:</strong><br/><strong>Decision/Recommendation:</strong>")}
${section("5. Incident & Issue Review")}
${section("6. Policy / Protocol Updates")}
${section("7. Resource & Infrastructure")}
${section("8. Any Other Business")}
${ACTION_TABLE}
${MINUTES_FOOTER}`,
};

// ─── Ordered template list (first match wins) ─────────────────────────────────

const ALL_TEMPLATES: CommitteeTemplate[] = [
  IPC,
  MORTALITY_MORBIDITY,
  BLOOD_TRANSFUSION,
  ETHICS,
  PHARMACY_THERAPEUTICS,
  NABH_STEERING,
  BMW,
  DISASTER_MANAGEMENT,
  OT,
  QUALITY_SAFETY,  // broad patterns last so they don't shadow others
];

// ─── Exported lookup ──────────────────────────────────────────────────────────

export function getCommitteeTemplate(committeeName: string): CommitteeTemplate {
  const lower = committeeName.toLowerCase();
  for (const t of ALL_TEMPLATES) {
    if (t.matchPatterns.some(p => lower.includes(p))) return t;
  }
  return GENERIC;
}

export { ALL_TEMPLATES, GENERIC };
