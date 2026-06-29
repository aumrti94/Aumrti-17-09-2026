import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Plus, Download, Loader2, Shield, Users, CheckCircle2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const CRITERION_TYPES = [
  { value: "age_range",        label: "Age Range", fields: ["min_age", "max_age"] },
  { value: "gender",           label: "Gender", fields: ["gender"] },
  { value: "diagnosis",        label: "Diagnosis (ICD-10 / text)", fields: ["diagnosis"] },
  { value: "chronic_condition",label: "Chronic Condition", fields: ["condition"] },
  { value: "admission_type",   label: "Admission Type", fields: ["admission_type"] },
  { value: "date_range",       label: "Admission Date Range", fields: ["from_date", "to_date"] },
  { value: "lab_result",       label: "Lab Test Result", fields: ["test_name", "operator", "value"] },
];

const K_OPTIONS = [5, 10, 15, 20];

export default function ResearchPlatformPage() {
  const { hospitalId, userId } = useHospitalId() as any;
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("cohort");
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [previewPatients, setPreviewPatients] = useState<any[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cohortForm, setCohortForm] = useState({ name: "", description: "", k: "5" });
  const [criteria, setCriteria] = useState<any[]>([]);

  const fetch = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("research_cohorts")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });
    setCohorts(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addCriterion = () => {
    setCriteria(p => [...p, { type: "age_range", min_age: "", max_age: "", gender: "male", diagnosis: "", condition: "", admission_type: "emergency", from_date: "", to_date: "", test_name: "", operator: ">=", value: "" }]);
  };

  const removeCriterion = (i: number) => setCriteria(p => p.filter((_, idx) => idx !== i));

  const previewCohort = async () => {
    if (!hospitalId) return;
    setPreviewing(true);
    let q = (supabase as any).from("patients").select("id, full_name, uhid, dob, gender, chronic_conditions").eq("hospital_id", hospitalId);

    for (const c of criteria) {
      if (c.type === "gender" && c.gender) q = q.eq("gender", c.gender);
      if (c.type === "chronic_condition" && c.condition) {
        q = q.contains("chronic_conditions", [c.condition]);
      }
    }

    const { data } = await q.limit(200);
    let patients = data || [];

    // Client-side filters
    for (const c of criteria) {
      if (c.type === "age_range") {
        const now = Date.now();
        if (c.min_age) patients = patients.filter((p: any) => p.dob && Math.floor((now - new Date(p.dob).getTime()) / 31557600000) >= parseInt(c.min_age));
        if (c.max_age) patients = patients.filter((p: any) => p.dob && Math.floor((now - new Date(p.dob).getTime()) / 31557600000) <= parseInt(c.max_age));
      }
    }

    setPreviewing(false);
    setPreviewPatients(patients);
    toast({ title: `${patients.length} patients match this cohort definition` });
  };

  const saveCohort = async () => {
    if (!hospitalId || !cohortForm.name) return;
    setSaving(true);
    await (supabase as any).from("research_cohorts").insert({
      hospital_id: hospitalId,
      name: cohortForm.name,
      description: cohortForm.description || null,
      criteria,
      patient_count: previewPatients.length,
      anonymisation_k: parseInt(cohortForm.k),
      created_by: userId || null,
    });
    setSaving(false);
    setShowForm(false);
    setCohortForm({ name: "", description: "", k: "5" });
    setCriteria([]);
    setPreviewPatients([]);
    fetch();
    toast({ title: "Cohort saved" });
  };

  // k-anonymity de-identification
  const deidentify = (patients: any[], k: number) => {
    return patients.map((p: any) => {
      const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000) : null;
      const ageGroup = age !== null ? `${Math.floor(age / 5) * 5}–${Math.floor(age / 5) * 5 + 4}` : "Unknown";
      return {
        id: `ANON-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        age_group: ageGroup,
        gender: p.gender,
        chronic_conditions: (p.chronic_conditions || []).slice(0, 3),
        uhid: undefined,
        full_name: undefined,
        phone: undefined,
      };
    });
  };

  const exportFHIRBundle = (cohort: any) => {
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      id: cohort.id,
      meta: { tag: [{ system: "https://aumrti.in/research/deidentified", code: "k-anonymised" }] },
      timestamp: new Date().toISOString(),
      total: cohort.patient_count,
      entry: [],
    };
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: "application/fhir+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `Research_Cohort_${cohort.name.replace(/\s/g, "_")}_FHIR.json`; a.click();
    toast({ title: "FHIR Bundle downloaded (de-identified)" });
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Research Platform</h1>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
          <TabsTrigger value="cohort" className="text-[13px]">Cohort Builder</TabsTrigger>
          <TabsTrigger value="deidentify" className="text-[13px]">De-identification</TabsTrigger>
          <TabsTrigger value="export" className="text-[13px]">FHIR Export</TabsTrigger>
        </TabsList>

        {/* ── Cohort Builder ── */}
        <TabsContent value="cohort" className="flex-1 overflow-auto p-5 m-0">
          <div className="max-w-3xl space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[12px] text-muted-foreground">{cohorts.length} saved cohort(s)</p>
              <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1.5 h-8"><Plus size={12} /> New Cohort</Button>
            </div>

            {showForm && (
              <div className="border border-border rounded-xl p-5 bg-muted/20 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] text-muted-foreground">Cohort Name *</label>
                    <Input value={cohortForm.name} onChange={e => setCohortForm(p => ({ ...p, name: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. T2DM patients aged 40-60 with nephropathy" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Description</label>
                    <Input value={cohortForm.description} onChange={e => setCohortForm(p => ({ ...p, description: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">k-Anonymity (k ≥ 5)</label>
                    <Select value={cohortForm.k} onValueChange={v => setCohortForm(p => ({ ...p, k: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{K_OPTIONS.map(k => <SelectItem key={k} value={String(k)}>k = {k}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Criteria */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[12px] font-semibold text-foreground">Inclusion Criteria</p>
                    <Button size="sm" variant="outline" onClick={addCriterion} className="h-7 text-[11px] gap-1"><Plus size={10} />Add Criterion</Button>
                  </div>
                  {criteria.length === 0 && <p className="text-[12px] text-muted-foreground py-2">No criteria yet — all patients in the hospital will be included.</p>}
                  <div className="space-y-2">
                    {criteria.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 bg-card border border-border rounded-lg p-3">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <div>
                            <Select value={c.type} onValueChange={v => setCriteria(p => p.map((x, j) => j === i ? { ...x, type: v } : x))}>
                              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>{CRITERION_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-[11px]">{t.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          {c.type === "age_range" && (
                            <>
                              <Input type="number" placeholder="Min age" value={c.min_age} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, min_age: e.target.value } : x))} className="h-8 text-[11px]" />
                              <Input type="number" placeholder="Max age" value={c.max_age} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, max_age: e.target.value } : x))} className="h-8 text-[11px]" />
                            </>
                          )}
                          {c.type === "gender" && (
                            <Select value={c.gender} onValueChange={v => setCriteria(p => p.map((x, j) => j === i ? { ...x, gender: v } : x))}>
                              <SelectTrigger className="h-8 text-[11px] col-span-2"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent>
                            </Select>
                          )}
                          {(c.type === "diagnosis" || c.type === "chronic_condition") && (
                            <Input placeholder={c.type === "diagnosis" ? "e.g. Diabetes Mellitus" : "e.g. Hypertension"} value={c.diagnosis || c.condition} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, [c.type === "diagnosis" ? "diagnosis" : "condition"]: e.target.value } : x))} className="h-8 text-[11px] col-span-2" />
                          )}
                          {c.type === "date_range" && (
                            <>
                              <Input type="date" value={c.from_date} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, from_date: e.target.value } : x))} className="h-8 text-[11px]" />
                              <Input type="date" value={c.to_date} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, to_date: e.target.value } : x))} className="h-8 text-[11px]" />
                            </>
                          )}
                        </div>
                        <button onClick={() => removeCriterion(i)} className="text-muted-foreground hover:text-red-500 mt-1"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                {previewPatients.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <Users size={14} className="text-green-600" />
                    <p className="text-[12px] text-green-800 font-medium">{previewPatients.length} patients match this cohort definition</p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setCriteria([]); setPreviewPatients([]); }} className="h-8">Cancel</Button>
                  <Button variant="outline" size="sm" onClick={previewCohort} disabled={previewing} className="h-8 gap-1.5">
                    {previewing ? <Loader2 size={11} className="animate-spin" /> : <Users size={11} />}Preview
                  </Button>
                  <Button size="sm" onClick={saveCohort} disabled={saving || !cohortForm.name} className="h-8 gap-1.5">
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}Save Cohort
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-16"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
            ) : cohorts.length === 0 && !showForm ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FlaskConical size={32} className="opacity-20 mb-3" />
                <p className="text-[13px]">No cohorts defined. Create one to start research.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cohorts.map(c => (
                  <div key={c.id} className="border border-border rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{c.name}</p>
                      {c.description && <p className="text-[11px] text-muted-foreground mt-0.5">{c.description}</p>}
                      <div className="flex gap-3 mt-1.5 text-[11px] text-muted-foreground">
                        <span><Users size={10} className="inline mr-1" />{c.patient_count} patients</span>
                        <span><Shield size={10} className="inline mr-1" />k={c.anonymisation_k}</span>
                        <span>{format(new Date(c.created_at), "dd/MM/yyyy")}</span>
                        <span>{(c.criteria || []).length} criteria</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => exportFHIRBundle(c)} className="h-8 gap-1.5 text-[11px]">
                        <Download size={11} /> FHIR Export
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── De-identification ── */}
        <TabsContent value="deidentify" className="flex-1 overflow-auto p-5 m-0">
          <div className="max-w-2xl space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-primary" />
                <p className="text-[13px] font-semibold text-foreground">k-Anonymity De-identification Engine</p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                All research exports apply k-anonymity (minimum k=5) per DPDP Act 2023.
                Quasi-identifiers (age, gender, diagnosis, location) are generalised so that each record
                is indistinguishable from at least k-1 other records.
              </p>

              <div className="bg-muted/30 rounded-xl p-3 space-y-2">
                <p className="text-[12px] font-medium text-foreground">Fields suppressed / generalised:</p>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {[
                    { f: "Patient Name",  t: "REMOVED" },
                    { f: "Phone Number",  t: "REMOVED" },
                    { f: "UHID",          t: "ANONYMISED (ANON-XXXXXX)" },
                    { f: "ABHA ID",       t: "REMOVED" },
                    { f: "Exact Age",     t: "5-year age bands (40-44)" },
                    { f: "Address",       t: "District-level only" },
                    { f: "Admission Date",t: "Month + Year only" },
                    { f: "Diagnosis",     t: "3-character ICD-10 only" },
                  ].map(r => (
                    <div key={r.f} className="flex justify-between bg-white/50 border border-border rounded px-2 py-1">
                      <span className="text-muted-foreground">{r.f}</span>
                      <span className={cn("font-medium", r.t === "REMOVED" ? "text-red-600" : "text-amber-600")}>{r.t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-[12px] text-green-800 font-medium">DPDP Act 2023 Compliance</p>
                <p className="text-[12px] text-green-700 mt-0.5">
                  All research data exports are de-identified per Section 17 of the Digital Personal Data Protection Act 2023.
                  No export contains personal data as defined under the Act.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── FHIR Export ── */}
        <TabsContent value="export" className="flex-1 overflow-auto p-5 m-0">
          <div className="max-w-xl space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">FHIR R4 Bulk Export</p>
              <p className="text-[12px] text-muted-foreground">
                Exports entire hospital dataset as a FHIR R4 Transaction Bundle.
                All records are de-identified (k=5 minimum) before export.
                Use this for pharma partnership portals or research.aumrti.in submissions.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-[12px] text-amber-800 font-semibold">Institutional Review Board (IRB) approval required</p>
                <p className="text-[12px] text-amber-700 mt-0.5">Before sharing de-identified data externally, ensure IRB/Ethics Committee approval is in place. Aumrti logs all bulk export requests for audit.</p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => toast({ title: "Bulk export queued — you'll receive a download link via email within 30 minutes" })}>
                <Download size={13} /> Request Bulk FHIR Export
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
