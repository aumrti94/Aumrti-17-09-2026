import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, Link2, Unlink, ShieldCheck, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Props {
  patientId: string;
  hospitalId: string;
  existingAbhaId?: string | null;
  onLinked?: (abhaId: string) => void;
  onUnlinked?: () => void;
}

interface ConsentLog {
  id: string;
  consent_type: string;
  consent_given: boolean;
  consent_at: string;
  abha_id: string;
  remarks: string | null;
  giver: { full_name: string } | null;
}

const ABHASearchPanel: React.FC<Props> = ({ patientId, hospitalId, existingAbhaId, onLinked, onUnlinked }) => {
  const { toast } = useToast();
  const [abhaInput, setAbhaInput] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "verifying" | "valid" | "sandbox" | "invalid">("idle");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [linking, setLinking] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [currentAbhaId, setCurrentAbhaId] = useState(existingAbhaId || null);
  const [consentLogs, setConsentLogs] = useState<ConsentLog[]>([]);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  const fetchConsentLogs = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("abdm_consent_logs")
      .select("*, giver:users!abdm_consent_logs_consent_given_by_fkey(full_name)")
      .eq("patient_id", patientId)
      .order("consent_at", { ascending: false })
      .limit(10);
    setConsentLogs(data || []);
  }, [patientId]);

  useEffect(() => { fetchConsentLogs(); }, [fetchConsentLogs]);
  useEffect(() => { setCurrentAbhaId(existingAbhaId || null); }, [existingAbhaId]);

  const handleVerify = async () => {
    const num = abhaInput.trim();
    if (!num) return;
    setVerifyState("verifying");
    try {
      const { data, error } = await supabase.functions.invoke("abdm-abha-verify", {
        body: { abha_number: num },
      });
      if (error) throw error;
      if (data?.verified && data?.mode === "live") {
        setVerifyState("valid");
        setVerifyMessage("Verified with ABDM");
      } else if (data?.verified && data?.mode === "sandbox_format_only") {
        setVerifyState("sandbox");
        setVerifyMessage(data.message || "Format valid (sandbox — live verification needs ABDM credentials)");
      } else {
        setVerifyState("invalid");
        setVerifyMessage(data?.message || data?.error || "Invalid ABHA format");
      }
    } catch (e: any) {
      setVerifyState("invalid");
      setVerifyMessage(e?.message || "Verification service unavailable");
    }
  };

  const handleLink = async () => {
    if (!consentChecked || !abhaInput.trim()) return;
    setLinking(true);
    try {
      const { error: pErr } = await supabase
        .from("patients")
        .update({
          abha_id: abhaInput.trim(),
          abha_verified: verifyState === "valid",
          abha_verified_at: verifyState === "valid" ? new Date().toISOString() : null,
        } as any)
        .eq("id", patientId);
      if (pErr) throw pErr;

      await (supabase as any).from("abdm_consent_logs").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        abha_id: abhaInput.trim(),
        consent_type: "linking",
        consent_given: true,
        consent_given_by: currentUserId,
        remarks: `Linked ${abhaInput.trim()}${verifyState === "valid" ? " — live verified" : " — format validated"}`,
      });

      setCurrentAbhaId(abhaInput.trim());
      setAbhaInput("");
      setVerifyState("idle");
      setConsentChecked(false);
      toast({ title: `ABHA ID linked: ${abhaInput.trim()}` });
      onLinked?.(abhaInput.trim());
      fetchConsentLogs();
    } catch (e: any) {
      toast({ title: "Linking failed", description: e.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      await supabase.from("patients").update({ abha_id: null, abha_verified: false } as any).eq("id", patientId);
      await (supabase as any).from("abdm_consent_logs").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        abha_id: currentAbhaId,
        consent_type: "linking",
        consent_given: false,
        consent_given_by: currentUserId,
        remarks: `ABHA ID ${currentAbhaId} unlinked by staff`,
      });
      setCurrentAbhaId(null);
      setShowUnlinkConfirm(false);
      toast({ title: "ABHA ID unlinked" });
      onUnlinked?.();
      fetchConsentLogs();
    } catch (e: any) {
      toast({ title: "Unlink failed", description: e.message, variant: "destructive" });
    } finally {
      setUnlinking(false);
    }
  };

  const canLink = (verifyState === "valid" || verifyState === "sandbox") && consentChecked && !linking;

  return (
    <div className="space-y-4">

      {currentAbhaId ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-800">ABHA ID Linked</p>
                <p className="text-sm font-mono text-emerald-700">{currentAbhaId}</p>
              </div>
            </div>
            {!showUnlinkConfirm ? (
              <button
                onClick={() => setShowUnlinkConfirm(true)}
                className="text-[11px] text-rose-600 hover:text-rose-700 font-medium flex items-center gap-1 border border-rose-200 rounded-lg px-2 py-1 hover:bg-rose-50 transition-colors"
              >
                <Unlink size={11} /> Unlink
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-rose-700 font-semibold">Confirm unlink?</p>
                <button onClick={handleUnlink} disabled={unlinking}
                  className="text-[11px] bg-rose-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors">
                  {unlinking ? "Unlinking…" : "Yes, Unlink"}
                </button>
                <button onClick={() => setShowUnlinkConfirm(false)}
                  className="text-[11px] text-muted-foreground px-2 py-1 rounded-lg border border-border hover:bg-muted transition-colors">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={abhaInput}
              onChange={(e) => { setAbhaInput(e.target.value); setVerifyState("idle"); setConsentChecked(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="14-digit ABHA number or name@abdm"
              className="flex-1 h-9 px-3 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleVerify}
              disabled={!abhaInput.trim() || verifyState === "verifying"}
              className="px-3 h-9 text-sm font-medium border border-border rounded-lg bg-card hover:bg-accent/10 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {verifyState === "verifying" && <Loader2 size={13} className="animate-spin" />}
              Verify
            </button>
          </div>

          {verifyState === "valid" && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              <CheckCircle2 size={12} /> {verifyMessage}
            </div>
          )}
          {verifyState === "sandbox" && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800">
              <AlertTriangle size={12} /> {verifyMessage}
            </div>
          )}
          {verifyState === "invalid" && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-800">
              <XCircle size={12} /> {verifyMessage}
            </div>
          )}

          {(verifyState === "valid" || verifyState === "sandbox") && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
                <p className="text-[11px] text-blue-800 leading-relaxed">
                  <strong>Consent Notice:</strong> By linking this ABHA ID, the patient consents to their health records being shared with this facility via ABDM. <strong>Verbal consent from the patient must be confirmed</strong> before proceeding.
                </p>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[12px] text-foreground">
                  Patient has given <strong>verbal consent</strong> to ABHA linking and health record sharing with this facility
                </span>
              </label>
              <button
                onClick={handleLink}
                disabled={!canLink}
                className="flex items-center gap-1.5 text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Link2 size={14} />
                {linking ? "Linking…" : "Link ABHA to this Patient"}
              </button>
            </div>
          )}
        </div>
      )}

      {consentLogs.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Consent History</p>
          <div className="space-y-1.5">
            {consentLogs.map((log) => (
              <div key={log.id} className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-[11px]",
                log.consent_given ? "bg-emerald-50 border border-emerald-100" : "bg-slate-50 border border-slate-200"
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  {log.consent_given
                    ? <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                    : <XCircle size={11} className="text-slate-400 shrink-0" />}
                  <span className="font-mono text-slate-600 truncate">{log.abha_id}</span>
                  <span className="text-muted-foreground capitalize shrink-0">{log.consent_type.replace("_", " ")}</span>
                </div>
                <div className="text-right text-muted-foreground shrink-0 ml-2">
                  <p>{formatDistanceToNow(new Date(log.consent_at), { addSuffix: true })}</p>
                  {log.giver?.full_name && <p className="text-[10px]">by {log.giver.full_name}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};

export default ABHASearchPanel;
