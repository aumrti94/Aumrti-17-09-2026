import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus, Activity } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ChronicProgram {
  id: string;
  condition: string;
  condition_label: string;
  next_followup: string | null;
  followup_tests: string[] | null;
  is_active: boolean;
  diagnosed_date: string | null;
  followup_interval_days: number;
}

interface Props {
  patientId: string;
  hospitalId: string;
}

const CONDITIONS = [
  { value: "dm", label: "Type 2 Diabetes Mellitus" },
  { value: "htn", label: "Hypertension" },
  { value: "ckd", label: "Chronic Kidney Disease" },
  { value: "cad", label: "Coronary Artery Disease" },
  { value: "copd", label: "COPD" },
  { value: "asthma", label: "Bronchial Asthma" },
  { value: "hypothyroid", label: "Hypothyroidism" },
  { value: "epilepsy", label: "Epilepsy" },
  { value: "other", label: "Other" },
];

const TESTS_BY_CONDITION: Record<string, string[]> = {
  dm: ["HbA1c", "Fasting glucose", "Creatinine", "Urine microalbumin", "Lipids"],
  htn: ["BP", "Creatinine", "Electrolytes", "ECG"],
  ckd: ["Creatinine", "eGFR", "Electrolytes", "CBC", "BP"],
  cad: ["Lipids", "ECG", "2D Echo", "Treadmill test"],
  copd: ["PFT", "SpO2", "Chest X-Ray", "ABG"],
  asthma: ["PFT", "SpO2", "Peak flow"],
  hypothyroid: ["TSH", "Free T4"],
  epilepsy: ["Drug levels", "EEG", "LFT"],
  other: [],
};

const INTERVALS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
];

function getFollowupColor(date: string | null): string {
  if (!date) return "text-muted-foreground";
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  if (days < 0) return "text-destructive font-bold";
  if (days <= 7) return "text-destructive";
  if (days <= 14) return "text-[hsl(38,92%,50%)]";
  return "text-[hsl(var(--success))]";
}

const ChronicDiseaseSection: React.FC<Props> = ({ patientId, hospitalId }) => {
  const { toast } = useToast();
  const [programs, setPrograms] = useState<ChronicProgram[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [condition, setCondition] = useState("");
  const [conditionLabel, setConditionLabel] = useState("");
  const [diagnosedDate, setDiagnosedDate] = useState<Date>();
  const [interval, setInterval] = useState(90);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchPrograms = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("chronic_disease_programs")
      .select("id, condition, condition_label, next_followup, followup_tests, is_active, diagnosed_date, followup_interval_days")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    setPrograms(data || []);
  }, [patientId]);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);

  const handleConditionChange = (val: string) => {
    setCondition(val);
    const found = CONDITIONS.find((c) => c.value === val);
    setConditionLabel(found?.label || "");
    setSelectedTests(TESTS_BY_CONDITION[val] || []);
  };

  const toggleTest = (test: string) => {
    setSelectedTests((prev) =>
      prev.includes(test) ? prev.filter((t) => t !== test) : [...prev, test]
    );
  };

  const handleEnrol = async () => {
    if (!condition || !conditionLabel) return;
    setSaving(true);

    const nextFollowup = new Date();
    nextFollowup.setDate(nextFollowup.getDate() + interval);

    const { error } = await (supabase as any)
      .from("chronic_disease_programs")
      .insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        condition,
        condition_label: conditionLabel,
        diagnosed_date: diagnosedDate ? format(diagnosedDate, "yyyy-MM-dd") : null,
        next_followup: format(nextFollowup, "yyyy-MM-dd"),
        followup_interval_days: interval,
        followup_tests: selectedTests,
      });

    setSaving(false);
    if (error) {
      toast({ title: "Enrolment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Patient enrolled in chronic disease program" });
      setShowModal(false);
      setCondition("");
      setConditionLabel("");
      setDiagnosedDate(undefined);
      setInterval(90);
      setSelectedTests([]);
      fetchPrograms();
    }
  };

  const availableTests = TESTS_BY_CONDITION[condition] || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Chronic Conditions
        </h3>
        <button
          onClick={() => setShowModal(true)}
          className="text-[10px] text-primary hover:underline flex items-center gap-1"
        >
          <Plus size={10} /> Enrol
        </button>
      </div>

      {programs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No chronic disease enrolments</p>
      ) : (
        <div className="space-y-2">
          {programs.map((p) => (
            <div key={p.id} className="bg-muted rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">{p.condition_label}</span>
                <Badge variant="outline" className="text-[10px]">
                  {p.condition.toUpperCase()}
                </Badge>
              </div>
              {p.next_followup && (
                <p className={cn("text-xs mt-1", getFollowupColor(p.next_followup))}>
                  Next follow-up: {new Date(p.next_followup).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}
              {p.followup_tests && p.followup_tests.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.followup_tests.map((t, i) => (
                    <span key={i} className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Enrolment Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowModal(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-primary" />
              <h2 className="text-base font-bold text-foreground">Enrol in Chronic Disease Program</h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Condition</label>
                <Select value={condition} onValueChange={handleConditionChange}>
                  <SelectTrigger className="h-9 text-sm mt-1">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Condition Label</label>
                <Input
                  value={conditionLabel}
                  onChange={(e) => setConditionLabel(e.target.value)}
                  className="h-9 text-sm mt-1"
                  placeholder="e.g. Type 2 Diabetes Mellitus"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Diagnosed Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full h-9 text-sm mt-1 justify-start", !diagnosedDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {diagnosedDate ? format(diagnosedDate, "dd/MM/yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={diagnosedDate}
                      onSelect={setDiagnosedDate}
                      disabled={(d) => d > new Date()}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Follow-up Interval</label>
                <div className="flex gap-2 mt-1">
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv.value}
                      onClick={() => setInterval(iv.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        interval === iv.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      {iv.label}
                    </button>
                  ))}
                </div>
              </div>

              {availableTests.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tests to Monitor</label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {availableTests.map((test) => (
                      <label key={test} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Checkbox
                          checked={selectedTests.includes(test)}
                          onCheckedChange={() => toggleTest(test)}
                          className="h-3.5 w-3.5"
                        />
                        {test}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleEnrol} disabled={!condition || !conditionLabel || saving}>
                {saving ? "Enrolling..." : "Enrol Patient"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChronicDiseaseSection;
