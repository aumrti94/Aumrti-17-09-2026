import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

interface StoreLocation {
  id: string;
  name: string;
  type: string;
}

interface IndentRow {
  item_name: string;
  item_code: string;
  requested_qty: number;
  unit: string;
  remarks: string;
}

interface Props {
  hospitalId: string;
  fromStore: StoreLocation | null;
  onClose: () => void;
  onCreated: () => void;
}

const emptyRow = (): IndentRow => ({ item_name: "", item_code: "", requested_qty: 1, unit: "nos", remarks: "" });

const RaiseIndentModal: React.FC<Props> = ({ hospitalId, fromStore, onClose, onCreated }) => {
  const { toast } = useToast();
  const [toStores, setToStores] = useState<StoreLocation[]>([]);
  const [toStoreId, setToStoreId] = useState("");
  const [rows, setRows] = useState<IndentRow[]>([emptyRow()]);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<{ id: string; item_name: string; item_code: string; uom: string }[]>([]);
  const [search, setSearch] = useState("");
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  useEffect(() => {
    (supabase as any)
      .from("store_locations")
      .select("id, name, type")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .neq("id", fromStore?.id || "")
      .order("type")
      .then(({ data }: any) => {
        const stores: StoreLocation[] = data || [];
        setToStores(stores);
        const central = stores.find((s) => s.type === "central");
        if (central) setToStoreId(central.id);
        else if (stores.length > 0) setToStoreId(stores[0].id);
      });

    (supabase as any)
      .from("inventory_items")
      .select("id, item_name, item_code, uom")
      .eq("is_active", true)
      .order("item_name")
      .then(({ data }: any) => setInventoryItems(data || []));
  }, [hospitalId, fromStore?.id]);

  const filteredItems = inventoryItems.filter(
    (i) =>
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.item_code || "").toLowerCase().includes(search.toLowerCase())
  ).slice(0, 8);

  const updateRow = (idx: number, field: keyof IndentRow, value: string | number) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const selectItem = (idx: number, item: typeof inventoryItems[0]) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, item_name: item.item_name, item_code: item.item_code || "", unit: item.uom } : r));
    setSearch("");
    setFocusedRow(null);
  };

  const submit = async () => {
    const validRows = rows.filter((r) => r.item_name.trim() && r.requested_qty > 0);
    if (validRows.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    if (!toStoreId) { toast({ title: "Select destination store", variant: "destructive" }); return; }

    setSaving(true);
    const { data: indent, error: ie } = await (supabase as any).from("store_indents").insert({
      hospital_id: hospitalId,
      from_store_id: fromStore?.id || null,
      to_store_id: toStoreId,
      status: "pending",
      remarks: remarks || null,
    }).select().single();

    if (ie || !indent) {
      toast({ title: "Failed to create indent", description: ie?.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    const itemsPayload = validRows.map((r) => ({
      indent_id: indent.id,
      item_name: r.item_name.trim(),
      item_code: r.item_code || null,
      requested_qty: r.requested_qty,
      unit: r.unit || "nos",
      remarks: r.remarks || null,
    }));

    const { error: itemErr } = await (supabase as any).from("store_indent_items").insert(itemsPayload);
    if (itemErr) {
      toast({ title: "Items save failed", description: itemErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: `Indent ${indent.indent_number} raised successfully` });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-[680px] max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">Raise Indent</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              From: <span className="font-medium text-foreground">{fromStore?.name || "Unspecified"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* To store */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">Request To *</label>
              <select
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                value={toStoreId}
                onChange={(e) => setToStoreId(e.target.value)}
              >
                <option value="">— Select Store —</option>
                {toStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">Remarks</label>
              <input
                className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Reason or notes"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {/* Item search hint */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Items Requested</p>
              <button
                onClick={() => setRows([...rows, emptyRow()])}
                className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
              >
                <Plus size={12} /> Add Row
              </button>
            </div>

            <div className="rounded-lg border border-border overflow-visible">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium w-[40%]">Item Name</th>
                    <th className="text-left px-2 py-2 text-muted-foreground font-medium">Code</th>
                    <th className="text-left px-2 py-2 text-muted-foreground font-medium w-16">Qty</th>
                    <th className="text-left px-2 py-2 text-muted-foreground font-medium w-16">Unit</th>
                    <th className="text-left px-2 py-2 text-muted-foreground font-medium">Remarks</th>
                    <th className="px-2 py-2 w-7" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border/60">
                      <td className="px-2 py-1.5 relative">
                        <input
                          className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Search item…"
                          value={focusedRow === idx ? search || row.item_name : row.item_name}
                          onFocus={() => { setFocusedRow(idx); setSearch(row.item_name); }}
                          onChange={(e) => { setSearch(e.target.value); updateRow(idx, "item_name", e.target.value); }}
                          onBlur={() => setTimeout(() => setFocusedRow(null), 150)}
                        />
                        {focusedRow === idx && search && filteredItems.length > 0 && (
                          <div className="absolute left-2 top-full z-50 bg-card border border-border rounded-lg shadow-lg w-72 mt-0.5 overflow-hidden">
                            {filteredItems.map((item) => (
                              <button
                                key={item.id}
                                onMouseDown={() => selectItem(idx, item)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0"
                              >
                                <span className="font-medium">{item.item_name}</span>
                                {item.item_code && <span className="text-muted-foreground ml-2">{item.item_code}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Code"
                          value={row.item_code}
                          onChange={(e) => updateRow(idx, "item_code", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0.01}
                          step="any"
                          className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          value={row.requested_qty}
                          onChange={(e) => updateRow(idx, "requested_qty", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="nos"
                          value={row.unit}
                          onChange={(e) => updateRow(idx, "unit", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Optional"
                          value={row.remarks}
                          onChange={(e) => updateRow(idx, "remarks", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {rows.length > 1 && (
                          <button onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="text-destructive/60 hover:text-destructive transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          <p className="text-xs text-muted-foreground">{rows.filter((r) => r.item_name.trim()).length} item(s) added</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <button
              onClick={submit}
              disabled={saving}
              className="px-5 py-2 text-xs rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? "Submitting…" : "Submit Indent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RaiseIndentModal;
