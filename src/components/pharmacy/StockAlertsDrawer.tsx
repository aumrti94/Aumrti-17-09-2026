import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Props {
  hospitalId: string;
  onClose: () => void;
}

interface StockAlert {
  id: string;
  alert_type: string;
  quantity: number | null;
  expiry_date: string | null;
  is_acknowledged: boolean;
  drug: { drug_name: string } | null;
  batch: { batch_number: string } | null;
}

const StockAlertsDrawer: React.FC<Props> = ({ hospitalId, onClose }) => {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<StockAlert[]>([]);

  const fetchAlerts = useCallback(async () => {
    const { data } = await supabase
      .from("pharmacy_stock_alerts")
      .select("id, alert_type, quantity, expiry_date, is_acknowledged, drug:drug_master(drug_name), batch:drug_batches(batch_number)")
      .eq("hospital_id", hospitalId)
      .eq("is_acknowledged", false)
      .order("created_at", { ascending: false });
    setAlerts((data as any) || []);
  }, [hospitalId]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const acknowledge = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    await supabase.from("pharmacy_stock_alerts").update({
      is_acknowledged: true,
      acknowledged_by: userData?.id,
    }).eq("id", id);
    fetchAlerts();
    toast({ title: "Alert acknowledged" });
  };

  const markAllSeen = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    for (const a of alerts) {
      await supabase.from("pharmacy_stock_alerts").update({
        is_acknowledged: true,
        acknowledged_by: userData?.id,
      }).eq("id", a.id);
    }
    fetchAlerts();
    toast({ title: "All alerts acknowledged" });
  };

  const grouped = {
    out_of_stock: alerts.filter((a) => a.alert_type === "out_of_stock"),
    expiry_7: alerts.filter((a) => a.alert_type === "expiry_7"),
    expiry_30: alerts.filter((a) => a.alert_type === "expiry_30"),
    low_stock: alerts.filter((a) => a.alert_type === "low_stock"),
  };

  const groupConfig = [
    { key: "out_of_stock" as const, label: "🔴 OUT OF STOCK", bg: "bg-red-50", border: "border-red-200" },
    { key: "expiry_7" as const, label: "🟠 EXPIRING IN 7 DAYS", bg: "bg-orange-50", border: "border-orange-200" },
    { key: "expiry_30" as const, label: "🟡 EXPIRING IN 30 DAYS", bg: "bg-amber-50", border: "border-amber-200" },
    { key: "low_stock" as const, label: "🟡 LOW STOCK", bg: "bg-yellow-50", border: "border-yellow-200" },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-[56px] bottom-0 w-[360px] bg-background border-l border-border z-50 flex flex-col shadow-xl">
        <div className="flex-shrink-0 px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            <span className="text-base font-bold">Stock Alerts</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">{alerts.length}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded transition-colors active:scale-95">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groupConfig.map((g) => {
            const items = grouped[g.key];
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">{g.label}</p>
                <div className="space-y-2">
                  {items.map((a) => (
                    <div
                      key={a.id}
                      className={cn("p-3 rounded-lg border", g.bg, g.border)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{a.drug?.drug_name || "Unknown Drug"}</p>
                          {a.batch?.batch_number && (
                            <p className="text-[11px] text-muted-foreground font-mono">Batch: {a.batch.batch_number}</p>
                          )}
                          {a.expiry_date && (
                            <p className="text-[11px] text-muted-foreground">
                              Expires: {new Date(a.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          )}
                          {a.quantity !== null && (
                            <p className="text-[11px] text-muted-foreground">Qty: {a.quantity} units</p>
                          )}
                        </div>
                        <button
                          onClick={() => acknowledge(a.id)}
                          className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted transition-colors active:scale-95"
                        >
                          <CheckCircle size={12} className="inline mr-0.5" /> Ack
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {alerts.length === 0 && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No active stock alerts ✓
            </div>
          )}
        </div>

        {alerts.length > 0 && (
          <div className="flex-shrink-0 p-4 border-t border-border">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={markAllSeen}>
              Mark All as Seen
            </Button>
          </div>
        )}
      </div>
    </>
  );
};

export default StockAlertsDrawer;
