import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User, ArrowLeft, Activity, Pill, FlaskConical, Stethoscope,
  BedDouble, Heart, AlertTriangle, RefreshCw, Calendar, ClipboardList, ShieldCheck,
} from "lucide-react";
import ABHASearchPanel from "@/components/patients/ABHASearchPanel";
import ABHARegistrationPanel from "@/components/abdm/ABHARegistrationPanel";
import ABHABadge from "@/components/abdm/ABHABadge";
import ABDMCareContextsPanel from "@/components/abdm/ABDMCareContextsPanel";
import ConsentStatusBanner from "@/components/abdm/ConsentStatusBanner";
import { cn } from "@/lib/utils";

interface DiagnosisHistoryItem {
  id: string;
  diagnosis_text: string;
  icd10_code: string | null;
  icd10_description: string | null;
  is_primary: boolean | null;
  diagnosis_type: string | null;
  created_at: string;
  opd_encounters: { visit_date: string; chief_complaint: string | null } | null;
}

interface Patient {
  id: string; full_name: string; uhid: string; dob: string | null;
  gender: string | null; phone: string | null; blood_group: string | null;
  allergy_history: string | null; hospital_id?: string; abha_id?: string | null;
}

interface TimelineEvent {
  id: string; type: "opd" | "ipd" | "lab" | "prescription" | "radiology";
  date: string; summary: string; detail?: string; status?: string;
}

