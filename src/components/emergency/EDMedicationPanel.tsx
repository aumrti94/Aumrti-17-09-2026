import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_ED } from "@/lib/serviceBilling";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Pill, AlertTriangle } from "lucide-react";
import { useConfigValues } from "@/hooks/useConfigValues";

interface MedRow {
  id: string;
  drug_name: string;
  dose: string | null;
  route: string | null;
  administered_at: string;
  notes: string | null;
  ed_charge_item_id: string | null;
}

interface Props {
  hospitalId: string;
  userId: string | null;
  edVisitId: string;
  patientId: string;
  patientName: string;
  allergies?: string;          // from AMPLE history (visit.ample_history.a)
  onClose: () => void;
  onAdministered?: () => void;  // refresh parent charge totals when a med is billed
}


/**
 * ED medication administration record (eMAR) — Phase 7.
 * Records administered emergency drugs, warns on a likely allergy match against the
 * AMPLE allergies, and optionally bills the drug/consumable via the Phase-1 ed_charge_items.
 */
const EDMedicationPanel: React.FC<Props> = ({
  hospitalId, userId, edVisitId, patientId, patientName, allergies, onClose, onAdministered,
}) => {
  // Emergency keeps its own route shorthand ("PO (oral)", "Nebulized") rather than
  // the pharmacy drug_routes vocabulary — see configValueDefaults.ts.
  const routes = useConfigValues("emergency_drug_routes");
  const [rows, setRows] = useState<MedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [drugName, setDrugName] = useState("");
  const [dose, setDose] = useState("");
  const [route, setRoute] = useState("IV");
  const [notes, setNotes] = useState("");
  const [billConsumable, setBillConsumable] = useState(false);
  const [rate, setRate] = useState("");

  const loadRows = useCallback(async () => {
    const { data } = await (supabase as any).from("ed_medications")
      .select("id, drug_name, dose, route, administered_at, notes, ed_charge_item_id")
      .eq("ed_visit_id", edVisitId)
      .order("administered_at", { ascending: false });
    setRows((data as MedRow[]) || []);
    setLoading(false);
  }, [edVisitId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Likely-allergy detection: token match between the drug name and recorded allergies.
  const allergyHit = useMemo(() => {
    const list = (allergies || "").split(/[,;/]+/).map(s => s.trim().toLowerCase()).filter(a => a.length > 2);
    const drug = drugName.trim().toLowerCase();
    if (!drug) return null;
    const match = list.find(a => drug.includes(a) || a.includes(drug));
    return match || null;
  }, [allergies, drugName]);

  const administer = async () => {
    if (!drugName.trim()) { toast({ title: "Enter a drug name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let chargeItemId: string | null = null;

      // Optional: bill the drug / consumable via the Phase-1 ed_charge_items path.
      if (billConsumable) {
        const r = parseFloat(rate) || 0;
        if (r <= 0) { toast({ title: "Enter a rate to bill", variant: "destructive" }); setSaving(false); return; }
        const { data: chargeRow, error: cErr } = await (supabase as any).from("ed_charge_items").insert({
          hospital_id: hospitalId,
          ed_visit_id: edVisitId,
          patient_id:  patientId,
          description: `${drugName.trim()}${dose ? ` ${dose}` : ""}`,
          category:    "consumable",
          quantity:    1,
          unit_rate:   r,
          gst_percent: 0,
          performed_by: userId,
        }).select("id").maybeSingle();
        if (cErr || !chargeRow) throw new Error(cErr?.message || "Could not create charge");
        chargeItemId = chargeRow.id;
        await autoChargeService({
          hospitalId, patientId,
          encounterId:   edVisitId,
          serviceName:   `${drugName.trim()}${dose ? ` ${dose}` : ""}`,
          serviceModule: MODULE_ED,
          sourceTable:   "ed_charge_items",
          sourceId:      chargeItemId,
          unitRate:      r,
          performedBy:   userId,
        });
      }

      const { error } = await (supabase as any).from("ed_medications").insert({
        hospital_id: hospitalId,
        ed_visit_id: edVisitId,
        patient_id:  patientId,
        drug_name:   drugName.trim(),
        dose:        dose.trim() || null,
        route,
        administered_by: userId,
        notes:       notes.trim() || null,
        ed_charge_item_id: chargeItemId,
      });
      if (error) throw new Error(error.message);

      toast({ title: "Medication recorded", description: `${drugName.trim()} administered.` });
      setDrugName(""); setDose(""); setRoute("IV"); setNotes(""); setBillConsumable(false); setRate("");
      await loadRows();
      if (chargeItemId) onAdministered?.();
    } catch (e: any) {
      toast({ title: "Could not record medication", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-4 w-4" /> Medications — {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {allergies?.trim() && (
            <p className="text-[11px] text-muted-foreground">
              Recorded allergies: <span className="font-medium text-foreground">{allergies}</span>
            </p>
          )}

          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Drug</label>
                <Input value={drugName} onChange={e => setDrugName(e.target.value)} className="mt-1 h-9" placeholder="e.g. Inj. Adrenaline" />
              </div>
              <div className="w-24">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Dose</label>
                <Input value={dose} onChange={e => setDose(e.target.value)} className="mt-1 h-9" placeholder="1 mg" />
              </div>
              <div className="w-32">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Route</label>
                <Select value={route} onValueChange={setRoute}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {routes.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {allergyHit && (
              <div className="flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-700 text-xs font-medium">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Allergy alert — patient is recorded allergic to “{allergyHit}”. Confirm before administering.
              </div>
            )}

            <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9" placeholder="Notes (optional)" />

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
                <input type="checkbox" checked={billConsumable} onChange={e => setBillConsumable(e.target.checked)} className="rounded" />
                Bill as consumable
              </label>
              {billConsumable && (
                <Input type="number" min="0" value={rate} onChange={e => setRate(e.target.value)} className="h-8 w-24" placeholder="Rate ₹" />
              )}
              <Button onClick={administer} disabled={saving} className="ml-auto h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Administer
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-1.5">Administered this visit</p>
            {loading ? (
              <p className="text-xs text-muted-foreground py-3 text-center">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No medications recorded yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="py-1 font-medium">Time</th>
                    <th className="py-1 font-medium">Drug</th>
                    <th className="py-1 font-medium">Dose</th>
                    <th className="py-1 font-medium">Route</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{new Date(r.administered_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-1.5 pr-2">{r.drug_name}{r.ed_charge_item_id ? " 💲" : ""}</td>
                      <td className="py-1.5 pr-2">{r.dose || "—"}</td>
                      <td className="py-1.5">{r.route || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EDMedicationPanel;
