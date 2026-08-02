import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronLeft, BedDouble } from "lucide-react";
import BedMap from "@/components/ipd/BedMap";
import IPDWorkspace from "@/components/ipd/IPDWorkspace";
import WardStats from "@/components/ipd/WardStats";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import BedReservationModal from "@/components/ipd/BedReservationModal";
import BedDemandForecastPanel from "@/components/ipd/BedDemandForecastPanel";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface BedData {
  id: string;
  bed_number: string;
  status: string;
  ward_id: string;
  ward_name?: string;
  admission?: {
    id: string;
    patient_id: string;
    patient_name: string;
    patient_initials: string;
    admitted_at: string;
    admission_type: string;
    admission_number: string;
    admitting_diagnosis: string;
    doctor_name: string;
    doctor_department: string | null;
    los_days: number;
    expected_discharge_date: string | null;
    is_mlc?: boolean;
    mlc_number?: string | null;
    payer_type?: string | null;
    abha_id?: string | null;
  } | null;
}

export interface AdmissionRow {
  id: string;
  patient_name: string;
  bed_number: string;
  ward_name: string;
  doctor_name: string;
  admission_type: string;
  admitted_at: string;
  expected_discharge_date: string | null;
  los_days: number;
  bed_id: string;
}

const IPDPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalContext();
  const [beds, setBeds] = useState<BedData[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionRow[]>([]);
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [admitModal, setAdmitModal] = useState<{ open: boolean; bedId?: string; wardId?: string; bedNumber?: string }>({ open: false });
  const [reserveModal, setReserveModal] = useState<{ open: boolean; bedId?: string; wardId?: string; bedNumber?: string }>({ open: false });
  const [reservedBedInfo, setReservedBedInfo] = useState<{
    open: boolean; bedId: string; bedNumber: string;
    patientName: string; plannedDate: string; doctorName: string; reservationId: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;

    const [{ data: bedData, error: bedErr }, { data: admData, error: admErr }] = await Promise.all([
      supabase
        .from("beds")
        .select("id, bed_number, status, ward_id, ward:wards(name)")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .order("bed_number"),
      supabase
        .from("admissions")
        .select("id, patient_id, bed_id, ward_id, admission_type, admission_number, admitting_diagnosis, admitted_at, expected_discharge_date, admitting_doctor_id, status, is_mlc, mlc_number, payer_type, patient:patients(full_name, abha_id), bed:beds(bed_number), ward:wards(name), doctor:users!admissions_admitting_doctor_id_fkey(full_name, department:departments(name))")
        .eq("hospital_id", hospitalId)
        .eq("status", "active")
        .order("admitted_at", { ascending: false }),
    ]);

    if (bedErr) { console.error("IPD beds fetch error:", bedErr.message); setLoading(false); return; }
    if (admErr) { console.error("IPD admissions fetch error:", admErr.message); }

    // Only beds currently marked as occupied are truly active
    const occupiedBedIds = new Set((bedData || []).filter((b: any) => b.status === "occupied").map((b: any) => b.id as string));

    const admMap = new Map<string, any>();
    const admRows: AdmissionRow[] = [];

    (admData || []).forEach((a: Record<string, unknown>) => {
      const bedId = a.bed_id as string;
      // Skip stale admissions whose bed is no longer occupied
      if (!occupiedBedIds.has(bedId)) return;
      // With descending order, first-wins = most recently admitted patient per bed
      if (admMap.has(bedId)) return;

      const patient = a.patient as { full_name: string } | null;
      const bed = a.bed as { bed_number: string } | null;
      const ward = a.ward as { name: string } | null;
      const doctor = a.doctor as { full_name: string; department?: { name: string } | null } | null;
      const name = patient?.full_name || "—";
      const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
      const los = Math.max(1, Math.ceil((Date.now() - new Date(a.admitted_at as string).getTime()) / 86400000));

      admMap.set(bedId, {
        id: a.id as string,
        patient_id: a.patient_id as string,
        patient_name: name,
        patient_initials: initials,
        admitted_at: a.admitted_at as string,
        admission_type: a.admission_type as string,
        admission_number: a.admission_number as string || "",
        admitting_diagnosis: a.admitting_diagnosis as string || "",
        doctor_name: doctor?.full_name || "—",
        doctor_department: doctor?.department?.name || null,
        los_days: los,
        expected_discharge_date: a.expected_discharge_date as string | null,
        is_mlc: (a.is_mlc as boolean) || false,
        mlc_number: (a.mlc_number as string | null) || null,
        abha_id: (a.patient as any)?.abha_id || null,
        payer_type: (a.payer_type as string | null) || null,
      });

      admRows.push({
        id: a.id as string,
        patient_name: name,
        bed_number: bed?.bed_number || "—",
        ward_name: ward?.name || "—",
        doctor_name: doctor?.full_name || "—",
        admission_type: a.admission_type as string,
        admitted_at: a.admitted_at as string,
        expected_discharge_date: a.expected_discharge_date as string | null,
        los_days: los,
        bed_id: bedId,
      });
    });

    const mappedBeds: BedData[] = (bedData || [])
      .map((b: Record<string, unknown>) => {
        const ward = b.ward as { name: string } | null;
        return {
          id: b.id as string,
          bed_number: b.bed_number as string,
          status: b.status as string,
          ward_id: b.ward_id as string,
          ward_name: ward?.name || "—",
          admission: admMap.get(b.id as string) || null,
        };
      })
      .sort((a, b) => {
        // Numeric sort: "Bed 2" before "Bed 10"
        const numA = parseInt(a.bed_number.replace(/\D/g, ""), 10) || 0;
        const numB = parseInt(b.bed_number.replace(/\D/g, ""), 10) || 0;
        return numA !== numB ? numA - numB : a.bed_number.localeCompare(b.bed_number);
      });

    setBeds(mappedBeds);
    setAdmissions(admRows);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Coalesce bursts of realtime changes into a single refetch. Kept short (≤500ms)
  // so the bed board never goes stale enough to risk double-booking. Debounced +
  // focus/reconnect fallback are handled inside the shared hook.
  useRealtimeRefetch({
    tables: ["beds", "admissions", "bed_reservations"],
    hospitalId,
    onChange: fetchData,
    channelName: "ipd",
  });

  const isMobile = useIsMobile();
  const selectedBed = beds.find((b) => b.id === selectedBedId) || null;

  const handleBedSelect = (bedId: string) => {
    const bed = beds.find((b) => b.id === bedId);
    if (bed?.status === "available") {
      setAdmitModal({ open: true, bedId: bed.id, wardId: bed.ward_id, bedNumber: `${bed.ward_name} - ${bed.bed_number}` });
    } else {
      setSelectedBedId(bedId);
    }
  };

  const handleReservedBedClick = async (bedId: string) => {
    const bed = beds.find((b) => b.id === bedId);
    if (!bed || !hospitalId) return;
    const { data } = await (supabase as any)
      .from("bed_reservations")
      .select("id, planned_admission_date, patients(full_name), users!bed_reservations_doctor_id_fkey(full_name)")
      .eq("bed_id", bedId)
      .eq("hospital_id", hospitalId)
      .eq("status", "reserved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setReservedBedInfo({
        open: true,
        bedId,
        bedNumber: `${bed.ward_name} - ${bed.bed_number}`,
        patientName: (data.patients as any)?.full_name || "Unknown patient",
        plannedDate: data.planned_admission_date,
        doctorName: (data.users as any)?.full_name || "—",
        reservationId: data.id,
      });
    }
  };

  const handleCancelReservation = async () => {
    if (!reservedBedInfo) return;
    await (supabase as any).from("bed_reservations").update({
      status: "cancelled", cancelled_at: new Date().toISOString(),
    }).eq("id", reservedBedInfo.reservationId);
    await supabase.from("beds").update({ status: "available" as any }).eq("id", reservedBedInfo.bedId);
    setReservedBedInfo(null);
    fetchData();
  };

  const handleCheckIn = () => {
    if (!reservedBedInfo) return;
    const bed = beds.find((b) => b.id === reservedBedInfo.bedId);
    setReservedBedInfo(null);
    setAdmitModal({
      open: true,
      bedId: reservedBedInfo.bedId,
      wardId: bed?.ward_id,
      bedNumber: reservedBedInfo.bedNumber,
    });
  };

  const handleNewAdmission = () => {
    setAdmitModal({ open: true });
  };

  const totalBeds = beds.length;
  const occupiedBeds = beds.filter((b) => b.status === "occupied").length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left / main column: forecast + bed map (hidden on mobile when workspace is open) */}
      {(!isMobile || !selectedBedId) && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Mobile: forecast above the bed map when no patient is selected */}
          {isMobile && hospitalId && totalBeds > 0 && !selectedBedId && (
            <div className="flex-shrink-0 p-3 border-b border-border">
              <BedDemandForecastPanel hospitalId={hospitalId} />
            </div>
          )}
          <div className="flex flex-row flex-1 overflow-hidden">
            <CollapsiblePanel panelKey="ipd_bedmap" title="Bed Map" side="left" expandedWidth="w-[300px]">
              <BedMap beds={beds} selectedBedId={selectedBedId} onSelectBed={handleBedSelect}
                hospitalId={hospitalId} loading={loading} onRefresh={fetchData} onNewAdmission={handleNewAdmission}
                onReserveBed={() => setReserveModal({ open: true })}
                onReservedBedClick={handleReservedBedClick} />
            </CollapsiblePanel>
            {/* Desktop: when a patient is selected show the workspace; otherwise show the
                AI forecast centred in the middle (with the "click a bed" hint below). */}
            {!isMobile && (
              selectedBedId ? (
                <IPDWorkspace bed={selectedBed} hospitalId={hospitalId} userId={userId} onRefresh={fetchData} />
              ) : (
                <div className="flex-1 bg-muted/30 overflow-y-auto flex justify-center">
                  <div className="w-full max-w-2xl px-6 pt-[8vh] pb-6">
                    {hospitalId && totalBeds > 0 && <BedDemandForecastPanel hospitalId={hospitalId} />}
                    <div className="flex flex-col items-center justify-center text-center mt-10">
                      <BedDouble className="h-12 w-12 text-muted-foreground/30 mb-3" />
                      <p className="text-base text-muted-foreground">Click a bed to view patient details</p>
                      <p className="text-[13px] text-muted-foreground/60 mt-1">or click an available bed to admit a new patient</p>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Mobile workspace overlay — full screen when bed selected */}
      {isMobile && selectedBedId && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setSelectedBedId(null)}
            className="flex-shrink-0 flex items-center gap-1.5 h-11 px-4 bg-card border-b border-border text-sm font-medium text-primary hover:bg-muted/30 w-full text-left"
          >
            <ChevronLeft size={16} /> Back to Bed Map
          </button>
          <IPDWorkspace bed={selectedBed} hospitalId={hospitalId} userId={userId} onRefresh={fetchData} />
        </div>
      )}

      {/* Ward stats — collapsible right panel, desktop only */}
      {!isMobile && (
        <CollapsiblePanel
          panelKey="ipd_wardstats"
          title={`Currently Admitted (${admissions.length})`}
          side="right"
          expandedWidth="w-[260px]"
          defaultCollapsed={false}
        >
          <WardStats admissions={admissions} onSelectBed={setSelectedBedId} onClose={() => {}} hospitalId={hospitalId} />
        </CollapsiblePanel>
      )}

      <AdmitPatientModal
        open={admitModal.open}
        onClose={() => setAdmitModal({ open: false })}
        hospitalId={hospitalId}
        preselectedBedId={admitModal.bedId || null}
        preselectedWardId={admitModal.wardId || null}
        preselectedBedNumber={admitModal.bedNumber || null}
        onAdmitted={fetchData}
      />

      {hospitalId && (
        <BedReservationModal
          open={reserveModal.open}
          onClose={() => setReserveModal({ open: false })}
          hospitalId={hospitalId}
          preselectedBedId={reserveModal.bedId || null}
          preselectedWardId={reserveModal.wardId || null}
          preselectedBedNumber={reserveModal.bedNumber || null}
          onReserved={fetchData}
        />
      )}

      {reservedBedInfo && (
        <Dialog open={reservedBedInfo.open} onOpenChange={(v) => { if (!v) setReservedBedInfo(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                🔵 Reserved Bed — {reservedBedInfo.bedNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-1.5">
                <p className="text-sm font-semibold text-blue-900">{reservedBedInfo.patientName}</p>
                <p className="text-xs text-blue-700">
                  Planned admission: <strong>{new Date(reservedBedInfo.plannedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</strong>
                </p>
                {reservedBedInfo.doctorName !== "—" && (
                  <p className="text-xs text-blue-600">Dr. {reservedBedInfo.doctorName}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-[#1A2F5A] hover:bg-[#152647] text-white"
                  onClick={handleCheckIn}
                >
                  ✅ Check In Patient
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                  onClick={handleCancelReservation}
                >
                  ✕ Cancel Reservation
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default IPDPage;
