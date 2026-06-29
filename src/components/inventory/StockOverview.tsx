import React, { useState, useEffect } from "react";
import { Search, Download, ChevronDown, ChevronRight, Plus, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import StockAdjustmentModal from "./StockAdjustmentModal";
import DrugForecastPanel from "./DrugForecastPanel";

interface StockItem {
  id: string;
  item_name: string;
  item_code: string | null;
  category: string;
  uom: string;
  abc_class: string | null;
  ved_class: string | null;
  reorder_level: number;
  max_stock_level: number;
  total_stock: number;
  stock_value: number;
  batches: any[];
}

const categories = ["all", "surgical", "consumable", "linen", "medical_gas", "other"];
const abcFilters = ["all", "A", "B", "C"];
const statusFilters = ["all", "low", "expiring", "out", "consignment"];

const categoryColors: Record<string, string> = {
  surgical: "bg-destructive/10 text-destructive",
  consumable: "bg-primary/10 text-primary",
  linen: "bg-accent/10 text-accent-foreground",
  medical_gas: "bg-secondary/10 text-secondary-foreground",
  stationery: "bg-muted text-muted-foreground",
  housekeeping: "bg-muted text-muted-foreground",
  equipment: "bg-primary/10 text-primary",
  other: "bg-muted text-muted-foreground",
};

const abcColors: Record<string, string> = {
  A: "bg-destructive/10 text-destructive font-bold",
  B: "bg-accent/10 text-accent-foreground",
  C: "bg-muted text-muted-foreground",
};

const StockOverview: React.FC = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [abcFilter, setAbcFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adjustItem, setAdjustItem] = useState<StockItem | null>(null);
  const [forecastItem, setForecastItem] = useState<StockItem | null>(null);
  const [hospitalId, setHospitalId] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setHospitalId(data.hospital_id); });
    });
  }, []);

  const loadData = async () => {
    const [itemsRes, stockRes] = await Promise.all([
      (supabase as any).from("inventory_items").select("*").eq("is_active", true).order("item_name"),
      (supabase as any).from("inventory_stock").select("*"),
    ]);

    const itemsList = itemsRes.data || [];
    const stockList = stockRes.data || [];

    const merged: StockItem[] = itemsList.map((item: any) => {
      const batches = stockList.filter((s: any) => s.item_id === item.id);
      const total_stock = batches.reduce((sum: number, b: any) => sum + (b.quantity_available || 0), 0);
      const stock_value = batches.reduce((sum: number, b: any) => sum + (b.quantity_available || 0) * (b.cost_price || 0), 0);
      return { ...item, total_stock, stock_value, batches };
    });

    setItems(merged);
  };

  useEffect(() => { loadData(); }, []);

  const filtered = items.filter((item) => {
    if (search && !item.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter !== "all" && item.category !== catFilter) return false;
    if (abcFilter !== "all" && item.abc_class !== abcFilter) return false;
    if (statusFilter === "low" && item.total_stock >= item.reorder_level) return false;
    if (statusFilter === "out" && item.total_stock > 0) return false;
    if (statusFilter === "expiring") {
      const hasExpiring = item.batches.some((b: any) => {
        if (!b.expiry_date) return false;
        const days = Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000);
        return days <= 30 && days > 0;
      });
      if (!hasExpiring) return false;
    }
    if (statusFilter === "consignment" && !item.batches.some((b: any) => b.is_consignment)) return false;
    return true;
  });

  const kpis = {
    totalSku: items.length,
    totalValue: items.reduce((s, i) => s + i.stock_value, 0),
    lowStock: items.filter((i) => i.total_stock > 0 && i.total_stock <= i.reorder_level).length,
    expiring: items.filter((i) => i.batches.some((b: any) => {
      if (!b.expiry_date) return false;
      const days = Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000);
      return days <= 30 && days > 0;
    })).length,
  };

  const getStatus = (item: StockItem) => {
    if (item.total_stock === 0) return { label: "Out of Stock 🔴", cls: "text-destructive" };
    if (item.total_stock <= item.reorder_level) return { label: "Low Stock ⚠️", cls: "text-amber-600" };
    return { label: "✓ OK", cls: "text-success" };
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filters */}
      <div className="flex-shrink-0 bg-card border-b border-border px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="relative w-[220px]">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <div className="flex gap-1">
          {categories.map((c) => (
            <button key={c} onClick={() => setCatFilter(c)} className={cn("px-2.5 py-1 rounded-full text-[10px] font-medium capitalize transition-colors", catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {c === "all" ? "All" : c.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {abcFilters.map((a) => (
            <button key={a} onClick={() => setAbcFilter(a)} className={cn("px-2 py-1 rounded text-[10px] font-bold transition-colors", abcFilter === a ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {a === "all" ? "ABC" : a}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {statusFilters.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn("px-2.5 py-1 rounded-full text-[10px] font-medium capitalize transition-colors", statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {s === "all" ? "All" : s === "low" ? "Low Stock" : s === "out" ? "Out" : s === "expiring" ? "Expiring" : "Consignment"}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto text-xs gap-1.5"><Download className="h-3 w-3" /> Export</Button>
      </div>

      {/* KPI Cards */}
      <div className="flex-shrink-0 bg-card border-b border-border px-4 py-2 flex gap-3">
        {[
          { label: "Total SKUs", value: kpis.totalSku, color: "text-foreground" },
          { label: "Stock Value", value: `₹${(kpis.totalValue / 1000).toFixed(1)}K`, color: "text-primary" },
          { label: "Low Stock", value: kpis.lowStock, color: kpis.lowStock > 0 ? "text-destructive" : "text-success" },
          { label: "Expiring Soon", value: kpis.expiring, color: kpis.expiring > 0 ? "text-amber-600" : "text-success" },
        ].map((k) => (
          <div key={k.label} className="flex-1 bg-muted/30 rounded-lg px-3 py-2">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={cn("text-lg font-bold", k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              <th className="w-8 px-2 py-2.5"></th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Item Name</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Category</th>
              <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground">ABC</th>
              <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Stock</th>
              <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Reorder</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Status</th>
              <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Value</th>
              <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const status = getStatus(item);
              const isExpanded = expandedId === item.id;
              return (
                <React.Fragment key={item.id}>
                  <tr className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-2 py-2">
                      <button onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-foreground">{item.item_name}</div>
                      {item.item_code && <div className="text-[10px] text-muted-foreground font-mono">{item.item_code}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full capitalize", categoryColors[item.category] || "bg-muted text-muted-foreground")}>
                        {item.category.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.abc_class && (
                        <span className={cn("text-[10px] px-2 py-0.5 rounded", abcColors[item.abc_class] || "bg-muted text-muted-foreground")}>
                          {item.abc_class}
                        </span>
                      )}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-semibold", item.total_stock === 0 ? "text-destructive" : item.total_stock <= item.reorder_level ? "text-amber-600" : "text-success")}>
                      {item.total_stock === 0 ? <Badge variant="destructive" className="text-[9px]">OUT</Badge> : `${item.total_stock} ${item.uom}`}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{item.reorder_level}</td>
                    <td className={cn("px-3 py-2", status.cls)}>{status.label}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">₹{item.stock_value.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-center">
                      <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2" onClick={() => setAdjustItem(item)}>Adjust</Button>
                      {hospitalId && (
                        <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2" onClick={() => setForecastItem(item)}>
                          <BarChart3 className="h-3 w-3 mr-1" />Forecast
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && item.batches.length > 0 && (
                    <tr>
                      <td colSpan={9} className="bg-muted/20 px-8 py-2">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left py-1 px-2">Batch</th>
                              <th className="text-left py-1 px-2">Expiry</th>
                              <th className="text-right py-1 px-2">Qty</th>
                              <th className="text-right py-1 px-2">Cost</th>
                              <th className="text-left py-1 px-2">Location</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.batches.map((b: any, i: number) => {
                              const daysToExpiry = b.expiry_date ? Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000) : null;
                              return (
                                <tr key={i} className={cn(
                                  "border-t border-border/30",
                                  daysToExpiry !== null && daysToExpiry < 0 && "bg-muted/50 line-through",
                                  daysToExpiry !== null && daysToExpiry <= 30 && daysToExpiry >= 0 && "bg-destructive/5",
                                  daysToExpiry !== null && daysToExpiry <= 90 && daysToExpiry > 30 && "bg-accent/5"
                                )}>
                                  <td className="py-1 px-2 font-mono">
                                    {b.batch_number || "—"}
                                    {b.is_consignment && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">C</span>}
                                  </td>
                                  <td className="py-1 px-2">{b.expiry_date || "—"}</td>
                                  <td className="py-1 px-2 text-right font-semibold">{b.quantity_available}</td>
                                  <td className="py-1 px-2 text-right">₹{b.cost_price || 0}</td>
                                  <td className="py-1 px-2">{b.location || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="h-48">
                <EmptyState icon="📦" title="No items in stock master" description="Add items or receive stock to populate inventory" />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adjustItem && (
        <StockAdjustmentModal item={adjustItem} onClose={() => setAdjustItem(null)} onSaved={() => { setAdjustItem(null); loadData(); }} />
      )}

      {forecastItem && hospitalId && (
        <DrugForecastPanel
          itemId={forecastItem.id}
          itemName={forecastItem.item_name}
          currentStock={forecastItem.total_stock}
          hospitalId={hospitalId}
          onClose={() => setForecastItem(null)}
        />
      )}
    </div>
  );
};

export default StockOverview;
