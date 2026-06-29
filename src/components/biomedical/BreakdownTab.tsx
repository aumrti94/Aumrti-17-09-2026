import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, differenceInHours } from "date-fns";
import { useHospitalId } from '@/hooks/useHospitalId';

const REVENUE_PER_HOUR = 15000;

const SEV_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-300 animate-pulse",
  high: "bg-red-50 text-red-600 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-muted text-muted-foreground border-border",
};

interface Props { onRefresh: () => void; }

const BreakdownTab: React.FC<Props> = ({ onRefresh }) => {
  const { hospitalId } = useHospitalId();
  const [logs, setLogs] = useState<any[]>([]);
  const [updating, setUpdating] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [updateForm, setUpdateForm] = useState({
    vendor_name: "", vendor_called_at: "", repair_started_at: "", repaired_at: "",
    root_cause: "", parts_replaced: "", repair_cost: "",
  });

  const load = async () => {
    const { data } = await supabase.from("breakdown_logs")
      .select("*, equipment_master(equipment_name, equipment_code, category)")
      .eq("hospital_id", hospitalId).order("reported_at", { ascending: false });
    setLogs(data || []);
  };

  useEffect(() => { load(); }, []);

  const openUpdate = (log: any) => {
    setUpdating(log);
    setUpdateForm({
      vendor_name: log.vendor_name || "", vendor_called_at: log.vendor_called_at?.slice(0, 16) || "",
      repair_started_at: log.repair_started_at?.slice(0, 16) || "", repaired_at: log.repaired_at?.slice(0, 16) || "",
      root_cause: log.root_cause || "", parts_replaced: log.parts_replaced || "", repair_cost: log.repair_cost?.toString() || "",
    });
  };

  const handleResolve = async () => {
    if (!updating) return;
    setSaving(true);
    const repairedAt = updateForm.repaired_at || new Date().toISOString();
    const downtime = differenceInHours(new Date(repairedAt), new Date(updating.reported_at));

    await supabase.from("breakdown_logs").update({
      status: "resolved",
      vendor_name: updateForm.vendor_name || null,
      vendor_called_at: updateForm.vendor_called_at || null,
      repair_started_at: updateForm.repair_started_at || null,
      repaired_at: repairedAt,
      root_cause: updateForm.root_cause || null,
      parts_replaced: updateForm.parts_replaced || null,
      repair_cost: updateForm.repair_cost ? Number(updateForm.repair_cost) : null,
      downtime_hrs: Math.max(0, downtime),
    }).eq("id", updating.id);

    await supabase.from("equipment_master").update({ status: "operational" }).eq("id", updating.equipment_id);

    setSaving(false); setUpdating(null); load(); onRefresh();
  };

  const activeBreakdowns = logs.filter((l) => l.status !== "resolved");
  const resolvedBreakdowns = logs.filter((l) => l.status === "resolved");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto space-y-2">
        {activeBreakdowns.length > 0 && (
          <>
            <p className="text-sm font-bold text-red-600">Active Breakdowns ({activeBreakdowns.length})</p>
            {activeBreakdowns.map((log) => {
              const elapsed = differenceInHours(new Date(), new Date(log.reported_at));
              const eq = log.equipment_master;
              const showRevenueLoss = eq && ["diagnostic", "radiation"].includes(eq.category);
              return (
                <div key={log.id} className={`rounded-lg border p-3 ${SEV_STYLES[log.severity] || ""}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold">{eq?.equipment_name} <span className="font-mono text-xs">({eq?.equipment_code})</span></p>
                      <p className="text-xs mt-0.5">{log.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <Badge variant="outline" className="text-[10px]">{log.severity}</Badge>
                        <span>Reported: {format(new Date(log.reported_at), "dd/MM HH:mm")}</span>
                        <span className="font-semibold">⏱ {elapsed}h elapsed</span>
                        {showRevenueLoss && <span className="text-red-600 font-bold">Est. revenue lost: ₹{(elapsed * REVENUE_PER_HOUR).toLocaleString("en-IN")}</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openUpdate(log)}>Update</Button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {resolvedBreakdowns.length > 0 && (
          <>
            <p className="text-sm font-bold text-muted-foreground mt-4">Resolved ({resolvedBreakdowns.length})</p>
            {resolvedBreakdowns.slice(0, 20).map((log) => {
              const eq = log.equipment_master;
              return (
                <div key={log.id} className="rounded-lg border border-border p-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{eq?.equipment_name} <span className="font-mono text-xs">({eq?.equipment_code})</span></p>
                      <p className="text-xs text-muted-foreground">{log.description.slice(0, 80)}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Downtime: {log.downtime_hrs || 0}h</span>
                        {log.repair_cost && <span>Cost: ₹{Number(log.repair_cost).toLocaleString("en-IN")}</span>}
                        {log.root_cause && <span>Cause: {log.root_cause}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {logs.length === 0 && <p className="text-center text-muted-foreground py-8">No breakdown records</p>}
      </div>

      <Dialog open={!!updating} onOpenChange={() => setUpdating(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Breakdown — {updating?.equipment_master?.equipment_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Vendor</Label><Input value={updateForm.vendor_name} onChange={(e) => setUpdateForm((f) => ({ ...f, vendor_name: e.target.value }))} /></div>
              <div><Label>Vendor Called At</Label><Input type="datetime-local" value={updateForm.vendor_called_at} onChange={(e) => setUpdateForm((f) => ({ ...f, vendor_called_at: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Repair Started</Label><Input type="datetime-local" value={updateForm.repair_started_at} onChange={(e) => setUpdateForm((f) => ({ ...f, repair_started_at: e.target.value }))} /></div>
              <div><Label>Repaired At</Label><Input type="datetime-local" value={updateForm.repaired_at} onChange={(e) => setUpdateForm((f) => ({ ...f, repaired_at: e.target.value }))} /></div>
            </div>
            <div><Label>Root Cause</Label><Textarea value={updateForm.root_cause} onChange={(e) => setUpdateForm((f) => ({ ...f, root_cause: e.target.value }))} rows={2} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Parts Replaced</Label><Input value={updateForm.parts_replaced} onChange={(e) => setUpdateForm((f) => ({ ...f, parts_replaced: e.target.value }))} /></div>
              <div><Label>Repair Cost (₹)</Label><Input type="number" value={updateForm.repair_cost} onChange={(e) => setUpdateForm((f) => ({ ...f, repair_cost: e.target.value }))} /></div>
            </div>
            <Button onClick={handleResolve} disabled={saving} className="w-full">{saving ? "Saving..." : "Mark Resolved"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BreakdownTab;
