import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { RotateCcw, AlertTriangle, TrendingDown } from "lucide-react";
import { format, subDays, addDays } from "date-fns";

interface Props {
  hospitalId: string;
}

interface ConsumptionRow {
  store_name: string;
  item_name: string;
  total_issued: number;
  unit: string | null;
}

interface ExpiryRow {
  id: string;
  item_id: string;
  item_name: string;
  batch_number: string | null;
  expiry_date: string;
  quantity_available: number;
  days_to_expiry: number;
}

interface NonMovingRow {
  id: string;
  item_name: string;
  category: string;
  quantity: number;
  last_movement: string | null;
}

const InventoryMISPanel: React.FC<Props> = ({ hospitalId }) => {
  const [activeCard, setActiveCard] = useState<"consumption" | "expiry" | "nonmoving">("consumption");
  const [consumptionData, setConsumptionData] = useState<ConsumptionRow[]>([]);
  const [expiryData, setExpiryData] = useState<ExpiryRow[]>([]);
  const [nonMovingData, setNonMovingData] = useState<NonMovingRow[]>([]);
  const [expiryDays, setExpiryDays] = useState<30 | 60>(30);
  const [loading, setLoading] = useState(false);

  const fetchConsumption = useCallback(async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data } = await (supabase as any)
      .from("store_stock_movements")
      .select("store_id, item_name, unit, quantity, store:store_locations(name)")
      .eq("hospital_id", hospitalId)
      .eq("movement_type", "issue")
      .gte("moved_at", startOfMonth.toISOString())
      .order("quantity", { ascending: false });

    if (!data) return;
    const grouped: Record<string, ConsumptionRow> = {};
    data.forEach((m: any) => {
      const key = `${m.store_id}-${m.item_name}`;
      if (!grouped[key]) {
        grouped[key] = { store_name: m.store?.name || "Unknown", item_name: m.item_name, total_issued: 0, unit: m.unit };
      }
      grouped[key].total_issued += m.quantity;
    });
    const sorted = Object.values(grouped).sort((a, b) => b.total_issued - a.total_issued).slice(0, 20);
    setConsumptionData(sorted);
  }, [hospitalId]);

  const fetchExpiry = useCallback(async () => {
    const cutoff = addDays(new Date(), expiryDays).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const { data: stock } = await (supabase as any)
      .from("inventory_stock")
      .select("id, item_id, batch_number, expiry_date, quantity_available")
      .eq("hospital_id", hospitalId)
      .gt("expiry_date", today)
      .lte("expiry_date", cutoff)
      .gt("quantity_available", 0)
      .order("expiry_date");

    if (!stock) { setExpiryData([]); return; }

    const itemIds = [...new Set(stock.map((s: any) => s.item_id))];
    const { data: items } = await (supabase as any)
      .from("inventory_items")
      .select("id, item_name")
      .in("id", itemIds);

    const nameMap: Record<string, string> = {};
    (items || []).forEach((i: any) => { nameMap[i.id] = i.item_name; });

    setExpiryData(stock.map((s: any) => ({
      ...s,
      item_name: nameMap[s.item_id] || "Unknown",
      days_to_expiry: Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000),
    })));
  }, [hospitalId, expiryDays]);

  const fetchNonMoving = useCallback(async () => {
    const cutoff = subDays(new Date(), 90).toISOString();

    const { data: recentMov } = await (supabase as any)
      .from("store_stock_movements")
      .select("item_name")
      .eq("hospital_id", hospitalId)
      .gte("moved_at", cutoff);

    const recentItems = new Set((recentMov || []).map((m: any) => m.item_name.toLowerCase()));

    const { data: stock } = await (supabase as any)
      .from("inventory_stock")
      .select("id, item_id, quantity_available")
      .eq("hospital_id", hospitalId)
      .gt("quantity_available", 0);

    if (!stock) { setNonMovingData([]); return; }

    const itemIds = [...new Set(stock.map((s: any) => s.item_id))];
    const { data: items } = await (supabase as any)
      .from("inventory_items")
      .select("id, item_name, category")
      .in("id", itemIds);

    const nameMap: Record<string, { name: string; category: string }> = {};
    (items || []).forEach((i: any) => { nameMap[i.id] = { name: i.item_name, category: i.category }; });

    const aggregated: Record<string, NonMovingRow> = {};
    stock.forEach((s: any) => {
      const info = nameMap[s.item_id];
      if (!info) return;
      if (recentItems.has(info.name.toLowerCase())) return;
      if (!aggregated[s.item_id]) {
        aggregated[s.item_id] = { id: s.item_id, item_name: info.name, category: info.category, quantity: 0, last_movement: null };
      }
      aggregated[s.item_id].quantity += s.quantity_available;
    });

    setNonMovingData(Object.values(aggregated).sort((a, b) => b.quantity - a.quantity).slice(0, 20));
  }, [hospitalId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchConsumption(), fetchExpiry(), fetchNonMoving()]);
    setLoading(false);
  }, [fetchConsumption, fetchExpiry, fetchNonMoving]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { fetchExpiry(); }, [fetchExpiry]);

  const maxConsumption = Math.max(...consumptionData.map((c) => c.total_issued), 1);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Card selector */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card flex items-center gap-3">
        {[
          { key: "consumption", icon: TrendingDown, label: "Dept-wise Consumption", sublabel: "This month", color: "text-blue-600" },
          { key: "expiry", icon: AlertTriangle, label: "Near-Expiry Items", sublabel: `Next ${expiryDays} days`, color: "text-amber-600" },
          { key: "nonmoving", icon: RotateCcw, label: "Non-Moving Items", sublabel: "No movement > 90 days", color: "text-slate-500" },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              onClick={() => setActiveCard(card.key as any)}
              className={cn(
                "flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left",
                activeCard === card.key
                  ? "border-primary/30 bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/20 hover:bg-muted/50"
              )}
            >
              <Icon size={20} className={card.color} />
              <div>
                <p className="text-xs font-bold text-foreground">{card.label}</p>
                <p className="text-[10px] text-muted-foreground">{card.sublabel}</p>
              </div>
              {activeCard === card.key && (
                <span className="ml-auto text-[10px] bg-primary text-white px-2 py-0.5 rounded-full font-bold">
                  {card.key === "consumption" ? consumptionData.length :
                   card.key === "expiry" ? expiryData.length :
                   nonMovingData.length}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={loadData}
          className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-2 rounded-lg hover:bg-muted"
          title="Refresh"
        >
          <RotateCcw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {!loading && activeCard === "consumption" && (
          <div>
            <p className="text-xs text-muted-foreground mb-4">Department-wise consumption from {format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "dd MMM")} to today</p>
            {consumptionData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No issue movements recorded this month</p>
            ) : (
              <div className="space-y-2">
                {consumptionData.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-3 group">
                    <div className="w-32 shrink-0">
                      <p className="text-xs font-medium text-foreground truncate">{row.item_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{row.store_name}</p>
                    </div>
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full rounded bg-blue-500/70 transition-all"
                        style={{ width: `${(row.total_issued / maxConsumption) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-foreground w-16 text-right">
                      {row.total_issued} {row.unit || ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeCard === "expiry" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <p className="text-xs text-muted-foreground">Items expiring within</p>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[30, 60].map((d) => (
                  <button
                    key={d}
                    onClick={() => setExpiryDays(d as 30 | 60)}
                    className={cn(
                      "text-xs px-3 py-1 font-medium transition-colors",
                      expiryDays === d ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {d} Days
                  </button>
                ))}
              </div>
            </div>
            {expiryData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No items expiring within {expiryDays} days</p>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Item</th>
                      <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">Batch</th>
                      <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">Expiry</th>
                      <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Days Left</th>
                      <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Qty</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {expiryData.map((row) => (
                      <tr key={row.id} className={cn("border-t border-border/60", row.days_to_expiry <= 7 && "bg-red-50/50")}>
                        <td className="px-4 py-2.5 font-medium text-foreground text-xs">{row.item_name}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.batch_number || "—"}</td>
                        <td className="px-3 py-2.5 text-xs">{format(new Date(row.expiry_date), "dd MMM yyyy")}</td>
                        <td className={cn("px-3 py-2.5 text-xs text-right font-bold",
                          row.days_to_expiry <= 7 ? "text-destructive" :
                          row.days_to_expiry <= 14 ? "text-amber-600" : "text-foreground"
                        )}>
                          {row.days_to_expiry}d
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right">{row.quantity_available}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium hover:bg-amber-200 transition-colors">
                              Mark Return
                            </button>
                            <button className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-medium hover:bg-rose-200 transition-colors">
                              Write-off
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!loading && activeCard === "nonmoving" && (
          <div>
            <p className="text-xs text-muted-foreground mb-4">Items with no issue/return/receipt movement in the last 90 days and with stock on hand</p>
            {nonMovingData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No non-moving items found — good inventory health!</p>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Item</th>
                      <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">Category</th>
                      <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">On Hand</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {nonMovingData.map((row) => (
                      <tr key={row.id} className="border-t border-border/60 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium text-foreground text-xs">{row.item_name}</td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-[10px]">{row.category}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right font-medium">{row.quantity}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium hover:bg-amber-200 transition-colors">
                              Redistribute
                            </button>
                            <button className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium hover:bg-slate-200 transition-colors">
                              Write-off
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryMISPanel;
