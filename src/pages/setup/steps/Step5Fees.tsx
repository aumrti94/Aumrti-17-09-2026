import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp } from "lucide-react";

const defaultFees: Record<string, [number, number]> = {
  "General Medicine": [300, 150],
  "General Surgery": [300, 150],
  "Paediatrics": [300, 150],
  "Gynaecology & Obstetrics": [500, 250],
  "Orthopaedics": [500, 250],
  "Cardiology": [500, 250],
  "Neurology": [500, 250],
  "Ophthalmology": [400, 200],
  "ENT": [400, 200],
  "Pulmonology": [400, 200],
  "Emergency / Casualty": [300, 150],
  "ICU / Critical Care": [500, 250],
};

const procedures = [
  { name: "ECG", fee: 150 },
  { name: "X-Ray Chest", fee: 200 },
  { name: "Dressing", fee: 100 },
  { name: "IV Drip Setup", fee: 200 },
  { name: "Nebulization", fee: 100 },
];

interface FeeRow {
  name: string;
  fee: number;
  followUp: number;
}

interface Props {
  hospitalId: string;
  selectedDepts: string[];
  onComplete: () => void;
}

const Step5Fees: React.FC<Props> = ({ hospitalId, selectedDepts, onComplete }) => {
  const { toast } = useToast();
  const [gstEnabled, setGstEnabled] = useState(false);
  const [fees, setFees] = useState<FeeRow[]>(
    selectedDepts.map((name) => {
      const [fee, followUp] = defaultFees[name] || [300, 150];
      return { name, fee, followUp };
    })
  );
  const [procFees, setProcFees] = useState(procedures.map((p) => ({ ...p })));
  const [showProc, setShowProc] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateFee = (i: number, field: "fee" | "followUp", value: number) => {
    setFees((prev) => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f));
  };

  const handleSave = async () => {
    setSaving(true);
    const rows = [
      ...fees.map((f) => ({
        hospital_id: hospitalId,
        name: f.name,
        category: "consultation",
        fee: f.fee,
        follow_up_fee: f.followUp,
        gst_applicable: gstEnabled,
        is_active: true,
      })),
      ...procFees.map((p) => ({
        hospital_id: hospitalId,
        name: p.name,
        category: "procedure",
        fee: p.fee,
        follow_up_fee: null,
        gst_applicable: gstEnabled,
        is_active: true,
      })),
    ];
    const { error } = await supabase.from("service_master").insert(rows);
    if (error) {
      toast({ title: "Error saving fees", description: error.message, variant: "destructive" });
    }
    setSaving(false);
    onComplete();
  };

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~3 min</span>
      <h2 className="text-[22px] font-bold text-foreground">Set your consultation fees</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">These are the default fees. You can adjust them anytime.</p>

      {/* GST Toggle */}
      <div className="flex items-center gap-3 mb-6 p-3 bg-muted/50 rounded-lg">
        <Switch checked={gstEnabled} onCheckedChange={setGstEnabled} />
        <div>
          <p className="text-sm font-medium text-foreground">Include 18% GST on consultation fees?</p>
          <p className="text-[11px] text-muted-foreground">Most clinics don't charge GST. Enable only if GST registered.</p>
        </div>
      </div>

      {/* OPD Fees Table */}
      <div className="grid grid-cols-[3fr_1.5fr_1.5fr] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
        <span>Speciality</span><span>Consultation (₹)</span><span>Follow-up (₹)</span>
      </div>
      <div className="space-y-1.5">
        {fees.map((f, i) => (
          <div key={f.name} className="grid grid-cols-[3fr_1.5fr_1.5fr] gap-2 items-center">
            <span className="text-sm text-foreground truncate">{f.name}</span>
            <Input type="number" min={0} value={f.fee} onChange={(e) => updateFee(i, "fee", parseInt(e.target.value) || 0)} />
            <Input type="number" min={0} value={f.followUp} onChange={(e) => updateFee(i, "followUp", parseInt(e.target.value) || 0)} />
          </div>
        ))}
      </div>

      {/* Procedures */}
      <button onClick={() => setShowProc(!showProc)} className="flex items-center gap-1.5 mt-6 text-sm text-primary font-medium">
        Common Procedure Fees {showProc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {showProc && (
        <div className="mt-2 space-y-1.5">
          {procFees.map((p, i) => (
            <div key={p.name} className="grid grid-cols-[3fr_1.5fr] gap-2 items-center">
              <span className="text-sm text-foreground">{p.name}</span>
              <Input type="number" min={0} value={p.fee} onChange={(e) => setProcFees((prev) => prev.map((x, idx) => idx === i ? { ...x, fee: parseInt(e.target.value) || 0 } : x))} />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <div />
        <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step5Fees;
