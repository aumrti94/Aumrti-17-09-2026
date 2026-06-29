import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlaskConical } from "lucide-react";

interface Modality {
  name: string;
  type: string;
  rate: number;
  selected: boolean;
}

interface LabTest {
  name: string;
  code: string;
  category: string;
  unit?: string;
  selected: boolean;
}

const DEFAULT_MODALITIES: Modality[] = [
  { name: "X-Ray",          type: "xray",        rate: 200,  selected: true },
  { name: "USG (Ultrasound)", type: "usg",       rate: 500,  selected: true },
  { name: "CT Scan",         type: "ct",          rate: 3500, selected: false },
  { name: "MRI",             type: "mri",         rate: 5000, selected: false },
  { name: "ECG",             type: "ecg",         rate: 150,  selected: true },
  { name: "Echo / 2D Echo",  type: "echo",        rate: 800,  selected: false },
  { name: "Mammography",     type: "mammography", rate: 1000, selected: false },
  { name: "DEXA Scan",       type: "dexa",        rate: 1200, selected: false },
  { name: "Fluoroscopy",     type: "fluoroscopy", rate: 1500, selected: false },
];

const DEFAULT_TESTS: LabTest[] = [
  { name: "Complete Blood Count (CBC)",   code: "CBC",    category: "Haematology",   selected: true },
  { name: "Liver Function Tests (LFT)",   code: "LFT",    category: "Biochemistry",  selected: true },
  { name: "Renal Function Tests (RFT)",   code: "RFT",    category: "Biochemistry",  selected: true },
  { name: "Lipid Profile",                code: "LIPID",  category: "Biochemistry",  selected: true },
  { name: "Thyroid Profile (TSH)",        code: "TSH",    category: "Biochemistry",  unit: "mIU/L", selected: true },
  { name: "Blood Sugar Fasting",          code: "BSF",    category: "Biochemistry",  unit: "mg/dL", selected: true },
  { name: "Blood Sugar PP",               code: "BSPP",   category: "Biochemistry",  unit: "mg/dL", selected: true },
  { name: "HbA1c",                        code: "HBA1C",  category: "Biochemistry",  unit: "%",     selected: true },
  { name: "Urine Routine",                code: "URE",    category: "Pathology",     selected: true },
  { name: "Serum Electrolytes",           code: "ELEC",   category: "Biochemistry",  selected: false },
  { name: "Haemoglobin",                  code: "HB",     category: "Haematology",   unit: "g/dL",  selected: true },
  { name: "ESR",                          code: "ESR",    category: "Haematology",   selected: false },
  { name: "CRP",                          code: "CRP",    category: "Biochemistry",  unit: "mg/L",  selected: false },
  { name: "Malaria Antigen",              code: "MAL",    category: "Serology",      selected: false },
  { name: "Dengue NS1 / IgM",            code: "DENGUE", category: "Serology",      selected: false },
  { name: "Urine Pregnancy Test",         code: "UPT",    category: "Serology",      selected: false },
  { name: "Blood Group & Rh",            code: "BG",     category: "Haematology",   selected: true },
  { name: "HIV Screening",               code: "HIV",    category: "Serology",      selected: false },
  { name: "VDRL / RPR",                  code: "VDRL",   category: "Serology",      selected: false },
  { name: "Hepatitis B (HBsAg)",         code: "HBSAG",  category: "Serology",      selected: false },
];

interface Props {
  hospitalId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const Step6cLabRadiology: React.FC<Props> = ({ hospitalId, onComplete, onSkip }) => {
  const { toast } = useToast();
  const [modalities, setModalities] = useState<Modality[]>(DEFAULT_MODALITIES);
  const [tests, setTests] = useState<LabTest[]>(DEFAULT_TESTS);
  const [saving, setSaving] = useState(false);

  const toggleModality = (i: number) =>
    setModalities((prev) => prev.map((m, idx) => idx === i ? { ...m, selected: !m.selected } : m));

  const updateRate = (i: number, val: string) =>
    setModalities((prev) => prev.map((m, idx) => idx === i ? { ...m, rate: parseFloat(val) || 0 } : m));

  const toggleTest = (i: number) =>
    setTests((prev) => prev.map((t, idx) => idx === i ? { ...t, selected: !t.selected } : t));

  const selectAll = (val: boolean) =>
    setTests((prev) => prev.map((t) => ({ ...t, selected: val })));

  const allSelected = tests.every((t) => t.selected);

  const handleSave = async () => {
    const selectedModalities = modalities.filter((m) => m.selected);
    const selectedTests = tests.filter((t) => t.selected);

    if (selectedModalities.length === 0 && selectedTests.length === 0) {
      onComplete();
      return;
    }

    setSaving(true);
    try {
      if (selectedModalities.length > 0) {
        const { error } = await supabase.from("radiology_modalities").insert(
          selectedModalities.map((m) => ({
            hospital_id: hospitalId,
            name: m.name,
            modality_type: m.type,
            fee: m.rate,
            is_active: true,
          }))
        );
        if (error) throw error;
      }

      if (selectedTests.length > 0) {
        const { error } = await supabase.from("lab_test_master").insert(
          selectedTests.map((t) => ({
            hospital_id: hospitalId,
            test_name: t.name,
            test_code: t.code,
            category: t.category,
            sample_type: "Blood",
            unit: t.unit ?? null,
            is_active: true,
            fee: 0,
          }))
        );
        if (error) throw error;
      }

      toast({
        title: "Lab & Radiology configured!",
        description: `${selectedModalities.length} modalities, ${selectedTests.length} lab tests added.`,
      });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <FlaskConical size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 10 · Lab & Radiology</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Lab & Radiology Quick Setup</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Enable services your hospital offers. Pre-filled rates — adjust as needed.
      </p>

      <Tabs defaultValue="radiology">
        <TabsList className="mb-4">
          <TabsTrigger value="radiology">Radiology</TabsTrigger>
          <TabsTrigger value="lab">Lab Tests</TabsTrigger>
        </TabsList>

        <TabsContent value="radiology">
          <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
            <div className="space-y-2">
              {modalities.map((m, i) => (
                <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                  m.selected ? "border-primary bg-primary/5" : "border-border"
                }`}>
                  <input
                    type="checkbox"
                    checked={m.selected}
                    onChange={() => toggleModality(i)}
                    className="accent-primary"
                  />
                  <span className="flex-1 text-sm font-medium text-foreground">{m.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-sm">₹</span>
                    <Input
                      type="number"
                      value={m.rate}
                      onChange={(e) => updateRate(i, e.target.value)}
                      disabled={!m.selected}
                      className="h-7 w-24 text-sm disabled:opacity-40"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="lab">
          <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">{tests.filter((t) => t.selected).length} of {tests.length} selected</p>
              <button
                onClick={() => selectAll(!allSelected)}
                className="text-xs text-primary hover:underline font-medium"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tests.map((t, i) => (
                <label key={i} className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  t.selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}>
                  <input
                    type="checkbox"
                    checked={t.selected}
                    onChange={() => toggleTest(i)}
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-foreground leading-tight">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.code} · {t.category}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip for now →
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step6cLabRadiology;
