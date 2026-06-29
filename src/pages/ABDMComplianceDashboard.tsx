import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { ShieldCheck, Users, Link2, FileText, Zap, Stethoscope, Building2, RefreshCw, ExternalLink, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Score weights ────────────────────────────────────────────────────────────
const WEIGHTS = { m1: 25, m2: 25, m3: 20, hcx: 15, hpr: 10, hfr: 5 };

interface MetricData {
  m1: { abhaLinked: number; totalPatients: number; credConfigured: boolean; hfrId: string | null };
  m2: { linked: number; total: number; hipEnabled: boolean };
  m3: { granted: number; requested: number; denied: number; hiuEnabled: boolean };
  hcx: { submissions: number; approved: number; enabled: boolean };
  hpr: { verified: number; totalDoctors: number; unverifiedDoctors: { id: string; full_name: string; department_id: string | null }[] };
  hfr: { hfrId: string | null; registered: boolean };
}

const empty: MetricData = {
  m1: { abhaLinked: 0, totalPatients: 0, credConfigured: false, hfrId: null },
  m2: { linked: 0, total: 0, hipEnabled: false },
  m3: { granted: 0, requested: 0, denied: 0, hiuEnabled: false },
  hcx: { submissions: 0, approved: 0, enabled: false },
  hpr: { verified: 0, totalDoctors: 0, unverifiedDoctors: [] },
  hfr: { hfrId: null, registered: false },
};

function calcScore(d: MetricData): number {
  const m1Score = d.m1.totalPatients > 0
    ? (d.m1.abhaLinked / d.m1.totalPatients) * WEIGHTS.m1
    : (d.m1.credConfigured ? WEIGHTS.m1 * 0.5 : 0);
  const m2Score = d.m2.total > 0
    ? (d.m2.linked / d.m2.total) * WEIGHTS.m2
    : 0;
  const consentTotal = d.m3.granted + d.m3.requested + d.m3.denied;
  const m3Score = consentTotal > 0
    ? (d.m3.granted / consentTotal) * WEIGHTS.m3
    : (d.m3.hiuEnabled ? WEIGHTS.m3 * 0.4 : 0);
  const hcxScore = d.hcx.enabled
    ? (d.hcx.submissions > 0 ? (d.hcx.approved / d.hcx.submissions) * WEIGHTS.hcx : WEIGHTS.hcx * 0.5)
    : 0;
  const hprScore = d.hpr.totalDoctors > 0
    ? (d.hpr.verified / d.hpr.totalDoctors) * WEIGHTS.hpr
    : 0;
  const hfrScore = d.hfr.registered ? WEIGHTS.hfr : (d.hfr.hfrId ? WEIGHTS.hfr * 0.5 : 0);
  return Math.min(100, Math.round(m1Score + m2Score + m3Score + hcxScore + hprScore + hfrScore));
}

// ─── Circular gauge ───────────────────────────────────────────────────────────
function CircularGauge({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e5e7eb" strokeWidth="12" />
      <circle
        cx="70" cy="70" r={r}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="70" y="66" textAnchor="middle" fontSize="26" fontWeight="700" fill={color}>{score}</text>
      <text x="70" y="84" textAnchor="middle" fontSize="11" fill="#6b7280">/ 100</text>
    </svg>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({
  icon: Icon, title, score, maxScore, color, children,
}: {
  icon: React.ElementType; title: string; score: number; maxScore: number; color: string; children: React.ReactNode;
}) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", color)}>
            <Icon size={15} />
          </div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <span className="text-[13px] font-bold text-foreground">{Math.round(score)}<span className="text-muted-foreground font-normal text-[11px]">/{maxScore}pts</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444" }}
        />
      </div>
      <div className="space-y-1.5 text-[12px] text-muted-foreground">{children}</div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string | number; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={cn("font-medium", ok === true ? "text-emerald-600" : ok === false ? "text-red-500" : "text-foreground")}>{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const ABDMComplianceDashboard: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { hospitalId } = useHospitalContext();
  const [data, setData] = useState<MetricData>(empty);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const [
        patRes, abhaRes, ctxRes, consentRes, hcxSubRes,
        doctorRes, hprRes, cfgRes,
      ] = await Promise.all([
        // Total patients
        (supabase as any).from("patients").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        // ABHA-linked patients (distinct patient_id)
        (supabase as any).from("patient_abha_profiles").select("patient_id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        // Care contexts
        (supabase as any).from("abdm_care_contexts").select("status").eq("hospital_id", hospitalId),
        // Consents
        (supabase as any).from("abdm_consents").select("status").eq("hospital_id", hospitalId),
        // HCX submissions this month
        (supabase as any).from("hcx_submissions").select("hcx_status").eq("hospital_id", hospitalId)
          .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        // Total doctors
        (supabase as any).from("users").select("id, full_name, department_id").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true),
        // HPR-verified doctors
        (supabase as any).from("users").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).not("hpr_verified_at", "is", null),
        // ABDM config
        (supabase as any).from("hospital_abdm_config").select("abdm_client_id, hfr_id, feature_hip_enabled, feature_hiu_enabled, feature_hcx_claims, is_production").eq("hospital_id", hospitalId).maybeSingle(),
      ]);

      const totalPatients = patRes?.count ?? 0;
      const abhaLinked = abhaRes?.count ?? 0;
      const cfg = cfgRes?.data ?? {};

      const ctxRows: { status: string }[] = ctxRes?.data ?? [];
      const linkedCtx = ctxRows.filter(c => c.status === "linked").length;

      const consentRows: { status: string }[] = consentRes?.data ?? [];
      const granted = consentRows.filter(c => c.status === "GRANTED").length;
      const requested = consentRows.filter(c => c.status === "REQUESTED").length;
      const denied = consentRows.filter(c => c.status === "DENIED" || c.status === "REVOKED").length;

      const hcxRows: { hcx_status: string }[] = hcxSubRes?.data ?? [];
      const hcxApproved = hcxRows.filter(r => r.hcx_status === "approved" || r.hcx_status === "claim_approved").length;

      const doctors: { id: string; full_name: string; department_id: string | null }[] = doctorRes?.data ?? [];
      const hprVerifiedCount = hprRes?.count ?? 0;
      const unverifiedDoctors = doctors.filter((_, idx) => idx >= hprVerifiedCount);

      setData({
        m1: { abhaLinked, totalPatients, credConfigured: !!cfg.abdm_client_id, hfrId: cfg.hfr_id ?? null },
        m2: { linked: linkedCtx, total: ctxRows.length, hipEnabled: !!cfg.feature_hip_enabled },
        m3: { granted, requested, denied, hiuEnabled: !!cfg.feature_hiu_enabled },
        hcx: { submissions: hcxRows.length, approved: hcxApproved, enabled: !!cfg.feature_hcx_claims },
        hpr: { verified: hprVerifiedCount, totalDoctors: doctors.length, unverifiedDoctors: doctors.slice(hprVerifiedCount) },
        hfr: { hfrId: cfg.hfr_id ?? null, registered: !!cfg.hfr_id },
      });
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const score = calcScore(data);
  const m1s = data.m1.totalPatients > 0 ? (data.m1.abhaLinked / data.m1.totalPatients) * WEIGHTS.m1 : (data.m1.credConfigured ? WEIGHTS.m1 * 0.5 : 0);
  const m2s = data.m2.total > 0 ? (data.m2.linked / data.m2.total) * WEIGHTS.m2 : 0;
  const ct = data.m3.granted + data.m3.requested + data.m3.denied;
  const m3s = ct > 0 ? (data.m3.granted / ct) * WEIGHTS.m3 : (data.m3.hiuEnabled ? WEIGHTS.m3 * 0.4 : 0);
  const hcxs = data.hcx.enabled ? (data.hcx.submissions > 0 ? (data.hcx.approved / data.hcx.submissions) * WEIGHTS.hcx : WEIGHTS.hcx * 0.5) : 0;
  const hprs = data.hpr.totalDoctors > 0 ? (data.hpr.verified / data.hpr.totalDoctors) * WEIGHTS.hpr : 0;
  const hfrs = data.hfr.registered ? WEIGHTS.hfr : (data.hfr.hfrId ? WEIGHTS.hfr * 0.5 : 0);

  return (
    <div className={cn("flex flex-col gap-5", embedded ? "p-0" : "p-6 overflow-y-auto h-full")}>
      {!embedded && (
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base font-bold text-foreground">ABDM Compliance Dashboard</h1>
            <p className="text-[12px] text-muted-foreground">NHA certification readiness scorecard · auto-refreshes every 60s</p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      )}

      {/* Overall score */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row items-center gap-6">
        <CircularGauge score={score} />
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-bold text-foreground">Overall ABDM Compliance Score</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {score >= 80 ? "Eligible to apply for NHA certification" :
               score >= 60 ? "Good progress — address gaps to reach 80% threshold" :
               "Significant setup required before certification"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { label: "M1 (ABHA)", score: m1s, max: WEIGHTS.m1 },
              { label: "M2 (HIP)", score: m2s, max: WEIGHTS.m2 },
              { label: "M3 (Consent)", score: m3s, max: WEIGHTS.m3 },
              { label: "HCX", score: hcxs, max: WEIGHTS.hcx },
              { label: "HPR", score: hprs, max: WEIGHTS.hpr },
              { label: "HFR", score: hfrs, max: WEIGHTS.hfr },
            ] as const).map(({ label, score: s, max }) => (
              <div key={label} className="text-center">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-[13px] font-semibold text-foreground">{Math.round(s)}<span className="text-[10px] text-muted-foreground">/{max}</span></p>
              </div>
            ))}
          </div>
          {score >= 80 && (
            <a
              href="https://sandbox.abdm.gov.in/applications/home/certification"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <ExternalLink size={13} /> Apply for NHA Certification
            </a>
          )}
          {lastRefresh && (
            <p className="text-[10px] text-muted-foreground">Last refreshed: {lastRefresh.toLocaleTimeString()}</p>
          )}
        </div>
      </div>

      {/* Section grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* M1 — ABHA Linkage */}
        <SectionCard icon={Users} title="M1 — ABHA Linkage" score={m1s} maxScore={WEIGHTS.m1} color="bg-blue-100 text-blue-700">
          <Row label="Patients with ABHA" value={`${data.m1.abhaLinked} / ${data.m1.totalPatients}`} ok={data.m1.totalPatients > 0 && data.m1.abhaLinked / data.m1.totalPatients >= 0.8} />
          <Row label="ABDM Credentials" value={data.m1.credConfigured ? "Configured" : "Not configured"} ok={data.m1.credConfigured} />
          <Row label="HFR ID" value={data.m1.hfrId ?? "Not set"} ok={!!data.m1.hfrId} />
          {data.m1.totalPatients > 0 && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round((data.m1.abhaLinked / data.m1.totalPatients) * 100)}%` }} />
            </div>
          )}
        </SectionCard>

        {/* M2 — Care Contexts (HIP) */}
        <SectionCard icon={Link2} title="M2 — Care Contexts (HIP)" score={m2s} maxScore={WEIGHTS.m2} color="bg-violet-100 text-violet-700">
          <Row label="Contexts linked" value={`${data.m2.linked} / ${data.m2.total}`} ok={data.m2.total > 0 && data.m2.linked / data.m2.total >= 0.8} />
          <Row label="HIP enabled" value={data.m2.hipEnabled ? "Yes" : "No"} ok={data.m2.hipEnabled} />
          <Row label="Pending / failed" value={data.m2.total - data.m2.linked} ok={(data.m2.total - data.m2.linked) === 0} />
        </SectionCard>

        {/* M3 — Consent Manager (HIU) */}
        <SectionCard icon={ShieldCheck} title="M3 — Consent Manager (HIU)" score={m3s} maxScore={WEIGHTS.m3} color="bg-emerald-100 text-emerald-700">
          <Row label="Granted consents" value={data.m3.granted} />
          <Row label="Pending requests" value={data.m3.requested} ok={data.m3.requested === 0} />
          <Row label="Denied / revoked" value={data.m3.denied} />
          <Row label="HIU enabled" value={data.m3.hiuEnabled ? "Yes" : "No"} ok={data.m3.hiuEnabled} />
        </SectionCard>

        {/* HCX — Health Claims Exchange */}
        <SectionCard icon={Zap} title="HCX — Claims Exchange" score={hcxs} maxScore={WEIGHTS.hcx} color="bg-amber-100 text-amber-700">
          <Row label="HCX enabled" value={data.hcx.enabled ? "Yes" : "No"} ok={data.hcx.enabled} />
          <Row label="Submissions this month" value={data.hcx.submissions} />
          <Row label="Approved" value={`${data.hcx.approved} / ${data.hcx.submissions}`} ok={data.hcx.submissions > 0 && data.hcx.approved / data.hcx.submissions >= 0.7} />
          {!data.hcx.enabled && (
            <p className="text-[11px] text-amber-600 mt-1">Enable HCX in Settings → ABDM to gain 15 pts</p>
          )}
        </SectionCard>

        {/* HPR — Doctor Verification */}
        <SectionCard icon={Stethoscope} title="HPR — Doctor Verification" score={hprs} maxScore={WEIGHTS.hpr} color="bg-rose-100 text-rose-700">
          <Row label="Doctors HPR-verified" value={`${data.hpr.verified} / ${data.hpr.totalDoctors}`} ok={data.hpr.totalDoctors > 0 && data.hpr.verified === data.hpr.totalDoctors} />
          {data.hpr.unverifiedDoctors.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <p className="text-[11px] font-medium text-foreground">Unverified doctors:</p>
              {data.hpr.unverifiedDoctors.slice(0, 5).map(d => (
                <p key={d.id} className="text-[11px] flex items-center gap-1 text-red-500">
                  <XCircle size={10} /> {d.full_name}
                </p>
              ))}
              {data.hpr.unverifiedDoctors.length > 5 && (
                <p className="text-[11px] text-muted-foreground">+{data.hpr.unverifiedDoctors.length - 5} more — verify in Settings → Staff</p>
              )}
            </div>
          )}
          {data.hpr.verified === data.hpr.totalDoctors && data.hpr.totalDoctors > 0 && (
            <div className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> All doctors verified</div>
          )}
        </SectionCard>

        {/* HFR — Facility Registry */}
        <SectionCard icon={Building2} title="HFR — Facility Registry" score={hfrs} maxScore={WEIGHTS.hfr} color="bg-cyan-100 text-cyan-700">
          <Row label="HFR ID" value={data.hfr.hfrId ?? "Not set"} ok={!!data.hfr.hfrId} />
          <Row label="Registration status" value={data.hfr.registered ? "Registered" : "Not registered"} ok={data.hfr.registered} />
          {!data.hfr.hfrId && (
            <p className="text-[11px] text-cyan-700 mt-1">Set HFR ID in Settings → ABDM to gain {WEIGHTS.hfr} pts</p>
          )}
        </SectionCard>

      </div>
    </div>
  );
};

export default ABDMComplianceDashboard;
