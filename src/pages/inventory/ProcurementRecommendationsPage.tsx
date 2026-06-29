import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, XCircle, TrendingUp, Package, ArrowLeft, MessageCircle, RefreshCw, ShoppingCart, Loader2, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function openWhatsAppAlert(rec: any) {
  const itemName = rec.item?.name ?? "Unknown Item";
  const qty = rec.recommended_quantity;
  const unit = rec.item?.unit_of_measure ?? "";
  const priority = (rec.priority ?? "medium").toUpperCase();
  const stockout = rec.expected_stockout_date
    ? ` Expected stockout: ${new Date(rec.expected_stockout_date).toLocaleDateString("en-IN")}.`
    : "";
  const msg = `🏥 *Procurement Alert — ${priority}*\n\nItem: ${itemName}\nRequired Qty: ${qty} ${unit}\nCurrent Stock: ${rec.current_stock ?? "N/A"}${stockout}\n\nPlease raise a Purchase Order immediately.\n\n_Sent from HMS Procurement Module_`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
}

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  critical: { label: "Critical", bg: "bg-red-100", text: "text-red-700" },
  high:     { label: "High",     bg: "bg-orange-100", text: "text-orange-700" },
  medium:   { label: "Medium",   bg: "bg-amber-100",  text: "text-amber-700" },
  low:      { label: "Low",      bg: "bg-slate-100",  text: "text-slate-600" },
};

