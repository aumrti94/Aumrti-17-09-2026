import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Boxes, Pill, Warehouse, AlertTriangle, Droplet, Syringe } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string;
}

interface SiloSummary {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  skus: number;
  units: number;
  value: number;
  expiring: number; // batches with 0<qty and 0<=days<=30
  expired: number;  // batches with qty>0 and days<0
}

interface ExpiringRow {
  silo: string;
  item_name: string;
  location: string;
  batch: string;
  expiry: string;
  days: number;
  qty: number;
}

const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

interface VendorSpend { name: string; silo: string; amount: number; }

const ConsolidatedStockPanel: React.FC<Props> = ({ hospitalId }) => {
  const [silos, setSilos] = useState<SiloSummary[]>([]);
  const [expiring, setExpiring] = useState<ExpiringRow[]>([]);
  const [vendorSpend, setVendorSpend] = useState<VendorSpend[]>([]);
  const [totalSpend, setTotalSpend] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const [centralRes, pharmRes, subRes, grnRes, drugBuyRes, bloodRes, vacRes] = await Promise.all([
      (supabase as any).from("inventory_stock")
        .select("item_id, quantity_available, cost_price, expiry_date, batch_number, inventory_items(item_name)")
        .eq("hospital_id", hospitalId),
      (supabase as any).from("drug_batches")
        .select("drug_id, quantity_available, cost_price, expiry_date, batch_number, drug_master(drug_name)")
        .eq("hospital_id", hospitalId).eq("is_active", true),
      (supabase as any).from("store_stock")
        .select("item_id, quantity_available, cost_price, expiry_date, batch_number, inventory_items(item_name), store_locations(name)")
        .eq("hospital_id", hospitalId),
      (supabase as any).from("grn_records")
        .select("total_amount, vendors(vendor_name)")
        .eq("hospital_id", hospitalId),
      (supabase as any).from("drug_batches")
        .select("supplier_name, quantity_received, cost_price")
        .eq("hospital_id", hospitalId),
      (supabase as any).from("blood_units")
        .select("status, component, blood_group, unit_number, expiry_at")
        .eq("hospital_id", hospitalId),
      (supabase as any).from("vaccine_stock")
        .select("quantity_balance, batch_number, expiry_date")
        .eq("hospital_id", hospitalId),
    ]);

    // Procurement spend: central from GRN receipts, pharmacy from drug purchase value.
    const spendMap: Record<string, VendorSpend> = {};
    let spendTotal = 0;
    (grnRes.data || []).forEach((g: any) => {
      const name = g.vendors?.vendor_name || "Unknown vendor";
      const amt = g.total_amount || 0;
      spendTotal += amt;
      const k = `Central|${name}`;
      spendMap[k] = { name, silo: "Central", amount: (spendMap[k]?.amount || 0) + amt };
    });
    (drugBuyRes.data || []).forEach((b: any) => {
      const name = b.supplier_name || "Unknown supplier";
      const amt = (b.quantity_received || 0) * (b.cost_price || 0);
      spendTotal += amt;
      const k = `Pharmacy|${name}`;
      spendMap[k] = { name, silo: "Pharmacy", amount: (spendMap[k]?.amount || 0) + amt };
    });
    setTotalSpend(spendTotal);
    setVendorSpend(Object.values(spendMap).sort((a, b) => b.amount - a.amount).slice(0, 10));

    const expRows: ExpiringRow[] = [];

    const summarise = (
      rows: any[], key: string, label: string, icon: React.ElementType, color: string,
      idField: string, nameOf: (r: any) => string, locOf: (r: any) => string
    ): SiloSummary => {
      const skuSet = new Set<string>();
      let units = 0, value = 0, expiringN = 0, expiredN = 0;
      (rows || []).forEach((r) => {
        const qty = r.quantity_available || 0;
        if (qty > 0) skuSet.add(r[idField]);
        units += qty;
        value += qty * (r.cost_price || 0);
        const d = daysTo(r.expiry_date);
        if (qty > 0 && d !== null) {
          if (d < 0) expiredN++;
          else if (d <= 30) expiringN++;
          if (d <= 30) {
            expRows.push({
              silo: label, item_name: nameOf(r), location: locOf(r),
              batch: r.batch_number || "—", expiry: r.expiry_date, days: d, qty,
            });
          }
        }
      });
      return { key, label, icon, color, skus: skuSet.size, units, value, expiring: expiringN, expired: expiredN };
    };

    const centralSilo = summarise(centralRes.data, "central", "Central Stores", Boxes, "text-blue-600",
      "item_id", (r) => r.inventory_items?.item_name || "—", () => "Central");
    const pharmSilo = summarise(pharmRes.data, "pharmacy", "Pharmacy", Pill, "text-emerald-600",
      "drug_id", (r) => r.drug_master?.drug_name || "—", () => "Pharmacy");
    const subSilo = summarise(subRes.data, "substore", "Ward / Sub-stores", Warehouse, "text-amber-600",
      "item_id", (r) => r.inventory_items?.item_name || "—", (r) => r.store_locations?.name || "Sub-store");

    // Blood bank (available units, no cost tracked) + vaccination (quantity_balance) silos
    let bUnits = 0, bExp = 0, bExpd = 0;
    (bloodRes.data || []).forEach((b: any) => {
      if (b.status !== "available") return;
      bUnits++;
      const exp = b.expiry_at ? String(b.expiry_at).slice(0, 10) : null;
      const d = daysTo(exp);
      if (d !== null) {
        if (d < 0) bExpd++; else if (d <= 30) bExp++;
        if (d <= 30) expRows.push({ silo: "Blood Bank", item_name: `${b.component || ""} ${b.blood_group || ""}`.trim() || "Unit", location: "Blood Bank", batch: b.unit_number || "—", expiry: exp || "", days: d, qty: 1 });
      }
    });
    const bloodSilo: SiloSummary = { key: "blood", label: "Blood Bank", icon: Droplet, color: "text-red-600", skus: bUnits, units: bUnits, value: 0, expiring: bExp, expired: bExpd };

    let vUnits = 0, vExp = 0, vExpd = 0;
    (vacRes.data || []).forEach((v: any) => {
      const qty = v.quantity_balance || 0;
      if (qty <= 0) return;
      vUnits += qty;
      const d = daysTo(v.expiry_date);
      if (d !== null) {
        if (d < 0) vExpd++; else if (d <= 30) vExp++;
        if (d <= 30) expRows.push({ silo: "Vaccination", item_name: `Vaccine ${v.batch_number || ""}`.trim(), location: "Vaccination", batch: v.batch_number || "—", expiry: v.expiry_date, days: d, qty });
      }
    });
    const vaccineSilo: SiloSummary = { key: "vaccine", label: "Vaccination", icon: Syringe, color: "text-purple-600", skus: 0, units: vUnits, value: 0, expiring: vExp, expired: vExpd };

    setSilos([centralSilo, pharmSilo, subSilo, bloodSilo, vaccineSilo]);
    setExpiring(expRows.sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 20));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const totalValue = silos.reduce((s, x) => s + x.value, 0);
  const totalUnits = silos.reduce((s, x) => s + x.units, 0);
  const totalSkus = silos.reduce((s, x) => s + x.skus, 0);
  const totalExpiring = silos.reduce((s, x) => s + x.expiring, 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-2.5 flex items-center gap-3">
        <span className="text-sm font-bold text-foreground">Consolidated Stock — All Silos</span>
        <span className="text-[11px] text-muted-foreground">Read-only rollup across Central, Pharmacy, Ward, Blood Bank &amp; Vaccination</span>
        <button onClick={load} className="ml-auto text-muted-foreground hover:text-primary" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Stock Value", value: inr(totalValue), color: "text-primary" },
            { label: "On-hand Units", value: totalUnits.toLocaleString("en-IN"), color: "text-foreground" },
            { label: "Distinct SKUs", value: totalSkus.toLocaleString("en-IN"), color: "text-foreground" },
            { label: "Expiring ≤30d", value: totalExpiring.toLocaleString("en-IN"), color: totalExpiring > 0 ? "text-amber-600" : "text-emerald-600" },
          ].map((k) => (
            <div key={k.label} className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-[11px] text-muted-foreground">{k.label}</p>
              <p className={cn("text-xl font-bold", k.color)}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Per-silo breakdown */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Silo</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">SKUs</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">On-hand Units</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Stock Value</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Expiring ≤30d</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Expired</th>
              </tr>
            </thead>
            <tbody>
              {silos.map((s) => {
                const Icon = s.icon;
                return (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="px-4 py-2.5 font-medium text-foreground flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", s.color)} /> {s.label}
                    </td>
                    <td className="px-3 py-2.5 text-right">{s.skus}</td>
                    <td className="px-3 py-2.5 text-right">{s.units.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{inr(s.value)}</td>
                    <td className={cn("px-3 py-2.5 text-right", s.expiring > 0 ? "text-amber-600 font-medium" : "text-muted-foreground")}>{s.expiring}</td>
                    <td className={cn("px-3 py-2.5 text-right", s.expired > 0 ? "text-destructive font-medium" : "text-muted-foreground")}>{s.expired}</td>
                  </tr>
                );
              })}
              {silos.length > 0 && (
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-4 py-2.5 text-foreground">Total</td>
                  <td className="px-3 py-2.5 text-right">{totalSkus}</td>
                  <td className="px-3 py-2.5 text-right">{totalUnits.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-right">{inr(totalValue)}</td>
                  <td className="px-3 py-2.5 text-right">{totalExpiring}</td>
                  <td className="px-3 py-2.5 text-right">{silos.reduce((a, x) => a + x.expired, 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cross-silo expiring soon */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold text-foreground">Expiring Soon — All Silos (≤30 days)</span>
          </div>
          {expiring.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-6 text-center">Nothing expiring within 30 days across any store. ✓</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Silo</th>
                  <th className="text-left px-3 py-2 font-medium">Item</th>
                  <th className="text-left px-3 py-2 font-medium">Location</th>
                  <th className="text-left px-3 py-2 font-medium">Batch</th>
                  <th className="text-left px-3 py-2 font-medium">Expiry</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((e, i) => (
                  <tr key={i} className={cn("border-b border-border/50", e.days < 0 && "bg-destructive/5")}>
                    <td className="px-4 py-1.5 text-muted-foreground">{e.silo}</td>
                    <td className="px-3 py-1.5 font-medium text-foreground">{e.item_name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.location}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{e.batch}</td>
                    <td className={cn("px-3 py-1.5", e.days < 0 ? "text-destructive font-semibold" : "text-amber-600")}>
                      {e.expiry} {e.days < 0 ? "(expired)" : `(${e.days}d)`}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold">{e.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Procurement spend & top vendors */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Procurement Spend — Top Vendors</span>
            <span className="text-xs text-muted-foreground">Total received value: <strong className="text-foreground">{inr(totalSpend)}</strong></span>
          </div>
          {vendorSpend.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-6 text-center">No procurement receipts recorded yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Vendor / Supplier</th>
                  <th className="text-left px-3 py-2 font-medium">Silo</th>
                  <th className="text-right px-3 py-2 font-medium">Spend</th>
                  <th className="text-right px-4 py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {vendorSpend.map((v, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-1.5 font-medium text-foreground">{v.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{v.silo}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{inr(v.amount)}</td>
                    <td className="px-4 py-1.5 text-right text-muted-foreground">{totalSpend > 0 ? `${((v.amount / totalSpend) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground px-1">
          These three systems are maintained separately by design — this is a unified read-only view, not a merged ledger.
        </p>
      </div>
    </div>
  );
};

export default ConsolidatedStockPanel;
