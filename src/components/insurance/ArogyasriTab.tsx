import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Search, Plus, CheckCircle2, Clock, XCircle, IndianRupee } from "lucide-react";

const STATES = ["Telangana", "Andhra Pradesh", "Karnataka", "Tamil Nadu"];
const SCHEMES = [
  "Aarogyasri (Telangana)",
  "Dr. YSR Aarogyasri (AP)",
  "Ayushman Bharat - PMJAY",
  "Amma Vodi",
  "Arogya Karnataka",
  "Chief Minister's Comprehensive Health Insurance (TN)",
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  partially_approved: "bg-orange-100 text-orange-700",
  settled: "bg-emerald-100 text-emerald-700",
};

interface Enrollment {
  id: string;
  patient_id: string;
  enrollment_id: string;
  scheme_name: string | null;
  district: string | null;
  state: string | null;
  aadhar_linked: boolean;
  status: string;
  valid_till: string | null;
  patients?: { full_name: string; uhid: string } | null;
}

interface Claim {
  id: string;
  patient_id: string;
  scheme_type: string;
  claim_number: string | null;
  claimed_amount: number;
  approved_amount: number | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
  patients?: { full_name: string; uhid: string } | null;
}

const ArogyasriTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<"enrollments" | "claims" | "enroll_new">("enrollments");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Enrollment form
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [schemeName, setSchemeName] = useState(SCHEMES[0]);
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("Telangana");
  const [aadharLinked, setAadharLinked] = useState(false);
  const [familyUnitId, setFamilyUnitId] = useState("");
  const [validTill, setValidTill] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [{ data: enr }, { data: clm }] = await Promise.all([
      (supabase as any)
        .from("arogyasri_enrollments")
        .select("*, patients(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("govt_scheme_claims")
        .select("*, patients(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .in("scheme_type", ["Arogyasri", "PMJAY", "state_scheme"])
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setEnrollments(enr || []);
    setClaims(clm || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const searchPatients = async () => {
    if (!hospitalId || patientSearch.trim().length < 2) return;
    const { data } = await (supabase as any)
      .from("patients")
      .select("id, full_name, uhid, phone")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${patientSearch}%,uhid.ilike.%${patientSearch}%`)
      .limit(8);
    setPatientResults(data || []);
  };

  const saveEnrollment = async () => {
    if (!hospitalId || !selectedPatient || !enrollmentId.trim()) {
      toast({ title: "Required fields missing", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("arogyasri_enrollments").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      enrollment_id: enrollmentId.trim(),
      scheme_name: schemeName,
      district: district || null,
      state,
      aadhar_linked: aadharLinked,
      family_unit_id: familyUnitId || null,
      valid_till: validTill || null,
      status: "active",
    });
    if (error) { toast({ title: error.message, variant: "destructive" }); setSaving(false); return; }
    toast({ title: "Enrollment saved" });
    setSelectedPatient(null); setEnrollmentId(""); setPatientSearch(""); setPatientResults([]);
    setSaving(false);
    setSubTab("enrollments");
    load();
  };

  const filtered = enrollments.filter(e =>
    !search || e.enrollment_id.toLowerCase().includes(search.toLowerCase()) ||
    e.patients?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    e.patients?.uhid?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 py-3 border-b bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Arogyasri / State Schemes</h2>
            <p className="text-xs text-muted-foreground">Aarogyasri (TS/AP), PMJAY, CM Health Insurance, Arogya Karnataka</p>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setSubTab("enroll_new")}>
            <Plus className="h-3.5 w-3.5" /> Enroll Patient
          </Button>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={v => setSubTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 mx-4 mt-2 justify-start h-8">
          <TabsTrigger value="enrollments" className="text-xs">Enrollments</TabsTrigger>
          <TabsTrigger value="claims" className="text-xs">Claims</TabsTrigger>
          <TabsTrigger value="enroll_new" className="text-xs">+ New Enrollment</TabsTrigger>
        </TabsList>

        {/* Enrollments Tab */}
        <TabsContent value="enrollments" className="flex-1 overflow-hidden mt-2 px-4">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search by name, UHID or enrollment ID..." className="pl-8 h-8 text-xs"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ScrollArea className="h-[calc(100%-3rem)]">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">No enrollments found</p>
                <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => setSubTab("enroll_new")}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Enroll First Patient
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {filtered.map(e => (
                  <div key={e.id} className="border rounded-lg px-4 py-3 bg-card flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{e.patients?.full_name || "—"}</span>
                        <span className="text-[10px] text-muted-foreground">{e.patients?.uhid}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.scheme_name || "State Scheme"} · ID: <span className="font-mono">{e.enrollment_id}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {e.district && `${e.district}, `}{e.state}
                        {e.aadhar_linked && " · Aadhaar Linked ✓"}
                        {e.valid_till && ` · Valid till ${new Date(e.valid_till).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                    <Badge variant="secondary" className={cn("text-[10px] shrink-0",
                      e.status === "active" ? "bg-emerald-100 text-emerald-700" :
                      e.status === "expired" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                    )}>
                      {e.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Claims Tab */}
        <TabsContent value="claims" className="flex-1 overflow-hidden mt-2 px-4">
          <ScrollArea className="h-full">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
            ) : claims.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No scheme claims found</p>
            ) : (
              <div className="space-y-2 pb-4">
                {claims.map(c => (
                  <div key={c.id} className="border rounded-lg px-4 py-3 bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{c.patients?.full_name || "—"}</span>
                          <Badge variant="secondary" className="text-[9px] bg-blue-50 text-blue-700">{c.scheme_type}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {c.claim_number ? `Claim# ${c.claim_number}` : "Claim# Pending"}
                          {" · "}{new Date(c.created_at).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 justify-end text-sm font-semibold">
                          <IndianRupee className="h-3 w-3" />
                          {c.claimed_amount.toLocaleString("en-IN")}
                        </div>
                        {c.approved_amount != null && (
                          <div className="text-[10px] text-muted-foreground">
                            Approved: ₹{c.approved_amount.toLocaleString("en-IN")}
                          </div>
                        )}
                        <Badge variant="secondary" className={cn("text-[9px] mt-1", STATUS_COLORS[c.status] || "")}>
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* New Enrollment Form */}
        <TabsContent value="enroll_new" className="flex-1 overflow-hidden mt-2 px-4">
          <ScrollArea className="h-full">
            <div className="space-y-4 pb-6 max-w-xl">
              <div>
                <Label className="text-xs">Search Patient *</Label>
                <div className="flex gap-2 mt-1">
                  <Input placeholder="Name or UHID..." className="h-8 text-xs flex-1"
                    value={patientSearch} onChange={e => setPatientSearch(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchPatients()} />
                  <Button size="sm" className="h-8" onClick={searchPatients}>
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {patientResults.length > 0 && !selectedPatient && (
                  <div className="border rounded-lg mt-1 overflow-hidden">
                    {patientResults.map(p => (
                      <button key={p.id} onClick={() => { setSelectedPatient(p); setPatientResults([]); setPatientSearch(p.full_name); }}
                        className="w-full text-left px-3 py-2 text-xs border-b hover:bg-muted/50 last:border-0">
                        <span className="font-semibold">{p.full_name}</span>
                        <span className="text-muted-foreground ml-2">{p.uhid}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedPatient && (
                  <div className="mt-1 flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="font-semibold text-emerald-700">{selectedPatient.full_name}</span>
                    <span className="text-muted-foreground">{selectedPatient.uhid}</span>
                    <button onClick={() => { setSelectedPatient(null); setPatientSearch(""); }} className="ml-auto text-muted-foreground hover:text-foreground">×</button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Scheme *</Label>
                  <select value={schemeName} onChange={e => setSchemeName(e.target.value)}
                    className="w-full h-8 text-xs border rounded-md px-2 mt-1 bg-background">
                    {SCHEMES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Enrollment ID *</Label>
                  <Input value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} className="mt-1 h-8 text-xs" placeholder="Aarogyasri/PMJAY ID" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">State</Label>
                  <select value={state} onChange={e => setState(e.target.value)}
                    className="w-full h-8 text-xs border rounded-md px-2 mt-1 bg-background">
                    {STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">District</Label>
                  <Input value={district} onChange={e => setDistrict(e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Hyderabad" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Family Unit ID</Label>
                  <Input value={familyUnitId} onChange={e => setFamilyUnitId(e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
                </div>
                <div>
                  <Label className="text-xs">Valid Till</Label>
                  <Input type="date" value={validTill} onChange={e => setValidTill(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="aadhar" checked={aadharLinked} onChange={e => setAadharLinked(e.target.checked)} className="rounded" />
                <Label htmlFor="aadhar" className="text-xs cursor-pointer">Aadhaar Linked</Label>
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={saveEnrollment} disabled={saving} className="flex-1">
                  {saving ? "Saving..." : "Save Enrollment"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSubTab("enrollments")}>Cancel</Button>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ArogyasriTab;
