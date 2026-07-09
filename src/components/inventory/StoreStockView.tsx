import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, RefreshCw, AlertTriangle, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string;
  storeId: string;
  storeName: string;
}

interface Batch {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity_available: number;
  cost_price: number | null;
  is_consignment: boolean | null;
}

interface Row {
  item_id: string;
  item_name: string;
  uom: string;
  category: string | null;
  on_hand: number;
  value: number;
  nearest_expiry: string | null;
  net_issued: number; // Σ(issued_qty − returned_qty) from this store's indents
  batches: Batch[];
}

const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);

const StoreStockView: React.FC<Props> = ({ hospitalId, storeId, storeName }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);

    // 1) Authoritative on-hand balances for this store
    const { data: stock } = await (supabase as any)
      .from("store_stock")
      .select("id, item_id, batch_number, expiry_date, quantity_available, cost_price, is_consignment, inventory_items(item_name, uom, category)")
      .eq("hospital_id", hospitalId)
      .eq("store_id", storeId);

    // 2) Net issued to this store from the source indent lines (drives reconciliation)
    const { data: indents } = await (supabase as any)
      .from("store_indents")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("from_store_id", storeId);
    const indentIds = (indents || []).map((i: any) => i.id);
    let issuedByItem: Record<string, number> = {};
    let issuedNames: Record<string, string> = {};
    if (indentIds.length > 0) {
      const { data: iitems } = await (supabase as any)
        .from("store_indent_items")
        .select("item_id, item_name, issued_qty, returned_qty")
        .in("indent_id", indentIds);
      (iitems || []).forEach((it: any) => {
        if (!it.item_id) return;
        issuedByItem[it.item_id] = (issuedByItem[it.item_id] || 0) + ((it.issued_qty || 0) - (it.returned_qty || 0));
        issuedNames[it.item_id] = it.item_name;
      });
    }

    // 3) Fold stock rows into per-item aggregates
    const byItem: Record<string, Row> = {};
    (stock || []).forEach((s: any) => {
      const id = s.item_id;
      if (!byItem[id]) {
        byItem[id] = {
          item_id: id,
          item_name: s.inventory_items?.item_name || issuedNames[id] || "—",
          uom: s.inventory_items?.uom || "",
          category: s.inventory_items?.category || null,
          on_hand: 0, value: 0, nearest_expiry: null,
          net_issued: issuedByItem[id] || 0,
          batches: [],
        };
      }
      const r = byItem[id];
      r.on_hand += s.quantity_available || 0;
      r.value += (s.quantity_available || 0) * (s.cost_price || 0);
      r.batches.push(s);
      if (s.expiry_date && (!r.nearest_expiry || s.expiry_date < r.nearest_expiry)) r.nearest_expiry = s.expiry_date;
    });

    // 4) Items net-issued but with zero on-hand balance (e.g. issued before Phase 3) → surface as drift
    Object.keys(issuedByItem).forEach((id) => {
      if (!byItem[id] && issuedByItem[id] !== 0) {
        byItem[id] = {
          item_id: id, item_name: issuedNames[id] || "—", uom: "", category: null,
          on_hand: 0, value: 0, nearest_expiry: null, net_issued: issuedByItem[id], batches: [],
        };
      }
    });

    setRows(Object.values(byItem).sort((a, b) => a.item_name.localeCompare(b.item_name)));
    setLoading(false);
  }, [hospitalId, storeId]);

  useEffect(() => { load(); }, [load]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const expiringCount = rows.filter((r) => { const d = daysTo(r.nearest_expiry); return d !== null && d <= 30; }).length;
  // Drift = on-hand exceeds what the ledger says was ever issued here (impossible without unrecorded receipt)
  const anomalies = rows.filter((r) => r.on_hand > r.net_issued + 0.001);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary strip */}
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-foreground">Stock on Hand — {storeName}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{rows.length} items</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        {expiringCount > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">⚠️ {expiringCount} expiring ≤30d</span>
        )}
        {anomalies.length > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {anomalies.length} reconciliation flag{anomalies.length !== 1 ? "s" : ""}
          </span>
        )}
        <button onClick={load} className="ml-auto text-muted-foreground hover:text-primary" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <PackageX size={28} />
            <p className="text-sm">No stock on hand in this store yet</p>
            <p className="text-xs">Stock appears here once indents are issued to this store.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className="w-8 px-2 py-2.5" />
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Item</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Category</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">On Hand</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Nearest Expiry</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Net Issued</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = daysTo(r.nearest_expiry);
                const expClass = d === null ? "text-muted-foreground" : d < 0 ? "text-destructive font-semibold" : d <= 30 ? "text-amber-600 font-medium" : "text-muted-foreground";
                const isOpen = expanded === r.item_id;
                const anomaly = r.on_hand > r.net_issued + 0.001;
                return (
                  <React.Fragment key={r.item_id}>
                    <tr className={cn("border-b border-border/50 hover:bg-muted/30", anomaly && "bg-destructive/5")}>
                      <td className="px-2 py-2">
                        {r.batches.length > 0 && (
                          <button onClick={() => setExpanded(isOpen ? null : r.item_id)}>
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">{r.item_name}</td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">{r.category?.replace("_", " ") || "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground">{r.on_hand} {r.uom}</td>
                      <td className={cn("px-3 py-2", expClass)}>{r.nearest_expiry || "—"}{d !== null && d < 0 ? " (expired)" : d !== null && d <= 30 ? ` (${d}d)` : ""}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {r.net_issued}
                        {anomaly && <AlertTriangle className="inline h-3 w-3 text-destructive ml-1" />}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">₹{r.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    </tr>
                    {isOpen && r.batches.length > 0 && (
                      <tr>
                        <td colSpan={7} className="bg-muted/20 px-10 py-2">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left py-1 px-2">Batch</th>
                                <th className="text-left py-1 px-2">Expiry</th>
                                <th className="text-right py-1 px-2">Qty</th>
                                <th className="text-right py-1 px-2">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.batches.map((b) => (
                                <tr key={b.id} className="border-t border-border/30">
                                  <td className="py-1 px-2 font-mono">
                                    {b.batch_number || "—"}
                                    {b.is_consignment && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">C</span>}
                                  </td>
                                  <td className="py-1 px-2">{b.expiry_date || "—"}</td>
                                  <td className="py-1 px-2 text-right font-semibold">{b.quantity_available}</td>
                                  <td className="py-1 px-2 text-right">₹{b.cost_price || 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {anomalies.length > 0 && (
        <div className="flex-shrink-0 border-t border-border bg-destructive/5 px-5 py-2 text-[11px] text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          On-hand exceeds net issued for {anomalies.length} item(s) — likely a manual balance edit or stock recorded before item-linkage. Review these batches.
        </div>
      )}
    </div>
  );
};

export default StoreStockView;
