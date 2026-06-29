import React, { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Check } from "lucide-react";
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
  timeout_team_introduced: boolean;
  timeout_patient_confirmed: boolean;
  timeout_procedure_confirmed: boolean;
  timeout_site_confirmed: boolean;
  timeout_imaging_displayed: boolean;
  timeout_antibiotics_given: boolean;
  timeout_anticoagulation: boolean;
  timeout_equipment_issues: boolean;
  timeout_completed_at: string | null;
  signout_procedure_recorded: boolean;
  signout_instrument_count: boolean;
  signout_swab_count: boolean;
  signout_specimen_labelled: boolean;
  signout_equipment_issues: boolean;
  signout_recovery_handover: boolean;
  signout_completed_at: string | null;
  compliance_percentage: number;
}

const SIGNIN_ITEMS: { key: string; label: string }[] = [
  { key: "signin_patient_identity", label: "Patient identity confirmed" },
  { key: "signin_site_marked", label: "Surgical site marked" },
  { key: "signin_consent_signed", label: "Patient consent signed" },
  { key: "signin_anaesthesia_checked", label: "Anaesthesia machine checked" },
  { key: "signin_pulse_oximeter", label: "Pulse oximeter working" },
  { key: "signin_allergies_known", label: "Known allergies confirmed" },
  { key: "signin_difficult_airway", label: "Difficult airway risk assessed" },
  { key: "signin_blood_loss_risk", label: "Blood loss risk assessed" },
];

const TIMEOUT_ITEMS: { key: string; label: string }[] = [
  { key: "timeout_team_introduced", label: "Team introductions done" },
  { key: "timeout_patient_confirmed", label: "Patient identity re-confirmed" },
  { key: "timeout_procedure_confirmed", label: "Procedure confirmed" },
  { key: "timeout_site_confirmed", label: "Surgical site re-confirmed" },
  { key: "timeout_imaging_displayed", label: "Imaging displayed" },
  { key: "timeout_antibiotics_given", label: "Prophylactic antibiotics given" },
  { key: "timeout_anticoagulation", label: "Anticoagulation considered" },
  { key: "timeout_equipment_issues", label: "Equipment concerns addressed" },
];

const SIGNOUT_ITEMS: { key: string; label: string }[] = [
  { key: "signout_procedure_recorded", label: "Procedure recorded in notes" },
  { key: "signout_instrument_count", label: "Instrument count correct" },
  { key: "signout_swab_count", label: "Swab count correct" },
  { key: "signout_specimen_labelled", label: "Specimen labelled correctly" },
  { key: "signout_equipment_issues", label: "Equipment issues noted" },
  { key: "signout_recovery_handover", label: "Recovery team briefed" },
];

const ALL_KEYS = [...SIGNIN_ITEMS, ...TIMEOUT_ITEMS, ...SIGNOUT_ITEMS].map((i) => i.key);

const WHOChecklistTab: React.FC<Props> = ({ schedule, onRefresh }) => {
  const { toast } = useToast();
  const [cl, setCl] = useState<ChecklistData | null>(null);

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
    const update = { [key]: !current } as any;

    // Recalculate compliance
    const newCl = { ...cl, ...update };
    const checked = ALL_KEYS.filter((k) => (newCl as any)[k] === true).length;
    update.compliance_percentage = Math.round((checked / ALL_KEYS.length) * 100);

    await supabase.from("ot_checklists").update(update).eq("id", cl.id);
    setCl({ ...newCl, compliance_percentage: update.compliance_percentage });
  };

  const completePhase = async (phase: "signin" | "timeout" | "signout") => {
    const update: any = {
      [`${phase}_completed_at`]: new Date().toISOString(),
    };
    await supabase.from("ot_checklists").update(update).eq("id", cl.id);
    setCl({ ...cl, ...update });
    toast({ title: `${phase === "signin" ? "Sign In" : phase === "timeout" ? "Time Out" : "Sign Out"} completed ✓` });
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
            ✓ Completed
          </div>
        ) : (
          <button
            disabled={!allDone || locked}
            onClick={() => completePhase(phase)}
            className={cn(
              "w-full text-xs font-semibold py-2 rounded-md transition-all active:scale-95",
              allDone && !locked
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {allDone ? `✓ Complete ${title}` : "Complete all items above"}
          </button>
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
