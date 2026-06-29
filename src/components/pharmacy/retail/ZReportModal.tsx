import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { printDocument, printHeader, printAmount } from "@/lib/printUtils";

interface Props {
  hospitalId: string;
  open: boolean;
  onClose: () => void;
}

interface ModeSummary {
  mode: string;
  count: number;
  gross: number;
  discount: number;
  gst: number;
  net: number;
}

interface DrugSummary {
  drug_name: string;
  qty: number;
  revenue: number;
}

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit" };

const ZReportModal: React.FC<Props> = ({ hospitalId, open, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [hospitalName, setHospitalName] = useState("Hospital");
  const [pharmacistName, setPharmacistName] = useState("Pharmacist");
  const [byMode, setByMode] = useState<ModeSummary[]>([]);
  const [topDrugs, setTopDrugs] = useState<DrugSummary[]>([]);
  const [totals, setTotals] = useState({ count: 0, gross: 0, discount: 0, gst: 0, net: 0 });
  const reportTime = new Date();
  const today = reportTime.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);

      const [hospRes, authRes] = await Promise.all([
        supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      if (hospRes.data?.name) setHospitalName(hospRes.data.name);
      if (authRes.data.user) {
        const { data: ud } = await (supabase as any).from("users")
          .select("full_name").eq("auth_user_id", authRes.data.user.id).maybeSingle();
        if (ud?.full_name) setPharmacistName(ud.full_name);
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: sales } = await (supabase as any).from("pharmacy_dispensing")
        .select("id, payment_mode, total_amount, discount_amount, gst_amount, net_amount")
        .eq("hospital_id", hospitalId)
        .eq("dispensing_type", "retail")
        .eq("status", "dispensed")
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", new Date().toISOString());

      const salesList: any[] = sales || [];
      const modeMap = new Map<string, ModeSummary>();
      let tCount = 0, tGross = 0, tDiscount = 0, tGst = 0, tNet = 0;

      for (const s of salesList) {
        const mode = s.payment_mode || "cash";
        if (!modeMap.has(mode)) modeMap.set(mode, { mode, count: 0, gross: 0, discount: 0, gst: 0, net: 0 });
        const m = modeMap.get(mode)!;
        m.count++;
        m.gross += s.total_amount || 0;
        m.discount += s.discount_amount || 0;
        m.gst += s.gst_amount || 0;
        m.net += s.net_amount || 0;
        tCount++;
        tGross += s.total_amount || 0;
        tDiscount += s.discount_amount || 0;
        tGst += s.gst_amount || 0;
        tNet += s.net_amount || 0;
      }

      setByMode(Array.from(modeMap.values()));
      setTotals({ count: tCount, gross: tGross, discount: tDiscount, gst: tGst, net: tNet });

      if (salesList.length > 0) {
        const saleIds = salesList.map((s) => s.id);
        const { data: items } = await (supabase as any).from("pharmacy_dispensing_items")
          .select("drug_name, quantity_dispensed, total_price")
          .in("dispensing_id", saleIds);

        const drugMap = new Map<string, DrugSummary>();
        for (const item of (items || [])) {
          if (!drugMap.has(item.drug_name)) drugMap.set(item.drug_name, { drug_name: item.drug_name, qty: 0, revenue: 0 });
          const d = drugMap.get(item.drug_name)!;
          d.qty += item.quantity_dispensed || 0;
          d.revenue += item.total_price || 0;
        }
        setTopDrugs(Array.from(drugMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10));
      }

      setLoading(false);
    };
    load();
  }, [open, hospitalId]);

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handlePrint = () => {
    const modeRows = byMode.map((m) => `
      <tr>
        <td>${MODE_LABEL[m.mode] || m.mode}</td>
        <td align="center">${m.count}</td>
        <td align="right">${printAmount(m.gross)}</td>
        <td align="right">${m.discount > 0 ? `-${printAmount(m.discount)}` : "—"}</td>
        <td align="right">${printAmount(m.gst)}</td>
        <td align="right"><strong>${printAmount(m.net)}</strong></td>
      </tr>`).join("");

    const drugRows = topDrugs.map((d, i) => `
      <tr>
        <td>${i + 1}. ${d.drug_name}</td>
        <td align="center">${d.qty}</td>
        <td align="right">${printAmount(d.revenue)}</td>
      </tr>`).join("");

    const body = `
      ${printHeader(hospitalName, "Pharmacy Z-Report — Daily Sales Summary")}
      <p class="label">Date: ${today} &nbsp;|&nbsp; Report Time: ${reportTime.toLocaleTimeString("en-IN")} &nbsp;|&nbsp; Period: 00:00 – ${reportTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} &nbsp;|&nbsp; Generated by: ${pharmacistName}</p>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0">
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center">
          <div class="label">Transactions</div>
          <div style="font-size:22px;font-weight:700;color:#1A2F5A">${totals.count}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center">
          <div class="label">Gross Revenue</div>
          <div style="font-size:16px;font-weight:700;color:#1A2F5A">${fmt(totals.gross)}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center">
          <div class="label">Total Discounts</div>
          <div style="font-size:16px;font-weight:700;color:#dc2626">${fmt(totals.discount)}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center">
          <div class="label">Net Revenue</div>
          <div style="font-size:16px;font-weight:700;color:#16a34a">${fmt(totals.net)}</div>
        </div>
      </div>

      <div class="section-title">Collections by Payment Mode</div>
      <table>
        <thead>
          <tr>
            <th>Payment Mode</th><th style="text-align:center">Txns</th>
            <th style="text-align:right">Gross</th><th style="text-align:right">Discount</th>
            <th style="text-align:right">GST Collected</th><th style="text-align:right">Net</th>
          </tr>
        </thead>
        <tbody>${modeRows}</tbody>
        <tfoot>
          <tr style="font-weight:bold;background:#f8fafc;border-top:2px solid #1A2F5A">
            <td>TOTAL</td><td align="center">${totals.count}</td>
            <td align="right">${printAmount(totals.gross)}</td>
            <td align="right">${totals.discount > 0 ? `-${printAmount(totals.discount)}` : "—"}</td>
            <td align="right">${printAmount(totals.gst)}</td>
            <td align="right">${printAmount(totals.net)}</td>
          </tr>
        </tfoot>
      </table>

      ${topDrugs.length > 0 ? `
      <div class="section-title">Top Drugs Sold Today</div>
      <table>
        <thead>
          <tr><th>#</th><th>Drug Name</th><th style="text-align:center">Qty Sold</th><th style="text-align:right">Revenue</th></tr>
        </thead>
        <tbody>${drugRows}</tbody>
      </table>` : ""}
    `;

    printDocument(`Z-Report — ${today}`, body, { width: 920, height: 720 });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pharmacy Z-Report — {today}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Loading today's sales...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Transactions" value={String(totals.count)} color="text-[#1A2F5A]" />
              <KpiCard label="Gross Revenue" value={fmt(totals.gross)} color="text-[#1A2F5A]" />
              <KpiCard label="Discounts" value={fmt(totals.discount)} color="text-red-600" />
              <KpiCard label="Net Revenue" value={fmt(totals.net)} color="text-emerald-600" />
            </div>

            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Collections by Payment Mode</p>
              {totals.count === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No retail sales recorded today</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-1.5 font-medium">Mode</th>
                      <th className="text-center py-1.5 font-medium">Txns</th>
                      <th className="text-right py-1.5 font-medium">Gross</th>
                      <th className="text-right py-1.5 font-medium">Discount</th>
                      <th className="text-right py-1.5 font-medium">GST</th>
                      <th className="text-right py-1.5 font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMode.map((m) => (
                      <tr key={m.mode} className="border-b border-border/50">
                        <td className="py-1.5 font-medium">{MODE_LABEL[m.mode] || m.mode}</td>
                        <td className="py-1.5 text-center text-muted-foreground">{m.count}</td>
                        <td className="py-1.5 text-right">{fmt(m.gross)}</td>
                        <td className="py-1.5 text-right text-red-600">{m.discount > 0 ? `-${fmt(m.discount)}` : "—"}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{fmt(m.gst)}</td>
                        <td className="py-1.5 text-right font-bold">{fmt(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/40 font-bold border-t-2 border-border">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-center">{totals.count}</td>
                      <td className="py-2 text-right">{fmt(totals.gross)}</td>
                      <td className="py-2 text-right text-red-600">{totals.discount > 0 ? `-${fmt(totals.discount)}` : "—"}</td>
                      <td className="py-2 text-right text-muted-foreground">{fmt(totals.gst)}</td>
                      <td className="py-2 text-right text-emerald-600">{fmt(totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {topDrugs.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Top Drugs Sold Today</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-1 font-medium w-8">#</th>
                      <th className="text-left py-1 font-medium">Drug</th>
                      <th className="text-center py-1 font-medium">Qty</th>
                      <th className="text-right py-1 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDrugs.map((d, i) => (
                      <tr key={d.drug_name} className="border-b border-border/30">
                        <td className="py-1 text-muted-foreground">{i + 1}</td>
                        <td className="py-1 font-medium">{d.drug_name}</td>
                        <td className="py-1 text-center">{d.qty}</td>
                        <td className="py-1 text-right">{fmt(d.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground border-t pt-2">
              Generated by {pharmacistName} · {reportTime.toLocaleTimeString("en-IN")} · Period: 00:00 – {reportTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} className="flex-1">Close</Button>
          <Button onClick={handlePrint} disabled={loading} className="flex-1">
            <Printer className="h-4 w-4 mr-2" /> Print Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const KpiCard = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="border border-border rounded-lg p-3 text-center">
    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">{label}</p>
    <p className={`text-sm font-bold ${color} leading-tight`}>{value}</p>
  </div>
);

export default ZReportModal;
