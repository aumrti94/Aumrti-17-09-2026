/**
 * IPD Device Management & Bundle Compliance Tab
 * Records device insertions/removals and daily prevention bundle checklists.
 * Used from IPDWorkspace — primarily ICU but available for all admissions.
 */
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Loader2, CheckCircle2, XCircle, Clock,
  Activity, AlertCircle, Trash2,
} from "lucide-react";
import { format, differenceInHours, parseISO } from "date-fns";

// ─── Bundle definitions ───────────────────────────────────────────────────────

type BundleKey = "central_line_insert" | "central_line_maintenance" | "urinary_catheter_maintenance" | "ventilator_bundle";

const BUNDLE_ELEMENTS: Record<BundleKey, Record<string, string>> = {
  central_line_insert: {
    hand_hygiene:      "Hand hygiene performed before insertion",
    full_barrier:      "Full barrier precautions (sterile gloves, gown, mask, large drape)",
    chlorhexidine:     "Chlorhexidine-based skin antisepsis allowed to dry",
    optimal_site:      "Optimal insertion site selected (subclavian preferred)",
    necessity:         "Necessity of central line confirmed by physician",
  },
  central_line_maintenance: {
    hand_hygiene:      "Hand hygiene before accessing the line",
    dressing_intact:   "Dressing intact, dry, and occlusive",
    tubing_changed:    "IV tubing changed as per protocol (≤96 h)",
    connector_changed: "Needleless connector changed per protocol",
    line_necessary:    "Daily review: line still clinically necessary?",
  },
  urinary_catheter_maintenance: {
    hand_hygiene:      "Hand hygiene performed",
    perineal_care:     "Perineal care performed with soap and water",
    bag_below_bladder: "Drainage bag maintained below bladder level",
    no_kinks:          "No kinks or dependent loops in tubing",
    catheter_necessary:"Daily review: catheter still clinically necessary?",
  },
  ventilator_bundle: {
    hob_elevation:     "Head-of-bed elevated 30–45 degrees (unless contraindicated)",
    oral_care:         "Oral care with chlorhexidine performed",
    sedation_holiday:  "Daily sedation interruption considered/performed",
    sbt:               "Spontaneous breathing trial performed or documented reason why not",
    dvt_prophylaxis:   "DVT prophylaxis in place",
  },
};

const DEVICE_BUNDLE_MAP: Record<string, BundleKey[]> = {
  central_line:      ["central_line_maintenance"],
  urinary_catheter:  ["urinary_catheter_maintenance"],
  ventilator:        ["ventilator_bundle"],
  peripheral_line:   [],
  tracheostomy:      [],
  others:            [],
};

