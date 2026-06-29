import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { Sparkles, Plus, Trash2, Loader2 } from "lucide-react";

const NANDA_DIAGNOSES = [
  "Acute Pain related to surgical incision",
  "Impaired Physical Mobility",
  "Risk for Infection",
  "Ineffective Breathing Pattern",
  "Fluid Volume Deficit",
  "Anxiety related to hospitalization",
  "Knowledge Deficit regarding disease process",
  "Risk for Falls",
];

const FREQUENCIES = ["hourly", "every2h", "every4h", "every8h", "daily"];
const ASSIGNEES = ["Nurse", "Doctor", "Physiotherapy", "Dietitian"];

interface Intervention {
  action: string;
  frequency: string;
  assigned_to: string;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  admission: { id: string; patient_id: string; patientName: string };
  onSaved: () => void;
}

const CarePlanModal: React.FC<Props> = ({ open, onClose, hospitalId, admission, onSaved }) => {
  const { toast } = useToast();
  const [diagnosis, setDiagnosis] = useState("");
  const [goal, setGoal] = useState("");
  const [interventions, setInterventions] = useState<Intervention[]>([
    { action: "", frequency: "every4h", assigned_to: "Nurse", status: "pending" },
  ]);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const updateIntervention = (idx: number, field: keyof Intervention, value: string) => {
    setInterventions((prev) => prev.map((i, k) => (k === idx ? { ...i, [field]: value } : i)));
  };

  const addIntervention = () =>
    setInterventions((prev) => [...prev, { action: "", frequency: "every4h", assigned_to: "Nurse", status: "pending" }]);

  const removeIntervention = (idx: number) =>
    setInterventions((prev) => prev.filter((_, k) => k !== idx));

  const suggestGoal = async () => {
    if (!diagnosis) {
      toast({ title: "Enter nursing diagnosis first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    try {
      const res = await callAI({
        featureKey: "care_plan_goal",
        hospitalId,
        prompt: `For the nursing diagnosis "${diagnosis}", suggest one SMART goal (Specific, Measurable, Achievable, Relevant, Time-bound) for a nursing care plan. Reply with the goal text only, max 1 sentence.`,
        maxTokens: 100,
      });
      if (res?.text) {
        setGoal(res.text.trim().replace(/^["']|["']$/g, ""));
        await (supabase as any).from("ai_feature_logs").insert({
          hospital_id: hospitalId,
          feature_key: "care_plan_goal",
          module: "nursing",
          patient_id: admission.patient_id || null,
          success: true,
          input_summary: `Diagnosis: ${diagnosis.slice(0, 80)}`,
          output_summary: `Goal: ${res.text.slice(0, 80)}`,
          tokens_used: res.tokens_used || null,
        });
      }
    } catch (e: any) {
      toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const save = async () => {
    if (!diagnosis || !goal) {
      toast({ title: "Diagnosis and goal are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const filtered = interventions.filter((i) => i.action.trim());
    const { error } = await supabase.from("nursing_care_plans" as any).insert({
      hospital_id: hospitalId,
      admission_id: admission.id,
      patient_id: admission.patient_id,
      nursing_diagnosis: diagnosis,
      goal,
      interventions: filtered,
      status: "active",
      created_by: userData?.user?.id,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Care plan created" });
    onSaved();
    onClose();
    setDiagnosis("");
    setGoal("");
    setInterventions([{ action: "", frequency: "every4h", assigned_to: "Nurse", status: "pending" }]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Care Plan — {admission.patientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Nursing Diagnosis (NANDA-I)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g. Acute Pain related to surgical incision"
                list="nanda-list"
              />
              <datalist id="nanda-list">
                {NANDA_DIAGNOSES.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {NANDA_DIAGNOSES.slice(0, 4).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiagnosis(d)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-accent text-muted-foreground"
                >
                  {d.split(" related")[0]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Goal (SMART)</Label>
              <Button type="button" size="sm" variant="ghost" onClick={suggestGoal} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                <span className="ml-1 text-[11px]">AI Suggest</span>
              </Button>
            </div>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Patient will report pain ≤3/10 by end of shift"
              rows={2}
              className="mt-1"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Interventions</Label>
              <Button type="button" size="sm" variant="outline" onClick={addIntervention}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {interventions.map((iv, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-5"
                    placeholder="Action"
                    value={iv.action}
                    onChange={(e) => updateIntervention(idx, "action", e.target.value)}
                  />
                  <Select value={iv.frequency} onValueChange={(v) => updateIntervention(idx, "frequency", v)}>
                    <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={iv.assigned_to} onValueChange={(v) => updateIntervention(idx, "assigned_to", v)}>
                    <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSIGNEES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="col-span-1 h-9 w-9"
                    onClick={() => removeIntervention(idx)}
                    disabled={interventions.length === 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Care Plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CarePlanModal;