export default function ProcurementRecommendationsPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "pending" | "critical">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [poVendorId, setPoVendorId] = useState("");
  const [creatingPO, setCreatingPO] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; vendor_name: string }[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("vendors").select("id, vendor_name").eq("is_active", true)
      .then(({ data }: any) => setVendors(data || []));
  }, [hospitalId]);

  const refreshStockoutEstimates = async () => {
    if (!hospitalId) return;
    setRefreshing(true);
    try {
      const [stockRes, itemRes, recsRes] = await Promise.all([
        (supabase as any).from("inventory_stock").select("item_id, quantity_available"),
        (supabase as any).from("inventory_items").select("id, reorder_level").eq("hospital_id", hospitalId),
        (supabase as any).from("procurement_recommendations").select("id, item_id").eq("hospital_id", hospitalId).eq("status", "pending"),
      ]);

      const stockMap: Record<string, number> = {};
      (stockRes.data || []).forEach((s: any) => { stockMap[s.item_id] = (stockMap[s.item_id] || 0) + (s.quantity_available || 0); });

      const reorderMap: Record<string, number> = {};
      (itemRes.data || []).forEach((i: any) => { reorderMap[i.id] = i.reorder_level || 10; });

      for (const rec of (recsRes.data || [])) {
        const currentStock = stockMap[rec.item_id] || 0;
        const dailyConsumption = (reorderMap[rec.item_id] || 10) / 30;
        const daysToStockout = dailyConsumption > 0 ? Math.ceil(currentStock / dailyConsumption) : 999;
        const expectedStockoutDate = new Date(Date.now() + daysToStockout * 86400000).toISOString().split("T")[0];
        await (supabase as any).from("procurement_recommendations")
          .update({ current_stock: currentStock, expected_stockout_date: expectedStockoutDate })
          .eq("id", rec.id);
      }

      toast({ title: `Stockout estimates updated for ${(recsRes.data || []).length} items` });
      qc.invalidateQueries({ queryKey: ["procurement-recommendations"] });
    } catch (err: any) {
      toast({ title: "Failed to refresh", description: err.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const scanReorderBreaches = async () => {
    if (!hospitalId) return;
    setScanning(true);
    try {
      const [stockRes, itemRes, vendorRes, existingRes] = await Promise.all([
        (supabase as any).from("inventory_stock").select("item_id, quantity_available").eq("hospital_id", hospitalId),
        (supabase as any).from("inventory_items").select("id, item_name, category, reorder_level, max_stock_level, minimum_order_qty, abc_class").eq("hospital_id", hospitalId).eq("is_active", true),
        (supabase as any).from("vendors").select("id, vendor_name, category, performance_score").eq("hospital_id", hospitalId).eq("is_active", true),
        (supabase as any).from("procurement_recommendations").select("item_id").eq("hospital_id", hospitalId).eq("status", "pending"),
      ]);

      const stockMap: Record<string, number> = {};
      (stockRes.data || []).forEach((s: any) => {
        stockMap[s.item_id] = (stockMap[s.item_id] || 0) + (s.quantity_available || 0);
      });

      const existingItems = new Set((existingRes.data || []).map((r: any) => r.item_id));
      const allVendors: any[] = vendorRes.data || [];
      const toInsert: any[] = [];

      for (const item of (itemRes.data || [])) {
        const currentStock = stockMap[item.id] || 0;
        const reorderLevel = item.reorder_level || 10;
        if (currentStock > reorderLevel) continue;
        if (existingItems.has(item.id)) continue;

        let priority = "medium";
        let priorityScore = 50;
        if (currentStock === 0) { priority = "critical"; priorityScore = 100; }
        else if (currentStock < reorderLevel * 0.5) { priority = "high"; priorityScore = 80; }
        else if (item.abc_class === "A") { priority = "high"; priorityScore = 70; }

        const dailyConsumption = reorderLevel / 30;
        const daysToStockout = dailyConsumption > 0 ? Math.ceil(currentStock / dailyConsumption) : 999;
        const expectedStockoutDate = new Date(Date.now() + daysToStockout * 86400000).toISOString().split("T")[0];

        const categoryVendors = allVendors.filter((v: any) =>
          Array.isArray(v.category) ? v.category.includes(item.category) : v.category === item.category
        );
        const pool = categoryVendors.length > 0 ? categoryVendors : allVendors;
        const bestVendor = [...pool].sort((a: any, b: any) => (b.performance_score || 0) - (a.performance_score || 0))[0];

        const maxStock = item.max_stock_level || reorderLevel * 3;
        const recommendedQty = Math.max(item.minimum_order_qty || 1, maxStock - currentStock);
        const stockoutMsg = currentStock === 0 ? "OUT OF STOCK — urgent action needed." : `Est. stockout in ${daysToStockout} day${daysToStockout !== 1 ? "s" : ""}.`;

        toInsert.push({
          hospital_id: hospitalId,
          item_id: item.id,
          recommended_quantity: recommendedQty,
          current_stock: currentStock,
          expected_stockout_date: expectedStockoutDate,
          priority,
          priority_score: priorityScore,
          recommendation_type: "reorder_breach",
          recommendation_text: `Stock (${currentStock}) breached reorder level (${reorderLevel}). ${stockoutMsg}${bestVendor ? ` Suggested vendor: ${bestVendor.vendor_name}.` : ""}`,
          forecast_7d: Math.round(dailyConsumption * 7),
          status: "pending",
          reasoning: `Auto-scanned ${new Date().toLocaleDateString("en-IN")}. Category: ${item.category || "uncategorised"}.`,
        });
      }

      if (toInsert.length === 0) {
        toast({ title: "No new breaches", description: "All active items are above reorder levels or already have pending recommendations." });
        setScanning(false);
        return;
      }

      const { error } = await (supabase as any).from("procurement_recommendations").insert(toInsert);
      if (error) throw error;
      toast({ title: `${toInsert.length} reorder breach recommendation${toInsert.length !== 1 ? "s" : ""} created` });
      qc.invalidateQueries({ queryKey: ["procurement-recommendations"] });
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const createPOFromAccepted = async () => {
    if (!hospitalId || !poVendorId) { toast({ title: "Select a vendor", variant: "destructive" }); return; }
    const accepted = (recs || []).filter((r: any) => r.status === "accepted");
    if (accepted.length === 0) { toast({ title: "No accepted recommendations", variant: "destructive" }); return; }
    setCreatingPO(true);
    try {
      const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
      if (!userData) throw new Error("User not found");
      const poNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
      const { data: po, error } = await (supabase as any).from("purchase_orders").insert({
        hospital_id: hospitalId, po_number: poNumber, vendor_id: poVendorId,
        notes: `Auto-generated from ${accepted.length} procurement recommendations`,
        total_amount: 0, gst_amount: 0, net_amount: 0,
        created_by: userData.id, status: "draft",
      }).select().maybeSingle();
      if (error || !po) throw new Error(error?.message || "PO creation failed");
      for (const rec of accepted) {
        await (supabase as any).from("po_items").insert({
          hospital_id: hospitalId, po_id: po.id, item_id: rec.item_id,
          quantity_ordered: rec.recommended_quantity, unit_rate: 0, gst_percent: 12, total_amount: 0,
        });
      }
      toast({ title: `PO ${poNumber} created with ${accepted.length} items — go to Inventory → PO to set rates` });
      setShowCreatePO(false);
      setPoVendorId("");
    } catch (err: any) {
      toast({ title: "Failed to create PO", description: err.message, variant: "destructive" });
    } finally {
      setCreatingPO(false);
    }
  };

  const { data: recs, isLoading } = useQuery({
    queryKey: ["procurement-recommendations", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("procurement_recommendations")
        .select("*, item:inventory_items(name, unit_of_measure)")
        .eq("hospital_id", hospitalId)
        .order("priority_score", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!hospitalId,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("procurement_recommendations")
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["procurement-recommendations"] });
      toast({ title: "Recommendation updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = (recs ?? []).filter((r) => {
    if (filter === "pending") return r.status === "pending";
    if (filter === "critical") return r.priority === "critical" || r.priority_score >= 80;
    return true;
  });

  const stats = {
    total: recs?.length ?? 0,
    pending: recs?.filter((r) => r.status === "pending").length ?? 0,
    critical: recs?.filter((r) => r.priority === "critical" || (r.priority_score ?? 0) >= 80).length ?? 0,
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold">Procurement Recommendations</h1>
            <p className="text-xs text-muted-foreground">AI-driven inventory replenishment suggestions</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={scanReorderBreaches} disabled={scanning} className="text-xs h-8 gap-1.5">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
            {scanning ? "Scanning…" : "Scan Reorder Breaches"}
          </Button>
          <Button size="sm" variant="outline" onClick={refreshStockoutEstimates} disabled={refreshing} className="text-xs h-8 gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing…" : "Refresh Estimates"}
          </Button>
          {(recs || []).some((r: any) => r.status === "accepted") && (
            <Button size="sm" onClick={() => setShowCreatePO(true)} className="text-xs h-8 gap-1.5">
              <ShoppingCart className="h-3.5 w-3.5" /> Create PO from Accepted
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-4 px-6 py-4">
        {[
          { label: "Total Recommendations", value: stats.total, icon: Package, color: "text-blue-600" },
          { label: "Pending Review", value: stats.pending, icon: TrendingUp, color: "text-amber-600" },
          { label: "Critical", value: stats.critical, icon: AlertTriangle, color: "text-red-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <Icon size={24} className={color} />
            <div>
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 px-6 pb-3 flex gap-2">
        {(["all", "pending", "critical"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-[hsl(222,55%,23%)] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">Loading recommendations…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <CheckCircle size={40} className="text-emerald-400" />
            <p className="text-sm text-muted-foreground">No recommendations in this view</p>
          </div>
        ) : (
          filtered.map((rec) => {
            const p = PRIORITY_CONFIG[rec.priority ?? "medium"] ?? PRIORITY_CONFIG.medium;
            return (
              <div key={rec.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", p.bg, p.text)}>{p.label}</span>
                      <span className="text-[11px] text-muted-foreground capitalize">{rec.recommendation_type?.replace("_", " ")}</span>
                      {rec.priority_score != null && (
                        <span className="text-[11px] text-muted-foreground">Score: {rec.priority_score}/100</span>
                      )}
                    </div>
                    <p className="font-semibold text-foreground">{(rec as any).item?.name ?? "Unknown Item"}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Recommended qty: <strong>{rec.recommended_quantity} {(rec as any).item?.unit_of_measure}</strong>
                      {rec.current_stock != null && <> · Current stock: {rec.current_stock}</>}
                      {rec.forecast_7d != null && <> · 7-day forecast: {rec.forecast_7d}</>}
                    </p>
                    {rec.recommendation_text && (
                      <p className="text-xs text-muted-foreground mt-1.5 italic">{rec.recommendation_text}</p>
                    )}
                    {rec.expected_stockout_date && (
                      <p className="text-xs text-destructive mt-1 font-medium">
                        ⚠ Expected stockout: {new Date(rec.expected_stockout_date).toLocaleDateString("en-IN")}
                      </p>
                    )}
                  </div>

                  {rec.status === "pending" ? (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => updateStatus.mutate({ id: rec.id, status: "accepted" })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                        <CheckCircle size={14} /> Accept
                      </button>
                      <button onClick={() => openWhatsAppAlert(rec)}
                        title="Send WhatsApp alert to pharmacy/purchase team"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-sm font-medium hover:bg-green-600">
                        <MessageCircle size={14} /> Notify
                      </button>
                      <button onClick={() => updateStatus.mutate({ id: rec.id, status: "rejected" })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-muted">
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  ) : (
                    <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0",
                      rec.status === "accepted" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
                      {rec.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create PO from Accepted Modal */}
      {showCreatePO && (
        <Dialog open onOpenChange={() => setShowCreatePO(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Create PO from Accepted Recommendations</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">
                {(recs || []).filter((r: any) => r.status === "accepted").length} accepted recommendations will be added to a new draft PO. Set unit rates in Inventory → PO after creation.
              </p>
              <Select value={poVendorId} onValueChange={setPoVendorId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select Vendor *" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id} className="text-xs">{v.vendor_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowCreatePO(false)} className="text-xs">Cancel</Button>
              <Button size="sm" onClick={createPOFromAccepted} disabled={creatingPO || !poVendorId} className="text-xs">
                {creatingPO ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Creating…</> : <><ShoppingCart className="h-3 w-3 mr-1" />Create PO</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
