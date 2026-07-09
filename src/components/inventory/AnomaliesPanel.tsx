import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { ScanSearch, Sparkles, Loader2, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Props { hospitalId: string; }

interface Anomaly {
  id: string; item_id: string | null; anomaly_type: string; severity: string;
  detail: string | null; detected_at: string; status: string;
  inventory_items?: { item_name: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  unbilled_consumption: "Un-billed consumption",
  off_contract_price: "Off-contract price",
  consumption_spike: "Consumption spike",
  abnormal_adjustment: "Abnormal adjustment",
  dead_stock: "Dead stock",
};
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEV_CLS: Record<string, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-muted text-muted-foreground",
};

const AnomaliesPanel: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [digesting, setDigesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("inventory_anomalies")
      .select("id, item_id, anomaly_type, severity, detail, detected_at, status, inventory_items(item_name)")
      .eq("hospital_id", hospitalId).eq("status", "open")
      .order("detected_at", { ascending: false });
    const rows: Anomaly[] = data || [];
    rows.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
    setAnomalies(rows);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await (supabase as any).rpc("run_inventory_anomaly_scan", { p_hospital_id: hospitalId });
      if (error) throw error;
      toast({ title: `Scan complete — ${data ?? 0} open anomal${data === 1 ? "y" : "ies"}` });
      setDigest(null);
      load();
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user?.id || "").maybeSingle();
    await (supabase as any).from("inventory_anomalies").update({ status, reviewed_by: me?.id ?? null }).eq("id", id);
    setAnomalies((a) => a.filter((x) => x.id !== id));
  };

  const generateDigest = async () => {
    if (anomalies.length === 0) return;
    setDigesting(true);
    try {
      const lines = anomalies.map((a) => `- ${TYPE_LABEL[a.anomaly_type] || a.anomaly_type} (${a.severity}) — ${a.inventory_items?.item_name || "item"}: ${a.detail || ""}`).join("\n");
      const prompt = `You are a hospital procurement analyst. Summarise these inventory anomalies for the purchase manager in 4-6 short bullets. Prioritise revenue leakage (un-billed consumption) and cost issues (off-contract pricing), and suggest one concrete action per bullet. Be concise.\n\nAnomalies:\n${lines}`;
      const res = await callAI({ featureKey: "inventory_anomaly_digest", hospitalId, prompt, maxTokens: 600 });
      if (res.error || !res.text) throw new Error(res.error || "No response");
      setDigest(res.text);
    } catch (err: any) {
      toast({ title: "Digest unavailable", description: err.message, variant: "destructive" });
    } finally {
      setDigesting(false);
    }
  };

  const counts = anomalies.reduce((m, a) => { m[a.anomaly_type] = (m[a.anomaly_type] || 0) + 1; return m; }, {} as Record<string, number>);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-foreground">Inventory Anomalies &amp; Leakage</span>
        <span className="text-[11px] text-muted-foreground">Rules-based detection over consumption, pricing &amp; adjustments</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={generateDigest} disabled={digesting || anomalies.length === 0} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">
            {digesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI Digest
          </button>
          <button onClick={runScan} disabled={scanning} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} Run Scan
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Type counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Object.keys(TYPE_LABEL).map((t) => (
            <div key={t} className="bg-card border border-border rounded-lg px-3 py-2">
              <p className="text-lg font-bold text-foreground">{counts[t] || 0}</p>
              <p className="text-[10px] text-muted-foreground">{TYPE_LABEL[t]}</p>
            </div>
          ))}
        </div>

        {digest && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <p className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> AI Digest</p>
            <p className="text-xs text-foreground whitespace-pre-wrap">{digest}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-24"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : anomalies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Check className="h-7 w-7 text-emerald-500" />
            <p className="text-sm">No open anomalies. Run a scan to check.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a) => (
              <div key={a.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", a.severity === "high" ? "text-destructive" : a.severity === "medium" ? "text-amber-500" : "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">{a.inventory_items?.item_name || "—"}</span>
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", SEV_CLS[a.severity] || SEV_CLS.low)}>{TYPE_LABEL[a.anomaly_type] || a.anomaly_type}</span>
                    <span className="text-[9px] text-muted-foreground">{formatDistanceToNow(new Date(a.detected_at), { addSuffix: true })}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{a.detail}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => updateStatus(a.id, "reviewed")} className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted flex items-center gap-1"><Check className="h-3 w-3" /> Review</button>
                  <button onClick={() => updateStatus(a.id, "dismissed")} className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground flex items-center gap-1"><X className="h-3 w-3" /> Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnomaliesPanel;
