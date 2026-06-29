import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface ChemoOrdersTabProps {
  onRefresh: () => void;
}

const ChemoOrdersTab: React.FC<ChemoOrdersTabProps> = ({ onRefresh }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    const { data } = await (supabase as any).from("chemo_orders")
      .select("*, oncology_patients(*, patients(*)), chemo_protocols(*), chemo_order_drugs(*)")
      .order("scheduled_date", { ascending: false })
      .limit(100);
    setOrders(data || []);
  };

  const filtered = orders.filter((o: any) => {
    const name = o.oncology_patients?.patients?.full_name || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const statusColor: Record<string, string> = {
    pending_verification: "bg-amber-100 text-amber-800",
    verified: "bg-blue-100 text-blue-800",
    dispensing: "bg-indigo-100 text-indigo-800",
    administered: "bg-cyan-100 text-cyan-800",
    completed: "bg-green-100 text-green-800",
    held: "bg-red-100 text-red-800",
    cancelled: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-3 mt-3">
      <Input placeholder="Search by patient name..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <div className="space-y-2">
        {filtered.map((order: any) => (
          <Card key={order.id}>
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">{order.oncology_patients?.patients?.full_name || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {order.chemo_protocols?.protocol_name} · Cycle {order.cycle_number} Day {order.day_of_cycle} · {format(new Date(order.scheduled_date), "dd/MM/yyyy")}
                </p>
                <div className="flex gap-2 mt-1">
                  {(order.chemo_order_drugs || []).map((d: any) => (
                    <Badge key={d.id} variant="outline" className="text-[10px]">{d.drug_name} {d.planned_dose_mg}mg</Badge>
                  ))}
                </div>
              </div>
              <div className="text-right space-y-1">
                <Badge className={statusColor[order.status] || ""}>{order.status.replace(/_/g, " ")}</Badge>
                <p className="text-[10px] text-muted-foreground">BSA: {order.bsa_used} m²</p>
                <p className="text-[10px] text-muted-foreground">{[order.v1_protocol_confirmed, order.v2_dose_correct, order.v3_allergies_checked, order.v4_labs_reviewed, order.v5_pharmacist_signoff].filter(Boolean).length}/5 verified</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No chemo orders found</p>}
      </div>
    </div>
  );
};

export default ChemoOrdersTab;
