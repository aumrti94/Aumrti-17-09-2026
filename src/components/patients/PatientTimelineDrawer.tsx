import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Stethoscope, BedDouble, FlaskConical, Scan, Pill, Scissors,
  AlertTriangle, Activity, Calendar, User, Loader2, Printer, ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { printDocument, printHeader } from "@/lib/printUtils";
import PatientPrintHubModal from "./PatientPrintHubModal";

type Patient = {
  id: string;
  uhid: string;
  full_name: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  blood_group: string | null;
  allergies: string | null;
  chronic_conditions: string[] | null;
  abha_id: string | null;
};

type EventType = "opd" | "ipd" | "lab" | "radiology" | "pharmacy" | "surgery";

type TimelineEvent = {
  id: string;
  type: EventType;
  date: string;
  title: string;
  subtitle?: string;
  details?: Record<string, any>;
  meta?: {
    rawId: string;
    encounterId?: string;
    isEncounter?: boolean;
    ipdStatus?: string;
  };
};

const TYPE_META: Record<EventType, { color: string; bg: string; icon: React.ElementType; label: string }> = {
  opd:       { color: "border-l-blue-500",   bg: "bg-blue-50 dark:bg-blue-950/30",     icon: Stethoscope,  label: "OPD Visit" },
  ipd:       { color: "border-l-green-600",  bg: "bg-green-50 dark:bg-green-950/30",   icon: BedDouble,    label: "IPD Admission" },
  lab:       { color: "border-l-purple-500", bg: "bg-purple-50 dark:bg-purple-950/30", icon: FlaskConical, label: "Lab Order" },
  radiology: { color: "border-l-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30", icon: Scan,         label: "Radiology" },
  pharmacy:  { color: "border-l-pink-500",   bg: "bg-pink-50 dark:bg-pink-950/30",     icon: Pill,         label: "Pharmacy" },
  surgery:   { color: "border-l-teal-600",   bg: "bg-teal-50 dark:bg-teal-950/30",     icon: Scissors,     label: "Surgery" },
};

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${y}y`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface Props {
  patient: Patient;
  hospitalId: string;
  onClose: () => void;
}

const PatientTimelineDrawer: React.FC<Props> = ({ patient, hospitalId, onClose }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [activeMedsCount, setActiveMedsCount] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPrintHub, setShowPrintHub] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [hospitalInfo, setHospitalInfo] = useState<{
    name: string; logo_url: string | null; address: string | null;
    phone: string | null; gstin: string | null;
  } | null>(null);

  const ageStr = patient.dob
    ? `${Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400000))}Y`
    : null;

  useEffect(() => {
    supabase.from("hospitals").select("name,logo_url,address,phone,gstin")
      .eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [hospitalId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pid = patient.id;

      const [opdEnc, opdTok, adm, labOrders, radOrders, pharm, surg] = await Promise.all([
        supabase.from("opd_encounters")
          .select("id, visit_date, created_at, diagnosis, icd10_code, chief_complaint, doctor:users!opd_encounters_doctor_id_fkey(full_name)")
          .eq("patient_id", pid).order("created_at", { ascending: false }).limit(200),
        supabase.from("opd_tokens")
          .select("id, visit_date, created_at, token_number, status, doctor:users!opd_tokens_doctor_id_fkey(full_name)")
          .eq("patient_id", pid).order("created_at", { ascending: false }).limit(200),
        supabase.from("admissions")
          .select("id, admitted_at, discharged_at, admission_number, admitting_diagnosis, status, ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name)")
          .eq("patient_id", pid).order("admitted_at", { ascending: false }).limit(100),
        supabase.from("lab_orders")
          .select("id, order_date, order_time, created_at, status, clinical_notes, encounter_id, items:lab_order_items(id, result_value, result_unit, result_flag, status, test:lab_test_master(test_name))")
          .eq("patient_id", pid).order("created_at", { ascending: false }).limit(100),
        supabase.from("radiology_orders")
          .select("id, order_date, created_at, study_name, modality_type, body_part, status, indication, encounter_id")
          .eq("patient_id", pid).order("created_at", { ascending: false }).limit(100),
        supabase.from("pharmacy_dispensing")
          .select("id, dispensed_at, created_at, dispensing_number, status, total_amount, dispensing_type")
          .eq("patient_id", pid).order("created_at", { ascending: false }).limit(100),
        supabase.from("ot_schedules")
          .select("id, scheduled_date, scheduled_start_time, surgery_name, surgery_category, status, surgeon:users!ot_schedules_surgeon_id_fkey(full_name)")
          .eq("patient_id", pid).order("scheduled_date", { ascending: false }).limit(100),
      ]);

      if (cancelled) return;

      const evs: TimelineEvent[] = [];
      const encByToken = new Map<string, any>();
      (opdEnc.data || []).forEach((e: any) => { if (e.token_id) encByToken.set(e.token_id, e); });

      (opdEnc.data || []).forEach((e: any) => {
        const dt = e.visit_date || e.created_at;
        if (!dt) return;
        evs.push({
          id: `enc-${e.id}`, type: "opd", date: dt,
          title: e.diagnosis || e.chief_complaint || "OPD Consultation",
          subtitle: `${e.doctor?.full_name ? `Dr. ${e.doctor.full_name}` : "Doctor"}${e.icd10_code ? ` · ICD ${e.icd10_code}` : ""}`,
          details: { "Chief Complaint": e.chief_complaint, "Diagnosis": e.diagnosis, "ICD-10": e.icd10_code },
          meta: { rawId: e.id, isEncounter: true },
        });
      });

      (opdTok.data || []).forEach((t: any) => {
        if ([...encByToken.values()].some((e: any) => e.token_id === t.id)) return;
        const dt = t.created_at || t.visit_date;
        if (!dt) return;
        evs.push({
          id: `tok-${t.id}`, type: "opd", date: dt,
          title: `OPD Token ${t.token_number}`,
          subtitle: `${t.doctor?.full_name ? `Dr. ${t.doctor.full_name}` : "—"} · ${t.status}`,
          meta: { rawId: t.id, isEncounter: false },
        });
      });

      (adm.data || []).forEach((a: any) => {
        const dt = a.admitted_at;
        if (!dt) return;
        evs.push({
          id: `adm-${a.id}`, type: "ipd", date: dt,
          title: `Admission ${a.admission_number || ""}`.trim(),
          subtitle: `${a.ward?.name || "Ward"} · ${a.admitting_diagnosis || a.status}`,
          details: {
            "Admitted": a.admitted_at && fmtDate(a.admitted_at),
            "Discharged": a.discharged_at ? fmtDate(a.discharged_at) : "Active",
            "Diagnosis": a.admitting_diagnosis,
            "Doctor": a.doctor?.full_name && `Dr. ${a.doctor.full_name}`,
          },
          meta: { rawId: a.id, ipdStatus: a.status },
        });
      });

      (labOrders.data || []).forEach((o: any) => {
        const dt = o.created_at || `${o.order_date}T${o.order_time || "00:00:00"}`;
        const tests = (o.items || []).map((i: any) => i.test?.test_name).filter(Boolean);
        evs.push({
          id: `lab-${o.id}`, type: "lab", date: dt,
          title: tests.length ? tests.slice(0, 3).join(", ") + (tests.length > 3 ? ` +${tests.length - 3}` : "") : "Lab Order",
          subtitle: `${o.items?.length || 0} test(s) · ${o.status}`,
          details: {
            results: (o.items || []).map((i: any) => ({
              name: i.test?.test_name,
              value: i.result_value,
              unit: i.result_unit,
              flag: i.result_flag,
            })),
            notes: o.clinical_notes,
          },
          meta: { rawId: o.id, encounterId: o.encounter_id },
        });
      });

      (radOrders.data || []).forEach((r: any) => {
        const dt = r.created_at || r.order_date;
        evs.push({
          id: `rad-${r.id}`, type: "radiology", date: dt,
          title: r.study_name || "Radiology Study",
          subtitle: `${r.modality_type || ""}${r.body_part ? ` · ${r.body_part}` : ""} · ${r.status}`,
          details: { "Indication": r.indication },
          meta: { rawId: r.id, encounterId: r.encounter_id },
        });
      });

      (pharm.data || []).forEach((p: any) => {
        const dt = p.dispensed_at || p.created_at;
        if (!dt) return;
        evs.push({
          id: `ph-${p.id}`, type: "pharmacy", date: dt,
          title: `Pharmacy Dispense ${p.dispensing_number || ""}`.trim(),
          subtitle: `${p.dispensing_type || "—"} · ₹${Number(p.total_amount || 0).toFixed(2)} · ${p.status || ""}`,
          meta: { rawId: p.id },
        });
      });

      (surg.data || []).forEach((s: any) => {
        const dt = `${s.scheduled_date}T${s.scheduled_start_time || "00:00:00"}`;
        evs.push({
          id: `ot-${s.id}`, type: "surgery", date: dt,
          title: s.surgery_name || "Surgery",
          subtitle: `${s.surgery_category || ""} · ${s.surgeon?.full_name ? `Dr. ${s.surgeon.full_name}` : ""} · ${s.status}`,
          meta: { rawId: s.id },
        });
      });

      evs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setEvents(evs);

      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      const activeMeds = (pharm.data || []).filter((p: any) => {
        const t = new Date(p.dispensed_at || p.created_at).getTime();
        return t >= cutoff;
      }).length;
      setActiveMedsCount(activeMeds);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patient.id]);

  const stats = useMemo(() => {
    const opdVisits = events.filter(e => e.type === "opd").length;
    const admissions = events.filter(e => e.type === "ipd").length;
    const lastVisit = events[0]?.date;
    return { opdVisits, admissions, lastVisit };
  }, [events]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const exportPDF = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = events.map(e => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-family:monospace;font-size:11px;">${fmtDate(e.date)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:11px;color:#555;">${TYPE_META[e.type].label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;"><b>${e.title || ""}</b>${e.subtitle ? `<br/><span style="color:#666;font-size:11px;">${e.subtitle}</span>` : ""}</td>
      </tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Medical Timeline - ${patient.full_name}</title>
      <style>body{font-family:Inter,system-ui,Arial;padding:24px;color:#0F172A;}h1{margin:0 0 4px;font-size:20px;}h2{margin:18px 0 8px;font-size:14px;color:#334155;}table{width:100%;border-collapse:collapse;}.meta{color:#475569;font-size:12px;}</style></head><body>
      <h1>Medical Timeline</h1>
      <div class="meta">${patient.full_name} · UHID ${patient.uhid} · ${calcAge(patient.dob)}${patient.gender ? ` / ${patient.gender}` : ""}${patient.blood_group ? ` · Blood ${patient.blood_group}` : ""}</div>
      ${patient.allergies ? `<div class="meta" style="color:#b91c1c;margin-top:6px;"><b>Allergies:</b> ${patient.allergies}</div>` : ""}
      ${patient.chronic_conditions?.length ? `<div class="meta" style="margin-top:4px;"><b>Chronic:</b> ${patient.chronic_conditions.join(", ")}</div>` : ""}
      <h2>Summary</h2>
      <div class="meta">OPD Visits: ${stats.opdVisits} · Admissions: ${stats.admissions} · Last activity: ${stats.lastVisit ? fmtDate(stats.lastVisit) : "—"}</div>
      <h2>Events (${events.length})</h2>
      <table>${rows || `<tr><td style="padding:12px;color:#666;">No events recorded.</td></tr>`}</table>
      <div style="margin-top:24px;color:#94a3b8;font-size:10px;">Generated ${new Date().toLocaleString("en-IN")} · Aumrti HMS</div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300);};</script>
      </body></html>`);
    w.document.close();
  };

  // ── PRINT HANDLERS ──────────────────────────────────────────────────────────

  const hospHeader = useCallback(() =>
    printHeader(
      hospitalInfo?.name || "Hospital",
      undefined,
      [
        hospitalInfo?.address ? `<p style="font-size:11px;color:#64748b;margin:2px 0">${hospitalInfo.address}</p>` : "",
        hospitalInfo?.phone ? `<p style="font-size:11px;color:#64748b;margin:2px 0">Ph: ${hospitalInfo.phone}</p>` : "",
        hospitalInfo?.gstin ? `<p style="font-size:10px;color:#64748b;margin:2px 0">GSTIN: ${hospitalInfo.gstin}</p>` : "",
      ].join("")
    ), [hospitalInfo]);

  const patientRow = () =>
    `<div class="row"><span class="label">Patient</span><span>${patient.full_name} · <span style="font-family:monospace">${patient.uhid}</span>${ageStr ? ` · ${ageStr}` : ""}${patient.gender ? ` / ${patient.gender}` : ""}</span></div>`;

  async function printLabReport(orderId: string) {
    setPrintingId(orderId + "_rep");
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
        const style = isCritical ? "background:#fee2e2;font-weight:bold" : isAbnormal ? "background:#fef3c7" : "";
        return `<tr style="${style}">
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

    printDocument(`Lab Report — ${patient.full_name}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">LAB REPORT</div>
       ${patientRow()}
       <div class="row"><span class="label">Order Date</span><span>${(order as any)?.order_date || "—"}</span></div>
       ${(order as any)?.clinical_notes ? `<div class="row"><span class="label">Clinical Notes</span><span>${(order as any).clinical_notes}</span></div>` : ""}
       ${categorySections || "<p style='color:#94a3b8;font-style:italic'>No results recorded yet.</p>"}`
    );
    setPrintingId(null);
  }

  async function printBillForEncounter(encounterId: string, billType: string) {
    setPrintingId(encounterId + "_bill");
    const { data: bills } = await supabase.from("bills")
      .select("id, bill_number, bill_date, bill_type, total_amount, paid_amount, balance_due, subtotal, discount_amount, gst_amount")
      .eq("encounter_id", encounterId)
      .eq("bill_type", billType)
      .order("bill_date", { ascending: false })
      .limit(1);

    const bill = bills?.[0] as any;
    if (!bill) {
      toast({ title: "No bill found for this order yet.", description: "Bill may not have been generated." });
      setPrintingId(null);
      return;
    }

    const { data: lineItems } = await supabase.from("bill_line_items" as any)
      .select("description, quantity, unit_rate, total_amount, discount_amount, gst_percent, gst_amount")
      .eq("bill_id", bill.id);

    const lineRows = (lineItems || []).map((item: any) =>
      `<tr><td>${item.description || "—"}</td><td style="text-align:center">${item.quantity}</td>
       <td style="text-align:right">₹${Number(item.unit_rate || 0).toFixed(2)}</td>
       <td style="text-align:right">₹${Number(item.total_amount || 0).toFixed(2)}</td></tr>`
    ).join("");

    printDocument(`Invoice — ${bill.bill_number}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">INVOICE</div>
       <div class="row"><span class="label">Bill No.</span><span><b>${bill.bill_number}</b></span></div>
       <div class="row"><span class="label">Date</span><span>${bill.bill_date || "—"}</span></div>
       <div class="row"><span class="label">Bill Type</span><span style="text-transform:capitalize">${bill.bill_type || "—"}</span></div>
       ${patientRow()}
       <div class="section-title" style="margin-top:16px;">Items</div>
       <table><thead><tr><th>Description</th><th>Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
       <tbody>${lineRows || `<tr><td colspan="4" style="color:#94a3b8">No items</td></tr>`}</tbody></table>
       <div style="margin-top:12px;">
         <div class="row"><span class="label">Subtotal</span><span>₹${Number(bill.subtotal || bill.total_amount || 0).toFixed(2)}</span></div>
         ${Number(bill.discount_amount) > 0 ? `<div class="row"><span class="label">Discount</span><span>-₹${Number(bill.discount_amount).toFixed(2)}</span></div>` : ""}
         ${Number(bill.gst_amount) > 0 ? `<div class="row"><span class="label">GST</span><span>₹${Number(bill.gst_amount).toFixed(2)}</span></div>` : ""}
       </div>
       <div class="total-row"><span>Total Amount</span><span class="amount">₹${Number(bill.total_amount || 0).toFixed(2)}</span></div>
       ${bill.paid_amount != null ? `<div class="total-row" style="color:#16a34a"><span>Amount Paid</span><span class="amount">₹${Number(bill.paid_amount).toFixed(2)}</span></div>` : ""}
       ${Number(bill.balance_due) > 0 ? `<div class="total-row" style="color:#dc2626"><span>Balance Due</span><span class="amount">₹${Number(bill.balance_due).toFixed(2)}</span></div>` : ""}`
    );
    setPrintingId(null);
  }

  async function printRadiologyReport(orderId: string) {
    setPrintingId(orderId + "_rep");
    const { data: order } = await (supabase as any).from("radiology_orders")
      .select("*, radiology_reports(*)")
      .eq("id", orderId).maybeSingle();

    const report = order?.radiology_reports?.[0] || null;
    printDocument(`Radiology — ${order?.study_name || "Report"}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">RADIOLOGY REPORT</div>
       ${patientRow()}
       <div class="row"><span class="label">Study</span><span>${order?.study_name || "—"}</span></div>
       <div class="row"><span class="label">Modality</span><span style="text-transform:uppercase">${order?.modality_type || "—"}</span></div>
       <div class="row"><span class="label">Date</span><span>${order?.order_date || "—"}</span></div>
       ${order?.indication ? `<div class="row"><span class="label">Indication</span><span>${order.indication}</span></div>` : ""}
       ${report?.technique ? `<div class="section-title">Technique</div><p>${report.technique}</p>` : ""}
       ${report?.findings ? `<div class="section-title">Findings</div><pre>${report.findings}</pre>` : ""}
       ${report?.impression ? `<div class="section-title">Impression</div><pre>${report.impression}</pre>` : ""}
       ${report?.recommendations ? `<div class="section-title">Recommendations</div><pre>${report.recommendations}</pre>` : ""}
       ${report?.is_critical ? `<p style="color:#dc2626;font-weight:bold;margin-top:12px">⚠️ CRITICAL FINDING: ${report.critical_finding || ""}</p>` : ""}
       ${!report ? `<p style="color:#94a3b8;font-style:italic;margin-top:16px">Report not yet available — order status: ${order?.status || "unknown"}</p>` : ""}`
    );
    setPrintingId(null);
  }

  async function printOPDPrescription(encounterId: string) {
    setPrintingId(encounterId + "_rx");
    const [encRes, rxRes] = await Promise.all([
      supabase.from("opd_encounters")
        .select("*, doctor:users!opd_encounters_doctor_id_fkey(full_name)")
        .eq("id", encounterId).maybeSingle(),
      supabase.from("prescriptions" as any)
        .select("drugs, advice_notes")
        .eq("encounter_id", encounterId).maybeSingle(),
    ]);
    const enc = encRes.data as any;
    const drugs: any[] = (rxRes.data as any)?.drugs || [];
    const adviceNotes: string = (rxRes.data as any)?.advice_notes || "";

    const rxRows = drugs.map((r: any) =>
      `<tr><td>${r.drug_name || "—"}</td><td>${r.dose || ""}</td><td>${r.frequency || ""}</td><td>${r.duration || ""}</td><td>${r.route || ""}</td><td>${r.instructions || ""}</td></tr>`
    ).join("");

    printDocument(`Prescription — ${patient.full_name}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">OPD PRESCRIPTION</div>
       ${patientRow()}
       <div class="row"><span class="label">Visit Date</span><span>${enc?.visit_date || "—"}</span></div>
       <div class="row"><span class="label">Doctor</span><span>${enc?.doctor?.full_name ? `Dr. ${enc.doctor.full_name}` : "—"}</span></div>
       ${enc?.chief_complaint ? `<div class="row"><span class="label">Chief Complaint</span><span>${enc.chief_complaint}</span></div>` : ""}
       ${enc?.diagnosis ? `<div class="row"><span class="label">Diagnosis</span><span>${enc.diagnosis}</span></div>` : ""}
       ${enc?.icd10_code ? `<div class="row"><span class="label">ICD-10</span><span>${enc.icd10_code}</span></div>` : ""}
       ${rxRows
         ? `<div class="section-title" style="margin-top:16px;">Prescription</div>
            <table><thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Route</th><th>Instructions</th></tr></thead>
            <tbody>${rxRows}</tbody></table>`
         : "<p style='color:#94a3b8;font-style:italic;margin-top:16px'>No drugs prescribed.</p>"}
       ${adviceNotes ? `<div class="section-title" style="margin-top:16px;">Advice / Notes</div><pre>${adviceNotes}</pre>` : ""}`
    );
    setPrintingId(null);
  }

  async function printIPDCaseSheet(admissionId: string) {
    setPrintingId(admissionId + "_case");
    const [admRes, notesRes, medsRes] = await Promise.all([
      supabase.from("admissions")
        .select("*, ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name)")
        .eq("id", admissionId).maybeSingle(),
      supabase.from("ward_round_notes")
        .select("round_date, round_time, subjective, objective, assessment, plan, doctor:users(full_name)")
        .eq("admission_id", admissionId).order("round_date", { ascending: false }).limit(20),
      supabase.from("ipd_medications")
        .select("drug_name, dose, route, frequency, start_date, is_active")
        .eq("admission_id", admissionId).eq("is_active", true),
    ]);
    const adm = admRes.data as any;
    const noteRows = (notesRes.data || []).map((n: any) =>
      `<tr><td style="white-space:nowrap;font-size:11px">${n.round_date || ""} ${n.round_time || ""}</td>
       <td>${n.doctor?.full_name || "—"}</td>
       <td>${n.subjective || ""}</td><td>${n.objective || ""}</td>
       <td>${n.assessment || ""}</td><td>${n.plan || ""}</td></tr>`
    ).join("");
    const medRows = (medsRes.data || []).map((m: any) =>
      `<tr><td>${m.drug_name}</td><td>${m.dose || ""}</td><td>${m.route || ""}</td><td>${m.frequency || ""}</td></tr>`
    ).join("");

    printDocument(`Case Sheet — ${adm?.admission_number || "IPD"}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">IPD CASE SHEET</div>
       ${patientRow()}
       <div class="row"><span class="label">Admission No.</span><span><b>${adm?.admission_number || "—"}</b></span></div>
       <div class="row"><span class="label">Admitted</span><span>${adm?.admitted_at ? new Date(adm.admitted_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Ward</span><span>${adm?.ward?.name || "—"}</span></div>
       <div class="row"><span class="label">Admitting Diagnosis</span><span>${adm?.admitting_diagnosis || "—"}</span></div>
       <div class="row"><span class="label">Consulting Doctor</span><span>${adm?.doctor?.full_name ? `Dr. ${adm.doctor.full_name}` : "—"}</span></div>
       <div class="section-title" style="margin-top:16px;">Ward Round Notes</div>
       ${noteRows
         ? `<table><thead><tr><th>Date/Time</th><th>Doctor</th><th>Subjective</th><th>Objective</th><th>Assessment</th><th>Plan</th></tr></thead><tbody>${noteRows}</tbody></table>`
         : "<p style='color:#94a3b8;font-style:italic'>No ward round notes recorded.</p>"}
       <div class="section-title" style="margin-top:16px;">Active Medications</div>
       ${medRows
         ? `<table><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th></tr></thead><tbody>${medRows}</tbody></table>`
         : "<p style='color:#94a3b8;font-style:italic'>No active medications.</p>"}`
    );
    setPrintingId(null);
  }

  async function printDischargeSummary(admissionId: string) {
    setPrintingId(admissionId + "_dc");
    const { data: adm } = await supabase.from("admissions")
      .select("*, ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name)")
      .eq("id", admissionId).maybeSingle() as any;
    const a = adm as any;
    const summaryText = a?.discharge_notes || a?.discharge_summary_text || "No discharge summary generated yet.";

    printDocument(`Discharge Summary — ${a?.admission_number || "IPD"}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">DISCHARGE SUMMARY</div>
       ${patientRow()}
       <div class="row"><span class="label">Admission No.</span><span><b>${a?.admission_number || "—"}</b></span></div>
       <div class="row"><span class="label">Admitted</span><span>${a?.admitted_at ? new Date(a.admitted_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Discharged</span><span>${a?.discharged_at ? new Date(a.discharged_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Ward</span><span>${a?.ward?.name || "—"}</span></div>
       <div class="row"><span class="label">Admitting Diagnosis</span><span>${a?.admitting_diagnosis || "—"}</span></div>
       <div class="row"><span class="label">Treating Doctor</span><span>${a?.doctor?.full_name ? `Dr. ${a.doctor.full_name}` : "—"}</span></div>
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

  async function printPharmacyReceipt(dispensingId: string) {
    setPrintingId(dispensingId + "_rec");
    const { data: disp } = await supabase.from("pharmacy_dispensing")
      .select("*")
      .eq("id", dispensingId).maybeSingle() as any;
    const { data: items } = await supabase.from("pharmacy_dispensing_items" as any)
      .select("drug_name, quantity, mrp, sale_price, total_amount")
      .eq("dispensing_id", dispensingId);

    const d = disp as any;
    const itemRows = (items || []).map((i: any) =>
      `<tr><td>${i.drug_name || "—"}</td><td style="text-align:center">${i.quantity}</td>
       <td style="text-align:right">₹${Number(i.mrp || 0).toFixed(2)}</td>
       <td style="text-align:right">₹${Number(i.sale_price || i.mrp || 0).toFixed(2)}</td>
       <td style="text-align:right">₹${Number(i.total_amount || 0).toFixed(2)}</td></tr>`
    ).join("");

    printDocument(`Pharmacy Receipt — ${d?.dispensing_number || dispensingId}`,
      `${hospHeader()}
       <div class="section-title" style="margin-bottom:12px;">PHARMACY DISPENSING RECEIPT</div>
       <div class="row"><span class="label">Dispensing No.</span><span><b>${d?.dispensing_number || "—"}</b></span></div>
       <div class="row"><span class="label">Date</span><span>${d?.dispensed_at ? new Date(d.dispensed_at).toLocaleString("en-IN") : "—"}</span></div>
       <div class="row"><span class="label">Type</span><span style="text-transform:capitalize">${d?.dispensing_type || "—"}</span></div>
       ${patientRow()}
       <div class="section-title" style="margin-top:16px;">Items</div>
       <table><thead><tr><th>Drug</th><th>Qty</th><th style="text-align:right">MRP</th><th style="text-align:right">Sale Price</th><th style="text-align:right">Total</th></tr></thead>
       <tbody>${itemRows || `<tr><td colspan="5" style="color:#94a3b8">No items</td></tr>`}</tbody></table>
       <div class="total-row"><span>Grand Total</span><span class="amount">₹${Number(d?.total_amount || 0).toFixed(2)}</span></div>`
    );
    setPrintingId(null);
  }

  // ── PER-ROW PRINT BUTTONS ───────────────────────────────────────────────────

  function renderPrintButtons(e: TimelineEvent): React.ReactNode {
    const id = e.meta?.rawId || e.id;
    const encId = e.meta?.encounterId;

    const btn = (label: string, suffix: string, handler: () => void) => (
      <Button
        key={suffix}
        size="sm"
        variant="outline"
        className="h-7 text-[11px] px-2 gap-1 flex-shrink-0"
        disabled={printingId === id + suffix}
        onClick={(ev) => { ev.stopPropagation(); handler(); }}
      >
        {printingId === id + suffix
          ? <Loader2 size={11} className="animate-spin" />
          : <Printer size={11} />}
        {label}
      </Button>
    );

    if (e.type === "lab") return (
      <>
        {btn("Report", "_rep", () => printLabReport(id))}
        {encId && btn("Bill", "_bill", () => printBillForEncounter(encId, "lab"))}
      </>
    );
    if (e.type === "radiology") return (
      <>
        {btn("Report", "_rep", () => printRadiologyReport(id))}
        {encId && btn("Bill", "_bill", () => printBillForEncounter(encId, "radiology"))}
      </>
    );
    if (e.type === "opd" && e.meta?.isEncounter) return (
      <>
        {btn("Rx", "_rx", () => printOPDPrescription(id))}
        {btn("Bill", "_bill", () => printBillForEncounter(id, "opd"))}
      </>
    );
    if (e.type === "ipd") return (
      <>
        {btn("Case Sheet", "_case", () => printIPDCaseSheet(id))}
        {e.meta?.ipdStatus === "discharged" && btn("Discharge", "_dc", () => printDischargeSummary(id))}
      </>
    );
    if (e.type === "pharmacy") return btn("Receipt", "_rec", () => printPharmacyReceipt(id));
    return null;
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="p-0 w-full sm:max-w-none sm:w-[65vw] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User size={26} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">{patient.full_name}</h2>
                <Badge variant="outline" className="font-mono text-[10px]">{patient.uhid}</Badge>
                {patient.blood_group && (
                  <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">{patient.blood_group}</Badge>
                )}
                {patient.abha_id && (
                  <Badge variant="secondary" className="text-[10px]">ABHA: {patient.abha_id}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {calcAge(patient.dob)}{patient.gender ? ` · ${patient.gender}` : ""}{patient.phone ? ` · ${patient.phone}` : ""}
              </div>
              {patient.allergies && (
                <div className="mt-2 flex items-center gap-1.5 text-xs">
                  <AlertTriangle size={12} className="text-destructive" />
                  <span className="text-destructive font-medium">Allergies:</span>
                  <span className="text-foreground">{patient.allergies}</span>
                </div>
              )}
              {patient.chronic_conditions && patient.chronic_conditions.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  {patient.chronic_conditions.map((c, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-400">{c}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={exportPDF}>
                <Printer size={14} className="mr-1" /> Export PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowPrintHub(true)}>
                <Printer size={14} className="mr-1" /> All Documents
              </Button>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 border-b border-border bg-muted/30 flex-shrink-0">
          <SummaryStat icon={Stethoscope} label="OPD Visits" value={stats.opdVisits} />
          <SummaryStat icon={BedDouble} label="Admissions" value={stats.admissions} />
          <SummaryStat icon={Calendar} label="Last Activity" value={stats.lastVisit ? new Date(stats.lastVisit).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"} />
          <SummaryStat icon={Pill} label="Active Meds (30d)" value={activeMedsCount} />
          <SummaryStat icon={AlertTriangle} label="Allergies" value={patient.allergies ? "Yes" : "None"} />
          <SummaryStat icon={Activity} label="Chronic" value={patient.chronic_conditions?.length || 0} />
        </div>

        {/* Timeline feed */}
        <div className="flex-1 overflow-auto px-5 py-4 bg-background">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Calendar size={36} className="mx-auto opacity-40 mb-2" />
              <p className="text-sm">No medical history recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((e) => {
                const meta = TYPE_META[e.type];
                const Icon = meta.icon;
                const isOpen = expanded.has(e.id);
                const hasDetails = !!e.details && Object.values(e.details).some(v => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
                const printBtns = renderPrintButtons(e);
                return (
                  <div key={e.id} className={`border-l-4 ${meta.color} ${meta.bg} rounded-r-md`}>
                    <div className="px-3 py-2.5 flex items-start gap-2">
                      {/* Left: expandable content */}
                      <button
                        onClick={() => hasDetails && toggle(e.id)}
                        className={`flex items-start gap-3 flex-1 min-w-0 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <Icon size={16} className="mt-0.5 text-foreground/70 flex-shrink-0" />
                        <div className="flex-shrink-0 w-20 sm:w-24">
                          <div className="text-[10px] font-mono text-muted-foreground uppercase">{meta.label}</div>
                          <div className="text-[11px] text-foreground/80 font-medium leading-tight">{fmtDate(e.date)}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{e.title}</div>
                          {e.subtitle && <div className="text-xs text-muted-foreground truncate">{e.subtitle}</div>}
                        </div>
                        {hasDetails && (
                          isOpen ? <ChevronDown size={14} className="mt-1 text-muted-foreground flex-shrink-0" /> : <ChevronRight size={14} className="mt-1 text-muted-foreground flex-shrink-0" />
                        )}
                      </button>

                      {/* Right: print buttons */}
                      {printBtns && (
                        <div className="flex gap-1 flex-shrink-0 ml-1">
                          {printBtns}
                        </div>
                      )}
                    </div>

                    {isOpen && hasDetails && (
                      <div className="px-3 pb-3 pt-0 ml-[52px] sm:ml-[148px] text-xs space-y-1 text-foreground/80">
                        <EventDetails details={e.details!} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showPrintHub && (
          <PatientPrintHubModal
            open={showPrintHub}
            onClose={() => setShowPrintHub(false)}
            patientId={patient.id}
            hospitalId={hospitalId}
            patientName={patient.full_name}
            uhid={patient.uhid}
            dob={patient.dob}
            gender={patient.gender}
          />
        )}
      </SheetContent>
    </Sheet>
  );
};

const SummaryStat: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode }> = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-card border border-border">
    <Icon size={14} className="text-primary flex-shrink-0" />
    <div className="min-w-0">
      <div className="text-[9px] uppercase text-muted-foreground tracking-wide truncate">{label}</div>
      <div className="text-sm font-bold text-foreground truncate">{value}</div>
    </div>
  </div>
);

const EventDetails: React.FC<{ details: Record<string, any> }> = ({ details }) => {
  const entries = Object.entries(details).filter(([_, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
  return (
    <>
      {entries.map(([k, v]) => {
        if (k === "results" && Array.isArray(v)) {
          return (
            <div key={k}>
              <div className="font-medium text-foreground/70 mb-0.5">Results:</div>
              <div className="space-y-0.5 ml-2">
                {v.map((r: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{r.name || "—"}:</span>
                    <span className={`font-mono ${r.flag === "high" || r.flag === "low" || r.flag === "critical" ? "text-destructive font-bold" : ""}`}>
                      {r.value ?? "—"} {r.unit || ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={k}>
            <span className="text-muted-foreground capitalize">{k}:</span> <span className="text-foreground">{String(v)}</span>
          </div>
        );
      })}
    </>
  );
};

export default PatientTimelineDrawer;
