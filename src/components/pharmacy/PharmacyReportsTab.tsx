import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { getGroup } from "@/lib/expiryGroups";

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ReportCardHeader: React.FC<{ title: string; onDownload?: () => void }> = ({ title, onDownload }) => (
  <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
    <CardTitle className="text-sm">{title}</CardTitle>
    {onDownload && (
      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={onDownload}>
        <Download className="h-3 w-3" /> CSV
      </Button>
    )}
  </CardHeader>
);

interface Props {
  hospitalId: string;
}

interface DailyRow {
  date: string;
  count: number;
  netAmount: number;
}

interface ConsumptionRow {
  drugName: string;
  quantity: number;
}

interface NdpsRow {
  drugName: string;
  issued: number;
  returned: number;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const PharmacyReportsTab: React.FC<Props> = ({ hospitalId }) => {
  const [loading, setLoading] = useState(true);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [stockCostValue, setStockCostValue] = useState(0);
  const [stockMrpValue, setStockMrpValue] = useState(0);
  const [skuCount, setSkuCount] = useState(0);
  const [expiryBuckets, setExpiryBuckets] = useState<Record<string, { count: number; value: number }>>({});
  const [ndpsRows, setNdpsRows] = useState<NdpsRow[]>([]);
  const [topConsumed, setTopConsumed] = useState<ConsumptionRow[]>([]);
  const [leastConsumed, setLeastConsumed] = useState<ConsumptionRow[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      setLoading(true);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const [dispensingRes, batchesRes, ndpsRes, consumptionRes] = await Promise.all([
        (supabase as any)
          .from("pharmacy_dispensing")
          .select("dispensed_at, net_amount")
          .eq("hospital_id", hospitalId)
          .gte("dispensed_at", sevenDaysAgo)
          .order("dispensed_at", { ascending: false }),
        (supabase as any)
          .from("drug_batches")
          .select("quantity_available, cost_price, mrp, expiry_date, status")
          .eq("hospital_id", hospitalId)
          .neq("status", "destroyed"),
        (supabase as any)
          .from("ndps_register")
          .select("drug_name, transaction_type, quantity")
          .eq("hospital_id", hospitalId)
          .gte("created_at", firstOfMonth),
        (supabase as any)
          .from("pharmacy_dispensing_items")
          .select("drug_name, quantity_dispensed, pharmacy_dispensing!inner(hospital_id, dispensed_at)")
          .eq("pharmacy_dispensing.hospital_id", hospitalId)
          .gte("pharmacy_dispensing.dispensed_at", thirtyDaysAgo),
      ]);

      // Daily Dispensing Report — last 7 days
      const byDate = new Map<string, { count: number; netAmount: number }>();
      for (const r of dispensingRes.data || []) {
        const d = (r.dispensed_at || "").split("T")[0];
        const cur = byDate.get(d) || { count: 0, netAmount: 0 };
        cur.count += 1;
        cur.netAmount += Number(r.net_amount || 0);
        byDate.set(d, cur);
      }
      setDailyRows(
        [...byDate.entries()]
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => b.date.localeCompare(a.date))
      );

      // Stock Valuation Report + Expiry Report (share the same drug_batches fetch)
      let costValue = 0;
      let mrpValue = 0;
      const buckets: Record<string, { count: number; value: number }> = {
        expired: { count: 0, value: 0 },
        critical: { count: 0, value: 0 },
        warning: { count: 0, value: 0 },
      };
      for (const b of batchesRes.data || []) {
        const qty = Number(b.quantity_available || 0);
        costValue += qty * Number(b.cost_price || 0);
        mrpValue += qty * Number(b.mrp || 0);
        if (qty > 0 && b.status !== "quarantined") {
          const group = getGroup(b.expiry_date);
          if (group !== "ok") {
            buckets[group].count += 1;
            buckets[group].value += qty * Number(b.cost_price || 0);
          }
        }
      }
      setStockCostValue(costValue);
      setStockMrpValue(mrpValue);
      setSkuCount((batchesRes.data || []).length);
      setExpiryBuckets(buckets);

      // NDPS Monthly Summary
      const ndpsMap = new Map<string, { issued: number; returned: number }>();
      for (const r of ndpsRes.data || []) {
        const cur = ndpsMap.get(r.drug_name) || { issued: 0, returned: 0 };
        if (r.transaction_type === "return") cur.returned += Number(r.quantity || 0);
        else cur.issued += Number(r.quantity || 0);
        ndpsMap.set(r.drug_name, cur);
      }
      setNdpsRows(
        [...ndpsMap.entries()]
          .map(([drugName, v]) => ({ drugName, ...v }))
          .sort((a, b) => b.issued - a.issued)
      );

      // Consumption Report — last 30 days
      const consumeMap = new Map<string, number>();
      for (const r of consumptionRes.data || []) {
        consumeMap.set(r.drug_name, (consumeMap.get(r.drug_name) || 0) + Number(r.quantity_dispensed || 0));
      }
      const consumeRows = [...consumeMap.entries()].map(([drugName, quantity]) => ({ drugName, quantity }));
      setTopConsumed([...consumeRows].sort((a, b) => b.quantity - a.quantity).slice(0, 10));
      setLeastConsumed([...consumeRows].sort((a, b) => a.quantity - b.quantity).slice(0, 10));

      setLoading(false);
    })();
  }, [hospitalId]);

  if (loading) {
    return <p className="text-center py-12 text-muted-foreground text-sm">Loading pharmacy reports…</p>;
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Daily Dispensing Report */}
      <Card>
        <ReportCardHeader
          title="Daily Dispensing Report (last 7 days)"
          onDownload={dailyRows.length > 0 ? () => downloadCSV(
            `pharmacy_daily_dispensing_${new Date().toISOString().split("T")[0]}.csv`,
            ["Date", "Dispensing Events", "Net Amount"],
            dailyRows.map(r => [r.date, r.count, r.netAmount])
          ) : undefined}
        />
        <CardContent>
          {dailyRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No dispensing activity in the last 7 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-center">Dispensing Events</TableHead>
                  <TableHead className="text-xs text-right">Net Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyRows.map(r => (
                  <TableRow key={r.date}>
                    <TableCell className="text-xs">{fmtDate(r.date)}</TableCell>
                    <TableCell className="text-xs text-center">{r.count}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatCurrency(r.netAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Stock Valuation Report */}
        <Card>
          <ReportCardHeader
            title="Stock Valuation"
            onDownload={() => downloadCSV(
              `pharmacy_stock_valuation_${new Date().toISOString().split("T")[0]}.csv`,
              ["Metric", "Value"],
              [
                ["Active Batches", skuCount],
                ["Stock Value (Cost)", stockCostValue],
                ["Stock Value (MRP)", stockMrpValue],
              ]
            )}
          />
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold">{formatCurrency(stockCostValue)}</p>
            <p className="text-xs text-muted-foreground">at cost · {skuCount} active batches</p>
            <p className="text-sm font-semibold text-muted-foreground pt-1">{formatCurrency(stockMrpValue)} at MRP</p>
          </CardContent>
        </Card>

        {/* Expiry Report */}
        <Card>
          <ReportCardHeader
            title="Expiry Report"
            onDownload={() => downloadCSV(
              `pharmacy_expiry_report_${new Date().toISOString().split("T")[0]}.csv`,
              ["Bucket", "Batches", "Value"],
              [
                ["Expired", expiryBuckets.expired?.count ?? 0, expiryBuckets.expired?.value ?? 0],
                ["< 30 days", expiryBuckets.critical?.count ?? 0, expiryBuckets.critical?.value ?? 0],
                ["30-90 days", expiryBuckets.warning?.count ?? 0, expiryBuckets.warning?.value ?? 0],
              ]
            )}
          />
          <CardContent className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <Badge className="bg-red-100 text-red-700 text-[10px]">Expired</Badge>
              <span>{expiryBuckets.expired?.count ?? 0} batches · {formatCurrency(expiryBuckets.expired?.value ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <Badge className="bg-orange-100 text-orange-700 text-[10px]">&lt; 30 days</Badge>
              <span>{expiryBuckets.critical?.count ?? 0} batches · {formatCurrency(expiryBuckets.critical?.value ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <Badge className="bg-amber-100 text-amber-700 text-[10px]">30–90 days</Badge>
              <span>{expiryBuckets.warning?.count ?? 0} batches · {formatCurrency(expiryBuckets.warning?.value ?? 0)}</span>
            </div>
          </CardContent>
        </Card>

        {/* NDPS Monthly Summary */}
        <Card>
          <ReportCardHeader
            title="NDPS Monthly Summary"
            onDownload={ndpsRows.length > 0 ? () => downloadCSV(
              `pharmacy_ndps_summary_${new Date().toISOString().split("T")[0]}.csv`,
              ["Drug", "Issued", "Returned"],
              ndpsRows.map(r => [r.drugName, r.issued, r.returned])
            ) : undefined}
          />
          <CardContent>
            {ndpsRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">No NDPS transactions this month.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {ndpsRows.map(r => (
                  <div key={r.drugName} className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate">{r.drugName}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{r.issued} issued · {r.returned} returned</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Consumption Report */}
      <Card>
        <ReportCardHeader
          title="Consumption Report (last 30 days)"
          onDownload={topConsumed.length > 0 ? () => downloadCSV(
            `pharmacy_consumption_${new Date().toISOString().split("T")[0]}.csv`,
            ["Rank Group", "Drug", "Quantity"],
            [
              ...topConsumed.map(r => ["Most Dispensed", r.drugName, r.quantity]),
              ...leastConsumed.map(r => ["Least Dispensed", r.drugName, r.quantity]),
            ]
          ) : undefined}
        />
        <CardContent>
          {topConsumed.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No dispensing activity in the last 30 days.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold mb-1.5">Most Dispensed</p>
                <Table>
                  <TableBody>
                    {topConsumed.map(r => (
                      <TableRow key={r.drugName}>
                        <TableCell className="text-xs">{r.drugName}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{r.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1.5">Least Dispensed</p>
                <Table>
                  <TableBody>
                    {leastConsumed.map(r => (
                      <TableRow key={r.drugName}>
                        <TableCell className="text-xs">{r.drugName}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{r.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PharmacyReportsTab;
