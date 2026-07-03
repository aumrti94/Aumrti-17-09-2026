import React, { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Check, AlertTriangle, Trash2 } from "lucide-react";
import SignaturePad from "@/components/ui/SignaturePad";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface Props {
  schedule: OTSchedule;
  onRefresh: () => void;
}

interface ChecklistData {
  id: string;
  signin_patient_identity: boolean;
  signin_site_marked: boolean;
  signin_consent_signed: boolean;
  signin_anaesthesia_checked: boolean;
  signin_pulse_oximeter: boolean;
  signin_allergies_known: boolean;
  signin_difficult_airway: boolean;
  signin_blood_loss_risk: boolean;
  signin_completed_at: string | null;
  signin_completed_by: string | null;
  signin_signature: string | null;
  timeout_team_introduced: boolean;
  timeout_patient_confirmed: boolean;
  timeout_procedure_confirmed: boolean;
  timeout_site_confirmed: boolean;
  timeout_imaging_displayed: boolean;
  timeout_antibiotics_given: boolean;
  timeout_anticoagulation: boolean;
  timeout_equipment_issues: boolean;
  timeout_completed_at: string | null;
  timeout_completed_by: string | null;
  timeout_signature: string | null;
  signout_procedure_recorded: boolean;
  signout_instrument_count: boolean;
  signout_swab_count: boolean;
  signout_specimen_labelled: boolean;
  signout_equipment_issues: boolean;
  signout_recovery_handover: boolean;
  signout_completed_at: string | null;
  signout_completed_by: string | null;
  signout_signature: string | null;
  compliance_percentage: number;
  skip_reason: string | null;
  skip_reason_by: string | null;
  skip_reason_at: string | null;
}

interface OTInstrumentCount {
  id: string;
  count_type: "instrument" | "sponge" | "needle";
  opening_count: number | null;
  closing_count: number | null;
  discrepancy_notes: string | null;
}

const COUNT_TYPES: OTInstrumentCount["count_type"][] = ["instrument", "sponge", "needle"];

// Maps a WHO Sign Out checkbox to the count row that must be complete before it can be checked
const COUNT_GATE: Record<string, OTInstrumentCount["count_type"]> = {
  signout_instrument_count: "instrument",
  signout_swab_count: "sponge",
};

export const SIGNIN_ITEMS: { key: string; label: string }[] = [
  { key: "signin_patient_identity", label: "Patient identity confirmed" },
  { key: "signin_site_marked", label: "Surgical site marked" },
  { key: "signin_consent_signed", label: "Patient consent signed" },
  { key: "signin_anaesthesia_checked", label: "Anaesthesia machine checked" },
  { key: "signin_pulse_oximeter", label: "Pulse oximeter working" },
  { key: "signin_allergies_known", label: "Known allergies confirmed" },
  { key: "signin_difficult_airway", label: "Difficult airway risk assessed" },
  { key: "signin_blood_loss_risk", label: "Blood loss risk assessed" },
];

export const TIMEOUT_ITEMS: { key: string; label: string }[] = [
  { key: "timeout_team_introduced", label: "Team introductions done" },
  { key: "timeout_patient_confirmed", label: "Patient identity re-confirmed" },
  { key: "timeout_procedure_confirmed", label: "Procedure confirmed" },
  { key: "timeout_site_confirmed", label: "Surgical site re-confirmed" },
  { key: "timeout_imaging_displayed", label: "Imaging displayed" },
  { key: "timeout_antibiotics_given", label: "Prophylactic antibiotics given" },
  { key: "timeout_anticoagulation", label: "Anticoagulation considered" },
  { key: "timeout_equipment_issues", label: "Equipment concerns addressed" },
];

