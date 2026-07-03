import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_ED, getEdItemRate } from "@/lib/serviceBilling";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Receipt } from "lucide-react";

interface ProcedureOption {
  id: string;
  name: string;
  fee: number;
  gst_applicable: boolean;
  gst_percent: number;
}

interface ChargeRow {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unit_rate: number;
  gst_percent: number;
  billing_status: string;
}

interface Props {
  hospitalId: string;
  userId: string | null;
  edVisitId: string;
  patientId: string;
  patientName: string;
  onClose: () => void;
  onCharged: () => void;
}

/**
 * Itemized ED charges (Phase 1). Lets ED staff bill procedures / observation /
 * consumables during the visit. Each charge is an ed_charge_items row billed via
 * autoChargeService onto the shared ED bill (encounter = ed_visit). Additive to the
 * flat casualty fee, which continues to bill separately on discharge/admit.
 */
const EDChargesPanel: React.FC<Props> = ({ hospitalId, userId, edVisitId, patientId, patientName, onClose, onCharged }) => {
  const [procedures, setProcedures] = useState<ProcedureOption[]>([]);
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Procedure quick-charge
  const [procId, setProcId] = useState("");
  const [procQty, setProcQty] = useState("1");

  // Observation quick-charge
  const [obsHours, setObsHours] = useState("");
  const [obsRate, setObsRate] = useState<{ fee: number; gstPct: number }>({ fee: 0, gstPct: 0 });

  // Misc / consumable charge
  const [miscDesc, setMiscDesc] = useState("");
  const [miscRate, setMiscRate] = useState("");
  const [miscQty, setMiscQty] = useState("1");

  const loadRows = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("ed_charge_items")
      .select("id, description, category, quantity, unit_rate, gst_percent, billing_status")
      .eq("ed_visit_id", edVisitId)
      .order("created_at", { ascending: true });
    setRows((data as ChargeRow[]) || []);
    setLoading(false);
  }, [edVisitId]);

  useEffect(() => {
    // Seeded ED procedures come from service_master (category = 'procedure').
    supabase.from("service_master")
      .select("id, name, fee, gst_applicable, gst_percent")
      .eq("hospital_id", hospitalId)
      .eq("category", "procedure")
      .order("name")
      .then(({ data }) => setProcedures((data as ProcedureOption[]) || []));
    getEdItemRate(hospitalId, "ed_observation").then(setObsRate);
    loadRows();
  }, [hospitalId, loadRows]);

  // Insert an ed_charge_items row, then bill it via autoChargeService onto the ED bill.
  const chargeItem = async (opts: {
    description: string; category: string; quantity: number; unitRate: number; gstPercent: number;
  }) => {
    if (opts.unitRate <= 0) {
      toast({ title: "Set a rate first", description: "This item has no rate configured.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: row, error } = await (supabase as any).from("ed_charge_items").insert({
        hospital_id:  hospitalId,
        ed_visit_id:  edVisitId,
        patient_id:   patientId,
        description:  opts.description,
        category:     opts.category,
        quantity:     opts.quantity,
        unit_rate:    opts.unitRate,
        gst_percent:  opts.gstPercent,
        performed_by: userId,
      }).select("id").maybeSingle();
      if (error || !row) throw new Error(error?.message || "Could not save charge");

      await autoChargeService({
        hospitalId,
        patientId,
        encounterId:   edVisitId,          // shared ED bill keyed by the ED visit
        serviceName:   opts.description,
        serviceModule: MODULE_ED,
        sourceTable:   "ed_charge_items",
        sourceId:      row.id,
        quantity:      opts.quantity,
        unitRate:      opts.unitRate,
        gstPercent:    opts.gstPercent,
        performedBy:   userId,
      });

      toast({ title: "Charge added", description: `${opts.description} billed to the ED bill.` });
      await loadRows();
      onCharged();
    } catch (e: any) {
      toast({ title: "Could not add charge", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addProcedure = () => {
    const p = procedures.find(x => x.id === procId);
    if (!p) { toast({ title: "Select a procedure", variant: "destructive" }); return; }
    const qty = Math.max(1, parseFloat(procQty) || 1);
    chargeItem({
      description: p.name,
      category:    "procedure",
      quantity:    qty,
      unitRate:    Number(p.fee) || 0,
      gstPercent:  p.gst_applicable ? Number(p.gst_percent) || 0 : 0,
    }).then(() => { setProcId(""); setProcQty("1"); });
  };

  const addObservation = () => {
    const hrs = parseFloat(obsHours) || 0;
    if (hrs <= 0) { toast({ title: "Enter observation hours", variant: "destructive" }); return; }
    chargeItem({
      description: `Observation / ED Bed (${hrs} hr)`,
      category:    "observation",
      quantity:    hrs,
      unitRate:    obsRate.fee,
      gstPercent:  obsRate.gstPct,
    }).then(() => setObsHours(""));
  };

  const addMisc = () => {
    if (!miscDesc.trim()) { toast({ title: "Enter a description", variant: "destructive" }); return; }
    const rate = parseFloat(miscRate) || 0;
    const qty = Math.max(1, parseFloat(miscQty) || 1);
    chargeItem({
      description: miscDesc.trim(),
      category:    "consumable",
      quantity:    qty,
      unitRate:    rate,
      gstPercent:  0,
    }).then(() => { setMiscDesc(""); setMiscRate(""); setMiscQty("1"); });
  };

  const lineTotal = (r: ChargeRow) => {
    const taxable = r.quantity * r.unit_rate;
    return taxable + (taxable * (Number(r.gst_percent) || 0)) / 100;
  };
  const grandTotal = rows.reduce((s, r) => s + lineTotal(r), 0);

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> ED Charges — {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Procedure quick-charge */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Add Procedure</p>
            {procedures.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No procedures configured. Add them in Settings › Services &amp; Fees › Procedures
                (use “Load Default Procedures”).
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Procedure</label>
                  <Select value={procId} onValueChange={setProcId}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select procedure" /></SelectTrigger>
                    <SelectContent>
                      {procedures.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} — ₹{Number(p.fee).toLocaleString("en-IN")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-16">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Qty</label>
                  <Input type="number" min="1" value={procQty} onChange={e => setProcQty(e.target.value)} className="mt-1 h-9" />
                </div>
                <Button onClick={addProcedure} disabled={saving || !procId} className="h-9">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          {/* Observation quick-charge */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Observation / ED Bed</p>
            {obsRate.fee <= 0 ? (
              <p className="text-xs text-muted-foreground">
                Set an hourly rate in Settings › Services &amp; Fees › Emergency to enable this.
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Hours (₹{obsRate.fee}/hr)</label>
                  <Input type="number" min="0" step="0.5" value={obsHours} onChange={e => setObsHours(e.target.value)} className="mt-1 h-9" placeholder="e.g. 4" />
                </div>
                <Button onClick={addObservation} disabled={saving} className="h-9">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          {/* Misc / consumable */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Misc / Consumable</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Description</label>
                <Input value={miscDesc} onChange={e => setMiscDesc(e.target.value)} className="mt-1 h-9" placeholder="e.g. IV set, Inj. Adrenaline" />
              </div>
              <div className="w-20">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Rate ₹</label>
                <Input type="number" min="0" value={miscRate} onChange={e => setMiscRate(e.target.value)} className="mt-1 h-9" />
              </div>
              <div className="w-14">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Qty</label>
                <Input type="number" min="1" value={miscQty} onChange={e => setMiscQty(e.target.value)} className="mt-1 h-9" />
              </div>
              <Button onClick={addMisc} disabled={saving} className="h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Existing charges */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-1.5">Charges on this visit</p>
            {loading ? (
              <p className="text-xs text-muted-foreground py-3 text-center">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No itemized charges yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="py-1 font-medium">Item</th>
                    <th className="py-1 font-medium text-right">Qty</th>
                    <th className="py-1 font-medium text-right">Rate</th>
                    <th className="py-1 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="py-1.5 pr-2">{r.description}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.quantity}</td>
                      <td className="py-1.5 text-right tabular-nums">₹{Number(r.unit_rate).toLocaleString("en-IN")}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">₹{lineTotal(r).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-2" colSpan={3}>Total (excl. casualty fee)</td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-muted-foreground mt-2">
              Labs, radiology and pharmacy ordered in the ED are billed by their own modules.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EDChargesPanel;
