import React, { useState, useEffect } from "react";
import { BarChart3, Package, AlertTriangle, Calendar, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ReportType = "valuation" | "consumption" | "dead_stock" | "expiry" | "vendor";

const ReportsPanel: React.FC = () => {
  const [activeReport, setActiveReport] = useState<ReportType>("valuation");
  const [valuationData, setValuationData] = useState<any[]>([]);
  const [deadStockData, setDeadStockData] = useState<any[]>([]);
  const [expiryData, setExpiryData] = useState<any[]>([]);

  const loadValuation = async () => {
    const { data: items } = await (supabase as any).from("inventory_items").select("id, item_name, category").eq("is_active", true);
    const { data: stock } = await (supabase as any).from("inventory_stock").select("item_id, quantity_available, cost_price");
    if (!items || !stock) return;

    const stockByItem: Record<string, { qty: number; value: number }> = {};
    stock.forEach((s: any) => {
      if (!stockByItem[s.item_id]) stockByItem[s.item_id] = { qty: 0, value: 0 };
      stockByItem[s.item_id].qty += s.quantity_available || 0;
      stockByItem[s.item_id].value += (s.quantity_available || 0) * (s.cost_price || 0);
    });

    const catTotals: Record<string, { qty: number; value: number; items: number }> = {};
    items.forEach((i: any) => {
      const cat = i.category || "other";
      if (!catTotals[cat]) catTotals[cat] = { qty: 0, value: 0, items: 0 };
      catTotals[cat].items++;
      catTotals[cat].qty += stockByItem[i.id]?.qty || 0;
      catTotals[cat].value += stockByItem[i.id]?.value || 0;
    });

    setValuationData(Object.entries(catTotals).map(([cat, data]) => ({ category: cat, ...data })).sort((a, b) => b.value - a.value));
  };

  const loadDeadStock = async () => {
    const { data: items } = await (supabase as any).from("inventory_items").select("id, item_name, category").eq("is_active", true);
    const { data: stock } = await (supabase as any).from("inventory_stock").select("item_id, quantity_available, cost_price");
    const { data: transactions } = await (supabase as any).from("stock_transactions").select("item_id, created_at").order("created_at", { ascending: false });
    if (!items || !stock) return;

    const lastTxn: Record<string, string> = {};
    (transactions || []).forEach((t: any) => { if (!lastTxn[t.item_id]) lastTxn[t.item_id] = t.created_at; });

    const stockByItem: Record<string, { qty: number; value: number }> = {};
    (stock || []).forEach((s: any) => {
      if (!stockByItem[s.item_id]) stockByItem[s.item_id] = { qty: 0, value: 0 };
      stockByItem[s.item_id].qty += s.quantity_available || 0;
      stockByItem[s.item_id].value += (s.quantity_available || 0) * (s.cost_price || 0);
    });

    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dead = items.filter((i: any) => {
      const qty = stockByItem[i.id]?.qty || 0;
      if (qty === 0) return false;
      const lastDate = lastTxn[i.id];
      return !lastDate || new Date(lastDate) < ninetyDaysAgo;
    }).map((i: any) => ({
      ...i,
      qty: stockByItem[i.id]?.qty || 0,
      value: stockByItem[i.id]?.value || 0,
      lastActivity: lastTxn[i.id] ? new Date(lastTxn[i.id]).toLocaleDateString("en-IN") : "Never",
    }));

    setDeadStockData(dead);
  };

  const loadExpiry = async () => {
    const { data: stock } = await (supabase as any)
      .from("inventory_stock")
      .select("item_id, quantity_available, expiry_date, inventory_items(item_name)")
      .not("expiry_date", "is", null)
      .order("expiry_date");

    const expiring = (stock || []).filter((s: any) => {
      if (!s.expiry_date) return false;
      const days = Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
      return days <= 90;
    }).map((s: any) => {
      const days = Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
      return { ...s, item_name: s.inventory_items?.item_name, daysLeft: days };
    });

    setExpiryData(expiring);
  };

  useEffect(() => {
    if (activeReport === "valuation") loadValuation();
    else if (activeReport === "dead_stock") loadDeadStock();
    else if (activeReport === "expiry") loadExpiry();
  }, [activeReport]);

  const totalDeadValue = deadStockData.reduce((s, d) => s + d.value, 0);

  const reports = [
    { id: "valuation" as ReportType, label: "Stock Valuation", icon: BarChart3 },
    { id: "dead_stock" as ReportType, label: "Dead Stock", icon: Package },
    { id: "expiry" as ReportType, label: "Expiry Report", icon: Calendar },
    { id: "vendor" as ReportType, label: "Vendor Performance", icon: Building2 },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left — Report Selector */}
      <div className="w-[200px] flex-shrink-0 border-r border-border bg-card flex flex-col py-2">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <button
              key={r.id}
              onClick={() => setActiveReport(r.id)}
              className={cn(
                "flex items-center gap-2.5 h-10 px-4 text-xs font-medium transition-colors text-left",
                activeReport === r.id ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <Icon size={14} className="shrink-0" /> {r.label}
            </button>
          );
        })}
      </div>

      {/* Right — Report Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeReport === "valuation" && (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Stock Valuation by Category</p>
              <p className="text-[10px] text-muted-foreground">Current stock value at cost price</p>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Category</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Items</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Total Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Value (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {valuationData.map((row) => (
                    <tr key={row.category} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium capitalize text-foreground">{row.category}</td>
                      <td className="px-3 py-2 text-right">{row.items}</td>
                      <td className="px-3 py-2 text-right">{row.qty.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right font-semibold">₹{row.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                  {valuationData.length > 0 && (
                    <tr className="bg-muted/50 font-bold">
                      <td className="px-4 py-2 text-foreground">Total</td>
                      <td className="px-3 py-2 text-right">{valuationData.reduce((s, r) => s + r.items, 0)}</td>
                      <td className="px-3 py-2 text-right">{valuationData.reduce((s, r) => s + r.qty, 0).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right">₹{valuationData.reduce((s, r) => s + r.value, 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeReport === "dead_stock" && (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Dead Stock Report</p>
              <p className="text-[10px] text-muted-foreground">Items with no movement in 90+ days</p>
            </div>
            {totalDeadValue > 0 && (
              <div className="flex-shrink-0 bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-xs font-semibold text-red-700">
                  ₹{totalDeadValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} worth of dead stock identified across {deadStockData.length} items
                </span>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Category</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Value (₹)</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {deadStockData.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium text-foreground">{item.item_name}</td>
                      <td className="px-3 py-2 capitalize text-muted-foreground">{item.category}</td>
                      <td className="px-3 py-2 text-right">{item.qty}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600">₹{item.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.lastActivity}</td>
                    </tr>
                  ))}
                  {deadStockData.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No dead stock found. All items have recent activity.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeReport === "expiry" && (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Expiry Report</p>
              <p className="text-[10px] text-muted-foreground">Items expiring within 90 days</p>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Batch</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Expiry Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {expiryData.map((item, idx) => (
                    <tr key={idx} className={cn("border-b border-border/50", item.daysLeft <= 0 ? "bg-red-50" : item.daysLeft <= 30 ? "bg-red-50/50" : item.daysLeft <= 60 ? "bg-amber-50/50" : "")}>
                      <td className="px-4 py-2 font-medium text-foreground">{item.item_name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{item.batch_number || "—"}</td>
                      <td className="px-3 py-2 text-right">{item.quantity_available}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.expiry_date}</td>
                      <td className="px-3 py-2">
                        {item.daysLeft <= 0 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">EXPIRED</span>
                        ) : (
                          <span className={cn("font-semibold", item.daysLeft <= 30 ? "text-red-600" : item.daysLeft <= 60 ? "text-amber-600" : "text-amber-500")}>
                            {item.daysLeft} days
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {expiryData.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No items expiring within 90 days.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeReport === "vendor" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Building2 size={32} className="text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Vendor Performance</p>
            <p className="text-xs">Track delivery timelines, order accuracy, and pricing trends per vendor.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsPanel;
