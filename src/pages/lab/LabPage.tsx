import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Microscope } from "lucide-react";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import { hasTabAccess } from "@/lib/tabPermissions";
import NABHBadge from "@/components/nabh/NABHBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import LabQueuePanel from "@/components/lab/LabQueuePanel";
import LabInfoPanel from "@/components/lab/LabInfoPanel";
import LabResultWorkspace from "@/components/lab/LabResultWorkspace";
import NewLabOrderModal from "@/components/lab/NewLabOrderModal";
import LabQCDashboard from "@/components/lab/LabQCDashboard";
import LabCalibrationTab from "@/components/lab/LabCalibrationTab";
import ExternalReferralsTab from "@/components/lab/ExternalReferralsTab";
import LabAnalyzerTab from "@/components/lab/LabAnalyzerTab";
import PendingOpdLabTab from "@/components/lab/PendingOpdLabTab";
import CollectionWorkstation from "@/components/lab/CollectionWorkstation";
import PathologyCaseList from "@/components/lab/PathologyCaseList";
import LabTATPanel from "@/components/lab/LabTATPanel";

interface PendingOpdLabOrder {
  patient: { id: string; full_name: string; uhid: string; gender: string | null; dob: string | null };
}

interface LabOrder {
  id: string;
  priority: string;
  status: string;
  order_date: string;
  order_time: string;
  created_at: string | null;
  clinical_notes: string | null;
  patient_id: string;
  ordered_by: string;
  patients: { full_name: string; uhid: string; gender: string | null; dob: string | null; phone?: string | null; blood_group?: string | null } | null;
  ordered_by_user: { full_name: string } | null;
  lab_order_items: { id: string; status: string; result_flag: string | null; result_value: string | null; test_id: string; validated_at: string | null; lab_test_master: { tat_minutes: number } | null }[];
}

const LAB_MAIN_TABS = [
  { key: "worklist" as const, label: "🔬 Worklist" },
  { key: "collection" as const, label: "💉 Collection" },
  { key: "pending_opd" as const, label: "⏳ Pending from OPD" },
  { key: "qc" as const, label: "📊 QC Dashboard" },
  { key: "calibration" as const, label: "🔧 Calibration (NABL)" },
  { key: "histopathology" as const, label: "🧫 Histopathology" },
  { key: "tat" as const, label: "⏱️ TAT" },
  { key: "external" as const, label: "🔗 External Referrals" },
  { key: "analyzer" as const, label: "⚙️ Analyzer Interface" },
] as const;

