import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Download, RefreshCw, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BatchRow {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity_available: number;
  cost_price: number;
  drug_name: string;
  manufacturer: string | null;
  supplier_name: string | null;
}

type ExpiryGroup = "expired" | "critical" | "warning" | "ok";
type ActiveFilter = ExpiryGroup | "all" | "quarantined";

function getGroup(expiryDate: string): ExpiryGroup {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "critical";
  if (daysLeft <= 90) return "warning";
  return "ok";
}

function daysLeft(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
}

const GROUP_CONFIG = {
  expired: { label: "Expired", color: "bg-red-100 text-red-700 border-red-200", rowBg: "bg-red-50/60", badge: "bg-red-100 text-red-700" },
  critical: { label: "< 30 days", color: "bg-orange-100 text-orange-700 border-orange-200", rowBg: "bg-orange-50/40", badge: "bg-orange-100 text-orange-700" },
  warning: { label: "30–90 days", color: "bg-amber-100 text-amber-700 border-amber-200", rowBg: "bg-amber-50/30", badge: "bg-amber-100 text-amber-700" },
};

interface Props {
  hospitalId: string;
}

const ExpiryControlTab: React.FC<Props> = ({ hospitalId }) => {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [quarantinedBatches, setQuarantinedBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<ActiveFilter>("all");

  const mapRow = (b: any): BatchRow => ({
    id: b.id,
    batch_number: b.batch_number,
    expiry_date: b.expiry_date,
    quantity_available: b.quantity_available,
    cost_price: b.cost_price,
    drug_name: b.drug_master?.brand_name || b.drug_master?.generic_name || "Unknown",
    manufacturer: b.manufacturer,
    supplier_name: b.supplier_name,
  });

  const fetch = useCallback(async () => {
    setLoading(true);
    const ninetyDaysOut = new Date();
    ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90);

    const [expiryRes, quarantineRes] = await Promise.all([
      (supabase as any)
        .from("drug_batches")
        .select("id, batch_number, expiry_date, quantity_available, cost_price, manufacturer, supplier_name, drug_master(generic_name, brand_name)")
        .eq("hospital_id", hospitalId)
        .neq("status", "quarantined")
        .neq("status", "destroyed")
        .gt("quantity_available", 0)
        .lte("expiry_date", ninetyDaysOut.toISOString().split("T")[0])
        .order("expiry_date", { ascending: true })
        .limit(300),
      (supabase as any)
        .from("drug_batches")
        .select("id, batch_number, expiry_date, quantity_available, cost_price, manufacturer, supplier_name, drug_master(generic_name, brand_name)")
        .eq("hospital_id", hospitalId)
        .eq("status", "quarantined")
        .eq("is_active", true)
        .order("expiry_date", { ascending: true })
        .limit(200),
    ]);

    if (expiryRes.error) { toast.error(expiryRes.error.message); setLoading(false); return; }

    setBatches((expiryRes.data || []).map(mapRow));
    setQuarantinedBatches((quarantineRes.data || []).map(mapRow));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const filtered = batches.filter(b => {
    const matchSearch = !search || b.drug_name.toLowerCase().includes(search.toLowerCase()) || b.batch_number.toLowerCase().includes(search.toLowerCase());
    const matchGroup = activeGroup === "all" || getGroup(b.expiry_date) === activeGroup;
    return matchSearch && matchGroup;
  });

  const counts = {
    expired: batches.filter(b => getGroup(b.expiry_date) === "expired").length,
    critical: batches.filter(b => getGroup(b.expiry_date) === "critical").length,
    warning: batches.filter(b => getGroup(b.expiry_date) === "warning").length,
    quarantined: quarantinedBatches.length,
  };

  const markDestroyed = async (batchId: string, drugName: string) => {
    await (supabase as any).from("drug_batches").update({ status: "destroyed", quantity_available: 0 }).eq("id", batchId);
    toast.success(`${drugName} marked as destroyed`);
    fetch();
  };

  const exportCSV = () => {
    const rows = [
      ["Drug Name", "Batch #", "Expiry Date", "Days Left", "Qty", "Cost/Unit", "Supplier"].join(","),
      ...filtered.map(b => [
        b.drug_name,
        b.batch_number,
        b.expiry_date,
        daysLeft(b.expiry_date),
        b.quantity_available,
        b.cost_price,
        b.supplier_name || "",
      ].map(v => `"${v}"`).join(",")),
    ].join("\n");

    const blob = new Blob([rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expiry_report_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Expiry report exported");
  };

  const markForReturn = async (batchId: string, drugName: string) => {
    await (supabase as any).from("pharmacy_stock_alerts").insert({
      hospital_id: hospitalId,
      alert_type: "expiring",
      batch_id: batchId,
      alert_message: `${drugName} marked for supplier return`,
    });
    toast.success(`${drugName} marked for return`);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Expiry Control Dashboard</h2>
            <p className="text-xs text-muted-foreground">Batches expiring within 90 days + expired stock</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={exportCSV}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={fetch} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        {/* Group filter chips */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveGroup("all")}
            className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              activeGroup === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")}
          >
            All ({batches.length})
          </button>
          {(["expired", "critical", "warning"] as const).map(g => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                activeGroup === g ? GROUP_CONFIG[g].color + " border" : "border-border hover:bg-muted")}
            >
              {g === "expired" ? "🔴" : g === "critical" ? "🟠" : "🟡"} {GROUP_CONFIG[g].label} ({counts[g]})
            </button>
          ))}
          <button
            onClick={() => setActiveGroup("quarantined")}
            className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              activeGroup === "quarantined"
                ? "bg-purple-100 text-purple-700 border-purple-300"
                : "border-border hover:bg-muted")}
          >
            🔒 Quarantined ({counts.quarantined})
          </button>
          <Input
            placeholder="Search drug or batch..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 w-48 text-xs ml-auto"
          />
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground text-sm">Loading expiry data...</p>
        ) : activeGroup === "quarantined" ? (
          quarantinedBatches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-purple-400" />
              <p className="text-sm font-medium">No quarantined stock</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 bg-purple-50 dark:bg-purple-950/20 border-b text-xs text-purple-700 font-medium flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                Quarantined stock — not available for dispensing. Mark as Destroyed when disposal is complete.
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Drug Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Batch #</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Expiry</th>
                    <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Value (₹)</th>
                    <th className="text-right px-4 py-2 font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {quarantinedBatches
                    .filter(b => !search || b.drug_name.toLowerCase().includes(search.toLowerCase()) || b.batch_number.toLowerCase().includes(search.toLowerCase()))
                    .map(b => (
                      <tr key={b.id} className="border-b hover:bg-muted/30 transition-colors bg-purple-50/40 dark:bg-purple-950/10">
                        <td className="px-4 py-2 font-medium">{b.drug_name}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{b.batch_number}</td>
                        <td className="px-3 py-2">{new Date(b.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                        <td className="px-3 py-2 text-center font-medium">{b.quantity_available}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {(b.quantity_available * b.cost_price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => markDestroyed(b.id, b.drug_name)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Mark Destroyed
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
            <p className="text-sm font-medium text-emerald-600">No expiring stock found</p>
            <p className="text-xs mt-1">All batches have more than 90 days before expiry</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Drug Name</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Batch #</th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Expiry</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Days</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Value (₹)</th>
                <th className="text-right px-4 py-2 font-semibold text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const group = getGroup(b.expiry_date);
                const days = daysLeft(b.expiry_date);
                const cfg = GROUP_CONFIG[group as keyof typeof GROUP_CONFIG];
                return (
                  <tr key={b.id} className={cn("border-b hover:bg-muted/30 transition-colors", cfg?.rowBg)}>
                    <td className="px-4 py-2 font-medium">{b.drug_name}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{b.batch_number}</td>
                    <td className="px-3 py-2">{new Date(b.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="secondary" className={cn("text-[10px]", cfg?.badge)}>
                        {days < 0 ? "EXPIRED" : `${days}d`}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-center font-medium">{b.quantity_available}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {(b.quantity_available * b.cost_price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        onClick={() => markForReturn(b.id, b.drug_name)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Mark Return
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* Summary footer */}
      {!loading && batches.length > 0 && (
        <div className="border-t px-4 py-2 bg-card flex items-center gap-4 text-xs text-muted-foreground">
          <span>Total batches: <strong>{batches.length}</strong></span>
          <span>Total value at risk: <strong>₹{batches.reduce((sum, b) => sum + b.quantity_available * b.cost_price, 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</strong></span>
        </div>
      )}
    </div>
  );
};

export default ExpiryControlTab;
