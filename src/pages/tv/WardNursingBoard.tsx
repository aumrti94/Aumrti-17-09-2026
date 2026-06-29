import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { differenceInHours, format } from "date-fns";
import { Clock, AlertCircle, Syringe, Activity, FlaskConical, LayoutGrid } from "lucide-react";
import { useLocation } from "react-router-dom";

interface BoardRow {
  id: string; // admission_id
  patientName: string;
  uhid: string;
  bedNumber: string;
  wardName: string;
  doctorName: string;
  overdueVitals: boolean;
  lastVitalsTime: string | null;
  pendingMeds: { name: string; time: string }[];
  pendingLabs: number;
  activeIVs: { name: string; rate: string; end_at: string | null }[];
}

const WardNursingBoard: React.FC = () => {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // allow ?ward=xyz filtering
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const wardFilter = queryParams.get("ward") || null;

  const fetchData = useCallback(async () => {
    // 1. Get anonymous hospital_id from first active admission if auth is missing (TV mode)
    // Or normally get from user session
    let hId = hospitalId;
    if (!hId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: ud } = await supabase.from("users").select("hospital_id").eq("auth_user_id", session.user.id).single();
        hId = ud?.hospital_id || null;
      } else {
        const { data: defaultAdmissions } = await supabase.from("admissions").select("hospital_id").eq("status", "admitted").limit(1);
        if (defaultAdmissions && defaultAdmissions.length > 0) {
          hId = defaultAdmissions[0].hospital_id;
        }
      }
      if (hId) setHospitalId(hId);
    }
    if (!hId) return;

    // 2. Fetch Active Admissions
    let admQuery = supabase
      .from("admissions")
      .select("id, patient_id, admitted_at, ward_id, bed_id, patients(full_name, uhid), beds(bed_number), wards(ward_name), users!admissions_admitting_doctor_id_fkey(full_name)")
      .eq("hospital_id", hId)
      .eq("status", "admitted")
      .order("admitted_at", { ascending: false });

    if (wardFilter) {
      const { data: wardData } = await supabase.from("wards").select("id").eq("hospital_id", hId).ilike("ward_name", `%${wardFilter}%`);
      if (wardData && wardData.length > 0) {
        admQuery = admQuery.in("ward_id", wardData.map(w => w.id));
      }
    }

    const { data: admissions } = await admQuery;
    if (!admissions || admissions.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    
    const admissionIds = admissions.map(a => a.id);

    // 3. Fetch Vitals (check overdue > 4h)
    const { data: vitals } = await supabase
      .from("ipd_vitals")
      .select("admission_id, recorded_at")
      .in("admission_id", admissionIds)
      .order("recorded_at", { ascending: false });

    const latestVitals = new Map<string, string>();
    (vitals || []).forEach(v => {
      if (!latestVitals.has(v.admission_id)) {
        latestVitals.set(v.admission_id, v.recorded_at);
      }
    });

    // 4. Fetch Pending Meds (next 2h or overdue)
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { data: meds } = await supabase
      .from("nursing_mar")
      .select("admission_id, drug_name, scheduled_time")
      .in("admission_id", admissionIds)
      .eq("outcome", "pending")
      .lte("scheduled_time", twoHoursFromNow)
      .order("scheduled_time", { ascending: true });

    const medMap = new Map<string, { name: string; time: string }[]>();
    (meds || []).forEach(m => {
      const list = medMap.get(m.admission_id) || [];
      list.push({ name: m.drug_name, time: m.scheduled_time });
      medMap.set(m.admission_id, list);
    });

    // 5. Fetch Pending Labs
    const { data: labs } = await supabase
      .from("lab_samples")
      .select("admission_id, status")
      .in("admission_id", admissionIds)
      .in("status", ["collected", "processing"]);
      
    const labMap = new Map<string, number>();
    (labs || []).forEach(l => {
      labMap.set(l.admission_id, (labMap.get(l.admission_id) || 0) + 1);
    });

    // 6. Fetch Active IVs
    let ivMap = new Map<string, { name: string; rate: string; end_at: string | null }[]>();
    try {
      const { data: ivs } = await supabase
        .from("iv_fluids")
        .select("admission_id, fluid_name, rate_ml_per_hour, expected_end_at")
        .in("admission_id", admissionIds)
        .eq("status", "running");
        
      (ivs || []).forEach(iv => {
        const list = ivMap.get(iv.admission_id) || [];
        list.push({ 
          name: iv.fluid_name, 
          rate: iv.rate_ml_per_hour ? `${iv.rate_ml_per_hour}ml/h` : "N/A",
          end_at: iv.expected_end_at 
        });
        ivMap.set(iv.admission_id, list);
      });
    } catch {
      // Ignore if table doesn't exist yet
    }

    // Combine
    const finalRows: BoardRow[] = admissions.map((a: any) => {
      const lastVital = latestVitals.get(a.id) || null;
      const isOverdue = !lastVital || differenceInHours(now, new Date(lastVital)) >= 4;
      
      return {
        id: a.id,
        patientName: a.patients?.full_name || "—",
        uhid: a.patients?.uhid || "—",
        bedNumber: a.beds?.bed_number || "—",
        wardName: a.wards?.ward_name || "—",
        doctorName: a.users?.full_name || "—",
        overdueVitals: isOverdue,
        lastVitalsTime: lastVital,
        pendingMeds: medMap.get(a.id) || [],
        pendingLabs: labMap.get(a.id) || 0,
        activeIVs: ivMap.get(a.id) || []
      };
    });

    // Sort: patients with overdue vitals or pending meds first
    finalRows.sort((a, b) => {
      const scoreA = (a.overdueVitals ? 10 : 0) + (a.pendingMeds.length > 0 ? 5 : 0);
      const scoreB = (b.overdueVitals ? 10 : 0) + (b.pendingMeds.length > 0 ? 5 : 0);
      return scoreB - scoreA; // Descending
    });

    setRows(finalRows);
    setLoading(false);
  }, [hospitalId, wardFilter]);

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return <div className="h-screen w-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400">
      <LayoutGrid className="h-12 w-12 animate-pulse mb-4" />
      <p className="text-xl font-medium tracking-widest uppercase">Initializing Station Board...</p>
    </div>;
  }

  const timeString = format(new Date(), "HH:mm");
  const dateString = format(new Date(), "EEEE, dd MMM yyyy");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Activity className="h-8 w-8 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white leading-none">Nursing Station Board</h1>
            <p className="text-zinc-400 text-sm font-medium mt-1 uppercase tracking-wider">{wardFilter || "All Wards"} • LIVE</p>
          </div>
        </div>
        <div className="text-right flex items-center gap-6">
          <div className="flex gap-4">
             <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500" /> <span className="text-xs text-zinc-400 font-medium">Critical / Overdue</span></div>
             <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500" /> <span className="text-xs text-zinc-400 font-medium">Pending Now</span></div>
          </div>
          <div className="bg-zinc-950 rounded-xl px-4 py-2 border border-zinc-800">
            <div className="text-3xl font-bold font-mono tracking-tighter leading-none">{timeString}</div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-1 font-bold">{dateString}</div>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 p-6 overflow-hidden flex flex-col">
        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
            <LayoutGrid className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-xl">No active patients found for this view.</p>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-max overflow-y-auto pr-2 pb-10">
            {rows.map((row) => {
              const isCritical = row.overdueVitals || (row.pendingMeds.length > 0 && new Date(row.pendingMeds[0].time) < new Date());
              const cardClass = isCritical 
                ? "bg-red-950/20 border-red-900/50 hover:border-red-500/50" 
                : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700";

              return (
                <div key={row.id} className={`rounded-xl border p-4 transition-colors flex flex-col gap-4 ${cardClass}`}>
                  
                  {/* Patient Header */}
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-bold text-white leading-none">{row.patientName}</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono flex items-center gap-2">
                        {row.uhid} • Dr. {row.doctorName.split(' ')[0]}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-emerald-400 leading-none">{row.bedNumber}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mt-1">{row.wardName}</div>
                    </div>
                  </div>

                  {/* Body grid */}
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    
                    {/* Vitals */}
                    <div className={`rounded-lg p-2.5 border ${row.overdueVitals ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-950/50 border-zinc-800/50'}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Activity className={`h-3.5 w-3.5 ${row.overdueVitals ? 'text-red-400' : 'text-zinc-500'}`} />
                        <span className={`text-[10px] uppercase font-bold tracking-wider ${row.overdueVitals ? 'text-red-400' : 'text-zinc-500'}`}>Vitals</span>
                      </div>
                      {row.overdueVitals ? (
                        <div className="flex items-center gap-1 text-red-400 font-medium text-xs">
                          <AlertCircle className="h-3 w-3" /> Overdue &gt;4h
                        </div>
                      ) : (
                        <div className="text-zinc-300 font-medium text-xs">
                          Last: {row.lastVitalsTime ? format(new Date(row.lastVitalsTime), "HH:mm") : "N/A"}
                        </div>
                      )}
                    </div>

                    {/* Labs */}
                    <div className={`rounded-lg p-2.5 border ${row.pendingLabs > 0 ? 'bg-blue-500/10 border-blue-500/30' : 'bg-zinc-950/50 border-zinc-800/50'}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FlaskConical className={`h-3.5 w-3.5 ${row.pendingLabs > 0 ? 'text-blue-400' : 'text-zinc-500'}`} />
                        <span className={`text-[10px] uppercase font-bold tracking-wider ${row.pendingLabs > 0 ? 'text-blue-400' : 'text-zinc-500'}`}>Labs</span>
                      </div>
                      <div className={`font-medium text-xs ${row.pendingLabs > 0 ? 'text-blue-300' : 'text-zinc-600'}`}>
                        {row.pendingLabs > 0 ? `${row.pendingLabs} Processing` : 'All clear'}
                      </div>
                    </div>
                  </div>

                  {/* Meds & IVs */}
                  <div className="space-y-2">
                    {/* Meds */}
                    {row.pendingMeds.length > 0 ? (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-xs">
                        <div className="flex items-center gap-1.5 text-amber-500 font-bold uppercase tracking-wider text-[10px] mb-1">
                          <Syringe className="h-3 w-3" /> Meds Due
                        </div>
                        <div className="space-y-1">
                          {row.pendingMeds.slice(0, 2).map((m, i) => {
                            const isPast = new Date(m.time) < new Date();
                            return (
                              <div key={i} className="flex justify-between items-center text-amber-100/90">
                                <span className="truncate pr-2">{m.name}</span>
                                <span className={`font-mono shrink-0 ${isPast ? 'text-red-400 font-bold' : ''}`}>
                                  {format(new Date(m.time), "HH:mm")}
                                </span>
                              </div>
                            );
                          })}
                          {row.pendingMeds.length > 2 && (
                            <div className="text-[10px] text-amber-500/70 pt-0.5">+{row.pendingMeds.length - 2} more pending</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                        <Syringe className="h-3 w-3" /> No pending meds (next 2h)
                      </div>
                    )}

                    {/* IVs */}
                    {row.activeIVs.length > 0 && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 text-xs">
                         <div className="flex items-center gap-1.5 text-emerald-500 font-bold uppercase tracking-wider text-[10px] mb-1">
                          <Activity className="h-3 w-3" /> Active IV
                        </div>
                        <div className="space-y-1">
                          {row.activeIVs.map((iv, i) => (
                            <div key={i} className="flex justify-between items-center text-emerald-100/90">
                              <span className="truncate pr-2">{iv.name} <span className="text-emerald-500/70 text-[10px]">({iv.rate})</span></span>
                              {iv.end_at && (
                                <span className="font-mono text-[10px] shrink-0 text-emerald-500/70">
                                  End: {format(new Date(iv.end_at), "HH:mm")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default WardNursingBoard;
