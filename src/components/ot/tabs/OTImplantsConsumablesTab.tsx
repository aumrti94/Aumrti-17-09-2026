import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle2, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import { calcGST, roundCurrency } from "@/lib/currency";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { fetchPreAuthCeiling, type PreAuthCeiling } from "@/lib/insuranceCeiling";
import { deductCentralFEFO, reverseCentral } from "@/lib/inventoryStock";
import { Search } from "lucide-react";
import EnhancementRequestModal from "@/components/billing/EnhancementRequestModal";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface OTImplant {
  id: string;
  item_name: string;
  catalogue_number: string | null;
  manufacturer: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  cdsco_registration_number: string | null;
  unit_cost: number;
  quantity: number;
  billed: boolean;
}

interface OTConsumable {
  id: string;
  item_name: string;
  item_code: string | null;
  unit: string;
  unit_cost: number;
  quantity: number;
  billed: boolean;
  inventory_item_id?: string | null;
  stock_deducted?: boolean;
}

interface Props {
  schedule: OTSchedule;
  hospitalId: string | null;
  onRefresh: () => void;
}

const emptyImplant = (): Partial<OTImplant> => ({
  item_name: "", catalogue_number: "", manufacturer: "", lot_number: "",
  expiry_date: "", cdsco_registration_number: "", unit_cost: 0, quantity: 1,
});

const emptyConsumable = (): Partial<OTConsumable> => ({
  item_name: "", item_code: "", unit: "pcs", unit_cost: 0, quantity: 1,
});

