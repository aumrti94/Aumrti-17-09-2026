import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, ClipboardList, CheckCircle2 } from "lucide-react";
import CarePlanModal from "./CarePlanModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Admission {
  id: string;
  patient_id: string;
  patientName: string;
  bedLabel: string;
}

interface CarePlan {
  id: string;
  nursing_diagnosis: string;
  goal: string;
  interventions: Array<{ action: string; frequency: string; assigned_to: string; status: string }>;
  evaluation: string | null;
  status: string;
  created_at: string;
}

interface Props {
  hospitalId: string;
}

const statusColors: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 border-blue-200",
  achieved: "bg-green-100 text-green-800 border-green-200",
  revised: "bg-amber-100 text-amber-800 border-amber-200",
  discontinued: "bg-muted text-muted-foreground border-border",
};

const CarePlansTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [selectedAdm, setSelectedAdm] = useState<string>("");
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [evalPlan, setEvalPlan] = useState<CarePlan | null>(null);
  const [evalText, setEvalText] = useState("");
  const [evalStatus, setEvalStatus] = useState("achieved");

  // Fetch active admissions
  useEffect(() => {
    if (!hospitalId) return;
    supabase
      .from("admissions")
      .select(`id, patient_id,
        patients!admissions_patient_id_fkey(full_name),
        beds!admissions_bed_id_fkey(bed_number),
        wards!admissions_ward_id_fkey(name)`)
      .eq("hospital_id", hospitalId)
      .eq("status", "active")
      .then(({ data }) => {
        const list = (data || []).map((a: any) => ({
          id: a.id,
          patient_id: a.patient_id,
          patientName: a.patients?.full_name || "Unknown",
          bedLabel: `${a.wards?.name || "?"}-${a.beds?.bed_number || "?"}`,
        }));
        setAdmissions(list);
        if (list.length && !selectedAdm) setSelectedAdm(list[0].id);
      });
  }, [hospitalId]);

  const fetchPlans = useCallback(async () => {
    if (!selectedAdm) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("nursing_care_plans" as any)
      .select("*")
      .eq("admission_id", selectedAdm)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      return;
    }
    setPlans((data as any) || []);
  }, [selectedAdm, toast]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const saveEvaluation = async () => {
    if (!evalPlan) return;
    const { error } = await supabase
      .from("nursing_care_plans" as any)
      .update({ evaluation: evalText, status: evalStatus })
      .eq("id", evalPlan.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Evaluation saved" });
    setEvalPlan(null);
    setEvalText("");
    fetchPlans();
  };

  const selected = admissions.find((a) => a.id === selectedAdm);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-3">
        <ClipboardList size={18} className="text-primary" />
        <span className="text-sm font-bold text-foreground">Care Plans</span>
        <Select value={selectedAdm} onValueChange={setSelectedAdm}>
          <SelectTrigger className="h-8 w-[280px] text-xs">
            <SelectValue placeholder="Select patient" />
          </SelectTrigger>
          <SelectContent>
            {admissions.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">
                {a.patientName} — {a.bedLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => setShowModal(true)}
          disabled={!selected}
        >
          <Plus className="h-4 w-4" /> New Care Plan
        </Button>
      </div>

      {/* Plans list */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!loading && plans.length === 0 && (
          <div className="text-center py-12">
            <ClipboardList size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No care plans yet for this patient.</p>
          </div>
        )}
        <div className="space-y-3 max-w-4xl mx-auto">
          {plans.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{p.nursing_diagnosis}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Created {new Date(p.created_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <Badge variant="outline" className={`text-[10px] ${statusColors[p.status] || ""}`}>
                  {p.status.toUpperCase()}
                </Badge>
              </div>
              <div className="bg-muted/40 rounded p-2 mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">GOAL</p>
                <p className="text-xs text-foreground">{p.goal}</p>
              </div>
              {p.interventions?.length > 0 && (
                <div className="space-y-1 mb-2">
                  <p className="text-[10px] font-semibold text-muted-foreground">INTERVENTIONS</p>
                  {p.interventions.map((iv, i) => (
                    <div key={i} className="text-xs flex items-center gap-2 bg-background rounded px-2 py-1 border border-border">
                      <span className="flex-1">{iv.action}</span>
                      <span className="text-[10px] text-muted-foreground">{iv.frequency}</span>
                      <Badge variant="outline" className="text-[9px]">{iv.assigned_to}</Badge>
                    </div>
                  ))}
                </div>
              )}
              {p.evaluation && (
                <div className="bg-green-50 border border-green-200 rounded p-2 mb-2">
                  <p className="text-[10px] font-semibold text-green-800 mb-0.5">EVALUATION</p>
                  <p className="text-xs text-green-900">{p.evaluation}</p>
                </div>
              )}
              {p.status === "active" && (
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setEvalPlan(p);
                      setEvalText(p.evaluation || "");
                      setEvalStatus("achieved");
                    }}
                  >
                    <CheckCircle2 className="h-3 w-3" /> Evaluate
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {showModal && selected && (
        <CarePlanModal
          open={showModal}
          onClose={() => setShowModal(false)}
          hospitalId={hospitalId}
          admission={selected}
          onSaved={fetchPlans}
        />
      )}

      <Dialog open={!!evalPlan} onOpenChange={(o) => !o && setEvalPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Evaluate Care Plan</DialogTitle>
          </DialogHeader>
          {evalPlan && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">{evalPlan.nursing_diagnosis}</p>
              <Textarea
                placeholder="Evaluation notes — was the goal met?"
                value={evalText}
                onChange={(e) => setEvalText(e.target.value)}
                rows={4}
              />
              <Select value={evalStatus} onValueChange={setEvalStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="achieved">Achieved</SelectItem>
                  <SelectItem value="revised">Revised</SelectItem>
                  <SelectItem value="discontinued">Discontinued</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEvalPlan(null)}>Cancel</Button>
            <Button onClick={saveEvaluation}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CarePlansTab;
