import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import DayCareAdmissionModal from "@/components/ipd/DayCareAdmissionModal";
import DayCareDischargeModal from "@/components/ipd/DayCareDischargeModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Plus, Search, Clock, User, Stethoscope, LogOut, RefreshCw } from "lucide-react";
import { formatDateIST } from "@/lib/dateUtils";

interface DayCareAdmission {
  id: string;
  patient_name: string;
  admission_number: string;
  admitted_at: string;
  admitting_diagnosis: string;
  doctor_name: string;
  insurance_type: string;
  procedure_name: string | null;
  duration_minutes: number | null;
}

interface DischargeTarget {
  admissionId: string;
  patientName: string;
  procedureName: string;
}

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

const DayCarePage: React.FC = () => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [admissions, setAdmissions] = useState<DayCareAdmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<DischargeTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "discharged">("active");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: ud } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!ud?.hospital_id) { setLoading(false); return; }
    setHospitalId(ud.hospital_id);

    const status = view === "active" ? "active" : "discharged";

    const { data, error } = await (supabase as any)
      .from("admissions")
      .select(`
        id, admission_number, admitted_at, admitting_diagnosis, insurance_type, status,
        patient:patients(full_name),
        doctor:users!admissions_admitting_doctor_id_fkey(full_name),
        procedure:day_care_procedures(procedure_name, duration_minutes)
      `)
      .eq("hospital_id", ud.hospital_id)
      .eq("admission_type", "daycare")
      .eq("status", status)
      .gte("admitted_at", `${selectedDate}T00:00:00+05:30`)
      .lte("admitted_at", `${selectedDate}T23:59:59+05:30`)
      .order("admitted_at", { ascending: false });

    if (error) { console.error("Day care fetch:", error.message); setLoading(false); return; }

    const rows: DayCareAdmission[] = (data || []).map((a: any) => ({
      id: a.id,
      patient_name: a.patient?.full_name || "—",
      admission_number: a.admission_number,
      admitted_at: a.admitted_at,
      admitting_diagnosis: a.admitting_diagnosis,
      doctor_name: a.doctor?.full_name || "—",
      insurance_type: a.insurance_type,
      procedure_name: a.procedure?.procedure_name || null,
      duration_minutes: a.procedure?.duration_minutes || null,
    }));

    setAdmissions(rows);
    setLoading(false);
  }, [view, selectedDate]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const filtered = admissions.filter(a =>
    !search ||
    a.patient_name.toLowerCase().includes(search.toLowerCase()) ||
    a.admission_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.procedure_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const selected = admissions.find(a => a.id === selectedId) || null;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white shrink-0">
        <div className="flex items-center gap-3">
          <Stethoscope size={20} className="text-teal-600" />
          <div>
            <h1 className="text-base font-semibold">Day Care Unit</h1>
            <p className="text-xs text-muted-foreground">Same-day procedure management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-1">
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button size="sm" className="bg-teal-600 hover:bg-teal-700 gap-1" onClick={() => setAdmitOpen(true)}>
            <Plus size={14} />
            New Admission
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — patient list */}
        <div className="w-80 flex flex-col border-r bg-white shrink-0">
          {/* Date bar */}
          <div className="px-3 pt-3 pb-2 border-b space-y-2">
            <div className="flex items-center gap-1.5">
              {[
                { label: "Today", val: todayStr() },
                { label: "Yesterday", val: yesterdayStr() },
              ].map(d => (
                <button
                  key={d.val}
                  onClick={() => { setSelectedDate(d.val); setSelectedId(null); }}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                    selectedDate === d.val
                      ? "bg-teal-600 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  {d.label}
                </button>
              ))}
              <input
                type="date"
                value={selectedDate}
                onChange={e => { setSelectedDate(e.target.value); setSelectedId(null); }}
                className="ml-auto text-[11px] bg-card border border-border rounded px-1.5 py-1 text-foreground"
              />
            </div>

            {/* Status tabs */}
            <div className="flex gap-1">
              {(["active", "discharged"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => { setView(v); setSelectedId(null); }}
                  className={cn(
                    "flex-1 text-xs py-1 rounded font-medium transition-colors",
                    view === v ? "bg-teal-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  {v === "active" ? "Active" : "Discharged"}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder="Search patient, procedure…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-xs text-muted-foreground text-center p-4">Loading…</p>}
            {!loading && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center p-6">
                {view === "active" ? "No active day care patients." : "No discharges on this date."}
              </p>
            )}
            {filtered.map(a => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "w-full text-left px-3 py-3 border-b hover:bg-muted/40 transition-colors",
                  selectedId === a.id && "bg-teal-50 border-l-2 border-l-teal-500"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{a.patient_name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {a.insurance_type.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.procedure_name || a.admitting_diagnosis}</div>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                  <Clock size={10} />
                  {formatDateIST(a.admitted_at)}
                  {a.duration_minutes && <span>· {a.duration_minutes} min</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Stethoscope size={40} className="text-muted-foreground/30" />
              <p className="text-sm">Select a patient to view details</p>
            </div>
          ) : (
            <div className="max-w-xl space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selected.patient_name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.admission_number}</p>
                </div>
                {view === "active" && (
                  <Button
                    size="sm"
                    className="bg-teal-600 hover:bg-teal-700 gap-1"
                    onClick={() => setDischargeTarget({
                      admissionId: selected.id,
                      patientName: selected.patient_name,
                      procedureName: selected.procedure_name || selected.admitting_diagnosis,
                    })}
                  >
                    <LogOut size={13} />
                    Discharge
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <DetailCard label="Procedure" value={selected.procedure_name || selected.admitting_diagnosis} />
                <DetailCard label="Duration" value={selected.duration_minutes ? `${selected.duration_minutes} min` : "—"} />
                <DetailCard label="Doctor" value={selected.doctor_name} icon={<User size={12} />} />
                <DetailCard label="Admitted" value={formatDateIST(selected.admitted_at)} icon={<Clock size={12} />} />
                <DetailCard label="Payer" value={selected.insurance_type.replace("_", " ").toUpperCase()} />
              </div>

              {view === "active" && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800 font-medium">Same-day discharge required</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Day care patients must be discharged before midnight (IST) on the day of admission.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {hospitalId && (
        <DayCareAdmissionModal
          open={admitOpen}
          onClose={() => setAdmitOpen(false)}
          hospitalId={hospitalId}
          onAdmitted={fetchData}
        />
      )}

      {dischargeTarget && (
        <DayCareDischargeModal
          open={!!dischargeTarget}
          onClose={() => setDischargeTarget(null)}
          admissionId={dischargeTarget.admissionId}
          patientName={dischargeTarget.patientName}
          procedureName={dischargeTarget.procedureName}
          onDischarged={() => { setDischargeTarget(null); setSelectedId(null); fetchData(); }}
        />
      )}
    </div>
  );
};

const DetailCard: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="bg-muted/40 rounded-lg p-3">
    <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">{icon}{label}</div>
    <div className="text-sm font-medium">{value}</div>
  </div>
);

export default DayCarePage;
