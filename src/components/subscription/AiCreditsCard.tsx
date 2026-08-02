import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatINRExact } from "@/lib/currency";
import { getErrorMessage } from "@/lib/errorMessage";

declare global {
  interface Window { Razorpay: any }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

interface WalletRow {
  balance_inr: number;
  low_balance_threshold_inr: number;
}
interface LedgerRow {
  id: string;
  type: string;
  amount_inr: number;
  balance_after_inr: number;
  feature_key: string | null;
  created_at: string;
}

const TOPUP_PRESETS = [500, 1000, 2500, 5000];

const TYPE_LABEL: Record<string, string> = {
  topup: "Top-up", debit: "Usage", grant: "Granted", adjustment: "Adjustment", refund: "Refund",
};

export default function AiCreditsCard({ hospitalId }: { hospitalId: string }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(1000);
  const [loading, setLoading] = useState(false);

  const { data: wallet, refetch: refetchWallet } = useQuery({
    queryKey: ["ai-wallet", hospitalId],
    queryFn: async (): Promise<WalletRow | null> => {
      const { data } = await (supabase as any)
        .from("hospital_ai_wallet")
        .select("balance_inr, low_balance_threshold_inr")
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!hospitalId,
    staleTime: 30_000,
  });

  const { data: ledger, refetch: refetchLedger } = useQuery({
    queryKey: ["ai-wallet-ledger", hospitalId],
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data } = await (supabase as any)
        .from("ai_wallet_transactions")
        .select("id, type, amount_inr, balance_after_inr, feature_key, created_at")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
    enabled: !!hospitalId,
    staleTime: 30_000,
  });

  const balance = Number(wallet?.balance_inr ?? 0);
  const threshold = Number(wallet?.low_balance_threshold_inr ?? 500);
  const lowBalance = balance < threshold;

  const refresh = () => { refetchWallet(); refetchLedger(); qc.invalidateQueries({ queryKey: ["ai-budget-status", hospitalId] }); };

  const startTopup = async () => {
    if (!amount || amount < 100) { toast.error("Minimum top-up is ₹100"); return; }
    setLoading(true);
    try {
      // Top-up is served by create-razorpay-subscription with a purpose flag
      // (folded in to stay within the project's edge-function quota).
      const { data, error } = await (supabase as any).functions.invoke("create-razorpay-subscription", {
        body: { hospital_id: hospitalId, amount_inr: amount, purpose: "ai_wallet_topup" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const ok = await loadRazorpayScript();
      if (!ok) throw new Error("Could not load the payment gateway. Check your connection.");

      const rzp = new window.Razorpay({
        key: data.razorpay_key_id,
        order_id: data.order_id,
        amount: data.amount_paise,
        currency: data.currency ?? "INR",
        name: "Aumrti HMS",
        description: `AI Credits — ${formatINRExact(amount)}`,
        handler: () => {
          toast.success("Payment received. Credits will appear here in a few seconds.");
          // Balance is credited by the webhook; poll a couple of times.
          setTimeout(refresh, 3000);
          setTimeout(refresh, 8000);
        },
        modal: { ondismiss: () => setLoading(false) },
        theme: { color: "#4f46e5" },
      });
      rzp.on("payment.failed", (resp: any) => {
        toast.error(resp?.error?.description ?? "Payment failed");
      });
      rzp.open();
    } catch (e: any) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <p className="text-sm font-semibold text-foreground">AI Credits</p>
        </div>
        <button onClick={refresh} className="text-foreground/50 hover:text-foreground" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-foreground/60">Prepaid balance</p>
            <p className={`text-2xl font-semibold ${balance < 0 ? "text-red-600" : "text-foreground"}`}>
              {formatINRExact(balance)}
            </p>
          </div>
          <p className="text-[11px] text-foreground/50">
            Usage above your plan's included AI allowance draws from this balance.
            Clinical safety AI is always free.
          </p>
        </div>

        {lowBalance && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-amber-500/10 text-amber-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {balance < 0
                ? "Your AI balance is negative. Top up to clear the outstanding usage."
                : "Low AI balance. Top up to avoid interruptions to non-clinical AI features."}
            </span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {TOPUP_PRESETS.map((v) => (
              <button key={v} type="button" onClick={() => setAmount(v)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  amount === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                {formatINRExact(v)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 flex-1">
              <span className="text-sm text-foreground/60">₹</span>
              <input type="number" min={100} value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <button onClick={startTopup} disabled={loading}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Credits
            </button>
          </div>
        </div>

        {(ledger?.length ?? 0) > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] font-medium text-foreground/50 mb-1">Recent activity</p>
            <div className="space-y-1">
              {ledger!.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground/70">
                    {TYPE_LABEL[t.type] ?? t.type}
                    {t.feature_key ? ` · ${t.feature_key}` : ""}
                  </span>
                  <span className={t.amount_inr < 0 ? "text-red-600" : "text-emerald-600"}>
                    {t.amount_inr < 0 ? "−" : "+"}{formatINRExact(Math.abs(Number(t.amount_inr)))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
