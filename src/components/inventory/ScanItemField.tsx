import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// USB keyboard-wedge scan input: a barcode gun types the code then sends Enter.
// On Enter we resolve the code against inventory_items (barcode or item_code) and
// hand the matched item to the caller. No camera / decode library.

interface Props {
  hospitalId: string;
  onItem: (item: any) => void;
  placeholder?: string;
  className?: string;
}

const ScanItemField: React.FC<Props> = ({ hospitalId, onItem, placeholder, className }) => {
  const { toast } = useToast();
  const [value, setValue] = useState("");

  const resolve = async () => {
    const code = value.trim();
    if (!code) return;
    const { data } = await (supabase as any)
      .from("inventory_items")
      .select("id, item_name, item_code, barcode, uom, gst_percent, reorder_level, minimum_order_qty, category")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .or(`barcode.eq.${code},item_code.eq.${code}`)
      .limit(1);
    const item = data?.[0];
    setValue("");
    if (item) onItem(item);
    else toast({ title: `No item found for "${code}"`, variant: "destructive" });
  };

  return (
    <div className={`relative ${className || ""}`}>
      <ScanLine className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        className="pl-8 h-8 text-xs w-full border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={placeholder || "Scan barcode…"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolve(); } }}
      />
    </div>
  );
};

export default ScanItemField;
