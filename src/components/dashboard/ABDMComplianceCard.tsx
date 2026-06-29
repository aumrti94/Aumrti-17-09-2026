import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface Props { hospitalId: string }

const ABDMComplianceCard: React.FC<Props> = ({ hospitalId }) => {
  const navigate = useNavigate();
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      try {
        const [patRes, abhaRes, ctxRes, doctRes, hprRes, cfgRes] = await Promise.all([
          (supabase as any).from("patients").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
          (supabase as any).from("patient_abha_profiles").select("patient_id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
          (supabase as any).from("abdm_care_contexts").select("link_status").eq("hospital_id", hospitalId),
          (supabase as any).from("users").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true),
          (supabase as any).from("users").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).not("hpr_verified_at", "is", null),
          (supabase as any).from("hospital_abdm_config").select("abdm_client_id, hfr_id, feature_hcx_claims").eq("hospital_id", hospitalId).maybeSingle(),
        ]);

        const totalPat = patRes?.count ?? 0;
        const abhaPat = abhaRes?.count ?? 0;
        const ctxRows: { link_status: string }[] = ctxRes?.data ?? [];
        const linkedCtx = ctxRows.filter(c => c.link_status === "linked").length;
        const totalDoctors = doctRes?.count ?? 0;
        const hprVerified = hprRes?.count ?? 0;
        const cfg = cfgRes?.data ?? {};

        const m1 = totalPat > 0 ? (abhaPat / totalPat) * 25 : (cfg.abdm_client_id ? 12.5 : 0);
        const m2 = ctxRows.length > 0 ? (linkedCtx / ctxRows.length) * 25 : 0;
        const hcx = cfg.feature_hcx_claims ? 7.5 : 0;
        const hpr = totalDoctors > 0 ? (hprVerified / totalDoctors) * 10 : 0;
        const hfr = cfg.hfr_id ? 5 : 0;

        setScore(Math.min(100, Math.round(m1 + m2 + hcx + hpr + hfr)));
      } finally {
        setLoading(false);
      }
    })();
  }, [hospitalId]);

  const color = score === null ? "text-muted-foreground" :
    score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-500";
  const bg = score === null ? "bg-muted/30" :
    score >= 80 ? "bg-emerald-50 border-emerald-200" : score >= 60 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <button
      onClick={() => navigate("/abdm?tab=compliance")}
      className={cn("w-full text-left rounded-xl border p-4 flex items-center gap-4 hover:opacity-90 transition-opacity", bg)}
    >
      <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", score !== null && score >= 80 ? "bg-emerald-100" : score !== null && score >= 60 ? "bg-amber-100" : "bg-red-100")}>
        <ShieldCheck size={20} className={color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground">ABDM Compliance</p>
        {loading ? (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        ) : (
          <p className={cn("text-[11px] font-medium", color)}>
            {score}% — {score !== null && score >= 80 ? "Certification ready" : score !== null && score >= 60 ? "Good progress" : "Setup needed"}
          </p>
        )}
      </div>
      {!loading && score !== null && (
        <span className={cn("text-xl font-bold", color)}>{score}</span>
      )}
      <ExternalLink size={13} className="text-muted-foreground shrink-0" />
    </button>
  );
};

export default ABDMComplianceCard;