const INSERT_BUNDLES: Record<string, BundleKey | null> = {
  central_line: "central_line_insert",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeviceUsage {
  id: string;
  device_type: string;
  device_inserted_at: string;
  device_removed_at: string | null;
  insertion_site: string | null;
  notes: string | null;
  inserted_by: string | null;
}

interface BundleChecklist {
  id: string;
  bundle_type: string;
  checklist_date: string;
  compliance_pct: number | null;
  device_type: string;
}

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

const DEVICE_LABELS: Record<string, string> = {
  central_line:       "Central Line",
  peripheral_line:    "Peripheral IV",
  urinary_catheter:   "Urinary Catheter",
  ventilator:         "Ventilator",
  tracheostomy:       "Tracheostomy",
  others:             "Other Device",
};

const DEVICE_COLOUR: Record<string, string> = {
  central_line:      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  peripheral_line:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  urinary_catheter:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  ventilator:        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  tracheostomy:      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  others:            "bg-muted text-muted-foreground",
};

const IPDDeviceTab: React.FC<Props> = ({ admissionId, hospitalId, userId, patientId }) => {
  const { toast } = useToast();
  const [devices, setDevices] = useState<DeviceUsage[]>([]);
  const [bundles, setBundles] = useState<BundleChecklist[]>([]);
  const [loading, setLoading] = useState(true);

  // Add device modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ device_type: "", insertion_site: "", notes: "" });
  const [addSaving, setAddSaving] = useState(false);

  // Bundle checklist modal
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleDevice, setBundleDevice] = useState<DeviceUsage | null>(null);
  const [bundleKey, setBundleKey] = useState<BundleKey | null>(null);
  const [bundleType, setBundleType] = useState<"insert" | "maintenance" | "removal">("maintenance");
  const [bundleElements, setBundleElements] = useState<Record<string, boolean>>({});
  const [bundleSaving, setBundleSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [dRes, bRes] = await Promise.all([
      (supabase as any)
        .from("ipc_device_usage")
        .select("id, device_type, device_inserted_at, device_removed_at, insertion_site, notes, inserted_by")
        .eq("admission_id", admissionId)
        .order("device_inserted_at", { ascending: false }),
      (supabase as any)
        .from("ipc_bundle_checklists")
        .select("id, bundle_type, checklist_date, compliance_pct, device_type")
        .eq("admission_id", admissionId)
        .order("checklist_date", { ascending: false })
        .limit(20),
    ]);
    setDevices(dRes.data || []);
    setBundles(bRes.data || []);
    setLoading(false);
  }, [admissionId]);

  useEffect(() => { load(); }, [load]);

  // ── Add device ──────────────────────────────────────────────────────────────
  const saveDevice = async () => {
    if (!hospitalId || !patientId || !addForm.device_type) {
      toast({ title: "Device type required", variant: "destructive" });
      return;
    }
    setAddSaving(true);
    const { data: device, error } = await (supabase as any).from("ipc_device_usage").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      device_type: addForm.device_type,
      insertion_site: addForm.insertion_site || null,
      notes: addForm.notes || null,
      inserted_by: userId ?? null,
    }).select().single();
    setAddSaving(false);
    if (error) { toast({ title: "Failed to add device", description: error.message, variant: "destructive" }); return; }

    // If there's an insertion bundle for this device, auto-open it
    const insertBundle = INSERT_BUNDLES[addForm.device_type];
    setDevices(prev => [device, ...prev]);
    setAddOpen(false);
    setAddForm({ device_type: "", insertion_site: "", notes: "" });
    toast({ title: `${DEVICE_LABELS[addForm.device_type]} recorded` });

    if (insertBundle) {
      openBundle(device, insertBundle, "insert");
    }
  };

  // ── Remove device ───────────────────────────────────────────────────────────
  const removeDevice = async (deviceId: string) => {
    const { error } = await (supabase as any).from("ipc_device_usage")
      .update({ device_removed_at: new Date().toISOString(), removed_by: userId ?? null })
      .eq("id", deviceId);
    if (error) { toast({ title: "Failed to remove device", variant: "destructive" }); return; }
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, device_removed_at: new Date().toISOString() } : d));
    toast({ title: "Device removal recorded" });
  };

  // ── Open bundle checklist ───────────────────────────────────────────────────
  const openBundle = (device: DeviceUsage, key: BundleKey, type: "insert" | "maintenance" | "removal") => {
    const elements = BUNDLE_ELEMENTS[key];
    const initial: Record<string, boolean> = {};
    Object.keys(elements).forEach(k => { initial[k] = false; });
    setBundleDevice(device);
    setBundleKey(key);
    setBundleType(type);
    setBundleElements(initial);
    setBundleOpen(true);
  };

  // ── Save bundle checklist ───────────────────────────────────────────────────
  const saveBundleChecklist = async () => {
    if (!hospitalId || !patientId || !bundleDevice || !bundleKey) return;
    setBundleSaving(true);
    const elementsStr: Record<string, string> = {};
    Object.entries(bundleElements).forEach(([k, v]) => { elementsStr[k] = String(v); });

    const { error } = await (supabase as any).from("ipc_bundle_checklists").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      device_usage_id: bundleDevice.id,
      device_type: bundleDevice.device_type,
      bundle_type: bundleType,
      checklist_date: new Date().toISOString().split("T")[0],
      completed_by: userId ?? null,
      elements: elementsStr,
    });
    setBundleSaving(false);
    if (error) { toast({ title: "Failed to save checklist", description: error.message, variant: "destructive" }); return; }

    toast({ title: "Bundle checklist saved" });
    setBundleOpen(false);
    load(); // refresh to get compliance_pct from DB
  };

  const deviceDays = (device: DeviceUsage): number => {
    const end = device.device_removed_at ? parseISO(device.device_removed_at) : new Date();
    return Math.round(differenceInHours(end, parseISO(device.device_inserted_at)) / 24 * 10) / 10;
  };

  const activeDevices = devices.filter(d => !d.device_removed_at);
  const removedDevices = devices.filter(d => d.device_removed_at);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">

      {/* Active devices */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Active Devices
          {activeDevices.length > 0 && (
            <Badge className="bg-red-100 text-red-700 text-[10px] px-1.5">{activeDevices.length}</Badge>
          )}
        </h3>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Device
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : activeDevices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-xs">
          No active devices. Add a device to start tracking.
        </div>
      ) : (
        <div className="space-y-2">
          {activeDevices.map(device => {
            const maintenanceBundles = DEVICE_BUNDLE_MAP[device.device_type] || [];
            const days = deviceDays(device);
            return (
              <div key={device.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-[10px] px-1.5 py-0", DEVICE_COLOUR[device.device_type])}>
                      {DEVICE_LABELS[device.device_type]}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">{days}d</span>
                    {days >= 7 && (
                      <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5">
                        ≥7 days — review necessity
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {maintenanceBundles.map(bk => (
                      <Button
                        key={bk}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => openBundle(device, bk, "maintenance")}
                      >
                        <CheckCircle2 className="h-3 w-3 text-green-500" /> Bundle Check
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => removeDevice(device.id)}
                      title="Record removal"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex gap-4 text-[10px] text-muted-foreground">
                  <span>Inserted: {format(parseISO(device.device_inserted_at), "dd MMM yyyy, HH:mm")}</span>
                  {device.insertion_site && <span>Site: {device.insertion_site}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent bundle checklists */}
      {bundles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            Recent Bundle Checklists
          </h3>
          <div className="space-y-1.5">
            {bundles.slice(0, 8).map(b => {
              const pct = b.compliance_pct ?? 0;
              return (
                <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border text-xs">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("text-[10px] px-1.5 py-0", DEVICE_COLOUR[b.device_type])}>
                      {DEVICE_LABELS[b.device_type] ?? b.device_type}
                    </Badge>
                    <span className="text-muted-foreground capitalize">{b.bundle_type}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{format(new Date(b.checklist_date), "dd MMM")}</span>
                    <span className={cn("font-semibold", pct >= 80 ? "text-green-600" : pct >= 60 ? "text-amber-600" : "text-red-600")}>
                      {pct != null ? `${pct}%` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recently removed devices */}
      {removedDevices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" /> Removed Devices
          </h3>
          {removedDevices.slice(0, 5).map(device => (
            <div key={device.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/30 text-xs opacity-70">
              <div className="flex items-center gap-2">
                <Badge className={cn("text-[10px] px-1.5 py-0", DEVICE_COLOUR[device.device_type])}>
                  {DEVICE_LABELS[device.device_type]}
                </Badge>
                <span className="text-muted-foreground">{deviceDays(device)} days total</span>
              </div>
              <span className="text-muted-foreground">
                Removed {format(parseISO(device.device_removed_at!), "dd MMM yyyy")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Add Device Modal ────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Device</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Device Type <span className="text-destructive">*</span></Label>
              <Select value={addForm.device_type} onValueChange={v => setAddForm(p => ({ ...p, device_type: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select device…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEVICE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Insertion Site</Label>
              <Input
                className="h-8 text-xs"
                value={addForm.insertion_site}
                onChange={e => setAddForm(p => ({ ...p, insertion_site: e.target.value }))}
                placeholder="e.g. Right subclavian, Right forearm…"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                className="text-xs resize-none"
                value={addForm.notes}
                onChange={e => setAddForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any relevant notes…"
              />
            </div>
            {addForm.device_type && INSERT_BUNDLES[addForm.device_type] && (
              <p className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Insertion bundle checklist will open after saving
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={saveDevice} disabled={addSaving}>
                {addSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add Device"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bundle Checklist Modal ──────────────────────────────────────────── */}
      <Dialog open={bundleOpen} onOpenChange={setBundleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Bundle Checklist — {bundleDevice ? DEVICE_LABELS[bundleDevice.device_type] : ""}
              <Badge variant="outline" className="text-[10px] capitalize">{bundleType}</Badge>
            </DialogTitle>
          </DialogHeader>
          {bundleKey && (
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                Mark each element as compliant. Date: {format(new Date(), "dd MMM yyyy")}
              </p>
              <div className="space-y-2.5">
                {Object.entries(BUNDLE_ELEMENTS[bundleKey]).map(([key, label]) => (
                  <div key={key} className="flex items-start gap-3">
                    <Checkbox
                      id={key}
                      checked={bundleElements[key] ?? false}
                      onCheckedChange={v => setBundleElements(p => ({ ...p, [key]: !!v }))}
                      className="mt-0.5"
                    />
                    <label htmlFor={key} className="text-xs text-foreground cursor-pointer leading-relaxed">
                      {label}
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="text-xs">
                  <span className="text-muted-foreground">Compliance: </span>
                  <span className={cn("font-bold", (() => {
                    const total = Object.keys(bundleElements).length;
                    const compliant = Object.values(bundleElements).filter(Boolean).length;
                    const pct = total ? Math.round((compliant / total) * 100) : 0;
                    return pct >= 80 ? "text-green-600" : pct >= 60 ? "text-amber-600" : "text-red-600";
                  })())}>
                    {(() => {
                      const total = Object.keys(bundleElements).length;
                      const compliant = Object.values(bundleElements).filter(Boolean).length;
                      return `${Math.round((compliant / (total || 1)) * 100)}%`;
                    })()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setBundleOpen(false)}>Cancel</Button>
                  <Button onClick={saveBundleChecklist} disabled={bundleSaving}>
                    {bundleSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Checklist"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IPDDeviceTab;