const LabPage: React.FC = () => {
  const { toast } = useToast();
  const { permissions, role } = useHospitalContext();
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState("all");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const handleDateChange = useCallback((d: string) => {
    setSelectedDate(d);
    setSelectedOrderId(null);
    // When switching to a past date reset the tab to "all" so completed orders aren't hidden
    if (d !== new Date().toISOString().split("T")[0]) {
      setFilterTab("all");
    }
  }, []);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [pendingOrderPatient, setPendingOrderPatient] = useState<PendingOpdLabOrder["patient"] | null>(null);
  const [pendingOrderTestNames, setPendingOrderTestNames] = useState<string[]>([]);
  const [pendingOrderEncounterId, setPendingOrderEncounterId] = useState<string | null>(null);
  const [pendingOrderAdmissionId, setPendingOrderAdmissionId] = useState<string | null>(null);

  const fetchHospitalId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (error) { console.error("Lab hospital fetch error:", error.message); return; }
    if (data) setHospitalId(data.hospital_id);
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error } = await supabase
      .from("lab_orders")
      .select(`
        id, priority, status, order_date, order_time, created_at, clinical_notes, patient_id, ordered_by,
        patients (full_name, uhid, gender, dob, phone, blood_group),
        ordered_by_user:users!lab_orders_ordered_by_fkey (full_name),
        lab_order_items (id, status, result_flag, result_value, test_id, validated_at, lab_test_master:lab_test_master!lab_order_items_test_id_fkey (tat_minutes, test_name))
      `)
      .eq("hospital_id", hospitalId)
      .eq("order_date", selectedDate)
      .neq("status", "cancelled")
      .neq("billing_status", "unbilled")
      .order("order_time", { ascending: true });

    if (error) {
      console.error("Lab orders fetch error:", error);
    } else {
      const todayStr = new Date().toISOString().split("T")[0];
      const isToday = selectedDate === todayStr;

      // Header-only ghost orders can no longer be created — order creation is atomic
      // via the create_lab_order_with_items RPC (Phase 4), so the old client-side
      // DELETE of stale empty orders is gone. The display filter below stays as a
      // harmless guard for any pre-Phase-4 leftovers.
      const sorted = (data || [])
        .filter((o: any) => isToday ? (o.lab_order_items && o.lab_order_items.length > 0) : true)
        .sort((a: any, b: any) => {
          const p: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };
          return (p[a.priority] ?? 2) - (p[b.priority] ?? 2);
        });
      setOrders(sorted as any);
    }
  }, [hospitalId, selectedDate]);

  useEffect(() => { fetchHospitalId(); }, [fetchHospitalId]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Realtime
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("lab-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_orders", filter: `hospital_id=eq.${hospitalId}` }, () => fetchOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_order_items", filter: `hospital_id=eq.${hospitalId}` }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, fetchOrders]);

  const filteredOrders = orders.filter((o) => {
    if (filterTab === "all") return true;
    if (filterTab === "pending") return ["ordered", "sample_collected"].includes(o.status);
    if (filterTab === "in_process") return o.status === "in_process";
    if (filterTab === "pending_validation") return o.status === "pending_validation";
    if (filterTab === "ready") return o.status === "partial_results";
    if (filterTab === "completed") return o.status === "completed";
    return true;
  });

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || null;

  const statCount = orders.filter((o) => o.priority === "stat").length;
  const urgentCount = orders.filter((o) => o.priority === "urgent").length;
  const routineCount = orders.filter((o) => o.priority === "routine").length;

  const [mainTab, setMainTab] = useState<"worklist" | "collection" | "pending_opd" | "qc" | "calibration" | "histopathology" | "tat" | "external" | "analyzer">("worklist");
  const [pendingOpdCount, setPendingOpdCount] = useState(0);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Top tab bar */}
      <div className="h-[40px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-4">
        {LAB_MAIN_TABS.filter((t) => hasTabAccess("lab", t.key, permissions, role)).map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${mainTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t.label}
            {t.key === "pending_opd" && pendingOpdCount > 0 && (
              <span className={`text-[10px] rounded-full px-1.5 py-0 font-bold ${mainTab === "pending_opd" ? "bg-white/20 text-white" : "bg-amber-500 text-white"}`}>
                {pendingOpdCount}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto" />
        <NABHBadge standardCodes={["AAC.3", "HIC.4", "QPS.2"]} />
      </div>

      {mainTab === "collection" && hospitalId ? (
        <div className="flex-1 overflow-y-auto">
          <CollectionWorkstation hospitalId={hospitalId} />
        </div>
      ) : mainTab === "pending_opd" && hospitalId ? (
        <div className="flex-1 overflow-y-auto">
          <PendingOpdLabTab
            hospitalId={hospitalId}
            onCountChange={setPendingOpdCount}
            onCreateOrder={(patient, testNames, encounterId, admissionId) => {
              setPendingOrderPatient(patient);
              setPendingOrderTestNames(testNames);
              // A ward row has no encounter; passing "" would link the order to nothing.
              setPendingOrderEncounterId(encounterId || null);
              setPendingOrderAdmissionId(admissionId ?? null);
              setShowNewOrder(true);
            }}
          />
        </div>
      ) : mainTab === "qc" && hospitalId ? (
        <LabQCDashboard hospitalId={hospitalId} />
      ) : mainTab === "calibration" && hospitalId ? (
        <LabCalibrationTab hospitalId={hospitalId} />
      ) : mainTab === "histopathology" && hospitalId ? (
        <div className="flex-1 overflow-hidden">
          <PathologyCaseList hospitalId={hospitalId} />
        </div>
      ) : mainTab === "tat" && hospitalId ? (
        <div className="flex-1 overflow-hidden">
          <LabTATPanel hospitalId={hospitalId} />
        </div>
      ) : mainTab === "external" && hospitalId ? (
        <div className="flex-1 overflow-hidden">
          <ExternalReferralsTab hospitalId={hospitalId} />
        </div>
      ) : mainTab === "analyzer" ? (
        <div className="flex-1 overflow-y-auto">
          <LabAnalyzerTab />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Queue */}
          <CollapsiblePanel panelKey="lab_queue" title="Lab Queue" side="left" expandedWidth="w-[280px]">
            <LabQueuePanel
              orders={filteredOrders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={setSelectedOrderId}
              filterTab={filterTab}
              onFilterChange={setFilterTab}
              selectedDate={selectedDate}
              onDateChange={handleDateChange}
              statCount={statCount}
              urgentCount={urgentCount}
              routineCount={routineCount}
              onNewOrder={() => setShowNewOrder(true)}
            />
          </CollapsiblePanel>

          {/* Center: Workspace */}
          {selectedOrder ? (
            <LabResultWorkspace order={selectedOrder} onRefresh={fetchOrders} />
          ) : (
            <div className="flex-1 bg-muted/30 flex items-center justify-center overflow-hidden">
              <div className="text-center space-y-3">
                <Microscope size={48} className="mx-auto text-muted-foreground/40" />
                <p className="text-base text-muted-foreground">Select a test order from the queue</p>
                <p className="text-sm text-muted-foreground/60">or create a new lab order</p>
              </div>
            </div>
          )}

          {/* Right: Info */}
          <CollapsiblePanel panelKey="lab_info" title="Patient Info" side="right" expandedWidth="w-[300px]">
            <LabInfoPanel
              selectedOrder={selectedOrder}
              onSelectOrder={setSelectedOrderId}
              onAddTestToOrder={(patient) => {
                setPendingOrderPatient(patient);
                setPendingOrderTestNames([]);
                setPendingOrderEncounterId(null);
                setShowNewOrder(true);
              }}
              onRepeatOrder={(patient, testNames) => {
                setPendingOrderPatient(patient);
                setPendingOrderTestNames(testNames);
                setPendingOrderEncounterId(null);
                setShowNewOrder(true);
              }}
            />
          </CollapsiblePanel>
        </div>
      )}

      {/* New Order Modal */}
      {showNewOrder && hospitalId && (
        <NewLabOrderModal
          hospitalId={hospitalId}
          onClose={() => {
            setShowNewOrder(false);
            setPendingOrderPatient(null);
            setPendingOrderTestNames([]);
            setPendingOrderEncounterId(null);
          }}
          onCreated={() => {
            fetchOrders();
            setShowNewOrder(false);
            setPendingOrderPatient(null);
            setPendingOrderTestNames([]);
            setPendingOrderEncounterId(null);
          }}
          preselectedPatient={pendingOrderPatient ?? undefined}
          preselectedTestNames={pendingOrderTestNames}
          linkedEncounterId={pendingOrderEncounterId}
          linkedAdmissionId={pendingOrderAdmissionId}
        />
      )}
    </div>
  );
};

export default LabPage;
