import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoPostJournalEntry } from "@/lib/accounting";

interface Props {
  item: { id: string; item_name: string; total_stock: number };
  onClose: () => void;
  onSaved: () => void;
}

interface Batch {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity_available: number;
  cost_price: number | null;
}

const adjustTypes = [
  { value: "adjustment", label: "Stock Correction" },
  { value: "disposal", label: "Wastage / Disposal" },
  { value: "expired", label: "Expired Items" },
  { value: "return", label: "Return to Vendor" },
];

const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);

const StockAdjustmentModal: React.FC<Props> = ({ item, onClose, onSaved }) => {
  const { toast } = useToast();
  const [type, setType] = useState("adjustment");
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("auto");
  const [newBatch, setNewBatch] = useState({ batch_number: "", expiry_date: "", cost_price: "" });

  useEffect(() => {
    (supabase as any)
      .from("inventory_stock")
      .select("id, batch_number, expiry_date, quantity_available, cost_price")
      .eq("item_id", item.id)
      .order("expiry_date", { ascending: true })
      .then(({ data }: any) => setBatches(data || []));
  }, [item.id]);

  // Disposal / expired / return only ever remove stock
  useEffect(() => {
    if (type === "expired" || type === "disposal" || type === "return") setDirection("deduct");
  }, [type]);

  const isExpiryWriteOff = type === "expired";
  // For expired write-off, only expired/expiring batches are eligible targets
  const deductTargets = isExpiryWriteOff
    ? batches.filter((b) => { const d = daysTo(b.expiry_date); return d !== null && d <= 0; })
    : batches;

  const batchLabel = (b: Batch) => {
    const d = daysTo(b.expiry_date);
    const exp = b.expiry_date ? ` • exp ${b.expiry_date}${d !== null && d < 0 ? " (expired)" : d !== null && d <= 30 ? ` (${d}d)` : ""}` : "";
    return `${b.batch_number || "No batch"}${exp} • ${b.quantity_available} on hand`;
  };

  const handleSave = async () => {
    const quantity = parseInt(qty);
    if (!quantity || quantity <= 0) { toast({ title: "Enter valid quantity", variant: "destructive" }); return; }

    setSaving(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", authUser?.id).maybeSingle();
    if (!userData) { setSaving(false); return; }

    const finalQty = direction === "deduct" ? -quantity : quantity;
    let deductedValue = 0;

    if (direction === "deduct") {
      const targets = selectedBatchId === "auto"
        ? deductTargets
        : deductTargets.filter((b) => b.id === selectedBatchId);
      if (targets.length === 0) {
        toast({ title: isExpiryWriteOff ? "No expired batches to write off" : "No batch selected", variant: "destructive" });
        setSaving(false); return;
      }
      let remaining = quantity;
      for (const b of targets) {
        if (remaining <= 0) break;
        const take = Math.min(b.quantity_available, remaining);
        remaining -= take;
        deductedValue += take * (b.cost_price || 0);
        await (supabase as any).from("inventory_stock").update({ quantity_available: b.quantity_available - take }).eq("id", b.id);
      }
      if (remaining > 0) {
        toast({ title: `Only ${quantity - remaining} available — deducted what was on hand`, variant: "destructive" });
      }
    } else {
      // Add
      if (selectedBatchId === "new") {
        await (supabase as any).from("inventory_stock").insert({
          hospital_id: userData.hospital_id,
          item_id: item.id,
          batch_number: newBatch.batch_number || null,
          expiry_date: newBatch.expiry_date || null,
          quantity_available: quantity,
          cost_price: newBatch.cost_price ? Number(newBatch.cost_price) : null,
          last_received_date: new Date().toISOString().slice(0, 10),
        });
      } else {
        const target = selectedBatchId === "auto" ? batches[0] : batches.find((b) => b.id === selectedBatchId);
        if (target) {
          await (supabase as any).from("inventory_stock").update({ quantity_available: target.quantity_available + quantity }).eq("id", target.id);
        } else {
          await (supabase as any).from("inventory_stock").insert({
            hospital_id: userData.hospital_id, item_id: item.id, quantity_available: quantity,
            last_received_date: new Date().toISOString().slice(0, 10),
          });
        }
      }
    }

    // Ledger
    await (supabase as any).from("stock_transactions").insert({
      hospital_id: userData.hospital_id,
      item_id: item.id,
      transaction_type: type,
      quantity: finalQty,
      notes,
      created_by: userData.id,
    });

    // Return to vendor reverses the GRN purchase (Dr AP / Cr Purchase). Expired/disposal
    // write-offs post nothing — purchases are already expensed at GRN, so re-posting would
    // double-count.
    if (type === "return" && deductedValue > 0) {
      await autoPostJournalEntry({
        triggerEvent: "vendor_return",
        sourceModule: "inventory",
        sourceId: item.id,
        amount: deductedValue,
        description: `Return to vendor — ${item.item_name}${notes ? ` (${notes})` : ""}`,
        hospitalId: userData.hospital_id,
        postedBy: userData.id,
      });
    }

    toast({ title: `Stock ${direction === "add" ? "added" : "adjusted"}: ${quantity} units` });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Adjust Stock — {item.item_name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Current stock: <span className="font-bold text-foreground">{item.total_stock}</span></p>

        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {adjustTypes.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Batch targeting */}
        <div>
          <label className="text-[11px] text-muted-foreground">{direction === "deduct" ? "Deduct from batch" : "Add to batch"}</label>
          <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {direction === "deduct" ? (
                <>
                  {!isExpiryWriteOff && <SelectItem value="auto" className="text-xs">Auto (FEFO — oldest expiry first)</SelectItem>}
                  {deductTargets.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{batchLabel(b)}</SelectItem>)}
                  {isExpiryWriteOff && deductTargets.length === 0 && <SelectItem value="none" disabled className="text-xs">No expired batches</SelectItem>}
                </>
              ) : (
                <>
                  <SelectItem value="auto" className="text-xs">Existing (first batch)</SelectItem>
                  {batches.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{batchLabel(b)}</SelectItem>)}
                  <SelectItem value="new" className="text-xs">+ New batch…</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {direction === "add" && selectedBatchId === "new" && (
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Batch no." value={newBatch.batch_number} onChange={(e) => setNewBatch({ ...newBatch, batch_number: e.target.value })} className="h-8 text-xs" />
            <Input type="date" value={newBatch.expiry_date} onChange={(e) => setNewBatch({ ...newBatch, expiry_date: e.target.value })} className="h-8 text-xs" />
            <Input type="number" placeholder="Cost" value={newBatch.cost_price} onChange={(e) => setNewBatch({ ...newBatch, cost_price: e.target.value })} className="h-8 text-xs" />
          </div>
        )}

        <div className="flex gap-2">
          <Select value={direction} onValueChange={(v) => setDirection(v as "add" | "deduct")} disabled={type !== "adjustment"}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="add" className="text-xs">+ Add</SelectItem>
              <SelectItem value="deduct" className="text-xs">− Deduct</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 text-xs" />
        </div>

        <Textarea placeholder="Reason / Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs min-h-[60px]" />

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs">{saving ? "Saving..." : "Save Adjustment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StockAdjustmentModal;
