import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePatientPortal } from "@/contexts/PatientPortalContext";
import { ChevronDown, ChevronUp, Download, X, Pill } from "lucide-react";

type Tab = "lab" | "radiology" | "prescriptions";

/* ── Shared ──────────────────────────────────────────────────────────────── */
const SkeletonList: React.FC = () => (
  <div className="space-y-2.5">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
        <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
        <div className="h-4 w-36 rounded mt-2" style={{ background: "#E2E8F0" }} />
        <div className="h-3 w-24 rounded mt-1.5" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

const EmptyState: React.FC<{ emoji: string; title: string; sub: string }> = ({ emoji, title, sub }) => (
  <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
    <span className="text-[32px]">{emoji}</span>
    <p className="text-sm font-semibold mt-2" style={{ color: "#374151" }}>{title}</p>
    <p className="text-[13px] mt-1" style={{ color: "#94A3B8" }}>{sub}</p>
  </div>
);

const StatusBadge: React.FC<{ label: string; color: string; bg: string }> = ({ label, color, bg }) => (
  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ color, background: bg }}>
    {label}
  </span>
);

/* ── Lab Tab ─────────────────────────────────────────────────────────────── */
const LabTab: React.FC<{ patientId: string; hospitalId: string; patientName: string; uhid: string; hospitalName: string }> = ({
  patientId, hospitalId, patientName, uhid, hospitalName,
}) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, any[]>>({});

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("lab_orders")
        .select("id, order_date, status, ordered_by")
        .eq("patient_id", patientId)
        .eq("hospital_id", hospitalId)
        .in("status", ["completed", "reported", "validated"])
        .order("order_date", { ascending: false })
        .limit(30);

      const enriched = await Promise.all(
        (data || []).map(async (o: any) => {
          const { data: orderItems } = await supabase
            .from("lab_order_items")
            .select("id, status")
            .eq("lab_order_id", o.id)
            .eq("hospital_id", hospitalId);

          const total = orderItems?.length || 0;
          const done = orderItems?.filter(
            (i) => i.status === "reported" || i.status === "validated"
          ).length || 0;

          let doctorName = "";
          if (o.ordered_by) {
            const { data: doc } = await supabase
              .from("users")
              .select("full_name")
              .eq("id", o.ordered_by)
              .maybeSingle();
            doctorName = doc?.full_name || "";
          }

          return { ...o, total, done, doctorName };
        })
      );

      setOrders(enriched);
      setLoading(false);
    })();
  }, [patientId, hospitalId]);

  useEffect(() => {
    if (!expanded || items[expanded]) return;
    (async () => {
      const { data } = await supabase
        .from("lab_order_items")
        .select("id, test_id, status, result_value, result_unit, result_flag, reference_range")
        .eq("lab_order_id", expanded)
        .eq("hospital_id", hospitalId);

      const enriched = await Promise.all(
        (data || []).map(async (item) => {
          const { data: test } = await (supabase as any)
            .from("lab_test_master")
            .select("test_name")
            .eq("id", item.test_id)
            .maybeSingle();
          return { ...item, testName: test?.test_name || "Test" };
        })
      );
      setItems((prev) => ({ ...prev, [expanded]: enriched }));
    })();
  }, [expanded, hospitalId]);

  const labBadge = (status: string) => {
    if (["completed", "validated", "reported"].includes(status))
      return { label: "✓ Ready", color: "#15803D", bg: "#DCFCE7" };
    return { label: "Processing", color: "#D97706", bg: "#FEF3C7" };
  };

  const handlePrint = (orderId: string) => {
    const orderItems = items[orderId];
    if (!orderItems) return;
    const order = orders.find((o) => o.id === orderId);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>Lab Report</title>
      <style>
        body{font-family:sans-serif;padding:32px;max-width:700px;margin:0 auto}
        h1{font-size:18px;color:#0E7B7B;margin-bottom:4px}
        .info{font-size:12px;color:#64748B;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th{background:#F1F5F9;text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#64748B;border:1px solid #E2E8F0}
        td{padding:8px;font-size:13px;border:1px solid #E2E8F0}
        .abnormal{color:#EF4444;font-weight:bold}
        .footer{margin-top:24px;font-size:11px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:12px}
      </style></head><body>
      <h1>🔬 LAB REPORT</h1>
      <p class="info">
        Patient: ${patientName} · UHID: ${uhid}<br/>
        Date: ${new Date(order?.order_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
        ${order?.doctorName ? ` · Dr. ${order.doctorName}` : ""}
      </p>
      <table>
        <tr><th>Test</th><th>Result</th><th>Unit</th><th>Ref. Range</th><th>Flag</th></tr>
        ${orderItems.map((i: any) => {
          const abn = i.result_flag && ["high","low","critical_high","critical_low"].includes(i.result_flag);
          return `<tr>
            <td>${i.testName}</td>
            <td class="${abn ? "abnormal" : ""}">${i.result_value || "—"}</td>
            <td>${i.result_unit || ""}</td>
            <td>${i.reference_range || ""}</td>
            <td class="${abn ? "abnormal" : ""}">${i.result_flag ? i.result_flag.replace("_"," ").toUpperCase() : "Normal"}</td>
          </tr>`;
        }).join("")}
      </table>
      <div class="footer">This report is for reference only. Please discuss results with your doctor.<br/>${hospitalName}</div>
      <script>window.onload=()=>window.print()</script>
    </body></html>`);
    win.document.close();
  };

  return (
    <div className="py-4">
      {loading ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <EmptyState emoji="🔬" title="No lab reports yet" sub="Your test results will appear here once ready" />
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const badge = labBadge(o.status);
            const isExp = expanded === o.id;
            return (
              <div key={o.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                <button onClick={() => setExpanded(isExp ? null : o.id)} className="w-full p-3.5 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: "#64748B" }}>
                      {new Date(o.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <StatusBadge {...badge} />
                  </div>
                  <p className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                    {o.done} of {o.total} tests complete
                  </p>
                  {o.doctorName && (
                    <p className="text-[11px] mt-0.5" style={{ color: "#94A3B8" }}>Ordered by Dr. {o.doctorName}</p>
                  )}
                  <div className="flex justify-end mt-0.5">
                    {isExp ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />}
                  </div>
                </button>

                {isExp && (
                  <div className="px-3.5 pb-3.5" style={{ borderTop: "1px solid #F1F5F9" }}>
                    {!items[o.id] ? (
                      <p className="text-xs py-3 text-center" style={{ color: "#94A3B8" }}>Loading…</p>
                    ) : items[o.id].length === 0 ? (
                      <p className="text-xs py-3" style={{ color: "#94A3B8" }}>No results recorded yet</p>
                    ) : (
                      <>
                        <div className="space-y-1 py-2">
                          {items[o.id].map((item: any) => {
                            const isAbn = item.result_flag && ["high","low","critical_high","critical_low"].includes(item.result_flag);
                            return (
                              <div key={item.id} className="flex items-center justify-between py-1.5">
                                <span className="text-xs font-medium" style={{ color: "#0F172A" }}>{item.testName}</span>
                                <div className="text-right">
                                  <span className="text-xs font-bold" style={{ color: isAbn ? "#EF4444" : "#0F172A" }}>
                                    {item.result_value || "—"}{item.result_unit ? ` ${item.result_unit}` : ""}
                                  </span>
                                  {item.reference_range && (
                                    <p className="text-[10px]" style={{ color: "#94A3B8" }}>Ref: {item.reference_range}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => handlePrint(o.id)}
                          className="w-full mt-2 rounded-lg flex items-center justify-center gap-2 text-sm font-bold py-2.5"
                          style={{ background: "#0E7B7B", color: "#FFFFFF" }}
                        >
                          <Download size={14} /> Download Report PDF
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Radiology Tab ───────────────────────────────────────────────────────── */
const MODALITY_COLORS: Record<string, string> = {
  "X-Ray": "#3B82F6", "CT": "#8B5CF6", "MRI": "#EC4899",
  "USG": "#0E7B7B", "Ultrasound": "#0E7B7B", "PET": "#F59E0B",
};

const RadiologyTab: React.FC<{ patientId: string; hospitalId: string }> = ({ patientId, hospitalId }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("radiology_orders")
        .select("id, study_name, modality_type, order_date, status, ordered_by, body_part")
        .eq("patient_id", patientId)
        .eq("hospital_id", hospitalId)
        .order("order_date", { ascending: false })
        .limit(30);

      const enriched = await Promise.all(
        (data || []).map(async (o) => {
          let doctorName = "";
          if (o.ordered_by) {
            const { data: doc } = await supabase.from("users").select("full_name").eq("id", o.ordered_by).maybeSingle();
            doctorName = doc?.full_name || "";
          }
          const { data: rep } = await supabase
            .from("radiology_reports")
            .select("impression, findings, recommendations, critical_finding, is_critical, is_signed")
            .eq("order_id", o.id)
            .eq("is_signed", true)
            .maybeSingle();
          return { ...o, doctorName, report: rep || null };
        })
      );

      setOrders(enriched);
      setLoading(false);
    })();
  }, [patientId, hospitalId]);

  const radiologyBadge = (status: string, hasReport: boolean) => {
    if (hasReport || status === "validated" || status === "reported")
      return { label: "✓ Ready", color: "#15803D", bg: "#DCFCE7" };
    if (["in_progress", "scheduled", "scan_done"].includes(status))
      return { label: "Processing", color: "#D97706", bg: "#FEF3C7" };
    return { label: "Pending", color: "#64748B", bg: "#F1F5F9" };
  };

  return (
    <div className="py-4">
      {loading ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <EmptyState emoji="🩻" title="No radiology reports yet" sub="Your imaging results will appear here once signed off" />
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const badge = radiologyBadge(o.status, !!o.report);
            const isExp = expanded === o.id;
            const modalColor = MODALITY_COLORS[o.modality_type] || "#64748B";
            return (
              <div key={o.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                <button
                  onClick={() => o.report && setExpanded(isExp ? null : o.id)}
                  className="w-full p-3.5 text-left"
                  style={{ cursor: o.report ? "pointer" : "default" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{ color: modalColor, background: `${modalColor}20` }}
                    >
                      {o.modality_type || "Imaging"}
                    </span>
                    <StatusBadge {...badge} />
                  </div>
                  <p className="text-[13px] font-bold mt-1" style={{ color: "#0F172A" }}>
                    {o.study_name}{o.body_part ? ` — ${o.body_part}` : ""}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                    {new Date(o.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {o.doctorName ? ` · Dr. ${o.doctorName}` : ""}
                  </p>
                  {o.report && (
                    <div className="flex justify-end mt-0.5">
                      {isExp ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />}
                    </div>
                  )}
                </button>

                {isExp && o.report && (
                  <div className="px-3.5 pb-3.5 space-y-3" style={{ borderTop: "1px solid #F1F5F9" }}>
                    {o.report.is_critical && o.report.critical_finding && (
                      <div className="rounded-lg p-2.5" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#DC2626" }}>Critical Finding</span>
                        <p className="text-xs mt-0.5" style={{ color: "#7F1D1D" }}>{o.report.critical_finding}</p>
                      </div>
                    )}
                    {o.report.impression && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Impression</span>
                        <p className="text-xs mt-0.5 whitespace-pre-wrap" style={{ color: "#374151" }}>{o.report.impression}</p>
                      </div>
                    )}
                    {o.report.findings && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Findings</span>
                        <p className="text-xs mt-0.5 whitespace-pre-wrap" style={{ color: "#374151" }}>{o.report.findings}</p>
                      </div>
                    )}
                    {o.report.recommendations && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Recommendations</span>
                        <p className="text-xs mt-0.5" style={{ color: "#374151" }}>{o.report.recommendations}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Prescriptions Tab ───────────────────────────────────────────────────── */
interface DrugEntry {
  name?: string;
  drug_name?: string;
  dose?: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  duration?: string;
  instructions?: string;
}

interface RxRecord {
  id: string;
  prescription_date: string | null;
  doctor_id: string | null;
  drugs: unknown;
  is_signed: boolean | null;
  advice_notes: string | null;
  review_date: string | null;
  doctorName: string;
  drugList: DrugEntry[];
}

const PrescriptionsTab: React.FC<{
  patientId: string;
  hospitalId: string;
  patientName: string;
  uhid: string;
  hospitalName: string;
}> = ({ patientId, hospitalId, patientName, uhid, hospitalName }) => {
  const [prescriptions, setPrescriptions] = useState<RxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewRx, setViewRx] = useState<RxRecord | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("prescriptions")
        .select("id, prescription_date, doctor_id, drugs, is_signed, advice_notes, review_date")
        .eq("patient_id", patientId)
        .eq("hospital_id", hospitalId)
        .order("prescription_date", { ascending: false })
        .limit(30);

      const enriched = await Promise.all(
        (data || []).map(async (rx: any) => {
          let doctorName = "";
          if (rx.doctor_id) {
            const { data: doc } = await supabase
              .from("users")
              .select("full_name")
              .eq("id", rx.doctor_id)
              .maybeSingle();
            doctorName = doc?.full_name || "";
          }
          let drugList: DrugEntry[] = [];
          if (Array.isArray(rx.drugs)) {
            drugList = rx.drugs as DrugEntry[];
          } else if (rx.drugs && typeof rx.drugs === "object") {
            drugList = [rx.drugs as DrugEntry];
          }
          return { ...rx, doctorName, drugList };
        })
      );

      setPrescriptions(enriched);
      setLoading(false);
    })();
  }, [patientId, hospitalId]);

  const keyDrugs = (drugList: DrugEntry[], max = 3) =>
    drugList
      .slice(0, max)
      .map((d) => d.name || d.drug_name || "Drug")
      .join(", ");

  const handlePrintRx = (rx: RxRecord) => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>Prescription</title>
      <style>
        body{font-family:sans-serif;padding:32px;max-width:700px;margin:0 auto}
        h1{font-size:18px;color:#0E7B7B;margin-bottom:4px}
        .info{font-size:12px;color:#64748B;margin-bottom:16px}
        .drug{margin-bottom:10px;padding:10px;border:1px solid #E2E8F0;border-radius:6px}
        .dname{font-size:14px;font-weight:700;color:#0F172A}
        .dmeta{font-size:11px;color:#64748B;margin-top:2px}
        .section{margin-top:14px}
        .section-title{font-size:11px;font-weight:700;text-transform:uppercase;color:#94A3B8;margin-bottom:4px}
        .footer{margin-top:24px;font-size:11px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:12px}
      </style></head><body>
      <h1>💊 PRESCRIPTION</h1>
      <p class="info">
        Patient: ${patientName} · UHID: ${uhid}<br/>
        Date: ${rx.prescription_date ? new Date(rx.prescription_date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—"}
        ${rx.doctorName ? ` · Dr. ${rx.doctorName}` : ""}
        ${rx.is_signed ? " · ✓ Signed" : ""}
      </p>
      <div class="section">
        <div class="section-title">Medications</div>
        ${rx.drugList.map((d) => `<div class="drug">
          <div class="dname">${d.name || d.drug_name || "—"}</div>
          <div class="dmeta">
            ${[d.dose || d.dosage, d.route, d.frequency, d.duration ? `for ${d.duration}` : ""].filter(Boolean).join(" · ")}
          </div>
          ${d.instructions ? `<div class="dmeta" style="margin-top:4px;font-style:italic">${d.instructions}</div>` : ""}
        </div>`).join("")}
      </div>
      ${rx.advice_notes ? `<div class="section"><div class="section-title">Advice</div><p style="font-size:13px;color:#374151">${rx.advice_notes}</p></div>` : ""}
      ${rx.review_date ? `<div class="section"><div class="section-title">Review Date</div><p style="font-size:13px;color:#374151">${new Date(rx.review_date).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</p></div>` : ""}
      <div class="footer">This prescription is for reference only.<br/>${hospitalName}</div>
      <script>window.onload=()=>window.print()</script>
    </body></html>`);
    win.document.close();
  };

  return (
    <>
      <div className="py-4">
        {loading ? (
          <SkeletonList />
        ) : prescriptions.length === 0 ? (
          <EmptyState emoji="💊" title="No prescriptions yet" sub="Prescriptions from your visits will appear here" />
        ) : (
          <div className="space-y-2.5">
            {prescriptions.map((rx) => (
              <div key={rx.id} className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs" style={{ color: "#64748B" }}>
                        {rx.prescription_date
                          ? new Date(rx.prescription_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                          : "—"}
                      </span>
                      {rx.is_signed && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ color: "#15803D", background: "#DCFCE7" }}>
                          ✓ Signed
                        </span>
                      )}
                    </div>
                    {rx.doctorName && (
                      <p className="text-[13px] font-bold mt-0.5" style={{ color: "#0F172A" }}>
                        Dr. {rx.doctorName}
                      </p>
                    )}
                    {rx.drugList.length > 0 && (
                      <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#64748B" }}>
                        <Pill size={11} />
                        {keyDrugs(rx.drugList)}
                        {rx.drugList.length > 3 && ` +${rx.drugList.length - 3} more`}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setViewRx(rx)}
                    className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{ background: "#F0FAFA", color: "#0E7B7B", border: "1px solid #B2DFDF" }}
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full Rx Modal */}
      {viewRx && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => e.target === e.currentTarget && setViewRx(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col"
            style={{ background: "#FFFFFF", maxHeight: "85vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #E2E8F0" }}>
              <div>
                <p className="text-sm font-bold" style={{ color: "#0F172A" }}>Prescription</p>
                <p className="text-xs mt-0.5" style={{ color: "#94A3B8" }}>
                  {viewRx.prescription_date
                    ? new Date(viewRx.prescription_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                  {viewRx.doctorName ? ` · Dr. ${viewRx.doctorName}` : ""}
                </p>
              </div>
              <button onClick={() => setViewRx(null)} className="p-1.5 rounded-full hover:bg-slate-100">
                <X size={18} color="#64748B" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {viewRx.drugList.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#94A3B8" }}>
                    Medications ({viewRx.drugList.length})
                  </p>
                  <div className="space-y-2">
                    {viewRx.drugList.map((d, idx) => (
                      <div key={idx} className="rounded-lg p-3" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                        <p className="text-sm font-bold" style={{ color: "#0F172A" }}>
                          {d.name || d.drug_name || "—"}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                          {[d.dose || d.dosage, d.route, d.frequency, d.duration ? `for ${d.duration}` : ""].filter(Boolean).join(" · ") || "No dosing info"}
                        </p>
                        {d.instructions && (
                          <p className="text-[11px] mt-1 italic" style={{ color: "#94A3B8" }}>{d.instructions}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewRx.advice_notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#94A3B8" }}>
                    Advice
                  </p>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: "#374151" }}>{viewRx.advice_notes}</p>
                </div>
              )}

              {viewRx.review_date && (
                <div className="rounded-lg p-3 flex items-center gap-2" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
                  <span className="text-sm">📅</span>
                  <div>
                    <p className="text-[10px] font-bold uppercase" style={{ color: "#15803D" }}>Review Date</p>
                    <p className="text-sm font-bold" style={{ color: "#166534" }}>
                      {new Date(viewRx.review_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4" style={{ borderTop: "1px solid #E2E8F0" }}>
              <button
                onClick={() => handlePrintRx(viewRx)}
                className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-bold"
                style={{ background: "#0E7B7B", color: "#FFFFFF" }}
              >
                <Download size={15} /> Download / Print
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ── Root ────────────────────────────────────────────────────────────────── */
const PatientPortalReportsPage: React.FC = () => {
  const { patientId, hospitalId, patient, hospital } = usePatientPortal();
  const [tab, setTab] = useState<Tab>("lab");

  if (!patientId || !hospitalId) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "lab", label: "🔬 Lab" },
    { key: "radiology", label: "🩻 Radiology" },
    { key: "prescriptions", label: "💊 Prescriptions" },
  ];

  return (
    <div className="px-4 py-0">
      {/* Tab bar */}
      <div className="flex" style={{ height: 44, borderBottom: "1px solid #E2E8F0" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-sm font-medium transition-colors"
            style={{
              color: tab === t.key ? "#0E7B7B" : "#94A3B8",
              borderBottom: tab === t.key ? "2px solid #0E7B7B" : "2px solid transparent",
              fontSize: "12px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lab" && (
        <LabTab
          patientId={patientId}
          hospitalId={hospitalId}
          patientName={patient?.fullName ?? ""}
          uhid={patient?.uhid ?? ""}
          hospitalName={hospital?.name ?? ""}
        />
      )}
      {tab === "radiology" && (
        <RadiologyTab patientId={patientId} hospitalId={hospitalId} />
      )}
      {tab === "prescriptions" && (
        <PrescriptionsTab
          patientId={patientId}
          hospitalId={hospitalId}
          patientName={patient?.fullName ?? ""}
          uhid={patient?.uhid ?? ""}
          hospitalName={hospital?.name ?? ""}
        />
      )}
    </div>
  );
};

export default PatientPortalReportsPage;
