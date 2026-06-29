import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScanLine } from "lucide-react";
import RadiologyWorklist from "@/components/radiology/RadiologyWorklist";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import NewRadiologyOrderModal from "@/components/radiology/NewRadiologyOrderModal";
import RadiologyReportingWorkspace from "@/components/radiology/RadiologyReportingWorkspace";
import PendingOpdRadiologyTab from "@/components/radiology/PendingOpdRadiologyTab";
import RadiologyTATPanel from "@/components/radiology/RadiologyTATPanel";

export interface RadiologyOrder {
  id: string;
  priority: string;
  status: string;
  order_date: string;
  order_time: string;
  study_name: string;
  body_part: string | null;
  clinical_history: string | null;
  indication: string | null;
  modality_type: string;
  modality_id: string;
  accession_number: string | null;
  is_pcpndt: boolean;
  patient_id: string;
  ordered_by: string;
  dicom_pacs_url: string | null;
  ai_flag: string | null;
  patients: { full_name: string; uhid: string; gender: string | null; dob: string | null; phone?: string | null; blood_group?: string | null } | null;
  ordered_by_user: { full_name: string } | null;
  radiology_modalities: { name: string; modality_type: string } | null;
  radiology_reports: { id: string; is_signed: boolean }[] | null;
}

export interface Modality {
  id: string;
  name: string;
  modality_type: string;
  is_active: boolean;
}

interface PendingOpdRadOrder {
  patient: { id: string; full_name: string; uhid: string; gender: string | null; dob: string | null };
}

const RadiologyPage: React.FC = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [modalities, setModalities] = useState<Modality[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [filterModality, setFilterModality] = useState("all");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [pendingOrderPatient, setPendingOrderPatient] = useState<PendingOpdRadOrder["patient"] | null>(null);
  const [pendingOrderStudyNames, setPendingOrderStudyNames] = useState<string[]>([]);
  const [pendingOrderEncounterId, setPendingOrderEncounterId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"worklist" | "pending_opd" | "tat_dashboard">("worklist");
  const [pendingOpdCount, setPendingOpdCount] = useState(0);

  const fetchHospitalId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (data) setHospitalId(data.hospital_id);
  }, []);

  const fetchModalities = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error } = await supabase
      .from("radiology_modalities")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("name");
    if (error) { console.error("Radiology modalities fetch error:", error.message); return; }
    setModalities(data || []);
  }, [hospitalId]);

  const fetchOrders = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error } = await supabase
      .from("radiology_orders")
      .select(`
        id, priority, status, order_date, order_time, study_name, body_part, ai_flag,
        clinical_history, indication, modality_type, modality_id,
        accession_number, is_pcpndt, patient_id, ordered_by, dicom_pacs_url,
        patients (full_name, uhid, gender, dob, phone, blood_group),
        ordered_by_user:users!radiology_orders_ordered_by_fkey (full_name),
        radiology_modalities (name, modality_type),
        radiology_reports (id, is_signed)
      `)
      .eq("hospital_id", hospitalId)
      .eq("order_date", selectedDate)
      .neq("status", "cancelled")
      .neq("billing_status", "unbilled")
      .order("order_time", { ascending: true });

    if (error) {
      console.error("Radiology orders fetch error:", error.message, error);
      // Show toast so the user knows the fetch failed (not just a silent empty list)
      toast({ title: "Failed to load worklist", description: error.message, variant: "destructive" });
    } else {
      const sorted = (data || []).sort((a: any, b: any) => {
        const p: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };
        return (p[a.priority] ?? 2) - (p[b.priority] ?? 2);
      });
      setOrders(sorted as any);
    }
  }, [hospitalId, selectedDate]);

  useEffect(() => { fetchHospitalId(); }, [fetchHospitalId]);
  useEffect(() => { if (hospitalId) { fetchModalities(); fetchOrders(); } }, [hospitalId, fetchModalities, fetchOrders]);

  // Realtime
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("radiology-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "radiology_orders", filter: `hospital_id=eq.${hospitalId}` }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, fetchOrders]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || null;

  const filteredOrders = filterModality === "all"
    ? orders
    : orders.filter(o => o.modality_type === filterModality);

  const statCounts = {
    pending: orders.filter(o => ["ordered", "scheduled", "patient_arrived"].includes(o.status)).length,
    imaging: orders.filter(o => o.status === "in_progress").length,
    reporting: orders.filter(o => o.status === "images_acquired").length,
    done: orders.filter(o => ["reported", "validated"].includes(o.status)).length,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top tab bar */}
      <div className="h-[40px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-2">
        {(["worklist", "pending_opd", "tat_dashboard"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${mainTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {tab === "worklist" ? "📡 Worklist" : tab === "pending_opd" ? "⏳ Pending from OPD" : "📊 TAT Dashboard"}
            {tab === "pending_opd" && pendingOpdCount > 0 && (
              <span className={`text-[10px] rounded-full px-1.5 font-bold ${mainTab === "pending_opd" ? "bg-white/20 text-white" : "bg-amber-500 text-white"}`}>
                {pendingOpdCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {mainTab === "tat_dashboard" && hospitalId ? (
        <div className="flex-1 overflow-y-auto">
          <RadiologyTATPanel hospitalId={hospitalId} />
        </div>
      ) : mainTab === "pending_opd" && hospitalId ? (
        <div className="flex-1 overflow-y-auto">
          <PendingOpdRadiologyTab
            hospitalId={hospitalId}
            onCountChange={setPendingOpdCount}
            onCreateOrder={(patient, studyNames, encounterId) => {
              setPendingOrderPatient(patient);
              setPendingOrderStudyNames(studyNames);
              setPendingOrderEncounterId(encounterId);
              setShowNewOrder(true);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Worklist */}
          <CollapsiblePanel panelKey="radiology_worklist" title="Worklist" side="left" expandedWidth="w-[320px]">
            <RadiologyWorklist
              orders={filteredOrders}
              modalities={modalities}
              selectedOrderId={selectedOrderId}
              onSelectOrder={setSelectedOrderId}
              filterModality={filterModality}
              onFilterChange={setFilterModality}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              statCounts={statCounts}
              onNewOrder={() => setShowNewOrder(true)}
            />
          </CollapsiblePanel>

          {/* Right: Workspace */}
          {selectedOrder && hospitalId ? (
            <RadiologyReportingWorkspace
              order={selectedOrder}
              hospitalId={hospitalId}
              onStatusChange={fetchOrders}
            />
          ) : (
            <div className="flex-1 bg-muted/30 flex items-center justify-center overflow-hidden">
              <div className="text-center space-y-3">
                <ScanLine size={48} className="mx-auto text-muted-foreground/40" />
                <p className="text-base text-muted-foreground">Select a study from the worklist</p>
                <p className="text-sm text-muted-foreground/60">or create a new radiology order</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Order Modal */}
      {showNewOrder && hospitalId && (
        <NewRadiologyOrderModal
          hospitalId={hospitalId}
          modalities={modalities}
          onClose={() => {
            setShowNewOrder(false);
            setPendingOrderPatient(null);
            setPendingOrderStudyNames([]);
            setPendingOrderEncounterId(null);
          }}
          onCreated={() => {
            setSelectedDate(new Date().toISOString().split("T")[0]);
            setFilterModality("all");
            fetchOrders();
          }}
          preselectedPatient={pendingOrderPatient ?? undefined}
          preselectedStudyNames={pendingOrderStudyNames}
          linkedEncounterId={pendingOrderEncounterId}
        />
      )}
    </div>
  );
};

export default RadiologyPage;
