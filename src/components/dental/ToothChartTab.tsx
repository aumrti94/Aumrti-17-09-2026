import React, { useState } from "react";
import FDIToothChart, { type ChartData } from "./FDIToothChart";
import { type Surface, type ToothStatus } from "./ToothSVG";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

const STATUSES: { label: string; value: ToothStatus }[] = [
  { label: "Normal", value: "normal" },
  { label: "Caries", value: "caries" },
  { label: "Filling", value: "filling" },
  { label: "Crown", value: "crown" },
  { label: "RCT", value: "rct" },
  { label: "Missing", value: "missing" },
  { label: "Implant", value: "implant" },
  { label: "Bridge", value: "bridge" },
  { label: "Extraction Planned", value: "extraction_planned" },
];

const STATUS_BADGE_COLORS: Record<ToothStatus, string> = {
  normal: "bg-white text-foreground border",
  caries: "bg-red-500 text-white",
  filling: "bg-blue-500 text-white",
  crown: "bg-yellow-500 text-white",
  rct: "bg-pink-500 text-white",
  missing: "bg-gray-400 text-white",
  implant: "bg-green-500 text-white",
  bridge: "bg-orange-500 text-white",
  extraction_planned: "bg-red-300 text-white",
};

interface ToothChartTabProps {
  patientId: string;
  hospitalId: string;
  chartData: ChartData;
  setChartData: React.Dispatch<React.SetStateAction<ChartData>>;
  oralHygiene: string;
  setOralHygiene: (v: string) => void;
  calculus: string;
  setCalculus: (v: string) => void;
  softTissueNotes: string;
  setSoftTissueNotes: (v: string) => void;
  chartId: string | null;
  userId: string | null;
}

const ToothChartTab: React.FC<ToothChartTabProps> = ({
  patientId, hospitalId, chartData, setChartData,
  oralHygiene, setOralHygiene, calculus, setCalculus,
  softTissueNotes, setSoftTissueNotes, chartId, userId,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ tooth: number; surface: Surface } | null>(null);

  const handleSurfaceClick = (tooth: number, surface: Surface) => {
    setModal({ tooth, surface });
  };

  const applyStatus = (status: ToothStatus) => {
    if (!modal) return;
    setChartData((prev) => {
      const existing = prev[modal.tooth] || { surfaces: {} };
      const newSurfaces = { ...existing.surfaces, [modal.surface]: status };
      const overallStatus = status === "missing" ? "missing" : existing.overallStatus;
      return { ...prev, [modal.tooth]: { ...existing, surfaces: newSurfaces, overallStatus } };
    });
    setModal(null);
  };

  const handleSave = async () => {
    if (!userId) { toast({ title: "Please log in first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: any = {
        hospital_id: hospitalId,
        patient_id: patientId,
        created_by: userId,
        chart_date: new Date().toISOString().split("T")[0],
        chart_data: chartData as any,
        oral_hygiene: oralHygiene || null,
        calculus: calculus || null,
        soft_tissue_notes: softTissueNotes || null,
      };

      if (chartId) {
        const { error } = await supabase.from("dental_charts").update(payload).eq("id", chartId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("dental_charts").insert(payload);
        if (error) throw error;
      }
      toast({ title: "Chart saved successfully" });
    } catch (err: any) {
      console.error("Save chart error:", err);
      toast({ title: "Failed to save chart", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
      <div className="bg-card rounded-lg border p-4">
        <FDIToothChart chartData={chartData} onSurfaceClick={handleSurfaceClick} />
      </div>

      <div className="bg-card rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-semibold">Oral Hygiene Assessment</h4>
        <div className="flex gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Oral Hygiene</p>
            <div className="flex gap-1">
              {["good", "fair", "poor"].map((v) => (
                <Button key={v} size="sm" variant={oralHygiene === v ? "default" : "outline"} onClick={() => setOralHygiene(v)} className="capitalize h-8 text-xs">{v}</Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Calculus</p>
            <div className="flex gap-1">
              {["none", "mild", "moderate", "heavy"].map((v) => (
                <Button key={v} size="sm" variant={calculus === v ? "default" : "outline"} onClick={() => setCalculus(v)} className="capitalize h-8 text-xs">{v}</Button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Soft Tissue Notes</p>
          <Textarea value={softTissueNotes} onChange={(e) => setSoftTissueNotes(e.target.value)} placeholder="Gingival findings, mucosal lesions..." rows={2} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        <Save size={16} className="mr-2" />
        {saving ? "Saving..." : "Save Chart"}
      </Button>

      <Dialog open={!!modal} onOpenChange={() => setModal(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Tooth {modal?.tooth} — Surface {modal?.surface}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {STATUSES.map((s) => (
              <Badge key={s.value} className={`cursor-pointer justify-center py-2 ${STATUS_BADGE_COLORS[s.value]}`} onClick={() => applyStatus(s.value)}>{s.label}</Badge>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ToothChartTab;
