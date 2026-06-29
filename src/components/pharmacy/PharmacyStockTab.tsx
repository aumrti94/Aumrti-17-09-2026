import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string;
  onReceiveStock: () => void;
}

interface DrugWithStock {
  id: string;
  drug_name: string;
  generic_name: string | null;
  category: string | null;
  drug_schedule: string;
  reorder_level: number;
  total_stock: number;
  batch_count: number;
  batches: BatchInfo[];
  status: "available" | "low_stock" | "out_of_stock" | "expiring" | "expired";
  has_expired_batches: boolean;
}

interface BatchInfo {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity_available: number;
  mrp: number;
  cost_price: number;
  manufacturer: string | null;
}

const PharmacyStockTab: React.FC<Props> = ({ hospitalId, onReceiveStock }) => {
  const [drugs, setDrugs] = useState<DrugWithStock[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedDrug, setExpandedDrug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    const { data: drugData } = await supabase
      .from("drug_master")
      .select("id, drug_name, generic_name, category, drug_schedule, reorder_level")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("drug_name");

    if (!drugData) { setLoading(false); return; }

    const { data: batchData } = await supabase
      .from("drug_batches")
      .select("id, drug_id, batch_number, expiry_date, quantity_available, mrp, cost_price, manufacturer")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true);

    const batchMap = new Map<string, BatchInfo[]>();
    for (const b of batchData || []) {
      const list = batchMap.get(b.drug_id) || [];
      list.push(b);
      batchMap.set(b.drug_id, list);
    }

    const now = new Date();
    const today = new Date(now.toISOString().split("T")[0]);
    const thirtyDays = new Date(now);
    thirtyDays.setDate(thirtyDays.getDate() + 30);

    const result: DrugWithStock[] = drugData.map((d: any) => {
      const batches = batchMap.get(d.id) || [];
      const totalStock = batches.reduce((s: number, b: BatchInfo) => s + b.quantity_available, 0);
      const hasExpired = batches.some((b: BatchInfo) => new Date(b.expiry_date) < today);
      const hasExpiring = batches.some((b: BatchInfo) => {
        const exp = new Date(b.expiry_date);
        return exp >= today && exp <= thirtyDays;
      });

      let status: DrugWithStock["status"] = "available";
      if (hasExpired) status = "expired";
      else if (totalStock === 0) status = "out_of_stock";
      else if (totalStock < (d.reorder_level || 10)) status = "low_stock";
      else if (hasExpiring) status = "expiring";

      return {
        ...d,
        total_stock: totalStock,
        batch_count: batches.length,
        batches: batches.sort((a: BatchInfo, b: BatchInfo) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()),
        status,
        has_expired_batches: hasExpired,
      };
    });

    // Merge entries with same drug_name (handles duplicate drug_master rows)
    const merged = new Map<string, DrugWithStock>();
    for (const d of result) {
      const key = d.drug_name.toLowerCase();
      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.total_stock += d.total_stock;
        existing.batch_count += d.batch_count;
        existing.batches = [...existing.batches, ...d.batches]
          .sort((a: BatchInfo, b: BatchInfo) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
        const mergedBatches = existing.batches;
        const mergedHasExpired = mergedBatches.some((b: BatchInfo) => new Date(b.expiry_date) < today);
        const mergedHasExpiring = mergedBatches.some((b: BatchInfo) => { const exp = new Date(b.expiry_date); return exp >= today && exp <= thirtyDays; });
        existing.has_expired_batches = mergedHasExpired;
        if (mergedHasExpired) existing.status = "expired";
        else if (existing.total_stock === 0) existing.status = "out_of_stock";
        else if (existing.total_stock < (existing.reorder_level || 10)) existing.status = "low_stock";
        else if (mergedHasExpiring) existing.status = "expiring";
        else existing.status = "available";
      } else {
        merged.set(key, { ...d });
      }
    }

    setDrugs(Array.from(merged.values()));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  const filtered = drugs.filter((d) => {
    const matchSearch =
      d.drug_name.toLowerCase().includes(search.toLowerCase()) ||
      (d.generic_name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const kpis = {
    totalSKUs: drugs.length,
    expired: drugs.filter((d) => d.status === "expired").length,
    expiringMonth: drugs.filter((d) => d.status === "expiring").length,
    lowStock: drugs.filter((d) => d.status === "low_stock").length,
    outOfStock: drugs.filter((d) => d.status === "out_of_stock").length,
  };

  const statusBadge = (s: DrugWithStock["status"]) => {
    const map = {
      available: { label: "Available", cls: "bg-emerald-100 text-emerald-700" },
      low_stock: { label: "Low Stock", cls: "bg-amber-100 text-amber-700" },
      out_of_stock: { label: "Out of Stock", cls: "bg-red-100 text-red-700" },
      expiring: { label: "Expiring Soon", cls: "bg-orange-100 text-orange-700" },
      expired: { label: "⛔ Expired", cls: "bg-red-600 text-white" },
    };
    const v = map[s];
    return <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", v.cls)}>{v.label}</span>;
  };

  const scheduleBadge = (s: string) => {
    const colors: Record<string, string> = {
      OTC: "bg-emerald-50 text-emerald-600",
      H: "bg-blue-50 text-blue-600",
      H1: "bg-purple-50 text-purple-600",
      X: "bg-red-50 text-red-600",
      G: "bg-gray-100 text-gray-600",
    };
    return <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold", colors[s] || colors.G)}>{s}</span>;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between gap-4 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drugs..."
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button size="sm" onClick={onReceiveStock}>
          <Package size={14} className="mr-1" /> Receive Stock
        </Button>
      </div>

      {/* KPI Row */}
      <div className="flex-shrink-0 px-5 py-3 grid grid-cols-5 gap-3">
        {[
          { key: "all",         label: "Total SKUs",        value: kpis.totalSKUs,    color: "text-foreground" },
          { key: "expired",     label: "Expired",           value: kpis.expired,      color: "text-red-700" },
          { key: "expiring",    label: "Expiring This Month", value: kpis.expiringMonth, color: "text-orange-600" },
          { key: "low_stock",   label: "Low Stock",         value: kpis.lowStock,     color: "text-amber-600" },
          { key: "out_of_stock",label: "Out of Stock",      value: kpis.outOfStock,   color: "text-destructive" },
        ].map((k) => (
          <Card
            key={k.key}
            className={cn("p-3 cursor-pointer transition-all hover:shadow-md", statusFilter === k.key && "ring-2 ring-primary")}
            onClick={() => setStatusFilter(statusFilter === k.key ? "all" : k.key)}
          >
            <p className="text-[11px] text-muted-foreground font-medium uppercase">{k.label}</p>
            <p className={cn("text-2xl font-bold tabular-nums", k.color)}>{k.value}</p>
          </Card>
        ))}
      </div>

      {/* Active filter label */}
      {statusFilter !== "all" && (
        <div className="flex-shrink-0 px-5 pb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtered by:</span>
          <span className="text-xs font-medium text-primary capitalize">{statusFilter.replace("_", " ")}</span>
          <button onClick={() => setStatusFilter("all")} className="text-xs text-muted-foreground underline hover:text-foreground">Clear</button>
        </div>
      )}

      {/* Drug Table */}
      <div className="flex-1 overflow-auto px-5 pb-4">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr className="text-[11px] font-semibold text-muted-foreground uppercase">
              <th className="text-left py-2 px-3">Drug Name</th>
              <th className="text-left py-2 px-3">Schedule</th>
              <th className="text-right py-2 px-3">Total Stock</th>
              <th className="text-right py-2 px-3">Batches</th>
              <th className="text-right py-2 px-3">Reorder Level</th>
              <th className="text-center py-2 px-3">Status</th>
              <th className="text-center py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <React.Fragment key={d.id}>
                <tr
                  className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setExpandedDrug(expandedDrug === d.id ? null : d.id)}
                >
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      {expandedDrug === d.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <div>
                        <p className="font-medium text-foreground">{d.drug_name}</p>
                        {d.generic_name && <p className="text-[11px] text-muted-foreground">{d.generic_name}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">{scheduleBadge(d.drug_schedule || "OTC")}</td>
                  <td className="py-2.5 px-3 text-right font-semibold tabular-nums">{d.total_stock}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{d.batch_count}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{d.reorder_level || 10}</td>
                  <td className="py-2.5 px-3 text-center">{statusBadge(d.status)}</td>
                  <td className="py-2.5 px-3 text-center">
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); setExpandedDrug(expandedDrug === d.id ? null : d.id); }}>
                      View Batches
                    </Button>
                  </td>
                </tr>
                {expandedDrug === d.id && d.batches.length > 0 && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <div className="bg-muted/40 px-10 py-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] text-muted-foreground uppercase">
                              <th className="text-left py-1 px-2">Batch #</th>
                              <th className="text-left py-1 px-2">Manufacturer</th>
                              <th className="text-left py-1 px-2">Expiry</th>
                              <th className="text-right py-1 px-2">Qty</th>
                              <th className="text-right py-1 px-2">MRP (₹)</th>
                              <th className="text-right py-1 px-2">Cost (₹)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.batches.map((b) => {
                              const expDate = new Date(b.expiry_date);
                              const todayCheck = new Date(new Date().toISOString().split("T")[0]);
                              const isExpired = expDate < todayCheck;
                              const isExpiring = !isExpired && expDate <= new Date(Date.now() + 30 * 86400000);
                              return (
                                <tr key={b.id} className={cn("border-b border-border/30", isExpired ? "bg-red-50" : isExpiring && "bg-orange-50/50")}>
                                  <td className={cn("py-1.5 px-2 font-mono", isExpired && "line-through text-muted-foreground")}>{b.batch_number}</td>
                                  <td className="py-1.5 px-2">{b.manufacturer || "—"}</td>
                                  <td className={cn("py-1.5 px-2 font-medium", isExpired ? "text-red-700" : isExpiring && "text-destructive")}>
                                    {expDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                    {isExpired
                                      ? <span className="ml-1.5 text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold">EXPIRED</span>
                                      : isExpiring && <span className="ml-1"> ⚠️</span>
                                    }
                                  </td>
                                  <td className={cn("py-1.5 px-2 text-right font-semibold tabular-nums", isExpired && "text-red-700")}>{b.quantity_available}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums">₹{Number(b.mrp).toFixed(2)}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums">₹{Number(b.cost_price).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  {loading ? "Loading stock data..." : "No drugs found"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PharmacyStockTab;
