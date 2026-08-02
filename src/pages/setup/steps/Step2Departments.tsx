import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";

const defaultDepts = [
  // Minimal universal core — pre-checked for every hospital. Everything else is opt-in.
  { name: "General Medicine", icon: "🏥", pre: true },
  { name: "General Surgery", icon: "🔪", pre: true },
  { name: "Emergency / Casualty", icon: "🚨", pre: true },
  { name: "Paediatrics", icon: "👶", pre: false },
  { name: "Gynaecology & Obstetrics", icon: "🤰", pre: false },
  { name: "Orthopaedics", icon: "🦴", pre: false },
  { name: "Cardiology", icon: "❤️", pre: false },
  { name: "Neurology", icon: "🧠", pre: false },
  { name: "Ophthalmology", icon: "👁️", pre: false },
  { name: "ENT", icon: "👂", pre: false },
  { name: "Pulmonology", icon: "🫁", pre: false },
  { name: "ICU / Critical Care", icon: "🏥", pre: false },
  { name: "Psychiatry", icon: "🧠", pre: false },
  { name: "Dermatology", icon: "🩺", pre: false },
  { name: "Urology", icon: "🩺", pre: false },
  { name: "Nephrology", icon: "🩺", pre: false },
  { name: "Gastroenterology", icon: "🩺", pre: false },
  { name: "Oncology", icon: "🩺", pre: false },
  { name: "Dental", icon: "🦷", pre: false },
  { name: "AYUSH / Ayurveda", icon: "🌿", pre: false },
  { name: "Physiotherapy", icon: "🏃", pre: false },
  { name: "Dialysis", icon: "🩺", pre: false },
  { name: "Radiology", icon: "📡", pre: false },
  { name: "Pathology / Lab", icon: "🔬", pre: false },
  { name: "Blood Bank", icon: "🩸", pre: false },
  { name: "CSSD", icon: "🧹", pre: false },
  { name: "Pharmacy", icon: "💊", pre: false },
  { name: "Dietetics", icon: "🥗", pre: false },
  { name: "Mortuary", icon: "🏥", pre: false },
];

interface Props {
  hospitalId: string;
  onComplete: (selectedDepts: string[]) => void;
}

const Step2Departments: React.FC<Props> = ({ hospitalId, onComplete }) => {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(defaultDepts.filter((d) => d.pre).map((d) => d.name))
  );
  const [customDepts, setCustomDepts] = useState<string[]>([]);
  const [newDept, setNewDept] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustom = () => {
    if (!newDept.trim() || customDepts.length >= 5) return;
    const name = newDept.trim();
    const allNames = [...defaultDepts.map((d) => d.name), ...customDepts];
    if (allNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Department already exists", description: `"${name}" is already in the list.`, variant: "destructive" });
      return;
    }
    setCustomDepts((prev) => [...prev, name]);
    setSelected((prev) => new Set([...prev, name]));
    setNewDept("");
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      toast({ title: "Select at least one department", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Check for existing departments to avoid duplicates
    const { data: existing } = await supabase
      .from("departments")
      .select("name")
      .eq("hospital_id", hospitalId);
    const existingNames = new Set((existing ?? []).map((d: any) => d.name.toLowerCase()));
    const rows = Array.from(selected)
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .map((name) => ({
        hospital_id: hospitalId,
        name,
        type: "clinical" as const,
        is_active: true,
      }));
    if (rows.length === 0) {
      setSaving(false);
      onComplete(Array.from(selected));
      return;
    }
    const { error } = await supabase.from("departments").insert(rows);
    if (error) {
      toast({ title: "Error saving departments", description: error.message, variant: "destructive" });
    }
    setSaving(false);
    onComplete(Array.from(selected));
  };

  const allDepts = [...defaultDepts, ...customDepts.map((n) => ({ name: n, icon: "📋", pre: false }))];

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~3 min</span>
      <h2 className="text-[22px] font-bold text-foreground">Which departments does your hospital have?</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Check all that apply. You can add more later.</p>

      <div className="bg-[#EFF6FF] border-l-[3px] border-[#3B82F6] px-3.5 py-2.5 rounded text-[13px] text-foreground mb-6">
        We've pre-selected only the core departments every hospital has. Check any others you run — you can always add more later.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {allDepts.map((dept) => {
          const checked = selected.has(dept.name);
          return (
            <button
              key={dept.name}
              onClick={() => toggle(dept.name)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-[13px] transition-colors ${
                checked ? "border-primary bg-[hsl(220,54%,95%)]" : "border-border bg-muted/30"
              }`}
            >
              <Checkbox checked={checked} className="pointer-events-none" />
              <span>{dept.icon}</span>
              <span className="truncate">{dept.name}</span>
            </button>
          );
        })}
      </div>

      {/* Add custom */}
      {showAdd ? (
        <div className="flex gap-2 mt-3">
          <Input value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="Department name..." className="max-w-xs" onKeyDown={(e) => e.key === "Enter" && addCustom()} />
          <button onClick={addCustom} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm">Add</button>
          <button onClick={() => setShowAdd(false)} className="text-sm text-muted-foreground">Cancel</button>
        </div>
      ) : (
        customDepts.length < 5 && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 mt-3 text-sm text-primary font-medium hover:underline">
            <Plus size={14} /> Add Custom Department
          </button>
        )
      )}

      <p className="text-[13px] text-muted-foreground mt-4">{selected.size} departments selected</p>

      <div className="flex justify-between mt-8">
        <div />
        <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step2Departments;
