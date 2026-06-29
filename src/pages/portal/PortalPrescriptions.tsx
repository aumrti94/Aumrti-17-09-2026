import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Download } from "lucide-react";
import type { PortalSession } from "./PortalLogin";

const FREQ_MAP: Record<string, string> = {
  OD: "Once daily",
  BD: "Twice daily",
  TDS: "Three times daily",
  QDS: "Four times daily",
  SOS: "As needed",
  HS: "At bedtime",
  STAT: "Immediately",
};

const PortalPrescriptions: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [rxList, setRxList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("prescriptions")
        .select("id, prescription_date, drugs, advice_notes, review_date, doctor_id")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("prescription_date", { ascending: false })
        .limit(20);

      const doctorIds = [...new Set((data || []).map((r) => r.doctor_id).filter(Boolean))];
      const { data: doctors } = doctorIds.length
        ? await supabase.from("users").select("id, full_name").in("id", doctorIds)
        : { data: [] };
      const docMap = Object.fromEntries((doctors || []).map((d) => [d.id, d.full_name]));

      setRxList((data || []).map((rx) => ({ ...rx, doctorName: docMap[rx.doctor_id] || "" })));
      setLoading(false);
    })();
  }, [session]);

  const printRx = (rx: any) => {
    const drugs: any[] = Array.isArray(rx.drugs) ? rx.drugs : [];
    const dateStr = rx.prescription_date
      ? new Date(rx.prescription_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "—";

    const rows = drugs
      .map(
        (d: any, i: number) =>
          `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${i + 1}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-weight:600;">${d.drug_name || d.name || "—"}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${d.dose || "—"}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${d.route || "—"}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${FREQ_MAP[d.frequency?.toUpperCase()] || d.frequency || "—"}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${d.duration || "—"}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;">${d.instructions || "—"}</td>
          </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html><html><head><title>Prescription</title>
      <style>@media print{body{margin:0}@page{size:A4;margin:16mm}}</style></head>
      <body style="font-family:system-ui,sans-serif;color:#0F172A;max-width:720px;margin:0 auto;padding:20px;">
        <div style="text-align:center;border-bottom:2px solid #0E7B7B;padding-bottom:12px;margin-bottom:16px;">
          <h2 style="margin:0;color:#0E7B7B;">${session.hospitalName}</h2>
          <p style="font-size:18px;font-weight:700;margin:8px 0 0;">PRESCRIPTION / e-Rx</p>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:12px;">
          <div><b>Patient:</b> ${session.fullName}<br/><b>UHID:</b> ${session.uhid}</div>
          <div style="text-align:right;"><b>Date:</b> ${dateStr}<br/><b>Doctor:</b> Dr. ${rx.doctorName}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
          <thead><tr style="background:#F1F5F9;">
            <th style="padding:8px;text-align:left;">#</th>
            <th style="padding:8px;text-align:left;">Drug Name</th>
            <th style="padding:8px;text-align:left;">Dose</th>
            <th style="padding:8px;text-align:left;">Route</th>
            <th style="padding:8px;text-align:left;">Frequency</th>
            <th style="padding:8px;text-align:left;">Duration</th>
            <th style="padding:8px;text-align:left;">Instructions</th>
          </tr></thead><tbody>${rows}</tbody>
        </table>
        ${rx.advice_notes ? `<div style="margin-top:16px;padding:10px;background:#F8FAFC;border-radius:8px;font-size:12px;"><b>Instructions:</b> ${rx.advice_notes}</div>` : ""}
        ${rx.review_date ? `<p style="margin-top:12px;font-size:12px;color:#0E7B7B;"><b>Follow-up:</b> ${new Date(rx.review_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>` : ""}
        <div style="margin-top:32px;border-top:1px solid #E2E8F0;padding-top:12px;font-size:10px;color:#94A3B8;text-align:center;">
          This is a computer-generated prescription. Please consult your doctor before making changes.
        </div>
      </body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  };

  return (
    <div className="px-4 py-4">
      <h2 className="text-base font-bold mb-1" style={{ color: "#0F172A" }}>Prescriptions</h2>
      <p className="text-xs mb-3" style={{ color: "#64748B" }}>Your medication history</p>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
              <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
              <div className="h-4 w-32 rounded mt-2" style={{ background: "#E2E8F0" }} />
            </div>
          ))}
        </div>
      ) : rxList.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-sm" style={{ color: "#94A3B8" }}>No prescriptions found</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rxList.map((rx) => {
            const drugs: any[] = Array.isArray(rx.drugs) ? rx.drugs : [];
            const isExpanded = expanded === rx.id;
            const shown = isExpanded ? drugs : drugs.slice(0, 3);

            return (
              <div key={rx.id} className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                    {rx.doctorName ? `Dr. ${rx.doctorName}` : "Prescription"}
                  </p>
                  <span className="text-[10px]" style={{ color: "#94A3B8" }}>
                    {rx.prescription_date
                      ? new Date(rx.prescription_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </span>
                </div>

                <p className="text-xs" style={{ color: "#64748B" }}>
                  {drugs.length} medication{drugs.length !== 1 ? "s" : ""}
                </p>

                {shown.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {shown.map((d: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 py-1 px-2 rounded-lg" style={{ background: "#F8FAFC" }}>
                        <span className="text-xs shrink-0">💊</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium" style={{ color: "#0F172A" }}>
                            {d.drug_name || d.name || "Medication"}
                          </p>
                          <p className="text-[10px]" style={{ color: "#64748B" }}>
                            {[d.dose, FREQ_MAP[d.frequency?.toUpperCase()] || d.frequency, d.route, d.duration]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    ))}
                    {!isExpanded && drugs.length > 3 && (
                      <button
                        onClick={() => setExpanded(rx.id)}
                        className="text-[11px] font-medium pl-2"
                        style={{ color: "#0E7B7B" }}
                      >
                        + {drugs.length - 3} more medications
                      </button>
                    )}
                    {isExpanded && drugs.length > 3 && (
                      <button
                        onClick={() => setExpanded(null)}
                        className="text-[11px] font-medium pl-2"
                        style={{ color: "#0E7B7B" }}
                      >
                        Show less
                      </button>
                    )}
                  </div>
                )}

                {rx.advice_notes && (
                  <p className="text-xs mt-2 italic" style={{ color: "#64748B" }}>📝 {rx.advice_notes}</p>
                )}

                {rx.review_date && (
                  <p className="text-xs font-medium mt-2" style={{ color: "#0E7B7B" }}>
                    📅 Review: {new Date(rx.review_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}

                <button
                  onClick={() => printRx(rx)}
                  className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 rounded-lg text-xs font-bold transition-colors"
                  style={{ border: "1.5px solid #0E7B7B", color: "#0E7B7B" }}
                >
                  <Download size={14} />
                  Download Prescription
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalPrescriptions;
