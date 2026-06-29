import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { printDocument, printHeader } from "@/lib/printUtils";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
  patientId: string;
  hospitalId: string;
  patientName: string;
  uhid: string;
  dob: string | null;
  gender: string | null;
}

type PrintTab = "bills" | "lab" | "radiology" | "ipd" | "opd";

const PatientPrintHubModal: React.FC<Props> = ({
  open, onClose, patientId, hospitalId, patientName, uhid, dob, gender,
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<PrintTab>("bills");
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [hospitalInfo, setHospitalInfo] = useState<{ name: string; logo_url: string | null; address: string | null; phone: string | null; gstin: string | null } | null>(null);
  const [bills, setBills] = useState<any[]>([]);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [radioOrders, setRadioOrders] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<any[]>([]);

  const ageStr = dob
    ? `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000))}Y`
    : null;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      supabase.from("hospitals").select("name,logo_url,address,phone,gstin").eq("id", hospitalId).maybeSingle(),
      supabase.from("bills").select("id,bill_number,bill_date,bill_type,total_amount,paid_amount,balance_due,bill_status,payment_status").eq("patient_id", patientId).order("bill_date", { ascending: false }).limit(50),
      supabase.from("lab_orders").select("id,order_date,status,clinical_notes").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50),
      supabase.from("radiology_orders").select("id,order_date,study_name,modality_type,status").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50),
      supabase.from("admissions").select("id,admission_number,admitted_at,discharged_at,status,admitting_diagnosis,discharge_summary_done").eq("patient_id", patientId).order("admitted_at", { ascending: false }).limit(20),
      supabase.from("opd_encounters").select("id,visit_date,created_at,chief_complaint,diagnosis,doctor:users!opd_encounters_doctor_id_fkey(full_name)").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50),
    ]).then(([hosp, b, l, r, a, e]) => {
      setHospitalInfo(hosp.data);
      setBills(b.data || []);
      setLabOrders(l.data || []);
      setRadioOrders(r.data || []);
      setAdmissions(a.data || []);
      setEncounters(e.data || []);
      setLoading(false);
    });
  }, [open, patientId, hospitalId]);

  const hospName = hospitalInfo?.name || "Hospital";

  const buildHeader = () =>
    printHeader(
      hospName, undefined,
      [
        hospitalInfo?.address ? `<p style="font-size:11px;color:#64748b;margin:2px 0">${hospitalInfo.address}</p>` : "",
        hospitalInfo?.phone ? `<p style="font-size:11px;color:#64748b;margin:2px 0">Ph: ${hospitalInfo.phone}</p>` : "",
        hospitalInfo?.gstin ? `<p style="font-size:10px;color:#64748b;margin:2px 0">GSTIN: ${hospitalInfo.gstin}</p>` : "",
      ].join("")
    );

  const patientRow = () =>
    `<div class="row"><span class="label">Patient</span><span>${patientName} · <span style="font-family:monospace">${uhid}</span>${ageStr ? ` · ${ageStr}` : ""}${gender ? ` / ${gender}` : ""}</span></div>`;

  // ── PRINT HANDLERS ──────────────────────────────────────────────────────────

  async function handlePrintBill(billId: string) {
    setPrintingId(billId);
    const { data: bill } = await supabase.from("bills")
      .select("*, bill_line_items(*), bill_payments(*)")
      .eq("id", billId).maybeSingle();
    if (!bill) { setPrintingId(null); return; }
    const b = bill as any;

    const lineRows = (b.bill_line_items || []).map((item: any) =>
      `<tr><td>${item.description || "—"}</td><td style="text-align:center">${item.quantity}</td>
       <td style="text-align:right">₹${Number(item.unit_rate || 0).toFixed(2)}</td>
       <td style="text-align:right">₹${Number(item.total_amount || 0).toFixed(2)}</td></tr>`
    ).join("");

    printDocument(`Invoice — ${b.bill_number}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">INVOICE</div>
       <div class="row"><span class="label">Bill No.</span><span><b>${b.bill_number}</b></span></div>
       <div class="row"><span class="label">Date</span><span>${b.bill_date || "—"}</span></div>
       <div class="row"><span class="label">Bill Type</span><span style="text-transform:capitalize">${b.bill_type || "—"}</span></div>
       ${patientRow()}
       <div class="section-title" style="margin-top:16px;">Items</div>
       <table><thead><tr><th>Description</th><th>Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
       <tbody>${lineRows || `<tr><td colspan="4" style="color:#94a3b8">No items</td></tr>`}</tbody></table>
       <div style="margin-top:12px;">
         <div class="row"><span class="label">Subtotal</span><span>₹${Number(b.subtotal || b.total_amount || 0).toFixed(2)}</span></div>
         ${Number(b.discount_amount) > 0 ? `<div class="row"><span class="label">Discount</span><span>-₹${Number(b.discount_amount).toFixed(2)}</span></div>` : ""}
         ${Number(b.gst_amount) > 0 ? `<div class="row"><span class="label">GST</span><span>₹${Number(b.gst_amount).toFixed(2)}</span></div>` : ""}
       </div>
       <div class="total-row"><span>Total Amount</span><span class="amount">₹${Number(b.total_amount || 0).toFixed(2)}</span></div>
       ${b.paid_amount != null ? `<div class="total-row" style="color:#16a34a"><span>Amount Paid</span><span class="amount">₹${Number(b.paid_amount).toFixed(2)}</span></div>` : ""}
       ${Number(b.balance_due) > 0 ? `<div class="total-row" style="color:#dc2626"><span>Balance Due</span><span class="amount">₹${Number(b.balance_due).toFixed(2)}</span></div>` : ""}`
    );
    setPrintingId(null);
  }

  async function handlePrintLabReport(orderId: string) {
    setPrintingId(orderId);
    const { data: order } = await supabase.from("lab_orders")
      .select("id, order_date, clinical_notes, lab_order_items(result_value, result_unit, result_flag, reference_range, test:lab_test_master(test_name, category, normal_min, normal_max))")
      .eq("id", orderId).maybeSingle();

    const grouped: Record<string, any[]> = {};
    for (const item of (order as any)?.lab_order_items || []) {
      const cat = item.test?.category || "General";
      (grouped[cat] = grouped[cat] || []).push(item);
    }
    const categorySections = Object.entries(grouped).map(([cat, items]) => {
      const rows = items.map((i: any) => {
        const flag = i.result_flag;
        const isCritical = flag === "CH" || flag === "CL";
        const isAbnormal = flag === "H" || flag === "L";
        const rowStyle = isCritical ? "background:#fee2e2;font-weight:bold" : isAbnormal ? "background:#fef3c7" : "";
        return `<tr style="${rowStyle}">
          <td>${i.test?.test_name || "—"}</td>
          <td style="text-align:right;font-family:monospace">${i.result_value || "pending"}</td>
          <td>${i.result_unit || ""}</td>
          <td>${i.reference_range || (i.test?.normal_min != null ? `${i.test.normal_min}–${i.test.normal_max}` : "")}</td>
          <td style="text-align:center">${flag ? `<b>${flag}</b>` : ""}</td>
        </tr>`;
      }).join("");
      return `<div class="section-title">${cat}</div>
        <table><thead><tr><th>Test</th><th style="text-align:right">Result</th><th>Unit</th><th>Ref Range</th><th>Flag</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }).join("");

    printDocument(`Lab Report — ${patientName}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">LAB REPORT</div>
       ${patientRow()}
       <div class="row"><span class="label">Order Date</span><span>${(order as any)?.order_date || "—"}</span></div>
       ${(order as any)?.clinical_notes ? `<div class="row"><span class="label">Clinical Notes</span><span>${(order as any).clinical_notes}</span></div>` : ""}
       ${categorySections || "<p style='color:#94a3b8;font-style:italic'>No results recorded yet.</p>"}`
    );
    setPrintingId(null);
  }

  async function handlePrintRadiologyReport(orderId: string) {
    setPrintingId(orderId);
    const { data: order } = await (supabase as any).from("radiology_orders")
      .select("*, radiology_reports(*)")
      .eq("id", orderId).maybeSingle();
    const report = (order as any)?.radiology_reports?.[0] || null;

    printDocument(`Radiology — ${(order as any)?.study_name || "Report"}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">RADIOLOGY REPORT</div>
       ${patientRow()}
       <div class="row"><span class="label">Study</span><span>${(order as any)?.study_name || "—"}</span></div>
       <div class="row"><span class="label">Modality</span><span style="text-transform:uppercase">${(order as any)?.modality_type || "—"}</span></div>
       <div class="row"><span class="label">Date</span><span>${(order as any)?.order_date || "—"}</span></div>
       ${(order as any)?.indication ? `<div class="row"><span class="label">Indication</span><span>${(order as any).indication}</span></div>` : ""}
       ${report?.technique ? `<div class="section-title">Technique</div><p>${report.technique}</p>` : ""}
       ${report?.findings ? `<div class="section-title">Findings</div><pre>${report.findings}</pre>` : ""}
       ${report?.impression ? `<div class="section-title">Impression</div><pre>${report.impression}</pre>` : ""}
       ${report?.recommendations ? `<div class="section-title">Recommendations</div><pre>${report.recommendations}</pre>` : ""}
       ${report?.is_critical ? `<p style="color:#dc2626;font-weight:bold;margin-top:12px">⚠️ CRITICAL FINDING: ${report.critical_finding || ""}</p>` : ""}
       ${!report ? `<p style="color:#94a3b8;font-style:italic;margin-top:16px">Report not yet available — order status: ${(order as any)?.status || "unknown"}</p>` : ""}`
    );
    setPrintingId(null);
  }

  async function handlePrintCaseSheet(admissionId: string) {
    setPrintingId(admissionId + "_case");
    const [admRes, notesRes, medsRes] = await Promise.all([
      supabase.from("admissions").select("*, ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name)").eq("id", admissionId).maybeSingle(),
      supabase.from("ward_round_notes").select("round_date, round_time, subjective, objective, assessment, plan, doctor:users(full_name)").eq("admission_id", admissionId).order("round_date", { ascending: false }).limit(20),
      supabase.from("ipd_medications").select("drug_name, dose, route, frequency").eq("admission_id", admissionId).eq("is_active", true),
    ]);
    const adm = admRes.data as any;
    const noteRows = (notesRes.data || []).map((n: any) =>
      `<tr><td style="white-space:nowrap;font-size:11px">${n.round_date || ""} ${n.round_time || ""}</td>
       <td>${n.doctor?.full_name || "—"}</td><td>${n.subjective || ""}</td>
       <td>${n.objective || ""}</td><td>${n.assessment || ""}</td><td>${n.plan || ""}</td></tr>`
    ).join("");
    const medRows = (medsRes.data || []).map((m: any) =>
      `<tr><td>${m.drug_name}</td><td>${m.dose || ""}</td><td>${m.route || ""}</td><td>${m.frequency || ""}</td></tr>`
    ).join("");

    printDocument(`Case Sheet — ${adm?.admission_number || "IPD"}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">IPD CASE SHEET</div>
       ${patientRow()}
       <div class="row"><span class="label">Admission No.</span><span><b>${adm?.admission_number || "—"}</b></span></div>
       <div class="row"><span class="label">Admitted</span><span>${adm?.admitted_at ? new Date(adm.admitted_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Ward</span><span>${adm?.ward?.name || "—"}</span></div>
       <div class="row"><span class="label">Diagnosis</span><span>${adm?.admitting_diagnosis || "—"}</span></div>
       <div class="row"><span class="label">Doctor</span><span>${adm?.doctor?.full_name ? `Dr. ${adm.doctor.full_name}` : "—"}</span></div>
       <div class="section-title" style="margin-top:16px;">Ward Round Notes</div>
       ${noteRows ? `<table><thead><tr><th>Date/Time</th><th>Doctor</th><th>Subjective</th><th>Objective</th><th>Assessment</th><th>Plan</th></tr></thead><tbody>${noteRows}</tbody></table>` : "<p style='color:#94a3b8;font-style:italic'>No notes recorded.</p>"}
       <div class="section-title" style="margin-top:16px;">Active Medications</div>
       ${medRows ? `<table><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th></tr></thead><tbody>${medRows}</tbody></table>` : "<p style='color:#94a3b8;font-style:italic'>No active medications.</p>"}`
    );
    setPrintingId(null);
  }

  async function handlePrintDischargeSummary(admissionId: string) {
    setPrintingId(admissionId + "_dc");
    const { data } = await supabase.from("admissions")
      .select("*, ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name)")
      .eq("id", admissionId).maybeSingle();
    const a = data as any;
    const summaryText = a?.discharge_notes || a?.discharge_summary_text || "No discharge summary generated yet.";

    printDocument(`Discharge Summary — ${a?.admission_number || "IPD"}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">DISCHARGE SUMMARY</div>
       ${patientRow()}
       <div class="row"><span class="label">Admission No.</span><span><b>${a?.admission_number || "—"}</b></span></div>
       <div class="row"><span class="label">Admitted</span><span>${a?.admitted_at ? new Date(a.admitted_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Discharged</span><span>${a?.discharged_at ? new Date(a.discharged_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Ward</span><span>${a?.ward?.name || "—"}</span></div>
       <div class="row"><span class="label">Diagnosis</span><span>${a?.admitting_diagnosis || "—"}</span></div>
       <div class="row"><span class="label">Doctor</span><span>${a?.doctor?.full_name ? `Dr. ${a.doctor.full_name}` : "—"}</span></div>
       <div class="section-title" style="margin-top:16px;">Discharge Summary</div>
       <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.6;">${summaryText}</pre>
       <div style="margin-top:48px;display:flex;justify-content:flex-end;">
         <div style="text-align:center;border-top:1px solid #1A2F5A;padding-top:8px;width:200px;font-size:11px;">
           ${a?.doctor?.full_name ? `Dr. ${a.doctor.full_name}` : "Treating Doctor"}<br/>Signature &amp; Stamp
         </div>
       </div>`
    );
    setPrintingId(null);
  }

  async function handlePrintOPDConsultation(encounterId: string) {
    setPrintingId(encounterId);
    const [encRes, rxRes] = await Promise.all([
      supabase.from("opd_encounters").select("*, doctor:users!opd_encounters_doctor_id_fkey(full_name)").eq("id", encounterId).maybeSingle(),
      supabase.from("prescriptions" as any).select("drugs, advice_notes").eq("encounter_id", encounterId).maybeSingle(),
    ]);
    const enc = encRes.data as any;
    const drugs: any[] = (rxRes.data as any)?.drugs || [];
    const adviceNotes: string = (rxRes.data as any)?.advice_notes || "";

    const rxRows = drugs.map((r: any) =>
      `<tr><td>${r.drug_name || "—"}</td><td>${r.dose || ""}</td><td>${r.frequency || ""}</td><td>${r.duration || ""}</td><td>${r.route || ""}</td><td>${r.instructions || ""}</td></tr>`
    ).join("");

    printDocument(`OPD Consultation — ${patientName}`,
      `${buildHeader()}
       <div class="section-title" style="margin-bottom:12px;">OPD CONSULTATION</div>
       ${patientRow()}
       <div class="row"><span class="label">Visit Date</span><span>${enc?.visit_date || "—"}</span></div>
       <div class="row"><span class="label">Doctor</span><span>${enc?.doctor?.full_name ? `Dr. ${enc.doctor.full_name}` : "—"}</span></div>
       ${enc?.chief_complaint ? `<div class="row"><span class="label">Chief Complaint</span><span>${enc.chief_complaint}</span></div>` : ""}
       ${enc?.diagnosis ? `<div class="row"><span class="label">Diagnosis</span><span>${enc.diagnosis}</span></div>` : ""}
       ${rxRows ? `<div class="section-title" style="margin-top:16px;">Prescription</div>
         <table><thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Route</th><th>Instructions</th></tr></thead>
         <tbody>${rxRows}</tbody></table>` : ""}
       ${adviceNotes ? `<div class="section-title" style="margin-top:16px;">Advice</div><pre>${adviceNotes}</pre>` : ""}`
    );
    setPrintingId(null);
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────

  function PrintRow({ id, title, meta, onPrint }: { id: string; title: string; meta: string; onPrint: () => void }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-border/40 last:border-0">
        <div className="min-w-0 flex-1 mr-4">
          <p className="text-sm font-medium text-foreground truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{meta}</p>
        </div>
        <Button size="sm" variant="outline" disabled={printingId === id} onClick={onPrint}>
          {printingId === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer size={13} className="mr-1" />}
          Print
        </Button>
      </div>
    );
  }

  function renderContent() {
    if (activeTab === "bills") {
      if (!bills.length) return <Empty />;
      return bills.map((b: any) => (
        <PrintRow key={b.id} id={b.id}
          title={`${b.bill_number} — ₹${Number(b.total_amount || 0).toLocaleString("en-IN")}`}
          meta={`${b.bill_date || "—"} · ${(b.bill_type || "").toUpperCase()} · ${b.payment_status || b.bill_status || "—"}`}
          onPrint={() => handlePrintBill(b.id)} />
      ));
    }
    if (activeTab === "lab") {
      if (!labOrders.length) return <Empty />;
      return labOrders.map((o: any) => (
        <PrintRow key={o.id} id={o.id}
          title={`Lab Order — ${o.order_date || "—"}`}
          meta={`Status: ${o.status || "—"}${o.clinical_notes ? ` · ${o.clinical_notes}` : ""}`}
          onPrint={() => handlePrintLabReport(o.id)} />
      ));
    }
    if (activeTab === "radiology") {
      if (!radioOrders.length) return <Empty />;
      return radioOrders.map((o: any) => (
        <PrintRow key={o.id} id={o.id}
          title={`${o.study_name || "Study"} · ${(o.modality_type || "").toUpperCase()}`}
          meta={`${o.order_date || "—"} · Status: ${o.status || "—"}`}
          onPrint={() => handlePrintRadiologyReport(o.id)} />
      ));
    }
    if (activeTab === "ipd") {
      if (!admissions.length) return <Empty />;
      return admissions.map((a: any) => (
        <div key={a.id} className="py-3 border-b border-border/40 last:border-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-4">
              <p className="text-sm font-medium">{a.admission_number || "Admission"}</p>
              <p className="text-xs text-muted-foreground">
                {a.admitted_at ? new Date(a.admitted_at).toLocaleDateString("en-IN") : "—"}
                {" · "}{a.admitting_diagnosis || "No diagnosis"}
                {" · "}<span className={cn(a.status === "active" ? "text-emerald-600 font-medium" : "")}>{a.status}</span>
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" disabled={printingId === a.id + "_case"} onClick={() => handlePrintCaseSheet(a.id)}>
                {printingId === a.id + "_case" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer size={12} className="mr-1" />}
                Case Sheet
              </Button>
              {(a.status === "discharged" || a.discharge_summary_done) && (
                <Button size="sm" variant="outline" disabled={printingId === a.id + "_dc"} onClick={() => handlePrintDischargeSummary(a.id)}>
                  {printingId === a.id + "_dc" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer size={12} className="mr-1" />}
                  Discharge
                </Button>
              )}
            </div>
          </div>
        </div>
      ));
    }
    if (activeTab === "opd") {
      if (!encounters.length) return <Empty />;
      return encounters.map((e: any) => (
        <PrintRow key={e.id} id={e.id}
          title={`OPD Consultation — ${e.visit_date || e.created_at?.split("T")[0] || "—"}`}
          meta={`${e.doctor?.full_name ? `Dr. ${e.doctor.full_name}` : "—"}${e.diagnosis ? ` · ${e.diagnosis}` : e.chief_complaint ? ` · ${e.chief_complaint}` : ""}`}
          onPrint={() => handlePrintOPDConsultation(e.id)} />
      ));
    }
    return null;
  }

  const TABS: { key: PrintTab; label: string; count: number }[] = [
    { key: "bills",     label: "Bills",       count: bills.length },
    { key: "lab",       label: "Lab Reports", count: labOrders.length },
    { key: "radiology", label: "Radiology",   count: radioOrders.length },
    { key: "ipd",       label: "IPD",         count: admissions.length },
    { key: "opd",       label: "OPD Notes",   count: encounters.length },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base font-semibold">All Documents</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{patientName} · <span className="font-mono">{uhid}</span></p>
        </div>
        <div className="flex px-6 border-b border-border flex-shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5",
                activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              {t.label}
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto px-6 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function Empty() {
  return <div className="text-center py-12 text-sm text-muted-foreground">No records found for this patient.</div>;
}

export default PatientPrintHubModal;
