import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoPostJournalEntry } from "@/lib/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

interface DisposedAsset {
  id: string;
  asset_code: string;
  asset_name: string;
  purchase_cost: number;
  accumulated_dep: number;
  disposed_at: string;
  disposal_value: number | null;
  disposal_reason: string | null;
}

interface Props {
  hospitalId: string;
  refreshKey: number;
  userId: string | null;
  onRefresh: () => void;
}

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const DisposalTab: React.FC<Props> = ({ hospitalId, refreshKey, userId, onRefresh }) => {
  const { toast } = useToast();
  const [disposed, setDisposed] = useState<DisposedAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const [retireModal, setRetireModal] = useState<{ id: string; name: string; nbv: number } | null>(null);
  const [disposalAmount, setDisposalAmount] = useState("");
  const [disposalReason, setDisposalReason] = useState("");
  const [retireSaving, setRetireSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("fixed_assets")
      .select("id, asset_code, asset_name, purchase_cost, accumulated_dep, disposed_at, disposal_value, disposal_reason")
      .eq("hospital_id", hospitalId)
      .eq("status", "disposed")
      .not("disposed_at", "is", null)
      .order("disposed_at", { ascending: false });
    setDisposed(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const confirmDisposal = async () => {
    if (!retireModal) return;
    setRetireSaving(true);

    const saleProceeds = parseFloat(disposalAmount) || 0;
    const gainLoss = saleProceeds - retireModal.nbv;

    await (supabase as any).from("fixed_assets").update({
      status: "disposed",
      disposed_at: new Date().toISOString().split("T")[0],
      disposal_value: saleProceeds,
      disposal_reason: disposalReason,
    }).eq("id", retireModal.id);

    if (gainLoss !== 0) {
      await autoPostJournalEntry({
        triggerEvent: "asset_disposal",
        sourceModule: "assets",
        sourceId: retireModal.id,
        amount: Math.abs(gainLoss),
        description: `Asset disposal — ${retireModal.name}: ${gainLoss >= 0 ? "Gain" : "Loss"} of ${fmt(Math.abs(gainLoss))}`,
        hospitalId,
        postedBy: userId || "",
      });
    }

    toast({ title: "Asset disposed", description: gainLoss >= 0 ? `Gain on disposal: ${fmt(gainLoss)}` : `Loss on disposal: ${fmt(Math.abs(gainLoss))}` });
    setRetireModal(null);
    setDisposalAmount("");
    setDisposalReason("");
    setRetireSaving(false);
    onRefresh();
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col gap-4">
      {disposed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No disposed assets. Assets retired from the register will appear here.</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Accum. Dep.</th>
                <th className="px-3 py-2 text-right">NBV at Disposal</th>
                <th className="px-3 py-2 text-right">Proceeds</th>
                <th className="px-3 py-2 text-right">Gain / Loss</th>
                <th className="px-3 py-2 text-center">Disposed On</th>
                <th className="px-3 py-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {disposed.map((a) => {
                const nbv = a.purchase_cost - a.accumulated_dep;
                const gainLoss = (a.disposal_value || 0) - nbv;
                return (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium">{a.asset_name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{a.asset_code}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-mono">{fmt(a.purchase_cost)}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono text-destructive">{fmt(a.accumulated_dep)}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono font-bold">{fmt(Math.max(0, nbv))}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono">{a.disposal_value != null ? fmt(a.disposal_value) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono font-bold">
                      {a.disposal_value != null ? (
                        <span className={gainLoss >= 0 ? "text-green-600" : "text-destructive"}>
                          {gainLoss >= 0 ? "+" : ""}{fmt(gainLoss)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">{format(new Date(a.disposed_at), "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{a.disposal_reason || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {retireModal && (
        <Dialog open onOpenChange={() => setRetireModal(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Dispose Asset: {retireModal.name}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">Net book value at disposal: <strong>{fmt(retireModal.nbv)}</strong></p>
              <div><Label>Sale / Scrap Proceeds (₹)</Label><Input type="number" value={disposalAmount} onChange={(e) => setDisposalAmount(e.target.value)} placeholder="0" className="mt-1" /></div>
              <div><Label>Reason for Disposal</Label><Input value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} placeholder="Written off / Sold / Scrapped" className="mt-1" /></div>
              {disposalAmount && (
                <p className={`text-sm font-medium ${parseFloat(disposalAmount) >= retireModal.nbv ? "text-green-600" : "text-destructive"}`}>
                  {parseFloat(disposalAmount) >= retireModal.nbv ? "Gain" : "Loss"} on disposal: {fmt(Math.abs(parseFloat(disposalAmount) - retireModal.nbv))}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRetireModal(null)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmDisposal} disabled={retireSaving}>{retireSaving ? "Posting..." : "Confirm Disposal"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DisposalTab;
