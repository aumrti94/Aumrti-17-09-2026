import React, { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Printer } from "lucide-react";
import type { OpdToken } from "@/pages/opd/OPDPage";
import { printDocument, printHeader } from "@/lib/printUtils";
import PatientHistorySection from "@/components/clinical/PatientHistorySection";

interface Props {
  token: OpdToken;
  encounterId: string | null;
  userId: string;
  /**
   * Appends the digest summary to the encounter's History of Present Illness.
   * Supplied only inside a consultation — the same panel is mounted in the patient
   * record at registration, where there is no encounter to write to.
   */
  onInsertToHpi?: (text: string) => void;
  /**
   * The consultation holds its own copy of the digest to feed the AI Guidance cards.
   * Fired whenever this tab changes it (a scan finished, a doctor attested) so the two
   * copies cannot disagree about whether the history is verified.
   */
  onDigestChange?: () => void;
}

interface PastEncounter {
  id: string;
  visit_date: string;
  diagnosis: string | null;
  icd10_code: string | null;
  chief_complaint: string | null;
  history_of_present_illness: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  follow_up_notes: string | null;
  vitals: Record<string, unknown> | null;
  doctor_id: string;
  doctor?: { full_name: string } | null;
  prescriptions?: {
    drugs: any[];
    lab_orders: any[];
    radiology_orders: any[];
    advice_notes: string;
    review_date: string | null;
  }[] | null;
}

const CONDITION_CHIPS = [
  "Hypertension", "Diabetes", "Asthma", "COPD", "CAD",
  "Hypothyroidism", "CKD", "Epilepsy", "Arthritis",
];

