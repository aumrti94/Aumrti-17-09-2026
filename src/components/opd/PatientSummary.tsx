import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Stethoscope, Phone, ExternalLink, X } from "lucide-react";
import type { OpdToken } from "@/pages/opd/OPDPage";

interface Props {
  token: OpdToken | null;
  hospitalId: string | null;
  onClose?: () => void;
}

interface VitalRow {
  visit_date: string;
  vitals: Record<string, unknown> | null;
}

const PatientSummary: React.FC<Props> = ({ token, hospitalId, onClose }) => {
  const navigate = useNavigate();
  const [pastVitals, setPastVitals] = useState<VitalRow[]>([]);
  const [pendingLabs, setPendingLabs] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const [{ data }, { data: rxData }] = await Promise.all([
        supabase
          .from("opd_encounters")
          .select("visit_date, vitals")
          .eq("patient_id", token.patient_id)
          .order("visit_date", { ascending: false })
          .limit(3),
        supabase
          .from("prescriptions")
          .select("lab_orders, radiology_orders")
          .eq("patient_id", token.patient_id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      setPastVitals((data as VitalRow[]) || []);

      if (rxData && rxData.length > 0) {
        const labs = (rxData[0].lab_orders as unknown as { test_name: string }[]) || [];
        const rads = (rxData[0].radiology_orders as unknown as { study_name: string }[]) || [];
        setPendingLabs([...labs.map((l) => l.test_name), ...rads.map((r) => r.study_name)]);
      } else {
        setPendingLabs([]);
      }
    })();
  }, [token?.patient_id]);

  if (!token) {
    return (
      <div className="w-80 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col items-center justify-center">
        <Stethoscope className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-[13px] text-slate-400">Patient details will appear here</p>
      </div>
    );
  }

  const initials = (token.patient?.full_name || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const patientAge = token.patient?.dob
    ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000)
    : null;

  const conditions = token.patient?.chronic_conditions || [];
  const allergies = token.patient?.allergies;

  return (
    <div className="w-80 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto">
      {/* Patient card */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-[#1A2F5A] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-slate-900">{token.patient?.full_name}</p>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-px rounded">{token.patient?.uhid}</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="flex-shrink-0 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-3 space-y-1 text-xs text-slate-600">
          <p>{patientAge !== null ? `${patientAge}y` : "—"} · {token.patient?.gender || "—"}{token.patient?.blood_group ? ` · ${token.patient.blood_group}` : ""}</p>
          {token.patient?.phone && (
            <a href={`tel:${token.patient.phone}`} className="flex items-center gap-1 text-[#1A2F5A] hover:underline">
              <Phone className="h-3 w-3" />{token.patient.phone}
            </a>
          )}
        </div>
      </div>

      {/* Active conditions */}
      <Section label="Active Conditions">
        {conditions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {conditions.map((c) => (
              <span key={c} className="text-[11px] bg-blue-50 text-[#1A2F5A] rounded-full px-2 py-0.5">{c}</span>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">—</span>}
      </Section>

      {/* Allergies */}
      <Section label="Known Allergies">
        {allergies ? (
          <div className="flex flex-wrap gap-1">
            {allergies.split(",").map((a, i) => (
              <span key={i} className="text-[11px] bg-red-50 text-red-600 rounded-full px-2 py-0.5">{a.trim()}</span>
            ))}
          </div>
        ) : <span className="text-xs text-emerald-500">No known allergies</span>}
      </Section>

      {/* Insurance */}
      <Section label="Insurance / TPA">
        <span className="text-xs text-slate-600">{token.patient?.insurance_id || "Self-pay"}</span>
      </Section>

      {/* Recent vitals */}
      <Section label="Recent Vitals">
        {pastVitals.length > 0 ? (
          <div className="space-y-1.5">
            {pastVitals.map((v, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-400 w-16">{new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                <span className="text-slate-600">
                  {v.vitals ? `BP: ${v.vitals.bp_systolic || "—"}/${v.vitals.bp_diastolic || "—"} · P: ${v.vitals.pulse || "—"} · Wt: ${v.vitals.weight_kg || "—"}` : "No vitals"}
                </span>
              </div>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">No previous vitals</span>}
      </Section>

      {/* Pending orders */}
      <Section label="Pending">
        {pendingLabs.length > 0 ? (
          <div className="space-y-1">
            {pendingLabs.map((l, i) => (
              <span key={i} className="text-[11px] text-slate-600 block">• {l}</span>
            ))}
          </div>
        ) : <span className="text-xs text-slate-400">No pending orders</span>}
      </Section>

      {/* View full patient record link */}
      <div className="px-4 py-3 mt-auto">
        <button
          onClick={() => navigate(`/patients?id=${token.patient_id}`)}
          className="flex items-center gap-1 text-[13px] text-[#1A2F5A] font-medium hover:underline"
        >
          View Full Patient Record <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="px-4 py-3 border-b border-slate-100">
    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{label}</label>
    {children}
  </div>
);

export default PatientSummary;
