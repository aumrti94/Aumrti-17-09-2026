import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CheckCircle2, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface OTImplant {
  id: string;
  item_name: string;
  catalogue_number: string | null;
  manufacturer: string | null;
  lot_number: string | null;
  expiry_date: string | null;
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
}

interface Props {
  schedule: OTSchedule;
  hospitalId: string | null;
  onRefresh: () => void;
}

const emptyImplant = (): Partial<OTImplant> => ({
  item_name: "", catalogue_number: "", manufacturer: "", lot_number: "",
  expiry_date: "", unit_cost: 0, quantity: 1,
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
    const { error } = await (supabase as any).from("ot_implants").insert({
      hospital_id: hospitalId,
      schedule_id: schedule.id,
      item_name: newImplant.item_name.trim(),
      catalogue_number: newImplant.catalogue_number || null,
      manufacturer: newImplant.manufacturer || null,
      lot_number: newImplant.lot_number || null,
      expiry_date: newImplant.expiry_date || null,
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
    const { error } = await (supabase as any).from("ot_consumables").insert({
      hospital_id: hospitalId,
      schedule_id: schedule.id,
      item_name: newConsumable.item_name.trim(),
      item_code: newConsumable.item_code || null,
      unit: newConsumable.unit || "pcs",
      unit_cost: Number(newConsumable.unit_cost) || 0,
      quantity: Number(newConsumable.quantity) || 1,
    });
    if (error) { toast({ title: "Failed to add consumable", variant: "destructive" }); return; }
    setNewConsumable(emptyConsumable());
    setAddingConsumable(false);
    fetchData();
  };

  const deleteImplant = async (id: string) => {
    await (supabase as any).from("ot_implants").delete().eq("id", id);
    fetchData();
  };

  const deleteConsumable = async (id: string) => {
    await (supabase as any).from("ot_consumables").delete().eq("id", id);
    fetchData();
  };

  const billAll = async () => {
    if (!schedule.admission_id) {
      toast({ title: "No linked admission", description: "This case is not linked to an IPD admission. Items cannot be auto-billed.", variant: "destructive" });
      return;
    }
    setBilling(true);
    const unbilledImplants = implants.filter((i) => !i.billed);
    const unbilledConsumables = consumables.filter((c) => !c.billed);

    const billItems = [
      ...unbilledImplants.map((i) => ({
        admission_id: schedule.admission_id,
        item_name: `Implant: ${i.item_name}`,
        category: "implant",
        quantity: i.quantity,
        unit_price: i.unit_cost,
        total_price: i.unit_cost * i.quantity,
      })),
      ...unbilledConsumables.map((c) => ({
        admission_id: schedule.admission_id,
        item_name: `Consumable: ${c.item_name}`,
        category: "consumable",
        quantity: c.quantity,
        unit_price: c.unit_cost,
        total_price: c.unit_cost * c.quantity,
      })),
    ];

    if (billItems.length === 0) {
      toast({ title: "All items already billed" });
      setBilling(false);
      return;
    }

    const { error } = await (supabase as any).from("bill_items").insert(billItems);
    if (error) {
      toast({ title: "Billing failed", description: error.message, variant: "destructive" });
      setBilling(false);
      return;
    }

    // Mark as billed
    const impIds = unbilledImplants.map((i) => i.id);
    const conIds = unbilledConsumables.map((c) => c.id);
    if (impIds.length > 0) await (supabase as any).from("ot_implants").update({ billed: true }).in("id", impIds);
    if (conIds.length > 0) await (supabase as any).from("ot_consumables").update({ billed: true }).in("id", conIds);

    toast({ title: `${billItems.length} item(s) added to patient bill` });
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
    </div>
  );
};

export default OTImplantsConsumablesTab;
