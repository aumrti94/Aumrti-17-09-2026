import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PortalSession } from "./PortalLogin";

type TimelineEvent = {
  type: "opd" | "ipd" | "lab" | "radiology";
  eventDate: string;
  title: string;
  doctorName: string;
  deptName: string;
  refId: string;
  detail?: string;
};

const TYPE_CONFIG: Record<string, { color: string; emoji: string; label: string }> = {
  opd: { color: "#3B82F6", emoji: "🩺", label: "OPD" },
  ipd: { color: "#8B5CF6", emoji: "🏥", label: "IPD" },
  lab: { color: "#10B981", emoji: "🔬", label: "Lab" },
  radiology: { color: "#F59E0B", emoji: "🩻", label: "Radiology" },
};

const FILTERS = ["All", "OPD Visits", "Admissions", "Lab Tests", "Radiology"] as const;
const FILTER_MAP: Record<string, string | null> = {
  All: null,
  "OPD Visits": "opd",
  Admissions: "ipd",
  "Lab Tests": "lab",
  Radiology: "radiology",
};

const PortalTimeline: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const all: TimelineEvent[] = [];

      // OPD encounters
      const { data: opd } = await supabase
        .from("opd_encounters")
        .select("id, created_at, chief_complaint, diagnosis, doctor_id")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (opd) {
        const doctorIds = [...new Set(opd.map((e) => e.doctor_id).filter(Boolean))];
        const { data: doctors } = doctorIds.length
          ? await supabase.from("users").select("id, full_name, department_id").in("id", doctorIds)
          : { data: [] };
        const deptIds = [...new Set((doctors || []).map((d) => d.department_id).filter(Boolean))];
        const { data: depts } = deptIds.length
          ? await supabase.from("departments").select("id, name").in("id", deptIds)
          : { data: [] };

        const docMap = Object.fromEntries((doctors || []).map((d) => [d.id, d]));
        const deptMap = Object.fromEntries((depts || []).map((d) => [d.id, d.name]));

        for (const e of opd) {
          const doc = docMap[e.doctor_id];
          all.push({
            type: "opd",
            eventDate: e.created_at,
            title: `OPD Visit — ${e.chief_complaint || "Consultation"}`,
            doctorName: doc?.full_name || "",
            deptName: doc?.department_id ? deptMap[doc.department_id] || "" : "",
            refId: e.id,
            detail: e.diagnosis || undefined,
          });
        }
      }

      // IPD admissions
      const { data: ipd } = await supabase
        .from("admissions")
        .select("id, admitted_at, discharged_at, status, ward_id, admitting_doctor_id")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("admitted_at", { ascending: false })
        .limit(50);

      if (ipd) {
        const wardIds = [...new Set(ipd.map((a) => a.ward_id))];
        const docIds = [...new Set(ipd.map((a) => a.admitting_doctor_id))];
        const { data: wards } = wardIds.length
          ? await supabase.from("wards").select("id, name").in("id", wardIds)
          : { data: [] };
        const { data: docs } = docIds.length
          ? await supabase.from("users").select("id, full_name").in("id", docIds)
          : { data: [] };

        const wardMap = Object.fromEntries((wards || []).map((w) => [w.id, w.name]));
        const docMap2 = Object.fromEntries((docs || []).map((d) => [d.id, d.full_name]));

        for (const a of ipd) {
          const los = a.discharged_at
            ? Math.ceil((new Date(a.discharged_at).getTime() - new Date(a.admitted_at!).getTime()) / 86400000)
            : null;
          all.push({
            type: "ipd",
            eventDate: a.admitted_at!,
            title: `Admitted — ${wardMap[a.ward_id] || "Ward"}`,
            doctorName: docMap2[a.admitting_doctor_id] || "",
            deptName: wardMap[a.ward_id] || "",
            refId: a.id,
            detail: a.discharged_at
              ? `Discharged after ${los} day${los !== 1 ? "s" : ""}`
              : "Currently admitted",
          });
        }
      }

      // Lab orders
      const { data: labs } = await supabase
        .from("lab_orders")
        .select("id, order_date, ordered_by, status")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("order_date", { ascending: false })
        .limit(50);

      if (labs) {
        const labIds = labs.map((l) => l.id);
        const docIds = [...new Set(labs.map((l) => l.ordered_by))];
        const { data: items } = labIds.length
          ? await supabase
              .from("lab_order_items")
              .select("lab_order_id, result_flag")
              .in("lab_order_id", labIds)
          : { data: [] };
        const { data: docs } = docIds.length
          ? await supabase.from("users").select("id, full_name").in("id", docIds)
          : { data: [] };

        const docMap3 = Object.fromEntries((docs || []).map((d) => [d.id, d.full_name]));
        const itemMap: Record<string, { total: number; abnormal: number }> = {};
        for (const it of items || []) {
          if (!itemMap[it.lab_order_id]) itemMap[it.lab_order_id] = { total: 0, abnormal: 0 };
          itemMap[it.lab_order_id].total++;
          if (it.result_flag && it.result_flag !== "normal") itemMap[it.lab_order_id].abnormal++;
        }

        for (const l of labs) {
          const info = itemMap[l.id] || { total: 0, abnormal: 0 };
          all.push({
            type: "lab",
            eventDate: l.order_date + "T00:00:00",
            title: `Lab Tests — ${info.total} test${info.total !== 1 ? "s" : ""}`,
            doctorName: docMap3[l.ordered_by] || "",
            deptName: "Laboratory",
            refId: l.id,
            detail:
              info.abnormal > 0
                ? `${info.total} tests · ${info.abnormal} abnormal`
                : `${info.total} tests · all normal`,
          });
        }
      }

      // Sort all events
      all.sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
      setEvents(all);
      setLoading(false);
    })();
  }, [session]);

  const filtered = filter === "All" ? events : events.filter((e) => e.type === FILTER_MAP[filter]);

  return (
    <div className="px-4 py-4">
      <h2 className="text-lg font-bold" style={{ color: "#0F172A" }}>
        My Health Story
      </h2>
      <p className="text-xs mb-3" style={{ color: "#64748B" }}>
        All your visits and records at {session.hospitalName}
      </p>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filter === f ? "#0E7B7B" : "#F1F5F9",
              color: filter === f ? "#FFFFFF" : "#64748B",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 mt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
              <div className="h-3 w-16 rounded" style={{ background: "#E2E8F0" }} />
              <div className="h-4 w-40 rounded mt-2" style={{ background: "#E2E8F0" }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center mt-2" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-sm" style={{ color: "#94A3B8" }}>No records found</p>
        </div>
      ) : (
        <div className="relative mt-1">
          {/* Vertical timeline line */}
          <div
            className="absolute left-[5px] top-4 bottom-4 w-0.5"
            style={{ background: "#E2E8F0" }}
          />

          <div className="space-y-0">
            {filtered.map((ev, idx) => {
              const cfg = TYPE_CONFIG[ev.type];
              const date = new Date(ev.eventDate);
              const isExpanded = expanded === ev.refId;

              return (
                <div key={ev.refId + idx} className="relative flex items-start pl-6 py-2">
                  {/* Dot */}
                  <div
                    className="absolute left-0 top-5 w-3 h-3 rounded-full border-2 border-white z-10"
                    style={{ background: cfg.color }}
                  />

                  {/* Card */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : ev.refId)}
                    className="w-full text-left bg-white rounded-xl p-3 transition-shadow"
                    style={{ border: "1px solid #E2E8F0" }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: cfg.color + "18", color: cfg.color }}
                        >
                          {cfg.label}
                        </span>
                        <span className="text-[10px]" style={{ color: "#94A3B8" }}>
                          {date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp size={14} color="#94A3B8" />
                      ) : (
                        <ChevronDown size={14} color="#94A3B8" />
                      )}
                    </div>

                    <p className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                      {ev.title}
                    </p>

                    {ev.doctorName && (
                      <p className="text-[10px] mt-0.5" style={{ color: "#94A3B8" }}>
                        by Dr. {ev.doctorName} · {ev.deptName}
                      </p>
                    )}

                    {ev.detail && (
                      <p
                        className="text-[11px] mt-1"
                        style={{
                          color:
                            ev.type === "lab" && ev.detail.includes("abnormal")
                              ? "#EF4444"
                              : "#64748B",
                          fontStyle: ev.type === "opd" ? "italic" : "normal",
                        }}
                      >
                        {ev.detail}
                      </p>
                    )}

                    {isExpanded && (
                      <div
                        className="mt-2 pt-2 text-[11px]"
                        style={{ borderTop: "1px solid #F1F5F9", color: "#64748B" }}
                      >
                        <p>
                          {ev.type === "opd" && "OPD consultation details available in reports."}
                          {ev.type === "ipd" && "Admission details and discharge summary available."}
                          {ev.type === "lab" && "View full results in My Reports → Lab Reports."}
                          {ev.type === "radiology" && "View imaging report in My Reports → Radiology."}
                        </p>
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalTimeline;
