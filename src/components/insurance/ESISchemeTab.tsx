import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ESIPatient {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  insurance_id: string | null;
  admission_id?: string;
  admission_status?: string;
  admitted_at?: string;
}

const CLAIM_CHECKLIST = [
  { item: "ESI Card / IP Number verified", form: "" },
  { item: "Dispensary referral letter (Form 10B)", form: "10B" },
  { item: "Treating doctor's certificate", form: "" },
  { item: "Discharge summary", form: "" },
  { item: "Bills and receipts attached", form: "" },
  { item: "Claim form (Form 14)", form: "14" },
  { item: "Lab reports attached", form: "" },
  { item: "Employer certificate (Form 9)", form: "9" },
];

const ESISchemeTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [patients, setPatients] = useState<ESIPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});
  const [ipNumber, setIpNumber] = useState("");
  const [dispensaryCode, setDispensaryCode] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<"patients" | "checklist" | "rates">("patients");

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const { data } = await supabase
      .from("patients")
      .select(`
        id, full_name, uhid, phone, insurance_id,
        admissions!admissions_patient_id_fkey(id, status, admitted_at)
      `)
      .eq("hospital_id", hospitalId)
      .eq("patient_category" as any, "esi")
      .order("full_name");

    const mapped: ESIPatient[] = (data || []).map((p: any) => {
      const activeAdm = (p.admissions || []).find((a: any) => a.status === "active");
      return {
        id: p.id,
        full_name: p.full_name,
        uhid: p.uhid,
        phone: p.phone,
        insurance_id: p.insurance_id,
        admission_id: activeAdm?.id,
        admission_status: activeAdm?.status,
        admitted_at: activeAdm?.admitted_at,
      };
    });

    setPatients(mapped);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const filtered = patients.filter(p =>
    !search || p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.uhid || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.insurance_id || "").includes(search)
  );

  const toggleCheck = (i: number) => setChecklist(prev => ({ ...prev, [i]: !prev[i] }));
  const checkedCount = Object.values(checklist).filter(Boolean).length;

  const ESI_RATES = [
    { procedure: "General Ward per day", rate: 1500 },
    { procedure: "Semi-Private per day", rate: 2500 },
    { procedure: "Private per day", rate: 4000 },
    { procedure: "ICU per day (without ventilator)", rate: 3300 },
    { procedure: "ICU per day (with ventilator)", rate: 4500 },
    { procedure: "OPD Consultation", rate: 0, note: "Free at ESI dispensary" },
    { procedure: "Appendectomy", rate: 16800 },
    { procedure: "Cholecystectomy (Laparoscopic)", rate: 22200 },
    { procedure: "LSCS / Caesarean", rate: 16200 },
    { procedure: "Normal Delivery", rate: 6000 },
    { procedure: "Total Hip Replacement", rate: 90000 },
    { procedure: "Total Knee Replacement", rate: 90000 },
    { procedure: "Cataract (Phaco)", rate: 10800 },
    { procedure: "PTCA Single Vessel", rate: 57000 },
    { procedure: "Dialysis (per session)", rate: 900 },
    { procedure: "Chemotherapy (per cycle)", rate: 7200 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold">ESI Scheme</span>
          <Badge variant="outline" className="text-[10px]">{patients.length} ESI Patients</Badge>
        </div>
        <div className="flex gap-1">
          {(["patients","checklist","rates"] as const).map(t => (
            <button key={t} onClick={() => setActiveSubTab(t)}
              className={cn("text-xs px-3 py-1 rounded-md font-medium transition-colors capitalize",
                activeSubTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t === "checklist" ? "Claim Checklist" : t === "rates" ? "ESI Rates" : "Patients"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeSubTab === "patients" && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, UHID, or ESI IP No." className="h-8 text-sm pl-8" />
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading ESI patients…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No ESI patients found.</p>
                <p className="text-xs mt-1">Register patients with category "ESI" to see them here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(p => (
                  <div key={p.id} className="border border-border rounded-lg px-3 py-2.5 flex items-center justify-between bg-card">
                    <div>
                      <p className="text-sm font-medium">{p.full_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {p.uhid} · ESI IP: {p.insurance_id || "Not recorded"}
                        {p.phone && ` · ${p.phone}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.admission_id ? (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Admitted</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">OPD</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeSubTab === "checklist" && (
          <div className="max-w-lg space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">ESI Claim Pre-submission Checklist</p>
              <p className="text-[11px] text-blue-600">Complete all items before submitting to ESIC branch office. Rate: CGHS General ward rates apply.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground font-medium block mb-1">ESI IP Number</label>
                <Input value={ipNumber} onChange={e => setIpNumber(e.target.value)}
                  placeholder="e.g. 1234567890" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground font-medium block mb-1">ESI Dispensary Code</label>
                <Input value={dispensaryCode} onChange={e => setDispensaryCode(e.target.value)}
                  placeholder="e.g. MH-42-001" className="h-8 text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              {CLAIM_CHECKLIST.map((item, i) => (
                <label key={i} className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <input type="checkbox" checked={!!checklist[i]} onChange={() => toggleCheck(i)}
                    className="mt-0.5 rounded accent-primary" />
                  <div>
                    <p className="text-sm">{item.item}</p>
                    {item.form && <p className="text-[10px] text-muted-foreground">Form {item.form}</p>}
                  </div>
                </label>
              ))}
            </div>

            <div className={cn("border rounded-lg p-3 text-center", checkedCount === CLAIM_CHECKLIST.length ? "border-emerald-200 bg-emerald-50" : "border-border bg-muted/30")}>
              <p className={cn("text-sm font-semibold", checkedCount === CLAIM_CHECKLIST.length ? "text-emerald-700" : "text-muted-foreground")}>
                {checkedCount}/{CLAIM_CHECKLIST.length} items complete
                {checkedCount === CLAIM_CHECKLIST.length && " — Ready to submit ✓"}
              </p>
            </div>
          </div>
        )}

        {activeSubTab === "rates" && (
          <div className="max-w-lg">
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg p-3 mb-3">
              <p className="text-[11px] text-amber-700 font-medium">ESI reimbursement = CGHS General Ward rates. Excess above CGHS rates is not reimbursable. Source: ESIC Circular 2023.</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b">
                  <th className="text-left pb-2 font-semibold">Procedure / Service</th>
                  <th className="text-right pb-2 font-semibold">ESI Rate (₹)</th>
                </tr>
              </thead>
              <tbody>
                {ESI_RATES.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2">
                      <p className="font-medium">{r.procedure}</p>
                      {r.note && <p className="text-[10px] text-muted-foreground">{r.note}</p>}
                    </td>
                    <td className="py-2 text-right font-mono font-semibold tabular-nums">
                      {r.rate > 0 ? `₹${r.rate.toLocaleString("en-IN")}` : "Free"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ESISchemeTab;
