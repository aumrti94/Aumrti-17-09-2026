import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Home, Check } from "lucide-react";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { generateVisits, HOME_CARE_FREQUENCIES } from "@/lib/homeCarePlans";
import { useConfigValues } from "@/hooks/useConfigValues";

/**
 * Discharge → Home Care handoff.
 *
 * home_care_plans defaults plan_type to 'post_discharge' and carries an
 * admission_id column, but nothing in the discharge flow ever created a plan —
 * so every post-discharge home care plan had to be re-keyed by hand in the
 * Home Care module, with no link back to the admission it came from.
 *
 * Rendered alongside the discharge instructions. Purely additive: discharge
 * proceeds exactly as before if the user ignores this panel.
 */

interface Props {
  hospitalId: string;
  admissionId: string;
  patientId: string;
  patientName: string;
  diagnosis?: string | null;
}

const HomeCareHandoffPanel: React.FC<Props> = ({
  hospitalId, admissionId, patientId, patientName, diagnosis,
}) => {
  const serviceOptions = useConfigValues("home_care_services");
  const { userId } = useHospitalId();
  const { toast } = useToast();
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("daily");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); // day after discharge
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });

  // A plan may already exist for this admission — don't offer to create a second.
  const check = useCallback(async () => {
    if (!hospitalId || !admissionId) return;
    setChecking(true);
    const { data } = await (supabase as any)
      .from("home_care_plans")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .eq("is_deleted", false)
      .limit(1)
      .maybeSingle();
    setExistingPlanId(data?.id ?? null);
    setChecking(false);
  }, [hospitalId, admissionId]);

  useEffect(() => { check(); }, [check]);

  const toggle = (s: string) =>
    setServices(v => (v.includes(s) ? v.filter(x => x !== s) : [...v, s]));

  const schedule = async () => {
    if (services.length === 0) {
      toast({ title: "Select at least one service", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as any).from("home_care_plans").insert({
      hospital_id:      hospitalId,
      patient_id:       patientId,
      admission_id:     admissionId,
      plan_type:        "post_discharge",
      diagnosis:        diagnosis || null,
      services_needed:  services,
      frequency,
      start_date:       startDate,
      end_date:         endDate || null,
      created_by:       userId ?? null,
      care_coordinator: userId ?? null,
      status:           "active",
    }).select("id").maybeSingle();

    if (error || !data?.id) {
      setSaving(false);
      toast({ title: "Could not schedule home care", description: error?.message, variant: "destructive" });
      return;
    }

    try {
      const count = await generateVisits({
        hospitalId, planId: data.id, patientId,
        startDate, endDate, frequency,
      });
      await logNABHEvidence(
        hospitalId, "AAC.12",
        `Post-discharge home care scheduled for ${patientName}: ${services.join(", ")}`,
      );
      toast({ title: `Home care scheduled — ${count} visit${count === 1 ? "" : "s"}` });
    } catch (e: any) {
      toast({ title: "Plan created, but visits could not be scheduled", description: e?.message, variant: "destructive" });
    }

    setSaving(false);
    setOpen(false);
    check();
  };

  if (checking) return null;

  if (existingPlanId) {
    return (
      <div className="border rounded-lg p-3 bg-emerald-50/40 border-emerald-200 flex items-center gap-2">
        <Check className="h-4 w-4 text-emerald-600" />
        <span className="text-sm">Post-discharge home care is already scheduled for this admission.</span>
        <a href="/home-care" className="text-sm text-primary hover:underline ml-auto">Open Home Care</a>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center gap-2 p-3">
        <Home className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Post-Discharge Home Care</span>
        <Badge variant="secondary" className="text-[10px]">Optional</Badge>
        <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={() => setOpen(v => !v)}>
          {open ? "Cancel" : "Schedule home care"}
        </Button>
      </div>

      {open && (
        <div className="border-t p-3 space-y-3">
          <div>
            <label className="text-[14px] font-medium mb-1 block">Services Needed</label>
            <div className="grid grid-cols-2 gap-1">
              {serviceOptions.map(s => (
                <label key={s.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={services.includes(s.value)} onChange={() => toggle(s.value)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[14px] font-medium">Frequency</label>
              <select className="w-full mt-1 border rounded-md px-2 py-1.5 text-sm bg-background"
                value={frequency} onChange={e => setFrequency(e.target.value)}>
                {HOME_CARE_FREQUENCIES.map(f => (
                  <option key={f} value={f}>{f.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[14px] font-medium">First Visit</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[14px] font-medium">Until</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={schedule} disabled={saving}>
            {saving ? "Scheduling…" : "Create Home Care Plan"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default HomeCareHandoffPanel;
