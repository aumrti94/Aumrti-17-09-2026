import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { checkClinicianCredential } from "@/lib/credentialGate";

interface GuardContext {
  clinicianId: string;
  module: string;   // lab | radiology | nursing
  action: string;   // validate_result | validate_report | medication_admin
  recordId?: string | null;
}

/**
 * Reusable license-validity gate for high-risk clinical sign-offs. Mirrors the
 * OT privilege gate: if the acting clinician's license is expired/missing, the
 * action is blocked until an override reason is recorded (audited in
 * credential_override_log). Otherwise the action runs immediately.
 *
 *   const { guard, gateElement } = useCredentialGate(hospitalId);
 *   const doValidate = () => { ...existing sign-off... };
 *   guard({ clinicianId, module: "lab", action: "validate_result", recordId }, doValidate);
 *   // render {gateElement} once in the component tree
 */
export function useCredentialGate(hospitalId: string | null) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [gateReason, setGateReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ ctx: GuardContext; proceed: () => void } | null>(null);

  const guard = useCallback(async (ctx: GuardContext, proceed: () => void) => {
    if (!hospitalId || !ctx.clinicianId) { proceed(); return; }
    const res = await checkClinicianCredential(hospitalId, ctx.clinicianId);
    if (!res.blocked) { proceed(); return; }
    setGateReason(res.reason);
    setReason("");
    setPending({ ctx, proceed });
    setOpen(true);
  }, [hospitalId]);

  const cancel = () => { setOpen(false); setPending(null); setReason(""); };

  const confirm = async () => {
    if (!pending) return;
    if (!reason.trim()) { toast({ title: "Override reason required", variant: "destructive" }); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    await (supabase as any).from("credential_override_log").insert({
      hospital_id: hospitalId,
      clinician_id: pending.ctx.clinicianId,
      acting_user_id: cu?.id || null,
      module: pending.ctx.module,
      action: pending.ctx.action,
      record_id: pending.ctx.recordId || null,
      reason: reason.trim(),
    });
    setSaving(false);
    const proceed = pending.proceed;
    setOpen(false);
    setPending(null);
    toast({ title: "Credential override recorded" });
    proceed();
  };

  const gateElement = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full p-5 border border-red-200 dark:border-red-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800 dark:text-red-300">Credential Check Failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">{gateReason}. To proceed with this sign-off, record an override reason (this is audited).</p>
            <textarea
              className="w-full text-xs border border-red-300 dark:border-red-800 rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 mt-2 focus:outline-none focus:ring-1 focus:ring-red-500"
              rows={3}
              placeholder="Override justification (required)…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={cancel} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50">Cancel</button>
              <button onClick={confirm} disabled={saving}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                <CheckCircle2 size={13} />{saving ? "Recording…" : "Override & Proceed"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { guard, gateElement };
}
