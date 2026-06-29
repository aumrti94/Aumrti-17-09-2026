import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pill, FlaskConical, Scan, X } from "lucide-react";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import type { BillRecord } from "@/pages/billing/BillingPage";

interface PharmacyRow {
  dispensing_id: string;
  drug_name: string;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  total_price: number;
}

interface LabRow {
  lab_order_id: string;
  test_id: string | null;
  test_name: string;
  fee: number;
}

interface RadRow {
  id: string;
  study_name: string;
  modality_type: string | null;
  fee: number;
}

interface Props {
  bill: BillRecord;
  hospitalId: string;
  onClose: () => void;
  onAdded: () => void;
}

const UnbilledServicesModal: React.FC<Props> = ({ bill, hospitalId, onClose, onAdded }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pharmacy, setPharmacy] = useState<PharmacyRow[]>([]);
  const [labs, setLabs] = useState<LabRow[]>([]);
  const [rads, setRads] = useState<RadRow[]>([]);
  const [selectedPharm, setSelectedPharm] = useState<Set<string>>(new Set());
  const [selectedLab, setSelectedLab] = useState<Set<string>>(new Set());
  const [selectedRad, setSelectedRad] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      if (!bill.admission_id) return;
      setLoading(true);

      // Pharmacy: aggregate items via dispensing headers linked to this admission, not yet billed
      const { data: dispHeaders } = await (supabase as any)
        .from("pharmacy_dispensing")
        .select("id")
        .eq("admission_id", bill.admission_id)
        .eq("billed", false);
      const dispIds = (dispHeaders || []).map((d: any) => d.id);
      let pharmRows: PharmacyRow[] = [];
      if (dispIds.length > 0) {
        const { data: items } = await (supabase as any)
          .from("pharmacy_dispensing_items")
          .select("dispensing_id, drug_name, quantity_dispensed, unit_price, gst_percent, total_price")
          .in("dispensing_id", dispIds);
        pharmRows = (items || []).map((i: any) => ({
          dispensing_id: i.dispensing_id,
          drug_name: i.drug_name,
          quantity: Number(i.quantity_dispensed) || 0,
          unit_price: Number(i.unit_price) || 0,
          gst_percent: Number(i.gst_percent) || 0,
          total_price: Number(i.total_price) || 0,
        }));
      }

      // Labs
      const { data: labOrders } = await supabase
        .from("lab_orders")
        .select("id")
        .eq("admission_id", bill.admission_id)
        .eq("billed", false);
      const labOrderIds = (labOrders || []).map((o: any) => o.id);
      let labRows: LabRow[] = [];
      if (labOrderIds.length > 0) {
        const { data: items } = await supabase
          .from("lab_order_items")
          .select("lab_order_id, test_id")
          .in("lab_order_id", labOrderIds);
        const testIds = Array.from(new Set((items || []).map((i: any) => i.test_id).filter(Boolean)));
        const { data: tests } = testIds.length
          ? await supabase.from("lab_test_master").select("id, test_name, fee").in("id", testIds)
          : { data: [] as any[] };
        const testMap = new Map((tests || []).map((t: any) => [t.id, t]));
        labRows = (items || []).map((i: any) => {
          const t = testMap.get(i.test_id);
          return {
            lab_order_id: i.lab_order_id,
            test_id: i.test_id,
            test_name: t?.test_name || "Lab Test",
            fee: Number(t?.fee) || 0,
          };
        });
      }

      // Radiology — no fee column on radiology_orders, look up modality fee
      const { data: radOrders } = await supabase
        .from("radiology_orders")
        .select("id, study_name, modality_type, modality_id")
        .eq("admission_id", bill.admission_id)
        .eq("billed", false);
      const modalityIds = Array.from(new Set((radOrders || []).map((r: any) => r.modality_id).filter(Boolean)));
      const { data: modalities } = modalityIds.length
        ? await (supabase as any).from("modalities").select("id, fee").in("id", modalityIds)
        : { data: [] as any[] };
      const modMap = new Map<string, number>((modalities || []).map((m: any) => [m.id as string, Number(m.fee) || 0]));
      const radRows: RadRow[] = (radOrders || []).map((r: any) => ({
        id: r.id,
        study_name: r.study_name,
        modality_type: r.modality_type,
        fee: modMap.get(r.modality_id) || 0,
      }));

      setPharmacy(pharmRows);
      setLabs(labRows);
      setRads(radRows);
      // Default all checked
      setSelectedPharm(new Set(pharmRows.map((_, idx) => String(idx))));
      setSelectedLab(new Set(labRows.map((_, idx) => String(idx))));
      setSelectedRad(new Set(radRows.map((r) => r.id)));
      setLoading(false);
    };
    load();
  }, [bill.admission_id]);

  const togglePharm = (key: string) => {
    const next = new Set(selectedPharm);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedPharm(next);
  };
  const toggleLab = (key: string) => {
    const next = new Set(selectedLab);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedLab(next);
  };
  const toggleRad = (key: string) => {
    const next = new Set(selectedRad);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedRad(next);
  };

  const totalSelected =
    selectedPharm.size + selectedLab.size + selectedRad.size;

  const handleAdd = async () => {
    if (totalSelected === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setSaving(true);

    const rows: any[] = [];
    const dispIdsToMark = new Set<string>();
    const labOrderIdsToMark = new Set<string>();
    const radIdsToMark = new Set<string>();

    pharmacy.forEach((p, idx) => {
      if (!selectedPharm.has(String(idx))) return;
      const taxable = p.quantity * p.unit_price;
      const gstAmt = (taxable * p.gst_percent) / 100;
      rows.push({
        hospital_id: hospitalId,
        bill_id: bill.id,
        item_type: "pharmacy",
        description: p.drug_name,
        quantity: p.quantity,
        unit_rate: p.unit_price,
        discount_percent: 0,
        discount_amount: 0,
        taxable_amount: taxable,
        gst_percent: p.gst_percent,
        gst_amount: gstAmt,
        total_amount: p.total_price || taxable + gstAmt,
        source_module: "pharmacy",
        source_record_id: p.dispensing_id,
      });
      dispIdsToMark.add(p.dispensing_id);
    });

    labs.forEach((l, idx) => {
      if (!selectedLab.has(String(idx))) return;
      rows.push({
        hospital_id: hospitalId,
        bill_id: bill.id,
        item_type: "lab",
        description: l.test_name,
        quantity: 1,
        unit_rate: l.fee,
        discount_percent: 0,
        discount_amount: 0,
        taxable_amount: l.fee,
        gst_percent: 0,
        gst_amount: 0,
        total_amount: l.fee,
        source_module: "lab",
        source_record_id: l.lab_order_id,
      });
      labOrderIdsToMark.add(l.lab_order_id);
    });

    rads.forEach((r) => {
      if (!selectedRad.has(r.id)) return;
      rows.push({
        hospital_id: hospitalId,
        bill_id: bill.id,
        item_type: "radiology",
        description: r.study_name,
        quantity: 1,
        unit_rate: r.fee,
        discount_percent: 0,
        discount_amount: 0,
        taxable_amount: r.fee,
        gst_percent: 0,
        gst_amount: 0,
        total_amount: r.fee,
        source_module: "radiology",
        source_record_id: r.id,
      });
      radIdsToMark.add(r.id);
    });

    const { error: insertErr } = await supabase.from("bill_line_items").insert(rows);
    if (insertErr) {
      toast({ title: "Failed to add items", description: insertErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Mark sources as billed
    if (dispIdsToMark.size > 0) {
      await (supabase as any).from("pharmacy_dispensing").update({ billed: true }).in("id", Array.from(dispIdsToMark));
    }
    if (labOrderIdsToMark.size > 0) {
      await supabase.from("lab_orders").update({ billed: true } as any).in("id", Array.from(labOrderIdsToMark));
    }
    if (radIdsToMark.size > 0) {
      await supabase.from("radiology_orders").update({ billed: true } as any).in("id", Array.from(radIdsToMark));
    }

    await recalculateBillTotalsSafe(bill.id);

    toast({ title: `${rows.length} item${rows.length === 1 ? "" : "s"} added to bill` });
    setSaving(false);
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold">Unbilled Services — {bill.patient_name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Services consumed during this admission that have not been added to a bill yet
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="animate-spin" size={18} /> Loading unbilled services...
            </div>
          ) : (
            <>
              {/* Pharmacy */}
              <Section
                icon={<Pill size={14} />}
                title="Pharmacy Dispenses"
                count={pharmacy.length}
                color="text-secondary"
              >
                {pharmacy.length === 0 ? (
                  <EmptyRow label="No unbilled pharmacy dispenses" />
                ) : (
                  pharmacy.map((p, idx) => {
                    const key = String(idx);
                    const checked = selectedPharm.has(key);
                    return (
                      <Row
                        key={`p-${idx}`}
                        checked={checked}
                        onToggle={() => togglePharm(key)}
                        title={p.drug_name}
                        meta={`Qty ${p.quantity} × ₹${p.unit_price.toFixed(2)}${p.gst_percent ? ` · GST ${p.gst_percent}%` : ""}`}
                        amount={p.total_price || p.quantity * p.unit_price * (1 + p.gst_percent / 100)}
                      />
                    );
                  })
                )}
              </Section>

              {/* Lab */}
              <Section
                icon={<FlaskConical size={14} />}
                title="Lab Orders"
                count={labs.length}
                color="text-success"
              >
                {labs.length === 0 ? (
                  <EmptyRow label="No unbilled lab orders" />
                ) : (
                  labs.map((l, idx) => {
                    const key = String(idx);
                    const checked = selectedLab.has(key);
                    return (
                      <Row
                        key={`l-${idx}`}
                        checked={checked}
                        onToggle={() => toggleLab(key)}
                        title={l.test_name}
                        meta="Single test"
                        amount={l.fee}
                      />
                    );
                  })
                )}
              </Section>

              {/* Radiology */}
              <Section
                icon={<Scan size={14} />}
                title="Radiology Orders"
                count={rads.length}
                color="text-accent"
              >
                {rads.length === 0 ? (
                  <EmptyRow label="No unbilled radiology orders" />
                ) : (
                  rads.map((r) => {
                    const checked = selectedRad.has(r.id);
                    return (
                      <Row
                        key={r.id}
                        checked={checked}
                        onToggle={() => toggleRad(r.id)}
                        title={r.study_name}
                        meta={r.modality_type || "—"}
                        amount={r.fee}
                      />
                    );
                  })
                )}
              </Section>

              {pharmacy.length === 0 && labs.length === 0 && rads.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No unbilled services found for this admission.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-muted-foreground">
            {totalSelected} item{totalSelected === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving || totalSelected === 0 || loading}>
              {saving && <Loader2 className="animate-spin mr-1" size={14} />}
              Add Selected to Bill
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ icon: React.ReactNode; title: string; count: number; color: string; children: React.ReactNode }> = ({ icon, title, count, color, children }) => (
  <div>
    <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${color}`}>
      {icon} {title} <Badge variant="outline" className="text-[10px] h-5">{count}</Badge>
    </div>
    <div className="border border-border rounded-md divide-y divide-border bg-background/50">
      {children}
    </div>
  </div>
);

const Row: React.FC<{ checked: boolean; onToggle: () => void; title: string; meta: string; amount: number }> = ({ checked, onToggle, title, meta, amount }) => (
  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
    <Checkbox checked={checked} onCheckedChange={onToggle} />
    <div className="flex-1 min-w-0">
      <p className="text-sm text-foreground truncate">{title}</p>
      <p className="text-[11px] text-muted-foreground">{meta}</p>
    </div>
    <span className="text-sm font-semibold tabular-nums">₹{amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
  </label>
);

const EmptyRow: React.FC<{ label: string }> = ({ label }) => (
  <div className="px-3 py-3 text-xs text-muted-foreground text-center">{label}</div>
);

export default UnbilledServicesModal;
