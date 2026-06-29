import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Loader2, FlaskConical } from "lucide-react";

interface AntibioticCourse {
  id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  patient_name: string;
  admission_id: string;
  started_at: string;
  doctor_name: string | null;
  has_culture: boolean;
}

const ANTIBIOTIC_KEYWORDS = [
  "amoxicillin","amoxyclav","augmentin","ampicillin","piperacillin","tazobactam","cefazolin",
  "cephalexin","cefalexin","cefixime","cefuroxime","ceftriaxone","cefotaxime","ceftazidime",
  "cefepime","meropenem","imipenem","ertapenem","doripenem","azithromycin","clarithromycin",
  "erythromycin","metronidazole","tinidazole","ciprofloxacin","levofloxacin","ofloxacin",
  "norfloxacin","vancomycin","teicoplanin","linezolid","daptomycin","gentamicin","amikacin",
  "tobramycin","doxycycline","tetracycline","clindamycin","cotrimoxazole","sulfamethoxazole",
  "trimethoprim","nitrofurantoin","fosfomycin","colistin","polymyxin","rifampicin","ethambutol",
  "isoniazid","pyrazinamide","streptomycin","antibiotic","antimicrobial",
];

const isAntibiotic = (name: string) =>
  ANTIBIOTIC_KEYWORDS.some(k => name.toLowerCase().includes(k));

const AntibioticStewardshipTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [courses, setCourses] = useState<AntibioticCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const since = `${monthFilter}-01T00:00:00`;
    const until = new Date(new Date(since).getTime() + 32 * 86400000).toISOString().slice(0, 7) + "-01T00:00:00";

    const { data: meds } = await (supabase as any)
      .from("ipd_medications")
      .select(`
        id, drug_name, dose, frequency, created_at, admission_id,
        admissions!ipd_medications_admission_id_fkey(
          hospital_id, admitted_at,
          patients!admissions_patient_id_fkey(full_name),
          users!admissions_admitting_doctor_id_fkey(full_name)
        )
      `)
      .eq("admissions.hospital_id", hospitalId)
      .gte("created_at", since)
      .lt("created_at", until)
      .eq("is_active", true)
      .limit(500);

    const antibiotics = (meds || []).filter((m: any) => isAntibiotic(m.drug_name || ""));

    const admIds = [...new Set(antibiotics.map((m: any) => m.admission_id))];

    let cultureSet = new Set<string>();
    if (admIds.length > 0) {
      const { data: labs } = await (supabase as any)
        .from("lab_orders")
        .select("admission_id")
        .in("admission_id", admIds)
        .ilike("order_notes", "%culture%");
      (labs || []).forEach((l: any) => cultureSet.add(l.admission_id));
    }

    const mapped: AntibioticCourse[] = antibiotics.map((m: any) => ({
      id: m.id,
      drug_name: m.drug_name,
      dose: m.dose,
      frequency: m.frequency,
      patient_name: m.admissions?.patients?.full_name || "—",
      admission_id: m.admission_id,
      started_at: m.created_at,
      doctor_name: m.admissions?.users?.full_name || null,
      has_culture: cultureSet.has(m.admission_id),
    }));

    setCourses(mapped);
    setLoading(false);
  }, [hospitalId, monthFilter]);

  useEffect(() => { load(); }, [load]);

  const total = courses.length;
  const withCulture = courses.filter(c => c.has_culture).length;
  const cultureRate = total > 0 ? Math.round((withCulture / total) * 100) : 0;
  const uniquePatients = new Set(courses.map(c => c.admission_id)).size;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">Antibiotic Stewardship</span>
        </div>
        <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          className="h-7 text-xs border border-input rounded px-2 bg-background" />
        <span className="text-[11px] text-muted-foreground ml-auto">NABH OPE.5 · NMC Rational Prescribing</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b shrink-0">
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg p-3 text-center">
          <p className="text-[10px] text-blue-600 font-semibold uppercase">Antibiotic Courses</p>
          <p className="text-2xl font-bold text-blue-700">{total}</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 rounded-lg p-3 text-center">
          <p className="text-[10px] text-purple-600 font-semibold uppercase">Patients</p>
          <p className="text-2xl font-bold text-purple-700">{uniquePatients}</p>
        </div>
        <div className={`border rounded-lg p-3 text-center ${cultureRate >= 80 ? "bg-emerald-50 border-emerald-200" : cultureRate >= 50 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
          <p className={`text-[10px] font-semibold uppercase ${cultureRate >= 80 ? "text-emerald-600" : cultureRate >= 50 ? "text-amber-600" : "text-red-600"}`}>Culture Before Start</p>
          <p className={`text-2xl font-bold ${cultureRate >= 80 ? "text-emerald-700" : cultureRate >= 50 ? "text-amber-700" : "text-red-700"}`}>{cultureRate}%</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Target ≥ 80%</p>
        </div>
        <div className="bg-muted/50 border border-border rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase">Without Culture</p>
          <p className="text-2xl font-bold text-foreground">{total - withCulture}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Need review</p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Analysing prescriptions…</span>
          </div>
        ) : courses.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No antibiotic prescriptions found for selected month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b">
                <th className="text-left pb-2 font-semibold">Drug</th>
                <th className="text-left pb-2 font-semibold">Patient</th>
                <th className="text-left pb-2 font-semibold">Dose / Freq</th>
                <th className="text-left pb-2 font-semibold">Doctor</th>
                <th className="text-left pb-2 font-semibold">Started</th>
                <th className="text-left pb-2 font-semibold">Culture</th>
              </tr>
            </thead>
            <tbody>
              {courses.map(c => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 font-medium text-foreground">{c.drug_name}</td>
                  <td className="py-2 text-muted-foreground">{c.patient_name}</td>
                  <td className="py-2 text-muted-foreground">{[c.dose, c.frequency].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2 text-muted-foreground">{c.doctor_name ? `Dr. ${c.doctor_name.split(" ")[0]}` : "—"}</td>
                  <td className="py-2 text-muted-foreground tabular-nums text-[11px]">
                    {new Date(c.started_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="py-2">
                    {c.has_culture ? (
                      <span className="text-[10px] px-1.5 py-px rounded bg-emerald-100 text-emerald-700 font-medium">Culture ✓</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-px rounded bg-red-100 text-red-700 font-medium">No Culture</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AntibioticStewardshipTab;
