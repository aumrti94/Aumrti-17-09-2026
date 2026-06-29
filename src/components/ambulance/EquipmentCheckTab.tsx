import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertCircle, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";

const CHECKLIST_ITEMS = [
  "Oxygen cylinder (full)",
  "Oxygen mask & tubing",
  "Bag-valve mask (BVM)",
  "Defibrillator / AED",
  "Suction machine & catheters",
  "IV fluids (NS, RL x2 each)",
  "IV cannulas (assorted)",
  "Emergency drug kit (sealed)",
  "Stretcher & safety straps",
  "BP cuff & stethoscope",
  "Pulse oximeter",
  "ECG leads / monitor",
  "Cervical collar (assorted sizes)",
  "Trauma dressings & bandages",
  "Intubation kit (laryngoscope, ETT)",
];

type ItemStatus = "ok" | "not_ok" | "missing";

interface Vehicle { id: string; vehicle_no: string; }
interface CheckRecord {
  id: string;
  check_date: string;
  all_ok: boolean;
  remarks: string | null;
  checklist_json: Record<string, ItemStatus>;
  vehicle_id: string;
}

const StatusIcon = ({ s }: { s: ItemStatus }) => {
  if (s === "ok") return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (s === "not_ok") return <XCircle className="h-4 w-4 text-red-500" />;
  return <AlertCircle className="h-4 w-4 text-amber-500" />;
};

const EquipmentCheckTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>("");
  const [checks, setChecks] = useState<Record<string, ItemStatus>>({});
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<CheckRecord[]>([]);

  const initChecks = () => {
    const init: Record<string, ItemStatus> = {};
    CHECKLIST_ITEMS.forEach(item => { init[item] = "ok"; });
    setChecks(init);
  };

  const loadVehicles = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("ambulance_vehicles").select("id, vehicle_no")
      .eq("hospital_id", hospitalId).eq("is_active", true).eq("is_deleted", false);
    setVehicles(data || []);
    if (data?.length > 0 && !selectedVehicle) setSelectedVehicle(data[0].id);
  }, [hospitalId, selectedVehicle]);

  const loadHistory = useCallback(async () => {
    if (!hospitalId || !selectedVehicle) return;
    const { data } = await (supabase as any)
      .from("ambulance_equipment_checks").select("*")
      .eq("hospital_id", hospitalId).eq("vehicle_id", selectedVehicle)
      .eq("is_deleted", false).order("check_date", { ascending: false }).limit(10);
    setHistory(data || []);
  }, [hospitalId, selectedVehicle]);

  useEffect(() => { loadVehicles(); initChecks(); }, [loadVehicles]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const setItemStatus = (item: string, status: ItemStatus) => {
    setChecks(c => ({ ...c, [item]: status }));
  };

  const save = async () => {
    if (!selectedVehicle || !hospitalId) {
      toast({ title: "Select a vehicle first", variant: "destructive" }); return;
    }
    const allOk = Object.values(checks).every(s => s === "ok");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("ambulance_equipment_checks").insert({
      hospital_id: hospitalId,
      vehicle_id: selectedVehicle,
      checked_by: userData.user?.id,
      checklist_json: checks,
      all_ok: allOk,
      remarks: remarks || null,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: allOk ? "Equipment check: All OK ✓" : "Equipment check saved — issues noted" });
      await logNABHEvidence(hospitalId, "COP.3", `Daily ambulance equipment check completed for vehicle. All OK: ${allOk}`);
      setRemarks(""); initChecks(); loadHistory();
    }
    setSaving(false);
  };

  const vehicle = vehicles.find(v => v.id === selectedVehicle);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Checklist panel */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center gap-3 mb-4">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Daily Equipment Check</h3>
          <select className="ml-auto border rounded px-2 py-1 text-xs bg-background"
            value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_no}</option>)}
          </select>
        </div>

        <div className="space-y-2 mb-4">
          {CHECKLIST_ITEMS.map(item => (
            <div key={item} className="flex items-center gap-2 p-2 border rounded-md bg-card">
              <StatusIcon s={checks[item] || "ok"} />
              <span className="flex-1 text-sm">{item}</span>
              <div className="flex gap-1">
                {(["ok", "not_ok", "missing"] as ItemStatus[]).map(s => (
                  <button key={s}
                    className={cn("px-2 py-0.5 text-xs rounded border transition-colors",
                      checks[item] === s ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                    )}
                    onClick={() => setItemStatus(item, s)}>
                    {s === "ok" ? "OK" : s === "not_ok" ? "Fault" : "Missing"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-3">
          <label className="text-xs font-medium">Remarks</label>
          <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none"
            rows={2} placeholder="Any observations…" value={remarks}
            onChange={e => setRemarks(e.target.value)} />
        </div>

        <Button size="sm" onClick={save} disabled={saving || !selectedVehicle}>
          {saving ? "Saving…" : `Save Check${vehicle ? ` — ${vehicle.vehicle_no}` : ""}`}
        </Button>
      </div>

      {/* History panel */}
      <div className="w-64 border-l bg-muted/20 overflow-auto p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Recent Checks</p>
        {history.map(h => (
          <div key={h.id} className={cn("p-2 border rounded mb-2 text-xs", h.all_ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
            <p className="font-medium">{h.check_date}</p>
            <p className={h.all_ok ? "text-green-700" : "text-red-700"}>{h.all_ok ? "All OK" : "Issues found"}</p>
            {h.remarks && <p className="text-muted-foreground mt-0.5">{h.remarks}</p>}
          </div>
        ))}
        {history.length === 0 && <p className="text-xs text-muted-foreground">No history yet.</p>}
      </div>
    </div>
  );
};

export default EquipmentCheckTab;
