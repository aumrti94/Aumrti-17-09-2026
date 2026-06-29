import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronLeft } from "lucide-react";
import BedMap from "@/components/ipd/BedMap";
import IPDWorkspace from "@/components/ipd/IPDWorkspace";
import WardStats from "@/components/ipd/WardStats";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import BedDemandForecastPanel from "@/components/ipd/BedDemandForecastPanel";
import { useHospitalContext } from "@/contexts/HospitalContext";
import CollapsiblePanel from "@/components/layout/CollapsiblePanel";

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

  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase.channel("ipd-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "beds", filter: `hospital_id=eq.${hospitalId}` }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "admissions", filter: `hospital_id=eq.${hospitalId}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, fetchData]);

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
          {hospitalId && totalBeds > 0 && (
            <div className="flex-shrink-0 p-3 border-b border-border space-y-2">
              <BedDemandForecastPanel hospitalId={hospitalId} />
            </div>
          )}
          <div className="flex flex-row flex-1 overflow-hidden">
            <CollapsiblePanel panelKey="ipd_bedmap" title="Bed Map" side="left" expandedWidth="w-[300px]">
              <BedMap beds={beds} selectedBedId={selectedBedId} onSelectBed={handleBedSelect}
                hospitalId={hospitalId} loading={loading} onRefresh={fetchData} onNewAdmission={handleNewAdmission} />
            </CollapsiblePanel>
            {/* Desktop: workspace beside bed map */}
            {!isMobile && (
              <IPDWorkspace bed={selectedBed} hospitalId={hospitalId} userId={userId} onRefresh={fetchData} />
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
          <WardStats admissions={admissions} onSelectBed={setSelectedBedId} onClose={() => {}} />
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
    </div>
  );
};

export default IPDPage;
