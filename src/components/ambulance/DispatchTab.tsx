import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { autoChargeService, MODULE_AMBULANCE } from "@/lib/serviceBilling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type DispatchStatus = "dispatched" | "en_route" | "at_scene" | "transporting" | "completed";

interface Dispatch {
  id: string;
  status: DispatchStatus;
  pickup_location: string | null;
  destination: string | null;
  complaint: string | null;
  vehicle_id: string | null;
  crew_names: string[] | null;
  call_received_at: string;
  vehicle_no?: string;
}

interface Vehicle { id: string; vehicle_no: string; }

const COLUMNS: { key: DispatchStatus; label: string; color: string }[] = [
  { key: "dispatched", label: "Dispatched", color: "border-blue-400 bg-blue-50" },
  { key: "en_route", label: "En Route", color: "border-amber-400 bg-amber-50" },
  { key: "at_scene", label: "At Scene", color: "border-purple-400 bg-purple-50" },
  { key: "transporting", label: "Transporting", color: "border-orange-400 bg-orange-50" },
  { key: "completed", label: "Completed", color: "border-green-400 bg-green-50" },
];

const STATUS_TIMESTAMPS: Partial<Record<DispatchStatus, string>> = {
  dispatched: "dispatch_at",
  at_scene: "pickup_at",
  completed: "arrival_at",
};

const DispatchTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [form, setForm] = useState({
    vehicle_id: "", pickup_location: "", destination: "", complaint: "", crew_names: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    const [dispRes, vehRes] = await Promise.all([
      (supabase as any).from("ambulance_dispatches")
        .select("*, ambulance_vehicles!ambulance_dispatches_vehicle_id_fkey(vehicle_no)")
        .eq("hospital_id", hospitalId).eq("is_deleted", false)
        .gte("call_received_at", `${today}T00:00:00`).order("call_received_at", { ascending: false }),
      (supabase as any).from("ambulance_vehicles")
        .select("id, vehicle_no").eq("hospital_id", hospitalId).eq("is_active", true).eq("is_deleted", false),
    ]);
    setDispatches((dispRes.data || []).map((d: any) => ({
      ...d, vehicle_no: d.ambulance_vehicles?.vehicle_no,
    })));
    setVehicles(vehRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const createDispatch = async () => {
    if (!form.pickup_location || !hospitalId) {
      toast({ title: "Pickup location is required", variant: "destructive" }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("ambulance_dispatches").insert({
      hospital_id: hospitalId,
      vehicle_id: form.vehicle_id || null,
      pickup_location: form.pickup_location,
      destination: form.destination || null,
      complaint: form.complaint || null,
      crew_names: form.crew_names ? form.crew_names.split(",").map(s => s.trim()).filter(Boolean) : null,
      dispatch_at: new Date().toISOString(),
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Dispatch created" }); setShowForm(false); setForm({ vehicle_id: "", pickup_location: "", destination: "", complaint: "", crew_names: "" }); load(); }
    setSaving(false);
  };

  const moveDispatch = async (dispatchId: string, newStatus: DispatchStatus) => {
    const updates: Record<string, any> = { status: newStatus };
    const tsField = STATUS_TIMESTAMPS[newStatus];
    if (tsField) updates[tsField] = new Date().toISOString();
    await (supabase as any).from("ambulance_dispatches").update(updates).eq("id", dispatchId);

    // Wire billing when trip is completed
    if (newStatus === "completed" && hospitalId) {
      const { data: dispatch } = await (supabase as any)
        .from("ambulance_dispatches")
        .select("patient_id, pickup_location, destination, billing_status")
        .eq("id", dispatchId).maybeSingle();

      if (dispatch && dispatch.billing_status !== "billed" && dispatch.patient_id) {
        autoChargeService({
          hospitalId,
          patientId:     dispatch.patient_id,
          serviceName:   `Ambulance Trip — ${dispatch.pickup_location || "Pickup"} → ${dispatch.destination || "Hospital"}`,
          serviceModule: MODULE_AMBULANCE,
          sourceTable:   "ambulance_dispatches",
          sourceId:      dispatchId,
          serviceDate:   new Date().toISOString().split("T")[0],
        }).catch(() => {});
      }
    }

    load();
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, status: DispatchStatus) => {
    e.preventDefault();
    if (dragId) { moveDispatch(dragId, status); setDragId(null); }
  };

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading dispatch board…</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b">
        <span className="text-sm font-semibold">Today's Dispatches</span>
        <Button size="sm" className="ml-auto" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New Dispatch
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex flex-1 gap-2 p-3 overflow-x-auto">
        {COLUMNS.map(col => {
          const cards = dispatches.filter(d => d.status === col.key);
          return (
            <div key={col.key}
              className={cn("flex-1 min-w-40 rounded-lg border-2 p-2 flex flex-col", col.color)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, col.key)}>
              <p className="text-xs font-bold mb-2">{col.label} <span className="ml-1 bg-white px-1.5 rounded-full">{cards.length}</span></p>
              {cards.map(d => (
                <div key={d.id} draggable
                  onDragStart={e => handleDragStart(e, d.id)}
                  className="mb-2 p-2 bg-white rounded border shadow-sm cursor-grab text-xs">
                  {d.vehicle_no && <p className="font-semibold text-primary">🚑 {d.vehicle_no}</p>}
                  {d.complaint && <p className="font-medium">{d.complaint}</p>}
                  <div className="flex items-center gap-1 text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3" />
                    <span>{d.pickup_location || "—"}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(d.call_received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  {d.crew_names && d.crew_names.length > 0 && (
                    <p className="text-muted-foreground mt-0.5">👥 {d.crew_names.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Dispatch</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Pickup Location *</label>
              <Input placeholder="Patient address / location" value={form.pickup_location}
                onChange={e => setForm(f => ({ ...f, pickup_location: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Destination</label>
              <Input placeholder="Hospital / Destination" value={form.destination}
                onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Chief Complaint</label>
              <Input placeholder="RTA, chest pain, etc." value={form.complaint}
                onChange={e => setForm(f => ({ ...f, complaint: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Vehicle</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.vehicle_id} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">— Select Vehicle —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_no}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Crew Names (comma separated)</label>
              <Input placeholder="Ravi Kumar, Priya Sharma" value={form.crew_names}
                onChange={e => setForm(f => ({ ...f, crew_names: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={createDispatch} disabled={saving}>
                {saving ? "Dispatching…" : "Dispatch"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DispatchTab;