function calcAge(dob: string | null) {
  if (!dob) return "—";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000)}y`;
}

const TYPE_ICONS = {
  opd: { icon: Stethoscope, color: "text-blue-600", bg: "bg-blue-50" },
  ipd: { icon: BedDouble, color: "text-purple-600", bg: "bg-purple-50" },
  lab: { icon: FlaskConical, color: "text-emerald-600", bg: "bg-emerald-50" },
  prescription: { icon: Pill, color: "text-orange-600", bg: "bg-orange-50" },
  radiology: { icon: Activity, color: "text-teal-600", bg: "bg-teal-50" },
};

const PatientSummaryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [vitals, setVitals] = useState<any>(null);
  const [activeMeds, setActiveMeds] = useState<string[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [diagnosisHistory, setDiagnosisHistory] = useState<DiagnosisHistoryItem[]>([]);
  const [aiContext, setAiContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { if (id) load(id); }, [id]);

  const load = async (patientId: string) => {
    setLoading(true);
    const [
      { data: p },
      { data: encounters },
      { data: admissions },
      { data: labs },
      { data: rxRows },
      { data: tokens },
      { data: ctx },
      { data: diagData },
    ] = await Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
      (supabase as any).from("opd_encounters").select("id,chief_complaint,diagnosis,icd10_code,created_at,status").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20),
      (supabase as any).from("admissions").select("id,admitted_at,discharged_at,status,final_diagnosis,ward_id").eq("patient_id", patientId).order("admitted_at", { ascending: false }).limit(10),
      (supabase as any).from("lab_order_items").select("id,test_name,result_value,reference_range,resulted_at,lab_orders!inner(created_at,patient_id)").eq("lab_orders.patient_id", patientId).order("lab_orders.created_at", { ascending: false }).limit(30),
      (supabase as any).from("prescriptions").select("id,items,created_at").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(5),
      (supabase as any).from("opd_tokens").select("id,visit_date,token_number,doctor_id,status").eq("patient_id", patientId).gte("visit_date", new Date().toISOString().slice(0, 10)).neq("status", "cancelled").limit(3),
      (supabase as any).from("patient_ai_context").select("*").eq("patient_id", patientId).maybeSingle(),
      (supabase as any).from("opd_diagnoses").select("id,diagnosis_text,icd10_code,icd10_description,is_primary,diagnosis_type,created_at,opd_encounters(visit_date,chief_complaint)").eq("patient_id", patientId).in("diagnosis_type", ["confirmed", "chronic", "comorbid"]).order("created_at", { ascending: false }).limit(30),
    ]);

    setPatient(p);
    setAiContext(ctx);
    setDiagnosisHistory(diagData || []);
    setUpcoming(tokens || []);

    // Build timeline
    const events: TimelineEvent[] = [];
    for (const e of (encounters || [])) {
      events.push({ id: e.id, type: "opd", date: e.created_at, summary: e.diagnosis || e.chief_complaint || "OPD Visit", detail: e.chief_complaint, status: e.status });
    }
    for (const a of (admissions || [])) {
      events.push({ id: a.id, type: "ipd", date: a.admitted_at, summary: a.final_diagnosis || "IPD Admission", detail: a.discharged_at ? `Discharged ${new Date(a.discharged_at).toLocaleDateString("en-IN")}` : "Active", status: a.status });
    }
    for (const l of (labs || [])) {
      events.push({ id: l.id, type: "lab", date: l.resulted_at || l.lab_orders?.created_at, summary: `${l.test_name}: ${l.result_value || "Pending"}`, detail: l.reference_range });
    }
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setTimeline(events);

    // Active medications from most recent Rx
    const meds: string[] = [];
    for (const rx of (rxRows || []).slice(0, 2)) {
      for (const item of (rx.items || [])) {
        if (item.drug_name && !meds.includes(item.drug_name)) meds.push(item.drug_name);
      }
    }
    setActiveMeds(meds);
    setLoading(false);
  };

  const refreshContext = async () => {
    if (!id || !patient) return;
    setRefreshing(true);
    const hospitalRes = await (supabase as any).from("patients").select("hospital_id").eq("id", id).maybeSingle();
    const hospitalId = hospitalRes?.data?.hospital_id;
    if (hospitalId) {
      await supabase.functions.invoke("update-patient-ai-context", { body: { patient_id: id, hospital_id: hospitalId } });
      const { data } = await (supabase as any).from("patient_ai_context").select("*").eq("patient_id", id).maybeSingle();
      setAiContext(data);
    }
    setRefreshing(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading 360° view...</div>;
  }

  if (!patient) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Patient not found.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3 border-b bg-card flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">{patient.full_name}</p>
            <Badge variant="secondary" className="text-[10px]">{patient.uhid}</Badge>
            {patient.blood_group && <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-700">{patient.blood_group}</Badge>}
            <ABHABadge abhaNumber={patient.abha_id} size="md" />
          </div>
          <p className="text-xs text-muted-foreground">
            {calcAge(patient.dob)} · {patient.gender || "—"} · {patient.phone || "No phone"}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={refreshContext} disabled={refreshing}>
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
          Refresh AI Context
        </Button>
      </div>

      {/* Allergy banner */}
      {patient.allergy_history && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-red-50 border-b border-red-200">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          <p className="text-xs text-red-700 font-medium">Allergy: {patient.allergy_history}</p>
        </div>
      )}

      <ConsentStatusBanner patientId={patient.id} />

      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="overview" className="flex flex-col h-full">
          <TabsList className="shrink-0 justify-start rounded-none border-b bg-card h-9 px-5 w-full">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
            <TabsTrigger value="ai_context" className="text-xs">AI Context</TabsTrigger>
            <TabsTrigger value="abha" className="text-xs flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              ABHA
              {patient.abha_id && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />}
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="flex-1 overflow-auto p-5 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Active Meds */}
              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <Pill className="h-4 w-4 text-orange-500" />
                  <span className="text-xs font-semibold">Active Medications</span>
                </div>
                {activeMeds.length === 0
                  ? <p className="text-xs text-muted-foreground">None recorded</p>
                  : activeMeds.map((m, i) => <p key={i} className="text-xs py-0.5 border-b last:border-0">{m}</p>)
                }
              </div>

              {/* Upcoming */}
              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  <span className="text-xs font-semibold">Upcoming Appointments</span>
                </div>
                {upcoming.length === 0
                  ? <p className="text-xs text-muted-foreground">None scheduled</p>
                  : upcoming.map((t: any) => (
                    <div key={t.id} className="text-xs py-1 border-b last:border-0">
                      <p className="font-medium">Token #{t.token_number}</p>
                      <p className="text-muted-foreground">{new Date(t.visit_date).toLocaleDateString("en-IN")}</p>
                    </div>
                  ))
                }
              </div>

              {/* Chronic conditions */}
              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-semibold">Chronic Conditions</span>
                </div>
                {(aiContext?.chronic_conditions || []).length === 0
                  ? <p className="text-xs text-muted-foreground">None recorded</p>
                  : (aiContext.chronic_conditions as string[]).map((c, i) => (
                    <Badge key={i} variant="secondary" className="mr-1 mb-1 text-[10px]">{c}</Badge>
                  ))
                }
              </div>
            </div>

            {/* Diagnosis History */}
            {diagnosisHistory.length > 0 && (
              <div className="border rounded-lg p-4 bg-card mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <ClipboardList className="h-4 w-4 text-indigo-500" />
                  <span className="text-xs font-semibold">Diagnosis History</span>
                  <Badge variant="secondary" className="text-[10px]">{diagnosisHistory.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {diagnosisHistory.map((d) => (
                    <div key={d.id} className="flex items-start gap-2 py-1 border-b last:border-0">
                      {d.is_primary && <span className="text-yellow-500 text-[10px] mt-0.5">★</span>}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{d.diagnosis_text}</p>
                        {d.icd10_code && (
                          <p className="text-[10px] text-muted-foreground font-mono">{d.icd10_code}{d.icd10_description ? ` — ${d.icd10_description}` : ""}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {d.diagnosis_type && (
                          <Badge variant="secondary" className={cn("text-[9px] capitalize", {
                            "bg-green-50 text-green-700": d.diagnosis_type === "confirmed",
                            "bg-purple-50 text-purple-700": d.diagnosis_type === "chronic",
                            "bg-blue-50 text-blue-700": d.diagnosis_type === "comorbid",
                          })}>{d.diagnosis_type}</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(d.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Timeline */}
          <TabsContent value="timeline" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full px-5 py-3">
              <div className="space-y-2">
                {timeline.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-8">No records found.</p>
                  : timeline.map(event => {
                    const t = TYPE_ICONS[event.type];
                    const Icon = t.icon;
                    return (
                      <div key={event.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                        <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", t.bg)}>
                          <Icon className={cn("h-3.5 w-3.5", t.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{event.summary}</p>
                          {event.detail && <p className="text-[10px] text-muted-foreground">{event.detail}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(event.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                        </span>
                      </div>
                    );
                  })
                }
              </div>
            </ScrollArea>
          </TabsContent>

          {/* AI Context */}
          <TabsContent value="ai_context" className="flex-1 overflow-auto p-5 mt-0">
            {!aiContext
              ? (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground mb-3">No AI context generated yet.</p>
                  <Button size="sm" onClick={refreshContext} disabled={refreshing}>
                    <RefreshCw className={cn("h-3.5 w-3.5 mr-1", refreshing && "animate-spin")} />
                    Generate AI Context
                  </Button>
                </div>
              )
              : (
                <div className="space-y-4 max-w-2xl">
                  <div className="border rounded-lg p-4 bg-muted/30">
                    <p className="text-xs font-semibold mb-2">Clinical Summary</p>
                    <p className="text-sm">{aiContext.context_summary || "—"}</p>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Last updated: {aiContext.last_updated ? new Date(aiContext.last_updated).toLocaleString("en-IN") : "—"}
                    </p>
                  </div>
                  {[
                    { label: "Known Allergies", items: aiContext.known_allergies, color: "bg-red-50 text-red-700" },
                    { label: "Current Medications", items: aiContext.current_medications, color: "bg-orange-50 text-orange-700" },
                    { label: "Chronic Conditions", items: aiContext.chronic_conditions, color: "bg-purple-50 text-purple-700" },
                    { label: "Recent Diagnoses", items: aiContext.recent_diagnoses, color: "bg-blue-50 text-blue-700" },
                    { label: "Risk Flags", items: aiContext.risk_flags, color: "bg-amber-50 text-amber-700" },
                  ].map(({ label, items, color }) => (items?.length > 0) && (
                    <div key={label}>
                      <p className="text-xs font-semibold mb-1.5">{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(items as string[]).map((item, i) => (
                          <Badge key={i} variant="secondary" className={cn("text-xs", color)}>{item}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </TabsContent>

          {/* ABHA tab */}
          <TabsContent value="abha" className="flex-1 overflow-auto p-5 mt-0">
            <div className="max-w-lg space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <div>
                  <h3 className="text-sm font-bold">Ayushman Bharat Health Account (ABHA)</h3>
                  <p className="text-xs text-muted-foreground">Link or create ABHA for ABDM health record sharing</p>
                </div>
              </div>
              {patient.hospital_id ? (
                patient.abha_id ? (
                  /* Already linked — show manage panel + care contexts */
                  <>
                    <ABHASearchPanel
                      patientId={patient.id}
                      hospitalId={patient.hospital_id}
                      existingAbhaId={patient.abha_id}
                      onLinked={(abhaId) => setPatient((prev) => prev ? { ...prev, abha_id: abhaId } : prev)}
                      onUnlinked={() => setPatient((prev) => prev ? { ...prev, abha_id: null } : prev)}
                    />
                    <div className="border-t pt-4">
                      <ABDMCareContextsPanel
                        patientId={patient.id}
                        hospitalId={patient.hospital_id}
                      />
                    </div>
                  </>
                ) : (
                  /* Not linked — show full creation wizard */
                  <ABHARegistrationPanel
                    patientId={patient.id}
                    patientName={patient.full_name}
                    patientMobile={patient.phone ?? ""}
                    onComplete={(abhaNumber, abhaAddress) =>
                      setPatient((prev) =>
                        prev ? { ...prev, abha_id: abhaNumber || abhaAddress } : prev,
                      )
                    }
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">Loading hospital context…</p>
              )}
            </div>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
};

export default PatientSummaryPage;
