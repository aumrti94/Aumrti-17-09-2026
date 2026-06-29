import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  item: { id: string; item_name: string; total_stock: number };
  onClose: () => void;
  onSaved: () => void;
}

const adjustTypes = [
  { value: "adjustment", label: "Stock Correction" },
  { value: "disposal", label: "Wastage / Disposal" },
  { value: "expired", label: "Expired Items" },
  { value: "return", label: "Return to Vendor" },
];

const StockAdjustmentModal: React.FC<Props> = ({ item, onClose, onSaved }) => {
  const { toast } = useToast();
  const [type, setType] = useState("adjustment");
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const quantity = parseInt(qty);
    if (!quantity || quantity <= 0) { toast({ title: "Enter valid quantity", variant: "destructive" }); return; }

    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!userData) { setSaving(false); return; }

    const finalQty = direction === "deduct" ? -quantity : quantity;

    await (supabase as any).from("stock_transactions").insert({
      hospital_id: userData.hospital_id,
      item_id: item.id,
      transaction_type: type,
      quantity: finalQty,
      notes,
      created_by: userData.id,
    });

    // Update stock
    const { data: stock } = await (supabase as any).from("inventory_stock").select("id, quantity_available").eq("item_id", item.id).limit(1).maybeSingle();
    if (stock) {
      await (supabase as any).from("inventory_stock").update({ quantity_available: Math.max(0, stock.quantity_available + finalQty) }).eq("id", stock.id);
    }

    toast({ title: `Stock ${direction === "add" ? "added" : "deducted"}: ${quantity} units` });
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

        <div className="flex gap-2">
          <Select value={direction} onValueChange={(v) => setDirection(v as "add" | "deduct")}>
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