const HistoryTab: React.FC<Props> = ({ token, encounterId, userId, onInsertToHpi, onDigestChange }) => {
  const [conditions, setConditions] = useState<string[]>(token.patient?.chronic_conditions || []);
  const [condInput, setCondInput] = useState("");
  const [pastVisits, setPastVisits] = useState<PastEncounter[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hospitalInfo, setHospitalInfo] = useState<any>(null);

  useEffect(() => {
    if (!token.hospital_id) return;
    supabase.from("hospitals").select("name, address").eq("id", token.hospital_id).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [token.hospital_id]);

  // Read through a ref so this stays keyed on patient_id: it re-seeds the editable
  // list when a DIFFERENT patient is opened, and must not overwrite the user's
  // edits every time the queue refresh hands back an equal array.
  const chronicConditionsRef = useRef(token.patient?.chronic_conditions);
  useEffect(() => { chronicConditionsRef.current = token.patient?.chronic_conditions; });

  useEffect(() => {
    setConditions(chronicConditionsRef.current || []);
  }, [token.patient_id]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("opd_encounters")
        .select("id, visit_date, diagnosis, icd10_code, chief_complaint, history_of_present_illness, soap_assessment, soap_plan, follow_up_notes, vitals, doctor_id, doctor:users!opd_encounters_doctor_id_fkey(full_name), prescriptions(drugs, lab_orders, radiology_orders, advice_notes, review_date)")
        .eq("patient_id", token.patient_id)
        .neq("id", encounterId || "00000000-0000-0000-0000-000000000000")
        .order("visit_date", { ascending: false })
        .limit(10);
      setPastVisits((data as any[]) || []);
    })();
  }, [token.patient_id, encounterId]);

  const addCondition = (name: string) => {
    if (!name.trim() || conditions.includes(name)) return;
    const next = [...conditions, name];
    setConditions(next);
    setCondInput("");
    supabase.from("patients").update({ chronic_conditions: next }).eq("id", token.patient_id);
  };

  /**
   * Bulk add from the scanned-records digest. One write rather than N, and matched
   * case-insensitively so "Diabetes" from an outside discharge summary does not land
   * next to the "diabetes" a receptionist already typed.
   */
  const addConditions = useCallback((names: string[]) => {
    setConditions((prev) => {
      const seen = new Set(prev.map((c) => c.trim().toLowerCase()));
      const additions = names
        .map((n) => n.trim())
        .filter((n) => n && !seen.has(n.toLowerCase()) && (seen.add(n.toLowerCase()), true));
      if (additions.length === 0) return prev;
      const next = [...prev, ...additions];
      void supabase.from("patients").update({ chronic_conditions: next }).eq("id", token.patient_id);
      return next;
    });
  }, [token.patient_id]);

  const removeCondition = (name: string) => {
    const next = conditions.filter((c) => c !== name);
    setConditions(next);
    supabase.from("patients").update({ chronic_conditions: next }).eq("id", token.patient_id);
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Chronic Conditions */}
      <div>
        <label className="text-xs font-bold text-slate-700 mb-2 block">Chronic Conditions</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {conditions.map((c) => (
            <span key={c} className="text-xs bg-blue-50 text-[#1A2F5A] border border-blue-200 rounded-full px-2.5 py-0.5 flex items-center gap-1">
              {c}
              <button onClick={() => removeCondition(c)} className="text-blue-400 hover:text-red-500 ml-0.5">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1 mb-2">
          <input value={condInput} onChange={(e) => setCondInput(e.target.value)} placeholder="Add condition" className="flex-1 h-8 px-2 border border-slate-200 rounded text-xs outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") addCondition(condInput); }} />
          <button onClick={() => addCondition(condInput)} className="text-xs bg-slate-100 px-2 rounded hover:bg-slate-200">+</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {CONDITION_CHIPS.filter((c) => !conditions.includes(c)).map((c) => (
            <button key={c} onClick={() => addCondition(c)} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100">{c}</button>
          ))}
        </div>
      </div>

      {/* Records from other hospitals — scan, read, and the resulting timeline.
          Sits above Previous OPD Visits because for a new patient it is the ONLY
          history there is: "Previous OPD Visits" only ever knows about this hospital. */}
      {token.hospital_id && (
        <PatientHistorySection
          patientId={token.patient_id}
          hospitalId={token.hospital_id}
          userId={userId}
          encounterId={encounterId}
          onInsertToHpi={onInsertToHpi}
          onAddChronicConditions={addConditions}
          onDigestChange={onDigestChange}
        />
      )}

      {/* Previous Visits */}
      <div>
        <label className="text-xs font-bold text-slate-700 mb-2 block">Previous OPD Visits</label>
        {pastVisits.length === 0 ? (
          <p className="text-xs text-slate-400">No previous visits on record</p>
        ) : (
          <div className="space-y-2">
            {pastVisits.map((visit) => {
              const rx = visit.prescriptions?.[0];
              const hasRx = !!(rx?.drugs?.length || rx?.lab_orders?.length || rx?.radiology_orders?.length || rx?.advice_notes);
              return (
              <div key={visit.id} className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === visit.id ? null : visit.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-500">{new Date(visit.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                    <span className="font-medium text-slate-900">{visit.diagnosis || "No diagnosis"}</span>
                  </div>
                  {expanded === visit.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {expanded === visit.id && (
                  <div className="border-t border-slate-100 p-3 bg-slate-50 text-xs space-y-2">
                    {visit.chief_complaint && <div><span className="font-bold text-slate-600">Complaint:</span> <span className="text-slate-700">{visit.chief_complaint}</span></div>}
                    {visit.history_of_present_illness && <div><span className="font-bold text-slate-600">History:</span> <div className="text-slate-700 whitespace-pre-wrap">{visit.history_of_present_illness}</div></div>}
                    {visit.diagnosis && <div><span className="font-bold text-slate-600">Diagnosis:</span> <span className="text-slate-700">{visit.diagnosis}{visit.icd10_code ? ` (${visit.icd10_code})` : ""}</span></div>}
                    {visit.soap_assessment && <div><span className="font-bold text-slate-600">Assessment:</span> <span className="text-slate-700 whitespace-pre-wrap">{visit.soap_assessment}</span></div>}
                    {visit.soap_plan && <div><span className="font-bold text-slate-600">Plan:</span> <div className="text-slate-700 whitespace-pre-wrap">{visit.soap_plan}</div></div>}

                    {/* Medications */}
                    {rx?.drugs?.length > 0 && (
                      <div>
                        <span className="font-bold text-slate-600">Medications:</span>
                        <ul className="list-disc pl-5 mt-0.5 space-y-0.5 text-slate-700">
                          {rx.drugs.map((d: any, i: number) => (
                            <li key={i}>
                              {d.drug_name}{d.dose ? ` ${d.dose}` : ""}{d.frequency ? ` · ${d.frequency}` : ""}{d.duration_days ? ` · ${d.duration_days}d` : ""}{d.instructions ? ` — ${d.instructions}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {rx?.lab_orders?.length > 0 && <div><span className="font-bold text-slate-600">Lab Orders:</span> <span className="text-slate-700">{rx.lab_orders.map((l: any) => l.test_name).join(", ")}</span></div>}
                    {rx?.radiology_orders?.length > 0 && <div><span className="font-bold text-slate-600">Radiology:</span> <span className="text-slate-700">{rx.radiology_orders.map((r: any) => r.study_name).join(", ")}</span></div>}
                    {rx?.advice_notes && <div><span className="font-bold text-slate-600">Advice:</span> <div className="text-slate-700 whitespace-pre-wrap">{rx.advice_notes}</div></div>}
                    {(visit.follow_up_notes || rx?.review_date) && (
                      <div>
                        <span className="font-bold text-slate-600">Follow-up:</span>{" "}
                        <span className="text-slate-700 whitespace-pre-wrap">
                          {rx?.review_date ? `Review ${new Date(rx.review_date).toLocaleDateString("en-IN")}` : ""}
                          {rx?.review_date && visit.follow_up_notes ? " — " : ""}
                          {visit.follow_up_notes || ""}
                        </span>
                      </div>
                    )}
                    {!hasRx && <div className="text-slate-400 italic">No prescription recorded for this visit.</div>}

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const drugsHtml = rx?.drugs?.length > 0
                            ? `<table><tr><th>Drug</th><th>Dose</th><th>Freq</th><th>Dur</th><th>Instructions</th></tr>${rx.drugs.map((d: any) => `<tr><td><b>${d.drug_name}</b></td><td>${d.dose}</td><td>${d.frequency}</td><td>${d.duration_days}d</td><td style="font-size:11px">${d.instructions || ""}</td></tr>`).join("")}</table>`
                            : "<p>No medications prescribed.</p>";
                          const labHtml = rx?.lab_orders?.length > 0
                            ? `<div class="section-title">Lab Orders</div><ul style="margin:0;padding-left:20px;">${rx.lab_orders.map((l: any) => `<li>${l.test_name}</li>`).join("")}</ul>`
                            : "";
                          const radHtml = rx?.radiology_orders?.length > 0
                            ? `<div class="section-title" style="margin-top:10px;">Radiology Orders</div><ul style="margin:0;padding-left:20px;">${rx.radiology_orders.map((r: any) => `<li>${r.study_name}</li>`).join("")}</ul>`
                            : "";
                          const followUp = visit.follow_up_notes || rx?.review_date
                            ? `<div style="margin-top:15px;padding:8px;border:1px dashed #1A2F5A;border-radius:4px;background:#f0f7ff;"><b style="color:#1A2F5A">Follow-up</b>${rx?.review_date ? ` <span style="color:#1A2F5A;">Review date: ${new Date(rx.review_date).toLocaleDateString("en-IN")}</span>` : ""}${visit.follow_up_notes ? `<p style="margin-top:4px;font-size:12px;color:#475569;">${visit.follow_up_notes}</p>` : ""}</div>`
                            : "";

                          const body = `
                            ${printHeader(hospitalInfo?.name || "Hospital", "OPD PRESCRIPTION", `<p style="font-size:12px">${hospitalInfo?.address || ""}</p>`)}
                            <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:15px;">
                              <div>
                                <div><span class="label">Patient:</span> <b>${token.patient?.full_name}</b></div>
                                <div><span class="label">UHID:</span> <b>${token.patient?.uhid}</b></div>
                              </div>
                              <div style="text-align:right">
                                <div><span class="label">Date:</span> <b>${new Date(visit.visit_date).toLocaleDateString("en-IN")}</b></div>
                                <div><span class="label">Doctor:</span> <b>${visit.doctor?.full_name || "Doctor"}</b></div>
                              </div>
                            </div>
                            <div class="section-title">Clinical Notes</div>
                            <p><span class="label">Complaint:</span> ${visit.chief_complaint || "--"}</p>
                            ${visit.history_of_present_illness ? `<p style="margin-bottom:0;"><span class="label">History of Present Illness:</span></p><div style="white-space:pre-wrap;margin:0 0 6px 0;">${visit.history_of_present_illness}</div>` : ""}
                            <p><span class="label">Diagnosis:</span> <b>${visit.diagnosis || "--"}</b>${visit.icd10_code ? ` (${visit.icd10_code})` : ""}</p>
                            ${visit.soap_plan ? `<p style="margin-bottom:0;"><span class="label">Plan & Investigations:</span></p><div style="white-space:pre-wrap;margin:0 0 6px 0;">${visit.soap_plan}</div>` : ""}
                            <div class="section-title">Rx (Prescription)</div>
                            ${drugsHtml}
                            ${labHtml}
                            ${radHtml}
                            ${rx?.advice_notes ? `<div class="section-title">Advice & Instructions</div><pre>${rx.advice_notes}</pre>` : ""}
                            ${followUp}
                          `;
                          printDocument(`Prescription_${visit.id}`, body);
                        }}
                        className="text-[10px] bg-slate-800 text-white px-2 py-1 rounded flex items-center gap-1 hover:bg-slate-900"
                      >
                        <Printer size={10} /> Print Prescription
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryTab;
