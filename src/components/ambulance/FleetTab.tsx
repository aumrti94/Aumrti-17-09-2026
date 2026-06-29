import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Vehicle {
  id: string;
  vehicle_no: string;
  vehicle_type: string;
  driver_name: string | null;
  driver_phone: string | null;
  is_active: boolean;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  bls: "BLS",
  als: "ALS",
  nicu_transport: "NICU Transport",
  mortuary: "Mortuary",
};

const FleetTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicle_no: "", vehicle_type: "bls", driver_name: "", driver_phone: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("ambulance_vehicles")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("is_deleted", false)
      .order("vehicle_no");
    setVehicles(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.vehicle_no || !hospitalId) {
      toast({ title: "Vehicle number is required", variant: "destructive" }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("ambulance_vehicles").insert({
      hospital_id: hospitalId,
      vehicle_no: form.vehicle_no.trim().toUpperCase(),
      vehicle_type: form.vehicle_type,
      driver_name: form.driver_name || null,
      driver_phone: form.driver_phone || null,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Vehicle added" }); setShowForm(false); setForm({ vehicle_no: "", vehicle_type: "bls", driver_name: "", driver_phone: "" }); load(); }
    setSaving(false);
  };

  const toggleActive = async (v: Vehicle) => {
    await (supabase as any).from("ambulance_vehicles").update({ is_active: !v.is_active }).eq("id", v.id);
    load();
  };

  return (
    <div className="p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Ambulance Fleet</h3>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Vehicle
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading fleet…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {vehicles.map(v => (
            <div key={v.id} className={cn("border rounded-lg p-3 bg-card", !v.is_active && "opacity-50")}>
              <div className="flex items-center gap-2 mb-1">
                <Truck className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">{v.vehicle_no}</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type}
                </span>
              </div>
              {v.driver_name && <p className="text-xs text-muted-foreground">Driver: {v.driver_name}</p>}
              {v.driver_phone && <p className="text-xs text-muted-foreground">📞 {v.driver_phone}</p>}
              <Button size="sm" variant="ghost" className="mt-2 text-xs h-7" onClick={() => toggleActive(v)}>
                {v.is_active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          ))}
          {vehicles.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-3">No vehicles registered. Add your first vehicle above.</p>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Vehicle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Vehicle Number *</label>
              <Input placeholder="MH12AB1234" value={form.vehicle_no}
                onChange={e => setForm(f => ({ ...f, vehicle_no: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Type</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                {Object.entries(VEHICLE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Driver Name</label>
              <Input placeholder="Driver Name" value={form.driver_name}
                onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Driver Phone</label>
              <Input placeholder="9876543210" value={form.driver_phone}
                onChange={e => setForm(f => ({ ...f, driver_phone: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FleetTab;
