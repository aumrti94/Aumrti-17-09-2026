import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

const ALL_TEETH = [
  18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
  31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,
];

type ProbeData = Record<number, {
  buccal_d: number; buccal_m: number; buccal_c: number; buccal_bop: boolean;
  palatal_d: number; palatal_m: number; palatal_c: number; palatal_bop: boolean;
}>;

interface PeriodontalTabProps {
  patientId: string;
  hospitalId: string;
  userId: string | null;
}

const depthColor = (v: number) => {
  if (v <= 3) return "";
  if (v <= 5) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
};

const PeriodontalTab: React.FC<PeriodontalTabProps> = ({ patientId, hospitalId, userId }) => {
  const { toast } = useToast();
  const [probeData, setProbeData] = useState<ProbeData>(() => {
    const init: ProbeData = {};
    ALL_TEETH.forEach(t => {
      init[t] = { buccal_d: 0, buccal_m: 0, buccal_c: 0, buccal_bop: false, palatal_d: 0, palatal_m: 0, palatal_c: 0, palatal_bop: false };
    });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const updateVal = (tooth: number, field: string, val: number | boolean) => {
    setProbeData(prev => ({ ...prev, [tooth]: { ...prev[tooth], [field]: val } }));
  };

  const stats = useMemo(() => {
    let totalSites = 0, bopSites = 0, maxDepth = 0, maxTooth = 0;
    Object.entries(probeData).forEach(([t, d]) => {
      const depths = [d.buccal_d, d.buccal_m, d.buccal_c, d.palatal_d, d.palatal_m, d.palatal_c];
      depths.forEach(v => { if (v > maxDepth) { maxDepth = v; maxTooth = Number(t); } });
      totalSites += 2;
      if (d.buccal_bop) bopSites++;
      if (d.palatal_bop) bopSites++;
    });
    const bleedingIndex = totalSites > 0 ? Math.round((bopSites / totalSites) * 100) : 0;
    let diagnosis = "Healthy";
    if (maxDepth >= 6) diagnosis = "Stage III-IV Periodontitis";
    else if (maxDepth >= 4) diagnosis = "Stage I-II Periodontitis";
    else if (bleedingIndex > 10) diagnosis = "Gingivitis";
    return { bleedingIndex, maxDepth, maxTooth, diagnosis };
  }, [probeData]);

  const handleSave = async () => {
    if (!userId) { toast({ title: "Please log in first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("periodontal_charts").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        created_by: userId,
        chart_date: new Date().toISOString().split("T")[0],
        perio_data: probeData as any,
        bleeding_index: stats.bleedingIndex,
        diagnosis: stats.diagnosis === "Healthy" ? "healthy"
          : stats.diagnosis === "Gingivitis" ? "gingivitis"
          : stats.diagnosis.includes("III") ? "stage3_perio" : "stage1_perio",
      });
      if (error) throw error;
      toast({ title: "Periodontal chart saved" });
    } catch (err: any) {
      console.error("Save perio error:", err);
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const ProbeInput: React.FC<{ tooth: number; field: string; value: number }> = ({ tooth, field, value }) => (
    <input
      type="number"
      min={0}
      max={15}
      value={value || ""}
      onChange={(e) => updateVal(tooth, field, parseInt(e.target.value) || 0)}
      className={`w-8 h-7 text-center text-xs border rounded font-mono ${depthColor(value)}`}
    />
  );

  return (
    <div className="space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
      <div className="flex gap-3">
        <Badge variant="outline" className="text-xs">Bleeding Index: {stats.bleedingIndex}%</Badge>
        <Badge variant="outline" className="text-xs">Deepest: {stats.maxDepth}mm (tooth {stats.maxTooth})</Badge>
        <Badge className={`text-xs ${stats.diagnosis === "Healthy" ? "bg-green-500" : stats.diagnosis === "Gingivitis" ? "bg-amber-500" : "bg-red-500"} text-white`}>
          {stats.diagnosis}
        </Badge>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-2 py-1 text-left w-12">Tooth</th>
              <th colSpan={3} className="px-1 py-1 text-center">Buccal (D/M/C)</th>
              <th className="px-1 py-1 text-center w-10">BOP</th>
              <th colSpan={3} className="px-1 py-1 text-center">Palatal (D/M/C)</th>
              <th className="px-1 py-1 text-center w-10">BOP</th>
            </tr>
          </thead>
          <tbody>
            {ALL_TEETH.map((t) => {
              const d = probeData[t];
              return (
                <tr key={t} className="border-b hover:bg-muted/20">
                  <td className="px-2 py-0.5 font-mono font-semibold">{t}</td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="buccal_d" value={d.buccal_d} /></td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="buccal_m" value={d.buccal_m} /></td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="buccal_c" value={d.buccal_c} /></td>
                  <td className="px-0.5 py-0.5 text-center">
                    <input type="checkbox" checked={d.buccal_bop} onChange={(e) => updateVal(t, "buccal_bop", e.target.checked)} />
                  </td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="palatal_d" value={d.palatal_d} /></td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="palatal_m" value={d.palatal_m} /></td>
                  <td className="px-0.5 py-0.5"><ProbeInput tooth={t} field="palatal_c" value={d.palatal_c} /></td>
                  <td className="px-0.5 py-0.5 text-center">
                    <input type="checkbox" checked={d.palatal_bop} onChange={(e) => updateVal(t, "palatal_bop", e.target.checked)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        <Save size={16} className="mr-2" />
        {saving ? "Saving..." : "Save Periodontal Chart"}
      </Button>
    </div>
  );
};

export default PeriodontalTab;
