import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { differenceInDays, format } from "date-fns";

interface InsuranceAsset {
  id: string;
  asset_code: string;
  asset_name: string;
  category: string;
  purchase_cost: number;
  insurance_policy_no: string | null;
  insurance_provider: string | null;
  insurance_expiry: string | null;
  insurance_premium: number | null;
}

interface Props {
  hospitalId: string;
  refreshKey: number;
}

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const InsuranceTab: React.FC<Props> = ({ hospitalId, refreshKey }) => {
  const [assets, setAssets] = useState<InsuranceAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("fixed_assets")
      .select("id, asset_code, asset_name, category, purchase_cost, insurance_policy_no, insurance_provider, insurance_expiry, insurance_premium")
      .eq("hospital_id", hospitalId)
      .neq("status", "disposed")
      .not("insurance_policy_no", "is", null)
      .order("insurance_expiry", { ascending: true });
    setAssets(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const today = new Date();

  const expiryBadge = (expiry: string | null) => {
    if (!expiry) return <span className="text-[10px] text-muted-foreground">—</span>;
    const days = differenceInDays(new Date(expiry), today);
    if (days < 0) return <Badge variant="destructive" className="text-[9px] gap-1"><AlertTriangle size={9} /> Expired {Math.abs(days)}d ago</Badge>;
    if (days <= 30) return <Badge variant="outline" className="text-[9px] gap-1 border-amber-300 bg-amber-50 text-amber-700"><AlertTriangle size={9} /> Expires in {days}d</Badge>;
    return <Badge variant="outline" className="text-[9px] gap-1 border-green-300 bg-green-50 text-green-700"><CheckCircle2 size={9} /> {format(new Date(expiry), "dd/MM/yyyy")}</Badge>;
  };

  if (assets.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No assets with insurance records. Add insurance details when registering assets.</div>;
  }

  const expiringSoon = assets.filter((a) => a.insurance_expiry && differenceInDays(new Date(a.insurance_expiry), today) <= 30);

  return (
    <div className="flex flex-col gap-4">
      {expiringSoon.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} />
          <span className="font-semibold">{expiringSoon.length} insurance polic{expiringSoon.length > 1 ? "ies" : "y"} expiring within 30 days</span>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-[10px] font-bold uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-left">Policy No.</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-right">Premium / yr</th>
              <th className="px-3 py-2 text-right">Asset Value</th>
              <th className="px-3 py-2 text-center">Expiry Status</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="text-xs font-medium">{a.asset_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{a.asset_code}</div>
                </td>
                <td className="px-3 py-2 text-xs font-mono">{a.insurance_policy_no || "—"}</td>
                <td className="px-3 py-2 text-xs">{a.insurance_provider || "—"}</td>
                <td className="px-3 py-2 text-xs text-right font-mono">{a.insurance_premium ? fmt(a.insurance_premium) : "—"}</td>
                <td className="px-3 py-2 text-xs text-right font-mono">{fmt(a.purchase_cost)}</td>
                <td className="px-3 py-2 text-center">{expiryBadge(a.insurance_expiry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InsuranceTab;
