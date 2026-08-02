import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Wallet, Loader2, Gift, X } from "lucide-react";
import { toast } from "sonner";
import { formatINRExact } from "@/lib/currency";
import { getErrorMessage } from "@/lib/errorMessage";

interface WalletRow {
  hospital_id: string;
  balance_inr: number;
  updated_at: string;
  hospitals: { name: string } | null;
}

/** Platform-admin view of every hospital's prepaid AI balance + a manual grant. */
export default function AiWalletsPanel() {
  const qc = useQueryClient();
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState<number>(500);

  const { data: wallets, isLoading } = useQuery({
    queryKey: ["platform-ai-wallets"],
    queryFn: async (): Promise<WalletRow[]> => {
      const { data } = await (supabase as any)
        .from("hospital_ai_wallet")
        .select("hospital_id, balance_inr, updated_at, hospitals:hospital_id(name)")
        .order("balance_inr", { ascending: true });
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const grant = useMutation({
    mutationFn: async ({ hospitalId, amount }: { hospitalId: string; amount: number }) => {
      const { error } = await (supabase as any).rpc("apply_ai_wallet_delta", {
        p_hospital_id: hospitalId,
        p_amount_inr:  amount,
        p_type:        "grant",
        p_feature_key: null,
        p_source:      "platform_admin_grant",
        p_metadata:    { note: "manual platform grant" },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Credits granted");
      setGrantingId(null);
      qc.invalidateQueries({ queryKey: ["platform-ai-wallets"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Wallet className="w-4 h-4 text-indigo-500" />
        <p className="text-sm font-semibold text-foreground">AI Wallet Balances</p>
      </div>
      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-foreground/60"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (wallets?.length ?? 0) === 0 ? (
          <p className="text-sm text-foreground/50">No hospital has an AI wallet yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/50 border-b border-border">
                <th className="py-2">Hospital</th>
                <th className="py-2 text-right">Balance</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {wallets!.map((w) => (
                <tr key={w.hospital_id} className="border-b border-border/50">
                  <td className="py-2 text-foreground/80">{w.hospitals?.name ?? w.hospital_id}</td>
                  <td className={`py-2 text-right font-medium ${Number(w.balance_inr) < 0 ? "text-red-600" : "text-foreground"}`}>
                    {formatINRExact(Number(w.balance_inr))}
                  </td>
                  <td className="py-2 text-right">
                    {grantingId === w.hospital_id ? (
                      <div className="inline-flex items-center gap-1 justify-end">
                        <span className="text-xs text-foreground/50">₹</span>
                        <input type="number" min={1} value={grantAmount}
                          onChange={(e) => setGrantAmount(Math.max(0, Number(e.target.value) || 0))}
                          className="w-20 h-7 px-2 rounded border border-border bg-background text-xs" />
                        <button onClick={() => grant.mutate({ hospitalId: w.hospital_id, amount: grantAmount })}
                          disabled={grant.isPending}
                          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-60">
                          {grant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Grant"}
                        </button>
                        <button onClick={() => setGrantingId(null)} className="text-foreground/40 hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setGrantingId(w.hospital_id); setGrantAmount(500); }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border hover:bg-muted">
                        <Gift className="w-3.5 h-3.5" /> Grant
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
