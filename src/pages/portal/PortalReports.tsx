import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PortalSession } from "./PortalLogin";
import { ChevronDown, ChevronUp, Download } from "lucide-react";

const PortalReports: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [tab, setTab] = useState<"lab" | "radiology">("lab");

  return (
    <div className="px-4 py-0">
      <div className="flex" style={{ height: 44, borderBottom: "1px solid #E2E8F0" }}>
        {[
          { key: "lab" as const, label: "🔬 Lab Reports" },
          { key: "radiology" as const, label: "🩻 Radiology" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-sm font-medium transition-colors"
            style={{
              color: tab === t.key ? "#0E7B7B" : "#94A3B8",
              borderBottom: tab === t.key ? "2px solid #0E7B7B" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lab" ? <LabTab session={session} /> : <RadiologyTab session={session} />}
    </div>
  );
};

/* ═══════════════ LAB TAB ═══════════════ */
const LabTab: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, any[]>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lab_orders")
        .select("id, order_date, status, priority, clinical_notes, ordered_by")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("order_date", { ascending: false })
        .limit(30);

      // Get item counts + doctor name
      const enriched = await Promise.all(
        (data || []).map(async (o) => {
          const { data: orderItems } = await supabase
            .from("lab_order_items")
            .select("id, status")
            .eq("lab_order_id", o.id)
            .eq("hospital_id", session.hospitalId);

          const total = orderItems?.length || 0;
          const done = orderItems?.filter((i) => i.status === "reported" || i.status === "validated").length || 0;

          let doctorName = "";
          if (o.ordered_by) {
            const { data: doc } = await supabase.from("users").select("full_name").eq("id", o.ordered_by).maybeSingle();
            doctorName = doc?.full_name || "";
          }

          return { ...o, total, done, doctorName };
        })
      );

      setOrders(enriched);
      setLoading(false);
    })();
  }, [session]);

  // Load items on expand
  useEffect(() => {
    if (!expanded || items[expanded]) return;
    (async () => {
      const { data } = await supabase
        .from("lab_order_items")
        .select("id, test_id, status, result_value, result_unit, result_flag, reference_range")
        .eq("lab_order_id", expanded)
        .eq("hospital_id", session.hospitalId);

      const enriched = await Promise.all(
        (data || []).map(async (item) => {
          const { data: test } = await supabase
            .from("lab_test_master")
            .select("test_name")
            .eq("id", item.test_id)
            .maybeSingle();
          return { ...item, testName: test?.test_name || "Test" };
        })
      );
      setItems((prev) => ({ ...prev, [expanded]: enriched }));
    })();
  }, [expanded]);

  const getStatusBadge = (status: string) => {
    if (status === "completed" || status === "validated" || status === "reported")
      return { label: "✓ Ready", color: "#15803D", bg: "#DCFCE7" };
    if (status === "in_progress" || status === "sample_collected")
      return { label: "Processing", color: "#D97706", bg: "#FEF3C7" };
    return { label: "Pending", color: "#64748B", bg: "#F1F5F9" };
  };

  const handlePrintReport = (orderId: string) => {
    const orderItems = items[orderId];
    if (!orderItems) return;
    const order = orders.find((o) => o.id === orderId);
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html><head><title>Lab Report</title>
      <style>
        body { font-family: Inter, sans-serif; padding: 32px; max-width: 700px; margin: 0 auto; }
        h1 { font-size: 18px; color: #0E7B7B; margin-bottom: 4px; }
        .info { font-size: 12px; color: #64748B; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #F1F5F9; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; color: #64748B; border: 1px solid #E2E8F0; }
        td { padding: 8px; font-size: 13px; border: 1px solid #E2E8F0; }
        .flag-high { color: #EF4444; font-weight: bold; }
        .flag-low { color: #F59E0B; font-weight: bold; }
        .footer { margin-top: 24px; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 12px; }
      </style></head><body>
        <h1>🔬 LAB REPORT</h1>
        <p class="info">
          Patient: ${session.fullName} · UHID: ${session.uhid}<br/>
          Date: ${new Date(order?.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          ${order?.doctorName ? ` · Dr. ${order.doctorName}` : ""}
        </p>
        <table>
          <tr><th>Test</th><th>Result</th><th>Unit</th><th>Ref. Range</th><th>Flag</th></tr>
          ${orderItems.map((i: any) => `
            <tr>
              <td>${i.testName}</td>
              <td>${i.result_value || "—"}</td>
              <td>${i.result_unit || ""}</td>
              <td>${i.reference_range || ""}</td>
              <td class="${i.result_flag === 'high' || i.result_flag === 'critical_high' ? 'flag-high' : i.result_flag === 'low' || i.result_flag === 'critical_low' ? 'flag-low' : ''}">${i.result_flag ? i.result_flag.toUpperCase() : "Normal"}</td>
            </tr>
          `).join("")}
        </table>
        <div class="footer">
          This report is for reference. Please discuss results with your doctor.<br/>
          ${session.hospitalName}
        </div>
        <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="py-4">
      {loading ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
          <span className="text-[32px]">🔬</span>
          <p className="text-sm font-semibold mt-2" style={{ color: "#374151" }}>No lab reports yet</p>
          <p className="text-[13px] mt-1" style={{ color: "#94A3B8" }}>Your test results will appear here once ready</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const badge = getStatusBadge(o.status);
            const isExp = expanded === o.id;
            return (
              <div key={o.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                <button onClick={() => setExpanded(isExp ? null : o.id)} className="w-full p-3.5 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: "#64748B" }}>
                      {new Date(o.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{ color: badge.color, background: badge.bg }}
                    >
                      {badge.label}
                    </span>
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
                      <p className="text-xs py-3" style={{ color: "#94A3B8" }}>No test results yet</p>
                    ) : (
                      <>
                        <div className="space-y-1 py-2">
                          {items[o.id].map((item: any) => {
                            const isAbnormal = item.result_flag === "high" || item.result_flag === "low" ||
                              item.result_flag === "critical_high" || item.result_flag === "critical_low";
                            return (
                              <div key={item.id} className="flex items-center justify-between py-1.5">
                                <span className="text-xs font-medium" style={{ color: "#0F172A" }}>{item.testName}</span>
                                <div className="text-right">
                                  <span
                                    className="text-xs font-bold"
                                    style={{ color: isAbnormal ? "#EF4444" : "#0F172A" }}
                                  >
                                    {item.result_value || "—"} {item.result_unit || ""}
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
                          onClick={() => handlePrintReport(o.id)}
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

/* ═══════════════ RADIOLOGY TAB ═══════════════ */
const RadiologyTab: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("radiology_orders")
        .select("id, study_name, modality_type, order_date, status, ordered_by")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("order_date", { ascending: false })
        .limit(30);

      const enriched = await Promise.all(
        (data || []).map(async (o) => {
          let doctorName = "";
          if (o.ordered_by) {
            const { data: doc } = await supabase.from("users").select("full_name").eq("id", o.ordered_by).maybeSingle();
            doctorName = doc?.full_name || "";
          }
          // Get report if exists
          let report: any = null;
          const { data: rep } = await supabase
            .from("radiology_reports")
            .select("impression, findings, recommendations, validated_at")
            .eq("order_id", o.id)
            .maybeSingle();
          if (rep) report = rep;

          return { ...o, doctorName, report };
        })
      );

      setOrders(enriched);
      setLoading(false);
    })();
  }, [session]);

  const getStatusBadge = (status: string, hasReport: boolean) => {
    if (hasReport || status === "validated" || status === "reported")
      return { label: "✓ Ready", color: "#15803D", bg: "#DCFCE7" };
    if (status === "in_progress" || status === "scheduled")
      return { label: "Processing", color: "#D97706", bg: "#FEF3C7" };
    return { label: "Pending", color: "#64748B", bg: "#F1F5F9" };
  };

  const MODALITY_COLORS: Record<string, string> = {
    "X-Ray": "#3B82F6", "CT": "#8B5CF6", "MRI": "#EC4899", "USG": "#0E7B7B",
    "Ultrasound": "#0E7B7B",
  };

  return (
    <div className="py-4">
      {loading ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
          <span className="text-[32px]">🩻</span>
          <p className="text-sm font-semibold mt-2" style={{ color: "#374151" }}>No radiology reports yet</p>
          <p className="text-[13px] mt-1" style={{ color: "#94A3B8" }}>Your imaging results will appear here once ready</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const badge = getStatusBadge(o.status, !!o.report);
            const isExp = expanded === o.id;
            const modalityColor = MODALITY_COLORS[o.modality_type] || "#64748B";
            return (
              <div key={o.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                <button onClick={() => setExpanded(isExp ? null : o.id)} className="w-full p-3.5 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{ color: modalityColor, background: `${modalityColor}15` }}
                    >
                      {o.modality_type}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{ color: badge.color, background: badge.bg }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-[13px] font-bold mt-1" style={{ color: "#0F172A" }}>{o.study_name}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                    {new Date(o.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {o.doctorName && ` · Dr. ${o.doctorName}`}
                  </p>
                  {o.report && (
                    <div className="flex justify-end mt-0.5">
                      {isExp ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />}
                    </div>
                  )}
                </button>

                {isExp && o.report && (
                  <div className="px-3.5 pb-3.5 space-y-2" style={{ borderTop: "1px solid #F1F5F9" }}>
                    {o.report.impression && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Impression</span>
                        <p className="text-xs" style={{ color: "#374151" }}>{o.report.impression}</p>
                      </div>
                    )}
                    {o.report.findings && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Findings</span>
                        <p className="text-xs" style={{ color: "#374151" }}>{o.report.findings}</p>
                      </div>
                    )}
                    {o.report.recommendations && (
                      <div>
                        <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>Recommendations</span>
                        <p className="text-xs" style={{ color: "#374151" }}>{o.report.recommendations}</p>
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

/* ═══════════════ SHARED ═══════════════ */
const EmptyCard: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
    <p className="text-sm" style={{ color: "#94A3B8" }}>{text}</p>
  </div>
);

const SkeletonList: React.FC = () => (
  <div className="space-y-2.5">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
        <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
        <div className="h-4 w-32 rounded mt-2" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

export default PortalReports;
