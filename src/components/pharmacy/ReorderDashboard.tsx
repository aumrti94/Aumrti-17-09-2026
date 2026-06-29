import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, ShoppingCart, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReorderTrigger {
  id: string;
  drug_name: string;
  trigger_reason: string;
  current_qty: number;
  reorder_qty: number;
  status: string;
  batch_info: string | null;
  created_at: string;
  notes: string | null;
}

interface LowStockDrug {
  drug_id: string;
  drug_name: string;
  current_stock: number;
  min_stock_level: number;
  reorder_qty: number;
  auto_reorder_enabled: boolean;
}

interface Props {
  hospitalId: string;
}

const ReorderDashboard: React.FC<Props> = ({ hospitalId }) => {
  const [triggers, setTriggers] = useState<ReorderTrigger[]>([]);
  const [lowStock, setLowStock] = useState<LowStockDrug[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "low_stock">("pending");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [trigRes, stockRes] = await Promise.all([
        (supabase as any)
          .from("stock_reorder_triggers")
          .select("id, trigger_reason, current_qty, reorder_qty, status, batch_info, notes, created_at, drug_master(generic_name, brand_name)")
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("drug_master")
          .select("id, generic_name, brand_name, min_stock_level, reorder_qty, auto_reorder_enabled")
          .eq("hospital_id", hospitalId)
          .gt("min_stock_level", 0)
          .limit(200),
      ]);

      const triggerRows: ReorderTrigger[] = (trigRes.data || []).map((t: any) => ({
        id: t.id,
        drug_name: t.drug_master?.brand_name || t.drug_master?.generic_name || "Unknown",
        trigger_reason: t.trigger_reason,
        current_qty: t.current_qty,
        reorder_qty: t.reorder_qty,
        status: t.status,
        batch_info: t.batch_info,
        created_at: t.created_at,
        notes: t.notes,
      }));
      setTriggers(triggerRows);

      // Fetch current stock sums per drug
      if (stockRes.data?.length > 0) {
        const drugIds = stockRes.data.map((d: any) => d.id);
        const { data: stockSums } = await (supabase as any)
          .from("drug_batches")
          .select("drug_id, quantity_available")
          .eq("hospital_id", hospitalId)
          .in("drug_id", drugIds)
          .gt("quantity_available", 0);

        const stockByDrug: Record<string, number> = {};
        (stockSums || []).forEach((s: any) => {
          stockByDrug[s.drug_id] = (stockByDrug[s.drug_id] || 0) + s.quantity_available;
        });

        const lowStockRows: LowStockDrug[] = stockRes.data
          .map((d: any) => ({
            drug_id: d.id,
            drug_name: d.brand_name || d.generic_name,
            current_stock: stockByDrug[d.id] || 0,
            min_stock_level: d.min_stock_level || 0,
            reorder_qty: d.reorder_qty || 0,
            auto_reorder_enabled: d.auto_reorder_enabled || false,
          }))
          .filter((d: LowStockDrug) => d.current_stock < d.min_stock_level);

        setLowStock(lowStockRows);
      }
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateTriggerStatus = async (id: string, status: "ordered" | "cancelled") => {
    await (supabase as any).from("stock_reorder_triggers").update({ status }).eq("id", id);
    setTriggers(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    toast.success(status === "ordered" ? "Marked as ordered" : "Trigger cancelled");
  };

  const toggleAutoReorder = async (drugId: string, enabled: boolean) => {
    await (supabase as any).from("drug_master").update({ auto_reorder_enabled: enabled }).eq("id", drugId);
    setLowStock(prev => prev.map(d => d.drug_id === drugId ? { ...d, auto_reorder_enabled: enabled } : d));
    toast.success(`Auto-reorder ${enabled ? "enabled" : "disabled"}`);
  };

  const createManualTrigger = async (drug: LowStockDrug) => {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any).from("stock_reorder_triggers").insert({
      hospital_id: hospitalId,
      drug_id: drug.drug_id,
      trigger_reason: "low_stock",
      current_qty: drug.current_stock,
      reorder_qty: drug.reorder_qty || drug.min_stock_level * 2,
      status: "pending",
      created_by: user?.id,
    });
    toast.success(`Reorder triggered for ${drug.drug_name}`);
    fetchData();
  };

  const pendingTriggers = triggers.filter(t => t.status === "pending");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-card flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Reorder Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            {pendingTriggers.length} pending reorder{pendingTriggers.length !== 1 ? "s" : ""} · {lowStock.length} drugs below minimum
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={fetchData} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 px-4 py-2 border-b bg-background">
        <button
          onClick={() => setActiveTab("pending")}
          className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "pending" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
        >
          <Clock className="h-3 w-3 inline mr-1" />
          Pending Reorders
          {pendingTriggers.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[9px] bg-primary/10 text-primary px-1">{pendingTriggers.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("low_stock")}
          className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "low_stock" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
        >
          <ShoppingCart className="h-3 w-3 inline mr-1" />
          Low Stock Drugs
          {lowStock.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 px-1">{lowStock.length}</Badge>
          )}
        </button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground text-sm">Loading...</p>
        ) : activeTab === "pending" ? (
          triggers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600">No pending reorder triggers</p>
            </div>
          ) : (
            <div className="divide-y">
              {triggers.map(t => (
                <div key={t.id} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.drug_name}</span>
                      <Badge variant="secondary" className={cn("text-[10px]",
                        t.trigger_reason === "low_stock" ? "bg-amber-100 text-amber-700" :
                        t.trigger_reason === "expiring_soon" ? "bg-orange-100 text-orange-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {t.trigger_reason?.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="secondary" className={cn("text-[10px]",
                        t.status === "pending" ? "bg-amber-100 text-amber-700" :
                        t.status === "ordered" ? "bg-emerald-100 text-emerald-700" :
                        "bg-slate-100 text-slate-500"
                      )}>
                        {t.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Current: {t.current_qty} units · Reorder: {t.reorder_qty} units
                      {t.notes && <span className="ml-2 italic">{t.notes}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {new Date(t.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {t.status === "pending" && (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => updateTriggerStatus(t.id, "ordered")}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Ordered
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => updateTriggerStatus(t.id, "cancelled")}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          lowStock.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600">All drugs above minimum stock levels</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Drug</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Current</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Minimum</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Deficit</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Auto-Reorder</th>
                  <th className="text-right px-4 py-2 font-semibold text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map(d => (
                  <tr key={d.drug_id} className="border-b hover:bg-muted/30 transition-colors bg-amber-50/30">
                    <td className="px-4 py-2.5 font-medium">{d.drug_name}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-red-600 font-bold">{d.current_stock}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-muted-foreground">{d.min_stock_level}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700">
                        -{d.min_stock_level - d.current_stock}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Switch
                        checked={d.auto_reorder_enabled}
                        onCheckedChange={v => toggleAutoReorder(d.drug_id, v)}
                        className="scale-75"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2"
                        onClick={() => createManualTrigger(d)}
                      >
                        <ShoppingCart className="h-3 w-3 mr-1" /> Trigger Reorder
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </ScrollArea>
    </div>
  );
};

export default ReorderDashboard;
