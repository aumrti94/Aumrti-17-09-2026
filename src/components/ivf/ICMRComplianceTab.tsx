import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Download, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { format } from "date-fns";

interface ArtCycle {
  id: string;
  cycle_number: string;
  couple_name: string;
  female_name: string;
  male_name: string;
  icmr_couple_id: string | null;
  procedure_type: string;
  cycle_start_date: string;
  outcome: string | null;
  embryos_transferred: number | null;
  embryos_frozen: number | null;
  sperm_source: string | null;
  oocyte_source: string | null;
  gestational_carrier: boolean | null;
  live_birth_date: string | null;
  birth_weight_grams: number | null;
  congenital_anomalies: string | null;
  icmr_submitted: boolean;
}

interface Props {
  // Uses hospitalId from hook
}

const ICMRComplianceTab: React.FC<Props> = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [cycles, setCycles] = useState<ArtCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("ivf_cycles")
      .select("id, cycle_number, cycle_start_date, outcome, procedure_type, embryos_transferred, embryos_frozen, sperm_source, oocyte_source, gestational_carrier, live_birth_date, birth_weight_grams, congenital_anomalies, icmr_submitted, ivf_couples!inner(icmr_couple_id, female_patient: patients!ivf_couples_female_patient_id_fkey(full_name), male_patient: patients!ivf_couples_male_patient_id_fkey(full_name))")
      .eq("hospital_id", hospitalId)
      .order("cycle_start_date", { ascending: false })
      .limit(200);

    const mapped: ArtCycle[] = (data || []).map((c: any) => ({
      id: c.id,
      cycle_number: c.cycle_number,
      couple_name: `${c.ivf_couples?.female_patient?.full_name || "?"} & ${c.ivf_couples?.male_patient?.full_name || "?"}`,
      female_name: c.ivf_couples?.female_patient?.full_name || "—",
      male_name: c.ivf_couples?.male_patient?.full_name || "—",
      icmr_couple_id: c.ivf_couples?.icmr_couple_id || null,
      procedure_type: c.procedure_type,
      cycle_start_date: c.cycle_start_date,
      outcome: c.outcome,
      embryos_transferred: c.embryos_transferred,
      embryos_frozen: c.embryos_frozen,
      sperm_source: c.sperm_source || "self",
      oocyte_source: c.oocyte_source || "self",
      gestational_carrier: c.gestational_carrier || false,
      live_birth_date: c.live_birth_date,
      birth_weight_grams: c.birth_weight_grams,
      congenital_anomalies: c.congenital_anomalies,
      icmr_submitted: c.icmr_submitted || false,
    }));

    setCycles(mapped);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const generateAnnualReport = async () => {
    if (!hospitalId) return;
    setGenerating(true);

    const yearCycles = cycles.filter((c) => new Date(c.cycle_start_date).getFullYear() === reportYear);

    if (yearCycles.length === 0) {
      toast({ title: `No cycles found for ${reportYear}` });
      setGenerating(false);
      return;
    }

    // Build ICMR ART Annual Report data structure per ART Act 2021 requirements
    const reportData = {
      report_year: reportYear,
      hospital_id: hospitalId,
      generated_at: new Date().toISOString(),
      total_cycles: yearCycles.length,
      procedure_breakdown: {
        ivf: yearCycles.filter(c => c.procedure_type === "ivf").length,
        icsi: yearCycles.filter(c => c.procedure_type === "icsi").length,
        iui: yearCycles.filter(c => c.procedure_type === "iui").length,
        fet: yearCycles.filter(c => c.procedure_type === "fet").length,
        donor_egg: yearCycles.filter(c => c.oocyte_source === "donor").length,
        donor_sperm: yearCycles.filter(c => c.sperm_source === "donor").length,
        surrogacy: yearCycles.filter(c => c.gestational_carrier).length,
      },
      outcomes: {
        clinical_pregnancy: yearCycles.filter(c => c.outcome === "clinical_pregnancy" || c.outcome === "live_birth").length,
        live_births: yearCycles.filter(c => c.outcome === "live_birth").length,
        cancelled: yearCycles.filter(c => c.outcome === "cancelled").length,
        miscarriage: yearCycles.filter(c => c.outcome === "miscarriage").length,
        ongoing: yearCycles.filter(c => !c.outcome || c.outcome === "ongoing").length,
      },
      pregnancy_rate: yearCycles.length > 0
        ? Math.round((yearCycles.filter(c => c.outcome === "clinical_pregnancy" || c.outcome === "live_birth").length / yearCycles.length) * 100)
        : 0,
      live_birth_rate: yearCycles.length > 0
        ? Math.round((yearCycles.filter(c => c.outcome === "live_birth").length / yearCycles.length) * 100)
        : 0,
      neonatal_outcomes: {
        total_babies: yearCycles.filter(c => c.live_birth_date).length,
        with_congenital_anomalies: yearCycles.filter(c => c.congenital_anomalies && c.congenital_anomalies !== "none").length,
      },
      cycle_details: yearCycles.map(c => ({
        icmr_couple_id: c.icmr_couple_id,
        cycle_number: c.cycle_number,
        procedure: c.procedure_type,
        start_date: c.cycle_start_date,
        outcome: c.outcome,
        embryos_transferred: c.embryos_transferred,
        embryos_frozen: c.embryos_frozen,
        sperm_source: c.sperm_source,
        oocyte_source: c.oocyte_source,
        gestational_carrier: c.gestational_carrier,
        live_birth_date: c.live_birth_date,
        birth_weight_g: c.birth_weight_grams,
        congenital_anomalies: c.congenital_anomalies,
      })),
    };

    // Save to HMIS reports table for record-keeping
    await (supabase as any).from("hmis_reports").insert({
      hospital_id: hospitalId,
      report_type: "icmr_art_annual",
      period_year: reportYear,
      status: "generated",
      generated_at: new Date().toISOString(),
      report_data: reportData,
    });

    // Mark cycles as submitted
    const cycleIds = yearCycles.map(c => c.id);
    await (supabase as any).from("ivf_cycles").update({ icmr_submitted: true }).in("id", cycleIds);

    // Download as JSON (ICMR submission format)
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ICMR_ART_Annual_Report_${reportYear}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: `ICMR ART Annual Report ${reportYear} generated`, description: `${yearCycles.length} cycles included. Download started.` });
    setGenerating(false);
    load();
  };

  const pendingCount = cycles.filter(c => !c.icmr_couple_id).length;
  const unsubmittedCount = cycles.filter(c => !c.icmr_submitted).length;

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* ICMR Compliance Status */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-xl border p-3 ${pendingCount > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
          <div className="flex items-center gap-2">
            {pendingCount > 0 ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
            <span className={`text-sm font-bold ${pendingCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>
              {pendingCount > 0 ? `${pendingCount} couples missing ICMR ID` : "All couples have ICMR IDs"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">ICMR Couple ID required under ART Act 2021 Rule 5(2)</p>
        </div>
        <div className={`rounded-xl border p-3 ${unsubmittedCount > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
          <div className="flex items-center gap-2">
            {unsubmittedCount > 0 ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
            <span className={`text-sm font-bold ${unsubmittedCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>
              {unsubmittedCount > 0 ? `${unsubmittedCount} cycles pending ICMR report` : "All cycles reported"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Annual ART Act 2021 report due by 31 March each year</p>
        </div>
      </div>

      {/* Annual Report Generator */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-primary" />
          <div>
            <p className="text-sm font-bold">ICMR ART Annual Registry Report</p>
            <p className="text-xs text-muted-foreground">ART Act 2021 — Section 25 Annual Submission to ICMR</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={reportYear}
            onChange={(e) => setReportYear(parseInt(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button size="sm" className="gap-1.5" onClick={generateAnnualReport} disabled={generating}>
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {generating ? "Generating..." : "Generate & Download"}
          </Button>
        </div>
      </div>

      {/* Cycle list */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-[10px] font-bold uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Cycle</th>
              <th className="px-3 py-2 text-left">Couple</th>
              <th className="px-3 py-2 text-left">ICMR ID</th>
              <th className="px-3 py-2 text-center">Procedure</th>
              <th className="px-3 py-2 text-center">Date</th>
              <th className="px-3 py-2 text-center">Outcome</th>
              <th className="px-3 py-2 text-center">Gametes</th>
              <th className="px-3 py-2 text-center">ICMR Submitted</th>
            </tr>
          </thead>
          <tbody>
            {cycles.slice(0, 50).map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 text-xs font-mono font-bold">{c.cycle_number}</td>
                <td className="px-3 py-2 text-xs">{c.couple_name}</td>
                <td className="px-3 py-2 text-xs">
                  {c.icmr_couple_id ? (
                    <span className="font-mono text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">{c.icmr_couple_id}</span>
                  ) : (
                    <Badge variant="outline" className="text-[9px] border-amber-300 bg-amber-50 text-amber-700">
                      <AlertTriangle size={8} className="mr-1" /> Missing
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Badge variant="outline" className="text-[9px] uppercase">{c.procedure_type}</Badge>
                </td>
                <td className="px-3 py-2 text-center text-xs">{format(new Date(c.cycle_start_date), "dd/MM/yyyy")}</td>
                <td className="px-3 py-2 text-center">
                  <Badge variant="outline" className="text-[9px] capitalize">
                    {c.outcome || "ongoing"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                  {[c.sperm_source !== "self" && `Donor sperm`, c.oocyte_source !== "self" && `Donor oocyte`, c.gestational_carrier && `Surrogate`].filter(Boolean).join(", ") || "Own"}
                </td>
                <td className="px-3 py-2 text-center">
                  {c.icmr_submitted
                    ? <CheckCircle2 size={14} className="text-emerald-600 mx-auto" />
                    : <span className="text-[10px] text-muted-foreground">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ICMRComplianceTab;