const OTImplantsConsumablesTab: React.FC<Props> = ({ schedule, hospitalId, onRefresh }) => {
  const { toast } = useToast();
  const [implants, setImplants] = useState<OTImplant[]>([]);
  const [consumables, setConsumables] = useState<OTConsumable[]>([]);
  const [newImplant, setNewImplant] = useState<Partial<OTImplant>>(emptyImplant());
  const [newConsumable, setNewConsumable] = useState<Partial<OTConsumable>>(emptyConsumable());
  const [addingImplant, setAddingImplant] = useState(false);
  const [addingConsumable, setAddingConsumable] = useState(false);
  const [billing, setBilling] = useState(false);
  // Inventory link for consumables (enables stock deduction)
  const [conLinkedItemId, setConLinkedItemId] = useState<string | null>(null);
  const [conItemSearch, setConItemSearch] = useState("");
  const [conItemResults, setConItemResults] = useState<any[]>([]);

  const searchConItems = async (q: string) => {
    setConItemSearch(q);
    if (!hospitalId || q.length < 2) { setConItemResults([]); return; }
    const { data } = await (supabase as any).from("inventory_items")
      .select("id, item_name, item_code, uom").eq("hospital_id", hospitalId).eq("is_active", true)
      .ilike("item_name", `%${q}%`).limit(6);
    setConItemResults(data || []);
  };
  const pickConItem = (it: any) => {
    setNewConsumable({ ...newConsumable, item_name: it.item_name, item_code: it.item_code || "", unit: it.uom || "pcs" });
    setConLinkedItemId(it.id);
    setConItemSearch(""); setConItemResults([]);
  };

  // Pre-auth ceiling enforcement (same convention as LineItemsTab) — implants can be
  // expensive enough on their own to blow past a TPA-approved ceiling that ordinary
  // line-item entry already respects.
  const [preAuthCeiling, setPreAuthCeiling] = useState<PreAuthCeiling | null>(null);
  const [enhancementBlocked, setEnhancementBlocked] = useState<{
    implants: OTImplant[];
    total: number;
    runningNow: number;
  } | null>(null);

  useEffect(() => {
    if (!schedule.admission_id || !hospitalId) { setPreAuthCeiling(null); return; }
    fetchPreAuthCeiling(schedule.admission_id, hospitalId).then(setPreAuthCeiling);
  }, [schedule.admission_id, hospitalId]);

  const fetchData = useCallback(async () => {
    const [{ data: imp }, { data: con }] = await Promise.all([
      (supabase as any).from("ot_implants").select("*").eq("schedule_id", schedule.id).order("created_at"),
      (supabase as any).from("ot_consumables").select("*").eq("schedule_id", schedule.id).order("created_at"),
    ]);
    setImplants(imp || []);
    setConsumables(con || []);
  }, [schedule.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addImplant = async () => {
    if (!newImplant.item_name?.trim() || !hospitalId) return;
    if (!newImplant.cdsco_registration_number?.trim()) {
      toast({ title: "CDSCO registration number is required", variant: "destructive" });
      return;
    }
    const { error } = await (supabase as any).from("ot_implants").insert({
      hospital_id: hospitalId,
      schedule_id: schedule.id,
      item_name: newImplant.item_name.trim(),
      catalogue_number: newImplant.catalogue_number || null,
      manufacturer: newImplant.manufacturer || null,
      lot_number: newImplant.lot_number || null,
      expiry_date: newImplant.expiry_date || null,
      cdsco_registration_number: newImplant.cdsco_registration_number.trim(),
      unit_cost: Number(newImplant.unit_cost) || 0,
      quantity: Number(newImplant.quantity) || 1,
    });
    if (error) { toast({ title: "Failed to add implant", variant: "destructive" }); return; }
    setNewImplant(emptyImplant());
    setAddingImplant(false);
    fetchData();
  };

  const addConsumable = async () => {
    if (!newConsumable.item_name?.trim() || !hospitalId) return;
    const qty = Number(newConsumable.quantity) || 1;
    const { error } = await (supabase as any).from("ot_consumables").insert({
      hospital_id: hospitalId,
      schedule_id: schedule.id,
      item_name: newConsumable.item_name.trim(),
      item_code: newConsumable.item_code || null,
      unit: newConsumable.unit || "pcs",
      unit_cost: Number(newConsumable.unit_cost) || 0,
      quantity: qty,
      inventory_item_id: conLinkedItemId,
      stock_deducted: !!conLinkedItemId,
    });
    if (error) { toast({ title: "Failed to add consumable", variant: "destructive" }); return; }
    // Deduct from central inventory when linked to a master item
    if (conLinkedItemId) {
      await deductCentralFEFO({
        hospitalId, itemId: conLinkedItemId, qty,
        ledger: { transactionType: "ot_consumption", referenceId: schedule.id, referenceType: "ot", notes: `OT consumable — ${newConsumable.item_name.trim()}` },
      });
    }
    setNewConsumable(emptyConsumable());
    setConLinkedItemId(null);
    setAddingConsumable(false);
    fetchData();
  };

  const deleteImplant = async (id: string) => {
    await (supabase as any).from("ot_implants").delete().eq("id", id);
    fetchData();
  };

  const deleteConsumable = async (id: string) => {
    const row = consumables.find((c) => c.id === id);
    await (supabase as any).from("ot_consumables").delete().eq("id", id);
    if (row?.inventory_item_id && row.stock_deducted && hospitalId) {
      await reverseCentral({
        hospitalId, itemId: row.inventory_item_id, qty: row.quantity || 0,
        ledger: { transactionType: "ot_consumption_reversal", referenceId: schedule.id, referenceType: "ot", notes: `OT consumable removed — ${row.item_name}` },
      });
    }
    fetchData();
  };

  // Implants bill through bill_line_items (same table/GST/dedupe scheme as OT charges &
  // fees) so they land on the real OT bill instead of a separate, GST-less list.
  // Shared by implants and consumables. Consumables used to take a separate path that inserted
  // into "bill_items" — a table that has never existed — with admission_id/unit_price/total_price
  // columns that do not exist on bill_line_items either. That insert always failed, so OT
  // consumables were never billed; the error surfaced only as a toast. Routing them through this
  // helper reuses the bill resolution, dedupe and total recalculation that implants already had.
  const insertOtLineItems = async (
    unbilled: Array<{ id: string; item_name: string; unit_cost: number; quantity: number }>,
    kind: "implant" | "consumable",
    opts?: { isInsuranceCovered?: boolean },
  ): Promise<number> => {
    if (unbilled.length === 0 || !hospitalId || !schedule.admission_id) return 0;

    const { data: existingBill } = await supabase
      .from("bills")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", schedule.admission_id)
      .eq("bill_type", "ipd")
      .maybeSingle();

    let billId = existingBill?.id;
    if (!billId) {
      const billNum = await generateBillNumber(hospitalId, "BILL");
      const { data: newBill } = await supabase
        .from("bills")
        .insert({
          hospital_id: hospitalId,
          patient_id: schedule.patient_id,
          admission_id: schedule.admission_id,
          bill_number: billNum,
          bill_type: "ipd",
          bill_date: new Date().toISOString().split("T")[0],
          bill_status: "draft",
          payment_status: "unpaid",
          total_amount: 0,
          balance_due: 0,
        })
        .select("id")
        .maybeSingle();
      billId = newBill?.id;
    }
    if (!billId) return 0;

    const { data: existingKeys } = await (supabase as any)
      .from("bill_line_items")
      .select("source_dedupe_key")
      .eq("bill_id", billId)
      .eq("source_module", "ot");
    const existingSet = new Set<string>((existingKeys || []).map((k: any) => k.source_dedupe_key).filter(Boolean));
    const label = kind === "implant" ? "Implant" : "Consumable";

    const lineItems = unbilled
      .map((i) => {
        const total = roundCurrency(i.unit_cost * i.quantity);
        const gst = calcGST(total, 12);
        const li: Record<string, unknown> = {
          hospital_id: hospitalId, bill_id: billId,
          item_type: kind,
          description: `${label}: ${i.item_name}`,
          quantity: i.quantity, unit_rate: i.unit_cost,
          taxable_amount: total, gst_percent: 12, gst_amount: gst,
          total_amount: roundCurrency(total + gst),
          // HSN 9021 is the orthopaedic-appliance heading and applies to implants only; a
          // consumable's HSN varies by item, so it is left unset rather than asserted wrongly.
          ...(kind === "implant" ? { hsn_code: "9021" } : {}),
          source_module: "ot",
          source_record_id: schedule.id,
          source_dedupe_key: `ot:${schedule.id}:${kind}:${i.id}`,
        };
        if (opts?.isInsuranceCovered === false) li.is_insurance_covered = false;
        return li;
      })
      .filter((li) => !existingSet.has(li.source_dedupe_key as string));

    if (lineItems.length > 0) {
      await supabase.from("bill_line_items").insert(lineItems as never[]);
      await recalculateBillTotalsSafe(billId);
    }

    await (supabase as any)
      .from(kind === "implant" ? "ot_implants" : "ot_consumables")
      .update({ billed: true })
      .in("id", unbilled.map((i) => i.id));
    return unbilled.length;
  };

  // Pre-auth ceiling enforcement (IPD insurance bills only) — mirrors LineItemsTab's
  // addServiceItem guard. Implants can be expensive enough on their own to exceed a
  // TPA-approved ceiling that ordinary line-item entry already blocks on.
  const billImplants = async (unbilled: OTImplant[]): Promise<number> => {
    if (unbilled.length === 0 || !hospitalId || !schedule.admission_id) return 0;

    if (preAuthCeiling) {
      const { data: existingBill } = await supabase
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", schedule.admission_id)
        .eq("bill_type", "ipd")
        .maybeSingle();

      let runningNow = 0;
      if (existingBill?.id) {
        const { data: items } = await supabase
          .from("bill_line_items")
          .select("total_amount")
          .eq("bill_id", existingBill.id);
        runningNow = roundCurrency((items || []).reduce((s, i: any) => s + Number(i.total_amount), 0));
      }

      const newImplantsTotal = roundCurrency(
        unbilled.reduce((s, i) => {
          const total = roundCurrency(i.unit_cost * i.quantity);
          return s + roundCurrency(total + calcGST(total, 12));
        }, 0)
      );
      const projectedTotal = roundCurrency(runningNow + newImplantsTotal);

      if (projectedTotal > preAuthCeiling.ceiling) {
        setEnhancementBlocked({ implants: unbilled, total: newImplantsTotal, runningNow });
        return 0;
      }
    }

    return insertOtLineItems(unbilled, "implant");
  };

  const billAll = async () => {
    const unbilledImplants = implants.filter((i) => !i.billed);
    const unbilledConsumables = consumables.filter((c) => !c.billed);

    if (unbilledImplants.length === 0 && unbilledConsumables.length === 0) {
      toast({ title: "All items already billed" });
      return;
    }
    if (!schedule.admission_id) {
      toast({ title: "No linked admission", description: "This case is not linked to an IPD admission. Items cannot be auto-billed.", variant: "destructive" });
      return;
    }

    setBilling(true);
    let billedCount = 0;

    try {
      billedCount += await billImplants(unbilledImplants);
    } catch {
      toast({ title: "Failed to bill implants", variant: "destructive" });
    }

    if (unbilledConsumables.length > 0) {
      // Was a direct insert into "bill_items" — a table that has never existed — with
      // admission_id/unit_price/total_price columns that bill_line_items does not have either.
      // It always failed, so OT consumables were never billed. insertOtLineItems() resolves or
      // creates the IPD bill, applies GST, dedupes on source_dedupe_key, recalculates the bill
      // total and marks the rows billed — the same path implants already use.
      try {
        billedCount += await insertOtLineItems(unbilledConsumables, "consumable");
      } catch (e) {
        toast({
          title: "Failed to bill consumables",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      }
    }

    toast({ title: `${billedCount} item(s) billed` });
    fetchData();
    setBilling(false);
  };

  const implantTotal = implants.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
  const consumableTotal = consumables.reduce((s, c) => s + c.unit_cost * c.quantity, 0);
  const grandTotal = implantTotal + consumableTotal;
  const unbilledCount = implants.filter((i) => !i.billed).length + consumables.filter((c) => !c.billed).length;
  const isReadOnly = schedule.status === "completed" || schedule.status === "cancelled";

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Totals banner */}
      <div className="flex items-center gap-3 bg-muted/40 rounded-lg px-4 py-2.5">
        <IndianRupee size={15} className="text-muted-foreground" />
        <div className="flex-1">
          <span className="text-xs text-muted-foreground">Implants </span>
          <span className="text-sm font-bold text-foreground">₹{implantTotal.toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground mx-2">+</span>
          <span className="text-xs text-muted-foreground">Consumables </span>
          <span className="text-sm font-bold text-foreground">₹{consumableTotal.toLocaleString("en-IN")}</span>
          <span className="text-muted-foreground mx-2">=</span>
          <span className="text-sm font-bold text-primary">₹{grandTotal.toLocaleString("en-IN")}</span>
        </div>
        {!isReadOnly && unbilledCount > 0 && (
          <button
            onClick={billAll}
            disabled={billing}
            className="flex items-center gap-1.5 text-[12px] bg-emerald-500 text-white px-3 py-1.5 rounded-md font-semibold hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50"
          >
            <CheckCircle2 size={13} />
            {billing ? "Billing…" : `Bill All (${unbilledCount})`}
          </button>
        )}
      </div>

      {/* Implants section */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-wide">🔩 Implants ({implants.length})</h3>
          {!isReadOnly && (
            <button
              onClick={() => setAddingImplant(true)}
              className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
            >
              <Plus size={12} /> Add Implant
            </button>
          )}
        </div>

        {implants.length === 0 && !addingImplant && (
          <p className="text-[12px] text-muted-foreground py-2">No implants recorded</p>
        )}

        {implants.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden mb-2">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Catalogue #</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Lot / Expiry</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">CDSCO #</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Qty</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Unit ₹</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Total</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {implants.map((imp) => (
                  <tr key={imp.id} className={cn("border-t border-border/60", imp.billed && "bg-emerald-50/50")}>
                    <td className="px-3 py-2 font-medium">
                      {imp.item_name}
                      {imp.billed && <span className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">BILLED</span>}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{imp.catalogue_number || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {imp.lot_number && <span>{imp.lot_number}</span>}
                      {imp.expiry_date && <span className="ml-1 text-[10px] text-amber-600">exp {imp.expiry_date}</span>}
                      {!imp.lot_number && !imp.expiry_date && "—"}
                    </td>
                    <td className="px-2 py-2">
                      {imp.cdsco_registration_number
                        ? <span className="text-muted-foreground">{imp.cdsco_registration_number}</span>
                        : <span className="text-[10px] text-red-500 font-medium">Missing</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{imp.quantity}</td>
                    <td className="px-2 py-2 text-right">₹{imp.unit_cost.toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2 text-right font-semibold">₹{(imp.unit_cost * imp.quantity).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2">
                      {!isReadOnly && !imp.billed && (
                        <button onClick={() => deleteImplant(imp.id)} className="text-destructive/70 hover:text-destructive transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add implant form */}
        {addingImplant && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Item Name *</label>
                <input
                  autoFocus
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. Titanium Hip Prosthesis"
                  value={newImplant.item_name || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, item_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Catalogue #</label>
                <input
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="CAT-12345"
                  value={newImplant.catalogue_number || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, catalogue_number: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Manufacturer</label>
                <input
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Manufacturer name"
                  value={newImplant.manufacturer || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, manufacturer: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Lot Number</label>
                <input
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="LOT-XXXX"
                  value={newImplant.lot_number || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, lot_number: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Expiry Date</label>
                <input
                  type="date"
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  value={newImplant.expiry_date || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, expiry_date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">CDSCO Registration # *</label>
                <input
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. MD-12345"
                  value={newImplant.cdsco_registration_number || ""}
                  onChange={(e) => setNewImplant({ ...newImplant, cdsco_registration_number: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Qty</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newImplant.quantity || 1}
                    onChange={(e) => setNewImplant({ ...newImplant, quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Unit Cost ₹</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newImplant.unit_cost || ""}
                    onChange={(e) => setNewImplant({ ...newImplant, unit_cost: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddingImplant(false); setNewImplant(emptyImplant()); }} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={addImplant} className="text-xs px-3 py-1.5 rounded-md bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all">Save Implant</button>
            </div>
          </div>
        )}
      </section>

      {/* Consumables section */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-wide">🧴 Consumables ({consumables.length})</h3>
          {!isReadOnly && (
            <button
              onClick={() => setAddingConsumable(true)}
              className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
            >
              <Plus size={12} /> Add Consumable
            </button>
          )}
        </div>

        {consumables.length === 0 && !addingConsumable && (
          <p className="text-[12px] text-muted-foreground py-2">No consumables recorded</p>
        )}

        {consumables.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden mb-2">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Code</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Unit</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Qty</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Unit ₹</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Total</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {consumables.map((con) => (
                  <tr key={con.id} className={cn("border-t border-border/60", con.billed && "bg-emerald-50/50")}>
                    <td className="px-3 py-2 font-medium">
                      {con.item_name}
                      {con.billed && <span className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">BILLED</span>}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{con.item_code || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{con.unit}</td>
                    <td className="px-2 py-2 text-right">{con.quantity}</td>
                    <td className="px-2 py-2 text-right">₹{con.unit_cost.toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2 text-right font-semibold">₹{(con.unit_cost * con.quantity).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2">
                      {!isReadOnly && !con.billed && (
                        <button onClick={() => deleteConsumable(con.id)} className="text-destructive/70 hover:text-destructive transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add consumable form */}
        {addingConsumable && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Search inventory item to deduct stock (optional)…"
                value={conItemSearch}
                onChange={(e) => searchConItems(e.target.value)}
              />
              {conItemResults.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-0.5 max-h-36 overflow-auto border border-border rounded-md bg-popover shadow">
                  {conItemResults.map((it) => (
                    <div key={it.id} onClick={() => pickConItem(it)} className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer">{it.item_name} <span className="text-muted-foreground">({it.uom})</span></div>
                  ))}
                </div>
              )}
              {conLinkedItemId && <p className="text-[10px] text-emerald-600 mt-0.5">✓ Linked — stock will be deducted on add</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Item Name *</label>
                <input
                  autoFocus
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. Surgical Drape"
                  value={newConsumable.item_name || ""}
                  onChange={(e) => setNewConsumable({ ...newConsumable, item_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Item Code</label>
                <input
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="SKU or code"
                  value={newConsumable.item_code || ""}
                  onChange={(e) => setNewConsumable({ ...newConsumable, item_code: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Unit</label>
                <select
                  className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                  value={newConsumable.unit || "pcs"}
                  onChange={(e) => setNewConsumable({ ...newConsumable, unit: e.target.value })}
                >
                  {["pcs", "box", "pair", "set", "ml", "L", "g", "kg", "roll", "pack"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Qty</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newConsumable.quantity || 1}
                    onChange={(e) => setNewConsumable({ ...newConsumable, quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Unit Cost ₹</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    value={newConsumable.unit_cost || ""}
                    onChange={(e) => setNewConsumable({ ...newConsumable, unit_cost: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddingConsumable(false); setNewConsumable(emptyConsumable()); }} className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={addConsumable} className="text-xs px-3 py-1.5 rounded-md bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all">Save Consumable</button>
            </div>
          </div>
        )}
      </section>

      {/* Pre-auth ceiling breach — enhancement request modal */}
      {enhancementBlocked && preAuthCeiling && hospitalId && schedule.admission_id && (
        <EnhancementRequestModal
          hospitalId={hospitalId}
          admissionId={schedule.admission_id}
          preAuthId={preAuthCeiling.preAuthId}
          preAuthNumber={preAuthCeiling.preAuthNumber}
          tpaName={preAuthCeiling.tpaName}
          currentApproved={preAuthCeiling.ceiling}
          runningTotal={enhancementBlocked.runningNow}
          serviceName={
            enhancementBlocked.implants.length === 1
              ? enhancementBlocked.implants[0].item_name
              : `${enhancementBlocked.implants.length} implants: ${enhancementBlocked.implants.map((i) => i.item_name).join(", ")}`
          }
          serviceAmount={enhancementBlocked.total}
          onMarkPatientPayable={async () => {
            const blocked = enhancementBlocked;
            setEnhancementBlocked(null);
            await insertOtLineItems(blocked.implants, "implant", { isInsuranceCovered: false });
            if (schedule.admission_id && hospitalId) {
              fetchPreAuthCeiling(schedule.admission_id, hospitalId).then(setPreAuthCeiling);
            }
            toast({
              title: `${blocked.implants.length} implant(s) marked as patient payable`,
              description: "Excluded from the TPA claim.",
            });
            fetchData();
          }}
          onClose={() => setEnhancementBlocked(null)}
        />
      )}
    </div>
  );
};

export default OTImplantsConsumablesTab;
