import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Pill, Plus, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type AdherenceRow,
  ADHERENCE_WINDOW_DAYS,
  adherencePercent,
  adherenceBand,
  toISODate,
} from "@/lib/chronicAdherence";

/**
 * Medication adherence tracking for a chronic care plan.
 *
 * medication_adherence has existed since 20260521000004_chronic_disease.sql
 * with RLS and indexes but no UI and no writes — adherence, the single most
 * predictive chronic-care metric, was unmeasurable.
 */

interface Props {
  hospitalId: string;
  carePlanId: string | null;
  patientId: string | null;
  patientName?: string;
}

const MedicationAdherenceTab: React.FC<Props> = ({ hospitalId, carePlanId, patientId, patientName }) => {
  const [rows, setRows] = useState<AdherenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drugName, setDrugName] = useState("");
  const [days, setDays] = useState("30");

  const load = useCallback(async () => {
    if (!hospitalId || !carePlanId) { setRows([]); return; }
    setLoading(true);
    const since = new Date(Date.now() - ADHERENCE_WINDOW_DAYS * 86400000);
    const { data, error } = await (supabase as any)
      .from("medication_adherence")
      .select("id, drug_name, scheduled_date, dispensed_at, adherence_status")
      .eq("hospital_id", hospitalId)
      .eq("care_plan_id", carePlanId)
      .gte("scheduled_date", toISODate(since))
      .order("scheduled_date", { ascending: false })
      .limit(500);
    if (error) toast.error(`Could not load adherence: ${error.message}`);
    setRows(data || []);
    setLoading(false);
  }, [hospitalId, carePlanId]);

  useEffect(() => { load(); }, [load]);

  /** Create one scheduled dose row per day for the requested window. */
  const addSchedule = async () => {
    if (!carePlanId || !patientId || !drugName.trim()) {
      toast.error("Drug name is required");
      return;
    }
    const n = Math.min(Math.max(Number(days) || 0, 1), 90);
    setSaving(true);
    const start = new Date();
    const inserts = Array.from({ length: n }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return {
        hospital_id: hospitalId,
        patient_id: patientId,
        care_plan_id: carePlanId,
        drug_name: drugName.trim(),
        scheduled_date: toISODate(d),
        adherence_status: "unknown",
      };
    });
    const { error } = await (supabase as any).from("medication_adherence").insert(inserts);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${drugName.trim()} scheduled for ${n} days`);
    setDrugName(""); setShowAdd(false);
    load();
  };

  const mark = async (id: string, status: "taken" | "missed") => {
    const { error } = await (supabase as any).from("medication_adherence").update({
      adherence_status: status,
      dispensed_at: status === "taken" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const pct = adherencePercent(rows);
  const today = toISODate(new Date());

  if (!carePlanId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a care plan to track medication adherence
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b bg-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Medication Adherence{patientName ? ` — ${patientName}` : ""}</h3>
            <p className="text-xs text-muted-foreground">
              {pct === null
                ? "No doses due yet"
                : `${pct}% adherence over the last ${ADHERENCE_WINDOW_DAYS} days`}
            </p>
          </div>
          {pct !== null && (
            <Badge
              variant="secondary"
              className={cn("ml-2 text-xs", {
                good:       "bg-emerald-100 text-emerald-700",
                suboptimal: "bg-amber-100 text-amber-700",
                poor:       "bg-red-100 text-red-700",
              }[adherenceBand(pct)])}
            >
              {{ good: "Good", suboptimal: "Suboptimal", poor: "Poor" }[adherenceBand(pct)]}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAdd(v => !v)}>
          <Plus className="h-3 w-3 mr-1" /> Add Drug
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-3 bg-blue-50/40 flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[14px]">Drug name</Label>
            <Input value={drugName} onChange={e => setDrugName(e.target.value)}
              className="h-8 text-sm mt-0.5" placeholder="e.g. Metformin 500mg BD" />
          </div>
          <div className="w-24">
            <Label className="text-[14px]">Days</Label>
            <Input type="number" min={1} max={90} value={days} onChange={e => setDays(e.target.value)}
              className="h-8 text-sm mt-0.5" />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={addSchedule} disabled={saving}>
            {saving ? "Saving…" : "Schedule"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
        </div>
      )}

      <ScrollArea className="flex-1 p-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No medications tracked for this plan yet — add a drug to start measuring adherence.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(r => {
              const isDue = r.scheduled_date <= today && r.adherence_status === "unknown";
              return (
                <div key={r.id} className={cn(
                  "border rounded-lg px-3 py-2 flex items-center gap-3 bg-card",
                  isDue && "border-amber-200 bg-amber-50/30",
                  r.adherence_status === "missed" && "border-red-200 bg-red-50/30",
                  r.adherence_status === "taken" && "opacity-70",
                )}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.drug_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.scheduled_date).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <Badge variant="secondary" className={cn("text-xs",
                    r.adherence_status === "taken" ? "bg-emerald-100 text-emerald-700"
                      : r.adherence_status === "missed" ? "bg-red-100 text-red-700"
                        : "bg-muted text-muted-foreground")}>
                    {r.adherence_status}
                  </Badge>
                  {r.adherence_status === "unknown" && r.scheduled_date <= today && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600"
                        title="Mark taken" onClick={() => mark(r.id, "taken")}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                        title="Mark missed" onClick={() => mark(r.id, "missed")}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default MedicationAdherenceTab;
