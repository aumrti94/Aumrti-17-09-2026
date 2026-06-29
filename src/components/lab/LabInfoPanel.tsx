import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User, Plus, RotateCcw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface LabOrder {
  id: string;
  priority: string;
  status: string;
  order_date: string;
  order_time: string;
  clinical_notes: string | null;
  patient_id: string;
  ordered_by: string;
  patients: { full_name: string; uhid: string; gender: string | null; dob: string | null; phone?: string | null; blood_group?: string | null } | null;
  ordered_by_user: { full_name: string } | null;
  lab_order_items: any[];
}

interface Props {
  selectedOrder: LabOrder | null;
  onSelectOrder?: (id: string) => void;
  onAddTestToOrder?: (patient: LabOrder["patients"]) => void;
  onRepeatOrder?: (patient: LabOrder["patients"], testNames: string[]) => void;
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function getAge(dob: string | null): string {
  if (!dob) return "";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}y`;
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  ordered: "bg-muted text-muted-foreground",
  sample_collected: "bg-amber-100 text-amber-700",
  in_process: "bg-blue-100 text-blue-700",
  partial_results: "bg-violet-100 text-violet-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  stat: "bg-destructive/10 text-destructive",
  urgent: "bg-amber-100 text-amber-700",
  routine: "bg-muted text-muted-foreground",
};

const LabInfoPanel: React.FC<Props> = ({ selectedOrder, onSelectOrder, onAddTestToOrder, onRepeatOrder }) => {
  const { toast } = useToast();
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  const fetchRecent = useCallback(async () => {
    if (!selectedOrder?.patient_id) return;
    const { data } = await supabase
      .from("lab_orders")
      .select(`
        id, order_date, status, priority,
        lab_order_items (id)
      `)
      .eq("patient_id", selectedOrder.patient_id)
      .neq("id", selectedOrder.id)
      .order("order_date", { ascending: false })
      .limit(5);
    setRecentOrders(data || []);
  }, [selectedOrder?.patient_id, selectedOrder?.id]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  if (!selectedOrder) {
    return (
      <div className="w-full bg-card border-l border-border flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Patient details appear here</p>
      </div>
    );
  }

  const patient = selectedOrder.patients;
  const items = selectedOrder.lab_order_items || [];
  const reportedCount = items.filter((i: any) => i.status === "reported" || i.status === "validated").length;
  const pendingCount = items.filter((i: any) => !["reported", "validated"].includes(i.status)).length;
  const abnormalCount = items.filter((i: any) => i.result_flag && ["H", "L", "A"].includes(i.result_flag)).length;
  const criticalCount = items.filter((i: any) => i.result_flag && ["CH", "CL"].includes(i.result_flag)).length;

  return (
    <div className="w-full bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Patient Card */}
      <div className="p-4 border-b border-border">
        {patient ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[hsl(var(--sidebar-background))] text-white flex items-center justify-center text-sm font-bold shrink-0">
                {getInitials(patient.full_name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{patient.full_name}</p>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{patient.uhid}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{getAge(patient.dob)}</span>
              <span>·</span>
              <span className="capitalize">{patient.gender || "—"}</span>
              {(patient as any).blood_group && (
                <>
                  <span>·</span>
                  <span className="text-destructive font-medium">{(patient as any).blood_group}</span>
                </>
              )}
            </div>
            {(patient as any).phone && (
              <a href={`tel:${(patient as any).phone}`} className="text-[11px] text-primary hover:underline block">
                📞 {(patient as any).phone}
              </a>
            )}
            <p className="text-[11px] text-muted-foreground">
              Ordered by: Dr. {(selectedOrder.ordered_by_user as any)?.full_name || "Unknown"}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <User size={16} />
            <span className="text-sm">No patient data</span>
          </div>
        )}
      </div>

      {/* Order Summary */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">This Order</p>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Order #</span>
            <span className="font-mono text-foreground">LAB-{selectedOrder.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tests</span>
            <span className="text-foreground">{items.length} test(s)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Priority</span>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full capitalize", PRIORITY_COLORS[selectedOrder.priority])}>
              {selectedOrder.priority}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full capitalize", STATUS_COLORS[selectedOrder.status])}>
              {selectedOrder.status.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ordered</span>
            <span className="text-foreground">{timeAgo(selectedOrder.order_time)}</span>
          </div>
        </div>
      </div>

      {/* Result Status */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Result Status</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">{reportedCount} Reported</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            <span className="text-muted-foreground">{pendingCount} Pending</span>
          </div>
          {abnormalCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-700 font-medium">{abnormalCount} Abnormal</span>
            </div>
          )}
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <span className="text-destructive font-bold">{criticalCount} Critical</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Orders */}
      <div className="px-4 py-3 flex-1 overflow-y-auto">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Recent Orders</p>
        {recentOrders.length === 0 && <p className="text-xs text-muted-foreground">No previous orders</p>}
        <div className="space-y-1.5">
          {recentOrders.map(ro => (
            <button
              key={ro.id}
              onClick={() => onSelectOrder?.(ro.id)}
              className="w-full text-left bg-muted/50 rounded-md p-2 hover:bg-muted transition-colors"
            >
              <div className="flex justify-between text-[11px]">
                <span className="text-foreground font-medium">{new Date(ro.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", STATUS_COLORS[ro.status])}>
                  {ro.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{ro.lab_order_items?.length || 0} tests</p>
            </button>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-t border-border shrink-0 space-y-1.5">
        <button
          onClick={() => onAddTestToOrder?.(selectedOrder.patients)}
          className="w-full h-9 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={13} /> Add Test to Order
        </button>
        <button
          onClick={() => {
            const testNames = (selectedOrder.lab_order_items || [])
              .map((i: any) => i.lab_test_master?.test_name)
              .filter(Boolean) as string[];
            onRepeatOrder?.(selectedOrder.patients, testNames);
          }}
          className="w-full h-9 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
        >
          <RotateCcw size={13} /> Repeat Order
        </button>
      </div>
    </div>
  );
};

export default LabInfoPanel;