export const SIGNOUT_ITEMS: { key: string; label: string }[] = [
  { key: "signout_procedure_recorded", label: "Procedure recorded in notes" },
  { key: "signout_instrument_count", label: "Instrument count correct" },
  { key: "signout_swab_count", label: "Swab count correct" },
  { key: "signout_specimen_labelled", label: "Specimen labelled correctly" },
  { key: "signout_equipment_issues", label: "Equipment issues noted" },
  { key: "signout_recovery_handover", label: "Recovery team briefed" },
];

const ALL_KEYS = [...SIGNIN_ITEMS, ...TIMEOUT_ITEMS, ...SIGNOUT_ITEMS].map((i) => i.key);

const PHASE_LABEL: Record<"signin" | "timeout" | "signout", string> = {
  signin: "Sign In",
  timeout: "Time Out",
  signout: "Sign Out",
};

const WHOChecklistTab: React.FC<Props> = ({ schedule, onRefresh }) => {
  const { toast } = useToast();
  const [cl, setCl] = useState<ChecklistData | null>(null);
  const [signingPhase, setSigningPhase] = useState<"signin" | "timeout" | "signout" | null>(null);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [sigClearCount, setSigClearCount] = useState(0);
  const [savingSig, setSavingSig] = useState(false);
  const [showSkipForm, setShowSkipForm] = useState(false);
  const [skipReasonText, setSkipReasonText] = useState("");
  const [savingSkip, setSavingSkip] = useState(false);
  const [counts, setCounts] = useState<OTInstrumentCount[]>([]);

  const fetchCounts = useCallback(async () => {
    const { data } = await supabase
      .from("ot_instrument_counts")
      .select("id, count_type, opening_count, closing_count, discrepancy_notes")
      .eq("ot_schedule_id", schedule.id);

    const existingTypes = new Set((data || []).map((c: any) => c.count_type));
    const missing = COUNT_TYPES.filter((t) => !existingTypes.has(t));
    let rows = (data as OTInstrumentCount[]) || [];

    if (missing.length > 0) {
      const hid = (await supabase.rpc("get_user_hospital_id")) as any;
      const { data: created } = await supabase
        .from("ot_instrument_counts")
        .insert(missing.map((count_type) => ({ hospital_id: hid.data, ot_schedule_id: schedule.id, count_type })))
        .select("id, count_type, opening_count, closing_count, discrepancy_notes");
      rows = [...rows, ...((created as OTInstrumentCount[]) || [])];
    }
    setCounts(rows);
  }, [schedule.id]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  const isCountComplete = (type: OTInstrumentCount["count_type"]) => {
    const row = counts.find((c) => c.count_type === type);
    if (!row || row.opening_count === null || row.closing_count === null) return false;
    if (row.opening_count !== row.closing_count && !row.discrepancy_notes?.trim()) return false;
    return true;
  };

  const updateCount = async (type: OTInstrumentCount["count_type"], field: "opening_count" | "closing_count", value: number | null) => {
    const row = counts.find((c) => c.count_type === type);
    if (!row) return;
    setCounts((prev) => prev.map((c) => (c.count_type === type ? { ...c, [field]: value } : c)));
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("ot_instrument_counts").update({ [field]: value, counted_by: user?.id || null }).eq("id", row.id);
  };

  const updateDiscrepancyNotesLocal = (type: OTInstrumentCount["count_type"], value: string) => {
    setCounts((prev) => prev.map((c) => (c.count_type === type ? { ...c, discrepancy_notes: value } : c)));
  };

  const persistDiscrepancyNotes = async (type: OTInstrumentCount["count_type"]) => {
    const row = counts.find((c) => c.count_type === type);
    if (!row) return;
    await supabase.from("ot_instrument_counts").update({ discrepancy_notes: row.discrepancy_notes }).eq("id", row.id);
  };

  const fetchChecklist = useCallback(async () => {
    let { data } = await supabase
      .from("ot_checklists")
      .select("*")
      .eq("ot_schedule_id", schedule.id)
      .maybeSingle();

    if (!data) {
      const hid = (await supabase.rpc("get_user_hospital_id")) as any;
      const { data: created } = await supabase
        .from("ot_checklists")
        .insert({ hospital_id: hid.data, ot_schedule_id: schedule.id })
        .select("*")
        .maybeSingle();
      data = created;
    }
    setCl(data as any);
  }, [schedule.id]);

  useEffect(() => { fetchChecklist(); }, [fetchChecklist]);

  if (!cl) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading checklist...</div>;

  const toggleItem = async (key: string) => {
    const current = (cl as any)[key];
    const gateType = COUNT_GATE[key];
    if (!current && gateType && !isCountComplete(gateType)) {
      toast({
        title: "Enter opening & closing count first",
        description: `Complete the ${gateType} count below (and explain any mismatch) before marking this correct.`,
      });
      return;
    }
    const update = { [key]: !current } as any;

    // Recalculate compliance
    const newCl = { ...cl, ...update };
    const checked = ALL_KEYS.filter((k) => (newCl as any)[k] === true).length;
    update.compliance_percentage = Math.round((checked / ALL_KEYS.length) * 100);

    await supabase.from("ot_checklists").update(update).eq("id", cl.id);
    setCl({ ...newCl, compliance_percentage: update.compliance_percentage });
  };

  const startSigning = (phase: "signin" | "timeout" | "signout") => {
    setSigningPhase(phase);
    setSigDataUrl(null);
    setSigClearCount((c) => c + 1);
  };

  const confirmSignAndComplete = async () => {
    if (!signingPhase || !sigDataUrl || !cl) return;
    setSavingSig(true);
    const { data: { user } } = await supabase.auth.getUser();
    const update: any = {
      [`${signingPhase}_completed_at`]: new Date().toISOString(),
      [`${signingPhase}_completed_by`]: user?.id || null,
      [`${signingPhase}_signature`]: sigDataUrl,
    };
    await supabase.from("ot_checklists").update(update).eq("id", cl.id);
    setCl({ ...cl, ...update });
    toast({ title: `${PHASE_LABEL[signingPhase]} completed ✓ (signed)` });
    setSigningPhase(null);
    setSigDataUrl(null);
    setSavingSig(false);
  };

  const saveSkipReason = async () => {
    if (!skipReasonText.trim() || !cl) return;
    setSavingSkip(true);
    const { data: { user } } = await supabase.auth.getUser();
    const update: any = {
      skip_reason: skipReasonText.trim(),
      skip_reason_by: user?.id || null,
      skip_reason_at: new Date().toISOString(),
    };
    await supabase.from("ot_checklists").update(update).eq("id", cl.id);
    setCl({ ...cl, ...update });
    toast({ title: "Exception documented", description: "Reason recorded for this incomplete checklist item." });
    setShowSkipForm(false);
    setSkipReasonText("");
    setSavingSkip(false);
  };

  const signinDone = SIGNIN_ITEMS.every((i) => (cl as any)[i.key]);
  const timeoutDone = TIMEOUT_ITEMS.every((i) => (cl as any)[i.key]);
  const signoutDone = SIGNOUT_ITEMS.every((i) => (cl as any)[i.key]);

  const signinCompleted = !!cl.signin_completed_at;
  const timeoutCompleted = !!cl.timeout_completed_at;
  const signoutCompleted = !!cl.signout_completed_at;

  const totalChecked = ALL_KEYS.filter((k) => (cl as any)[k] === true).length;

  const renderPhase = (
    title: string, subtitle: string, items: { key: string; label: string }[],
    headerBg: string, headerBorder: string, headerText: string,
    allDone: boolean, phaseCompleted: boolean, locked: boolean,
    phase: "signin" | "timeout" | "signout"
  ) => (
    <div className="flex-1 flex flex-col min-w-0 border-r border-border last:border-r-0">
      <div className={cn("px-3 py-2 border-b-2 flex-shrink-0", headerBg, headerBorder)}>
        <p className={cn("text-xs font-bold uppercase", headerText)}>{title}</p>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex-1 overflow-y-auto relative">
        {locked && (
          <div className="absolute inset-0 bg-background/70 z-10 flex items-center justify-center">
            <p className="text-[13px] text-muted-foreground font-medium">
              Complete {phase === "timeout" ? "Sign In" : "Time Out"} first
            </p>
          </div>
        )}
        {items.map((item) => {
          const checked = (cl as any)[item.key];
          return (
            <button
              key={item.key}
              onClick={() => !locked && !phaseCompleted && toggleItem(item.key)}
              disabled={locked || phaseCompleted}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2.5 text-left border-b border-border/50 transition-colors",
                !locked && !phaseCompleted && "hover:bg-muted/50 cursor-pointer",
                (locked || phaseCompleted) && "cursor-default opacity-60"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30 bg-background"
              )}>
                {checked && <Check size={14} className="text-white" />}
              </div>
              <span className={cn("text-[13px]", checked ? "text-foreground" : "text-foreground/80")}>
                {item.label}
              </span>
            </button>
          );
        })}

        {phase === "signout" && (
          <div className="border-t border-border px-3 py-2 space-y-2.5 bg-muted/20">
            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wide">Instrument / Sponge / Needle Count</p>
            {COUNT_TYPES.map((type) => {
              const row = counts.find((c) => c.count_type === type);
              const hasBoth = row?.opening_count !== null && row?.opening_count !== undefined && row?.closing_count !== null && row?.closing_count !== undefined;
              const mismatch = hasBoth && row!.opening_count !== row!.closing_count;
              return (
                <div key={type} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium capitalize w-16 flex-shrink-0">{type}</span>
                    <input
                      type="number" min={0} placeholder="Open"
                      disabled={phaseCompleted}
                      value={row?.opening_count ?? ""}
                      onChange={(e) => updateCount(type, "opening_count", e.target.value === "" ? null : Number(e.target.value))}
                      className="w-14 text-[11px] border border-border rounded px-1.5 py-1 bg-background disabled:opacity-60"
                    />
                    <span className="text-[10px] text-muted-foreground">→</span>
                    <input
                      type="number" min={0} placeholder="Close"
                      disabled={phaseCompleted}
                      value={row?.closing_count ?? ""}
                      onChange={(e) => updateCount(type, "closing_count", e.target.value === "" ? null : Number(e.target.value))}
                      className="w-14 text-[11px] border border-border rounded px-1.5 py-1 bg-background disabled:opacity-60"
                    />
                    {mismatch ? (
                      <span className="text-[10px] text-red-500 font-semibold">⚠ Mismatch</span>
                    ) : hasBoth ? (
                      <span className="text-[10px] text-emerald-600 font-semibold">✓ Match</span>
                    ) : null}
                  </div>
                  {mismatch && (
                    <textarea
                      value={row?.discrepancy_notes || ""}
                      disabled={phaseCompleted}
                      onChange={(e) => updateDiscrepancyNotesLocal(type, e.target.value)}
                      onBlur={() => persistDiscrepancyNotes(type)}
                      placeholder="Required — explain the discrepancy…"
                      rows={1}
                      className="w-full text-[11px] border border-red-300 rounded px-2 py-1 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-red-400 disabled:opacity-60"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">
            {items.filter((i) => (cl as any)[i.key]).length}/{items.length}
          </span>
        </div>
        <Progress value={(items.filter((i) => (cl as any)[i.key]).length / items.length) * 100} className="h-1 mb-2" />
        {phaseCompleted ? (
          <div className="bg-emerald-50 text-emerald-700 text-[11px] font-semibold text-center py-1.5 rounded-md">
            ✓ Completed{(cl as any)[`${phase}_signature`] ? " · signed" : ""}
          </div>
        ) : signingPhase === phase ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-muted-foreground">Sign to confirm {title}</p>
              <button onClick={() => setSigClearCount((c) => c + 1)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 size={10} /> Clear
              </button>
            </div>
            <SignaturePad label="" onCapture={setSigDataUrl} cleared={sigClearCount} height={70} />
            <div className="flex gap-2">
              <button onClick={() => setSigningPhase(null)} className="flex-1 text-[11px] font-medium py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted/50">
                Cancel
              </button>
              <button
                disabled={!sigDataUrl || savingSig}
                onClick={confirmSignAndComplete}
                className="flex-1 text-[11px] font-semibold py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              >
                {savingSig ? "Saving..." : "Confirm & Complete"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              disabled={!allDone || locked}
              onClick={() => startSigning(phase)}
              className={cn(
                "w-full text-xs font-semibold py-2 rounded-md transition-all active:scale-95",
                allDone && !locked
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {allDone ? `✓ Sign & Complete ${title}` : "Complete all items above"}
            </button>
            {!allDone && !locked && (
              <button
                onClick={() => setShowSkipForm(true)}
                className="w-full mt-1.5 flex items-center justify-center gap-1 text-[10px] text-amber-600 hover:text-amber-700 font-medium"
              >
                <AlertTriangle size={10} /> Cannot complete — document reason
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        {renderPhase("✅ SIGN IN", "Before anaesthesia induction", SIGNIN_ITEMS, "bg-blue-50", "border-b-blue-500", "text-blue-700", signinDone, signinCompleted, false, "signin")}
        {renderPhase("⏱️ TIME OUT", "Before skin incision", TIMEOUT_ITEMS, "bg-orange-50", "border-b-orange-500", "text-orange-700", timeoutDone, timeoutCompleted, !signinCompleted, "timeout")}
        {renderPhase("📋 SIGN OUT", "Before patient leaves OT", SIGNOUT_ITEMS, "bg-emerald-50", "border-b-emerald-500", "text-emerald-700", signoutDone, signoutCompleted, !timeoutCompleted, "signout")}
      </div>
      {(showSkipForm || cl.skip_reason) && (
        <div className="border-t border-border px-5 py-3 bg-amber-50/60 flex-shrink-0">
          {cl.skip_reason ? (
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-amber-800">Documented exception</p>
                <p className="text-[12px] text-amber-700">{cl.skip_reason}</p>
                {cl.skip_reason_at && (
                  <p className="text-[10px] text-amber-600 mt-0.5">{new Date(cl.skip_reason_at).toLocaleString()}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Document why this checklist could not be fully completed
              </p>
              <textarea
                value={skipReasonText}
                onChange={(e) => setSkipReasonText(e.target.value)}
                placeholder="Required — e.g. life-threatening emergency, reason Time Out items were not completed…"
                rows={2}
                className="w-full text-[12px] border border-amber-300 rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowSkipForm(false); setSkipReasonText(""); }} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5">
                  Cancel
                </button>
                <button
                  disabled={!skipReasonText.trim() || savingSkip}
                  onClick={saveSkipReason}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50"
                >
                  {savingSkip ? "Saving..." : "Save exception reason"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="bg-card border-t border-border px-5 py-2 flex items-center gap-4 flex-shrink-0">
        <span className="text-xs text-muted-foreground">WHO Compliance:</span>
        <Progress
          value={cl.compliance_percentage}
          className={cn("h-2 flex-1", cl.compliance_percentage >= 90 ? "[&>div]:bg-emerald-500" : cl.compliance_percentage >= 50 ? "[&>div]:bg-amber-500" : "[&>div]:bg-destructive")}
        />
        <span className="text-xs font-bold text-foreground">{cl.compliance_percentage}%</span>
        <span className="text-[10px] text-muted-foreground">{totalChecked}/{ALL_KEYS.length} items</span>
      </div>
    </div>
  );
};

export default WHOChecklistTab;
