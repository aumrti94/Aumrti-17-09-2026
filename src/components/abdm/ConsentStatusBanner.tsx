import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, Link2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface Props {
  patientId: string;
  className?: string;
}

interface BannerState {
  hasAbha: boolean;
  abhaAddress: string | null;
  linkedCount: number;
  totalCount: number;
  lastLinkedAt: string | null;
  activeConsentCount: number;
}

const ConsentStatusBanner: React.FC<Props> = ({ patientId, className }) => {
  const navigate = useNavigate();
  const [state, setState] = useState<BannerState | null>(null);

  useEffect(() => {
    if (!patientId) return;

    const load = async () => {
      const [profileRes, contextsRes, consentsRes] = await Promise.all([
        supabase
          .from("patient_abha_profiles")
          .select("abha_address, abha_number")
          .eq("patient_id", patientId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("abdm_care_contexts")
          .select("link_status, linked_at")
          .eq("patient_id", patientId),
        supabase
          .from("abdm_consents")
          .select("id", { count: "exact", head: true })
          .eq("patient_id", patientId)
          .eq("status", "GRANTED"),
      ]);

      const profile = profileRes.data;
      if (!profile?.abha_address && !profile?.abha_number) {
        setState({ hasAbha: false, abhaAddress: null, linkedCount: 0, totalCount: 0, lastLinkedAt: null, activeConsentCount: 0 });
        return;
      }

      const ctxs = contextsRes.data ?? [];
      const linked = ctxs.filter(c => c.link_status === "linked");
      const lastLinkedAt = linked
        .map(c => c.linked_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

      setState({
        hasAbha: true,
        abhaAddress: profile.abha_address ?? null,
        linkedCount: linked.length,
        totalCount: ctxs.length,
        lastLinkedAt,
        activeConsentCount: consentsRes.count ?? 0,
      });
    };

    load();
  }, [patientId]);

  if (!state || !state.hasAbha) return null;

  const hasUnlinked = state.totalCount > 0 && state.linkedCount < state.totalCount;

  return (
    <div className={cn(
      "shrink-0 flex items-center gap-3 px-5 py-1.5 border-b text-[11px]",
      hasUnlinked ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-100",
      className
    )}>
      <ShieldCheck className={cn("h-3.5 w-3.5 shrink-0", hasUnlinked ? "text-amber-600" : "text-emerald-600")} />

      <div className="flex items-center gap-3 flex-1 flex-wrap">
        <span className={cn("font-medium", hasUnlinked ? "text-amber-800" : "text-emerald-800")}>
          ABHA: {state.abhaAddress ?? "Linked"}
        </span>

        {state.totalCount > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Link2 className="h-3 w-3" />
            {state.linkedCount}/{state.totalCount} records linked
          </span>
        )}

        {state.lastLinkedAt && (
          <span className="text-muted-foreground">
            Last linked {new Date(state.lastLinkedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
        )}

        {state.activeConsentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-violet-700">
            <ShieldCheck className="h-3 w-3" />
            {state.activeConsentCount} active consent{state.activeConsentCount !== 1 ? "s" : ""}
          </span>
        )}

        {hasUnlinked && (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertCircle className="h-3 w-3" />
            {state.totalCount - state.linkedCount} pending
          </span>
        )}
      </div>

      <button
        onClick={() => navigate("/abdm")}
        className={cn(
          "shrink-0 text-[10px] font-medium hover:underline",
          hasUnlinked ? "text-amber-700" : "text-emerald-700"
        )}
      >
        Manage →
      </button>
    </div>
  );
};

export default ConsentStatusBanner;
