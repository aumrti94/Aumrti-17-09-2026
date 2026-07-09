import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import ScanItemField from "./ScanItemField";

interface Props { hospitalId: string; }

interface StoreLoc { id: string; name: string; type: string; }
interface CountSession { id: string; count_number: string; scope: string; store_id: string | null; status: string; created_at: string; store?: { name: string } | null; }
interface CountItem {
  id: string; item_id: string; item_name: string; stock_row_id: string;
  batch_number: string | null; system_qty: number; counted_qty: number | null; variance: number | null;
}

const StockCountPanel: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreLoc[]>([]);
  const [scope, setScope] = useState<string>("central"); // "central" or a store id
  const [counts, setCounts] = useState<CountSession[]>([]);
  const [active, setActive] = useState<CountSession | null>(null);
  const [items, setItems] = useState<CountItem[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanFilter, setScanFilter] = useState<string | null>(null);

  const getMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("users").select("id").eq("auth_user_id", user?.id || "").maybeSingle();
    return data?.id || null;
  };

  const loadStores = useCallback(async () => {
    const { data } = await (supabase as any).from("store_locations").select("id, name, type").eq("hospital_id", hospitalId).eq("is_active", true).order("name");
    setStores(data || []);
  }, [hospitalId]);

  const loadCounts = useCallback(async () => {
    const { data } = await (supabase as any).from("stock_counts")
      .select("id, count_number, scope, store_id, status, created_at, store:store_locations(name)")
      .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(50);
    setCounts(data || []);
  }, [hospitalId]);

  useEffect(() => { loadStores(); loadCounts(); }, [loadStores, loadCounts]);

  const loadItems = async (count: CountSession) => {
    const { data } = await (supabase as any).from("stock_count_items").select("*").eq("count_id", count.id).order("item_name");
    setItems(data || []);
    const c: Record<string, string> = {};
    (data || []).forEach((it: CountItem) => { c[it.id] = it.counted_qty != null ? String(it.counted_qty) : ""; });
    setCounted(c);
  };

  const openCount = (count: CountSession) => { setActive(count); loadItems(count); };

  const startCount = async () => {
    setCreating(true);
    const isCentral = scope === "central";
    const storeId = isCentral ? null : scope;

    // Snapshot current on-hand batches from the chosen source
    let rows: any[] = [];
    if (isCentral) {
      const { data } = await (supabase as any).from("inventory_stock")
        .select("id, item_id, batch_number, quantity_available, inventory_items(item_name)")
        .eq("hospital_id", hospitalId);
      rows = (data || []).map((r: any) => ({ stock_row_id: r.id, item_id: r.item_id, item_name: r.inventory_items?.item_name || "—", batch_number: r.batch_number, system_qty: r.quantity_available || 0 }));
    } else {
      const { data } = await (supabase as any).from("store_stock")
        .select("id, item_id, batch_number, quantity_available, inventory_items(item_name)")
        .eq("hospital_id", hospitalId).eq("store_id", storeId);
      rows = (data || []).map((r: any) => ({ stock_row_id: r.id, item_id: r.item_id, item_name: r.inventory_items?.item_name || "—", batch_number: r.batch_number, system_qty: r.quantity_available || 0 }));
    }
    if (rows.length === 0) { toast({ title: "Nothing on hand to count in this location", variant: "destructive" }); setCreating(false); return; }

    const me = await getMe();
    const { data: session, error } = await (supabase as any).from("stock_counts").insert({
      hospital_id: hospitalId, store_id: storeId, scope: isCentral ? "central" : "store", status: "counting", counted_by: me,
    }).select("id, count_number, scope, store_id, status, created_at").maybeSingle();
    if (error || !session) { toast({ title: "Failed to start count", variant: "destructive" }); setCreating(false); return; }

    await (supabase as any).from("stock_count_items").insert(
      rows.map((r) => ({ count_id: session.id, item_id: r.item_id, item_name: r.item_name, stock_row_id: r.stock_row_id, batch_number: r.batch_number, system_qty: r.system_qty }))
    );
    toast({ title: `Count ${session.count_number} started — ${rows.length} lines` });
    setCreating(false);
    loadCounts();
    openCount(session);
  };

  const postVariances = async () => {
    if (!active) return;
    setPosting(true);
    const me = await getMe();
    const isCentral = active.scope === "central";
    let posted = 0;

    for (const it of items) {
      const raw = counted[it.id];
      if (raw === "" || raw == null) continue;         // uncounted lines left as-is
      const countedQty = Number(raw);
      const variance = countedQty - it.system_qty;
      await (supabase as any).from("stock_count_items").update({ counted_qty: countedQty, variance }).eq("id", it.id);
      if (variance === 0) continue;

      if (isCentral) {
        await (supabase as any).from("inventory_stock").update({ quantity_available: Math.max(0, countedQty) }).eq("id", it.stock_row_id);
        await (supabase as any).from("stock_transactions").insert({
          hospital_id: hospitalId, item_id: it.item_id, transaction_type: "count_variance",
          quantity: variance, reference_id: active.id, reference_type: "stock_count", created_by: me,
          notes: `Count ${active.count_number} — ${it.item_name} (batch ${it.batch_number || "—"})`,
        });
      } else {
        await (supabase as any).from("store_stock").update({ quantity_available: Math.max(0, countedQty) }).eq("id", it.stock_row_id);
        await (supabase as any).from("store_stock_movements").insert({
          hospital_id: hospitalId, store_id: active.store_id, item_id: it.item_id, item_name: it.item_name,
          movement_type: "adjustment", quantity: variance, moved_by: me, notes: `Count ${active.count_number}`,
        });
      }
      posted++;
    }

    await (supabase as any).from("stock_counts").update({ status: "posted", posted_at: new Date().toISOString(), approved_by: me }).eq("id", active.id);
    toast({ title: `Count posted — ${posted} variance${posted !== 1 ? "s" : ""} adjusted` });
    setPosting(false);
    setActive((a) => a ? { ...a, status: "posted" } : a);
    loadCounts();
    loadItems(active);
  };

  const varianceOf = (it: CountItem) => {
    const raw = counted[it.id];
    if (raw === "" || raw == null) return null;
    return Number(raw) - it.system_qty;
  };
  const editable = active?.status === "counting";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — sessions */}
      <div className="w-[300px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-card border-b border-border p-3 space-y-2">
          <select className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="central">Central Store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
          </select>
          <button onClick={startCount} disabled={creating} className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Start New Count
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {counts.map((c) => (
            <div key={c.id} onClick={() => openCount(c)} className={cn("px-4 py-2.5 border-b border-border/50 cursor-pointer", active?.id === c.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30")}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold">{c.count_number}</span>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full font-medium", c.status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{c.status}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{c.scope === "central" ? "Central" : c.store?.name || "Store"} · {format(new Date(c.created_at), "dd MMM HH:mm")}</p>
            </div>
          ))}
          {counts.length === 0 && <p className="text-center text-xs text-muted-foreground py-10">No counts yet</p>}
        </div>
      </div>

      {/* RIGHT — active count */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {active ? (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">{active.count_number}</p>
                <p className="text-[10px] text-muted-foreground">{active.scope === "central" ? "Central Store" : "Sub-store"} · {items.length} lines</p>
              </div>
              <div className="flex items-center gap-2">
                {editable && <ScanItemField hospitalId={hospitalId} onItem={(it) => setScanFilter(it.id)} placeholder="Scan to find item…" className="w-52" />}
                {scanFilter && <button onClick={() => setScanFilter(null)} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">clear filter</button>}
                <button onClick={() => loadItems(active)} className="text-muted-foreground hover:text-primary" title="Refresh"><RefreshCw size={14} /></button>
                {editable && (
                  <button onClick={postVariances} disabled={posting} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {posting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCheck className="h-3 w-3" />} Post Variances
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Batch</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">System</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Counted</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {(scanFilter ? items.filter((i) => i.item_id === scanFilter) : items).map((it) => {
                    const v = active.status === "posted" ? it.variance : varianceOf(it);
                    return (
                      <tr key={it.id} className={cn("border-b border-border/50", v != null && v !== 0 && "bg-amber-50/40")}>
                        <td className="px-4 py-1.5 font-medium">{it.item_name}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{it.batch_number || "—"}</td>
                        <td className="px-3 py-1.5 text-right">{it.system_qty}</td>
                        <td className="px-3 py-1.5 text-right">
                          {editable ? (
                            <input type="number" className="w-20 text-right px-1.5 py-1 border border-border rounded text-xs" value={counted[it.id] ?? ""} onChange={(e) => setCounted({ ...counted, [it.id]: e.target.value })} />
                          ) : (it.counted_qty ?? "—")}
                        </td>
                        <td className={cn("px-3 py-1.5 text-right font-semibold", v == null ? "text-muted-foreground" : v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                          {v == null ? "—" : v > 0 ? `+${v}` : v}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">Select or start a stock count</div>
        )}
      </div>
    </div>
  );
};

export default StockCountPanel;
