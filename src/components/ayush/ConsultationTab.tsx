import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Save, X, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  system: string;
  showNew: boolean;
  onShowNewDone: () => void;
}

interface DrugItem {
  drug_name: string;
  formulation_type: string;
  dose: string;
  anupana: string;
  frequency: string;
  duration: string;
}

interface AyushToken {
  id: string;
  token_number: string;
  token_prefix: string;
  status: string;
  created_at: string;
  patient_id: string;
  doctor_id: string | null;
  patient?: { id: string; full_name: string; uhid: string; gender: string | null; dob: string | null; phone: string | null };
  doctor?: { full_name: string } | null;
}

// Map AYUSH system to department name search patterns
const SYSTEM_DEPT_MAP: Record<string, string[]> = {
  ayurveda: ["%ayurveda%", "%ayurved%"],
  homeopathy: ["%homeopathy%", "%homoeopathy%", "%homeo%"],
  unani: ["%unani%"],
  siddha: ["%siddha%"],
  yoga: ["%yoga%", "%naturopathy%", "%naturo%"],
};

const statusStyles: Record<string, string> = {
  waiting: "border-l-amber-400",
  called: "border-l-orange-400",
  in_consultation: "border-l-blue-400",
  completed: "border-l-green-400 opacity-60",
};

const statusLabel: Record<string, string> = {
  waiting: "Waiting",
  called: "Called",
  in_consultation: "With Doctor",
  completed: "Done",
};

const NADI_TEMPLATES = ["Vata dominant, irregular, thready", "Pitta dominant, sharp, bounding", "Kapha dominant, slow, steady", "Mixed Vata-Pitta"];
const TONGUE_TEMPLATES = ["Coated white", "Red/dry", "Pale", "Normal", "Yellow coating"];

export default function ConsultationTab({ system, showNew, onShowNewDone }: Props) {
  const [tokens, setTokens] = useState<AyushToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<AyushToken | null>(null);
  const [search, setSearch] = useState("");
  const [recentEncounters, setRecentEncounters] = useState<any[]>([]);
  const [drugs, setDrugs] = useState<any[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [complaint, setComplaint] = useState("");
  const [nadi, setNadi] = useState("");
  const [mala, setMala] = useState("");
  const [mutra, setMutra] = useState("");
  const [jivha, setJivha] = useState("");
  const [shabda, setShabda] = useState("");
  const [sparsha, setSparsha] = useState("");
  const [drik, setDrik] = useState("");
  const [akriti, setAkriti] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [icdCode, setIcdCode] = useState("");
  const [prescription, setPrescription] = useState<DrugItem[]>([]);
  const [dietAdvice, setDietAdvice] = useState("");
  const [lifestyleAdvice, setLifestyleAdvice] = useState("");
  const [followUpDays, setFollowUpDays] = useState("");
  const [saving, setSaving] = useState(false);

  // Homeopathy specific
  const [modalities, setModalities] = useState("");
  const [mentalGenerals, setMentalGenerals] = useState("");
  const [physicalGenerals, setPhysicalGenerals] = useState("");
  const [miasm, setMiasm] = useState("");
  const [remedy, setRemedy] = useState("");
  const [potency, setPotency] = useState("30c");
  const [homDose, setHomDose] = useState("1 dose");

  const fetchTokens = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: userData } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!userData) { setLoading(false); return; }
    setHospitalId(userData.hospital_id);
    setUserId(userData.id);

    // Find departments matching the selected AYUSH system
    const patterns = SYSTEM_DEPT_MAP[system] || [`%${system}%`];
    let deptIds: string[] = [];
    for (const pattern of patterns) {
      const { data: depts } = await supabase
        .from("departments")
        .select("id")
        .eq("hospital_id", userData.hospital_id)
        .ilike("name", pattern);
      if (depts) deptIds.push(...depts.map(d => d.id));
    }
    // Deduplicate
    deptIds = [...new Set(deptIds)];

    if (deptIds.length === 0) {
      setTokens([]);
      setLoading(false);
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("opd_tokens")
      .select("id, token_number, token_prefix, status, created_at, patient_id, doctor_id, patient:patients(id, full_name, uhid, gender, dob, phone), doctor:users!opd_tokens_doctor_id_fkey(full_name)")
      .eq("hospital_id", userData.hospital_id)
      .in("department_id", deptIds)
      .eq("visit_date", today)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching AYUSH tokens:", error);
      toast.error("Failed to load queue");
      setLoading(false);
      return;
    }
    setTokens((data as unknown as AyushToken[]) || []);
    setLoading(false);
  }, [system]);

  useEffect(() => { setSelectedToken(null); setLoading(true); fetchTokens(); }, [fetchTokens]);

  // Realtime
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`ayush-tokens-${system}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "opd_tokens", filter: `hospital_id=eq.${hospitalId}` }, () => fetchTokens())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, system, fetchTokens]);

  useEffect(() => { loadDrugs(); }, []);

  const selectedPatient = selectedToken?.patient || null;

  useEffect(() => {
    if (selectedPatient) loadRecentEncounters();
  }, [selectedPatient]);

  const loadDrugs = async () => {
    const { data } = await supabase.from("ayush_drug_master").select("*").eq("is_active", true).order("drug_name");
    if (data) setDrugs(data);
  };

  const loadRecentEncounters = async () => {
    if (!selectedPatient) return;
    const { data } = await supabase.from("ayush_encounters").select("*")
      .eq("patient_id", selectedPatient.id).order("encounter_date", { ascending: false }).limit(10);
    if (data) setRecentEncounters(data);
  };

  const addDrug = () => {
    setPrescription([...prescription, { drug_name: "", formulation_type: "", dose: "", anupana: "", frequency: "Twice daily", duration: "15 days" }]);
  };

  const updateDrug = (idx: number, field: keyof DrugItem, value: string) => {
    const updated = [...prescription];
    updated[idx] = { ...updated[idx], [field]: value };
    setPrescription(updated);
  };

  const selectDrugFromMaster = (idx: number, drugId: string) => {
    const drug = drugs.find((d: any) => d.id === drugId);
    if (!drug) return;
    const updated = [...prescription];
    updated[idx] = {
      ...updated[idx],
      drug_name: drug.drug_name,
      formulation_type: drug.formulation_type,
      dose: drug.dose_adult || "",
      anupana: drug.anupana || "",
    };
    setPrescription(updated);
  };

  const removeDrug = (idx: number) => {
    setPrescription(prescription.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setComplaint(""); setNadi(""); setMala(""); setMutra(""); setJivha("");
    setShabda(""); setSparsha(""); setDrik(""); setAkriti("");
    setDiagnosis(""); setIcdCode(""); setPrescription([]);
    setDietAdvice(""); setLifestyleAdvice(""); setFollowUpDays("");
    setModalities(""); setMentalGenerals(""); setPhysicalGenerals("");
    setMiasm(""); setRemedy(""); setPotency("30c"); setHomDose("1 dose");
  };

  const saveConsultation = async () => {
    if (!selectedPatient) { toast.error("Select a patient"); return; }
    if (!complaint.trim()) { toast.error("Enter chief complaint"); return; }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      const { data: userRow } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", userId).maybeSingle();
      if (!userRow) { toast.error("User not found"); return; }

      const record: any = {
        hospital_id: userRow.hospital_id,
        patient_id: selectedPatient.id,
        system,
        practitioner_id: userRow.id,
        chief_complaint: complaint,
        ayurvedic_diagnosis: diagnosis || null,
        icd_code: icdCode || null,
        prescription: prescription.length > 0 ? prescription : [],
        diet_advice: dietAdvice || null,
        lifestyle_advice: lifestyleAdvice || null,
        follow_up_days: followUpDays ? parseInt(followUpDays) : null,
      };

      if (system === "ayurveda") {
        record.nadi_pariksha = nadi || null;
        record.mala_pariksha = mala || null;
        record.mutra_pariksha = mutra || null;
        record.jivha_pariksha = jivha || null;
        record.shabda_pariksha = shabda || null;
        record.sparsha_pariksha = sparsha || null;
        record.drik_pariksha = drik || null;
        record.akriti_pariksha = akriti || null;
      }

      const { error } = await supabase.from("ayush_encounters").insert(record);
      if (error) throw error;
      toast.success("Consultation saved");
      resetForm();
      loadRecentEncounters();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const calcAge = (dob: string | null) => {
    if (!dob) return "–";
    return Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000) + "y";
  };

  const filteredTokens = tokens.filter((t) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (t.patient?.full_name?.toLowerCase().includes(s) || t.patient?.uhid?.toLowerCase().includes(s) || t.token_number.includes(s));
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left - OPD Token Queue */}
      <div className="w-[280px] border-r flex flex-col bg-muted/20">
        <div className="p-3 border-b flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Filter queue..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
          </div>
          <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => { setLoading(true); fetchTokens(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Loading queue...</p>
          ) : filteredTokens.length === 0 ? (
            <div className="text-center py-8 px-3">
              <p className="text-xs text-muted-foreground">No OPD tokens for this department today</p>
              <p className="text-xs text-muted-foreground mt-1">Register patients via OPD with the {system} department</p>
            </div>
          ) : (
            filteredTokens.map((t) => (
              <button
                key={t.id}
                className={`w-full text-left px-3 py-2 border-b border-l-4 text-sm hover:bg-accent/50 transition ${statusStyles[t.status] || ""} ${selectedToken?.id === t.id ? "bg-accent" : ""}`}
                onClick={() => setSelectedToken(t)}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium truncate">{t.patient?.full_name || "—"}</p>
                  <Badge variant="outline" className="text-[10px] h-5">{t.token_prefix}-{t.token_number}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t.patient?.uhid} · {calcAge(t.patient?.dob || null)} · {statusLabel[t.status] || t.status}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right - Consultation Workspace */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!selectedPatient ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Search and select a patient to start consultation</p>
          </div>
        ) : (
          <>
            {/* Patient Info */}
            <Card className="shadow-none">
              <CardContent className="p-3 flex items-center gap-4">
                <div>
                  <p className="font-semibold">{selectedPatient.full_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedPatient.uhid} · {calcAge(selectedPatient.dob)} · {selectedPatient.gender}</p>
                </div>
                {recentEncounters.length > 0 && (
                  <Badge variant="outline" className="ml-auto">
                    Last visit: {new Date(recentEncounters[0].encounter_date).toLocaleDateString("en-IN")}
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Chief Complaint */}
            <div>
              <Label className="text-sm font-medium">Chief Complaint *</Label>
              <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Describe the main complaint..." rows={2} className="mt-1" />
            </div>

            {/* System-specific form */}
            {system === "ayurveda" && (
              <>
                <Card>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm">Ashtavidha Pariksha (8-fold Examination)</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <Accordion type="multiple" className="space-y-0">
                      <AccordionItem value="nadi">
                        <AccordionTrigger className="text-sm py-2">🖐️ Nadi (Pulse)</AccordionTrigger>
                        <AccordionContent className="space-y-2">
                          <div className="flex gap-1 flex-wrap">
                            {NADI_TEMPLATES.map((t) => (
                              <Button key={t} size="sm" variant="outline" className="text-xs h-7" onClick={() => setNadi(t)}>{t.split(",")[0]}</Button>
                            ))}
                          </div>
                          <Input value={nadi} onChange={(e) => setNadi(e.target.value)} placeholder="Pulse examination findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="mala">
                        <AccordionTrigger className="text-sm py-2">💩 Mala (Stool)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={mala} onChange={(e) => setMala(e.target.value)} placeholder="Stool examination findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="mutra">
                        <AccordionTrigger className="text-sm py-2">💧 Mutra (Urine)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={mutra} onChange={(e) => setMutra(e.target.value)} placeholder="Urine examination findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="jivha">
                        <AccordionTrigger className="text-sm py-2">👅 Jivha (Tongue)</AccordionTrigger>
                        <AccordionContent className="space-y-2">
                          <div className="flex gap-1 flex-wrap">
                            {TONGUE_TEMPLATES.map((t) => (
                              <Button key={t} size="sm" variant="outline" className="text-xs h-7" onClick={() => setJivha(t)}>{t}</Button>
                            ))}
                          </div>
                          <Input value={jivha} onChange={(e) => setJivha(e.target.value)} placeholder="Tongue examination findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="shabda">
                        <AccordionTrigger className="text-sm py-2">🗣️ Shabda (Voice)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={shabda} onChange={(e) => setShabda(e.target.value)} placeholder="Voice/sound findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sparsha">
                        <AccordionTrigger className="text-sm py-2">✋ Sparsha (Touch)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={sparsha} onChange={(e) => setSparsha(e.target.value)} placeholder="Skin/touch findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="drik">
                        <AccordionTrigger className="text-sm py-2">👁️ Drik (Eyes)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={drik} onChange={(e) => setDrik(e.target.value)} placeholder="Eye examination findings" />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="akriti">
                        <AccordionTrigger className="text-sm py-2">🧍 Akriti (Appearance)</AccordionTrigger>
                        <AccordionContent>
                          <Input value={akriti} onChange={(e) => setAkriti(e.target.value)} placeholder="Build/appearance findings" />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </CardContent>
                </Card>
              </>
            )}

            {system === "homeopathy" && (
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm">Homeopathic Case Taking</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-3">
                  <div>
                    <Label className="text-xs">Modalities (better/worse)</Label>
                    <Textarea value={modalities} onChange={(e) => setModalities(e.target.value)} rows={2} placeholder="Better by warmth, worse in morning..." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Mental Generals</Label>
                      <Textarea value={mentalGenerals} onChange={(e) => setMentalGenerals(e.target.value)} rows={2} />
                    </div>
                    <div>
                      <Label className="text-xs">Physical Generals</Label>
                      <Textarea value={physicalGenerals} onChange={(e) => setPhysicalGenerals(e.target.value)} rows={2} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Miasmatic Tendency</Label>
                    <Select value={miasm} onValueChange={setMiasm}>
                      <SelectTrigger><SelectValue placeholder="Select miasm" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="psora">Psora</SelectItem>
                        <SelectItem value="sycosis">Sycosis</SelectItem>
                        <SelectItem value="syphilis">Syphilis</SelectItem>
                        <SelectItem value="tubercular">Tubercular</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Remedy</Label>
                      <Input value={remedy} onChange={(e) => setRemedy(e.target.value)} placeholder="e.g. Nux Vomica" />
                    </div>
                    <div>
                      <Label className="text-xs">Potency</Label>
                      <Select value={potency} onValueChange={setPotency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["6c", "12c", "30c", "200c", "1M", "10M"].map((p) => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Dose</Label>
                      <Select value={homDose} onValueChange={setHomDose}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1 dose">1 dose</SelectItem>
                          <SelectItem value="3 doses daily">3 doses daily</SelectItem>
                          <SelectItem value="Morning and night">Morning & night</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Diagnosis */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Ayurvedic Diagnosis</Label>
                <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Vataja Jwara, Pitta prakopa" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">ICD Code (optional)</Label>
                <Input value={icdCode} onChange={(e) => setIcdCode(e.target.value)} placeholder="e.g. R50.9" className="mt-1" />
              </div>
            </div>

            {/* Prescription */}
            {system !== "homeopathy" && (
              <Card>
                <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">Prescription</CardTitle>
                  <Button size="sm" variant="outline" onClick={addDrug}><Plus className="h-3 w-3 mr-1" /> Add Medicine</Button>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  {prescription.map((rx, idx) => (
                    <div key={idx} className="grid grid-cols-7 gap-2 items-end">
                      <div className="col-span-2">
                        <Label className="text-xs">Drug</Label>
                        <Select onValueChange={(v) => selectDrugFromMaster(idx, v)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder={rx.drug_name || "Select drug"} />
                          </SelectTrigger>
                          <SelectContent>
                            {drugs.map((d: any) => (
                              <SelectItem key={d.id} value={d.id} className="text-xs">{d.drug_name} ({d.formulation_type})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Dose</Label>
                        <Input className="h-8 text-xs" value={rx.dose} onChange={(e) => updateDrug(idx, "dose", e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Anupana</Label>
                        <Input className="h-8 text-xs" value={rx.anupana} onChange={(e) => updateDrug(idx, "anupana", e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Frequency</Label>
                        <Input className="h-8 text-xs" value={rx.frequency} onChange={(e) => updateDrug(idx, "frequency", e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Duration</Label>
                        <Input className="h-8 text-xs" value={rx.duration} onChange={(e) => updateDrug(idx, "duration", e.target.value)} />
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeDrug(idx)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {prescription.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">No medicines added</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Diet & Lifestyle */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Diet Advice</Label>
                <Textarea value={dietAdvice} onChange={(e) => setDietAdvice(e.target.value)} rows={3} placeholder="Dietary recommendations..." className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">Lifestyle Advice</Label>
                <Textarea value={lifestyleAdvice} onChange={(e) => setLifestyleAdvice(e.target.value)} rows={3} placeholder="Lifestyle recommendations..." className="mt-1" />
              </div>
            </div>

            {/* Follow-up */}
            <div className="flex items-center gap-2">
              <Label className="text-sm">Follow-up after</Label>
              <Input type="number" value={followUpDays} onChange={(e) => setFollowUpDays(e.target.value)} className="w-20 h-8" />
              <span className="text-sm text-muted-foreground">days</span>
            </div>

            {/* Save */}
            <div className="flex justify-end pb-4">
              <Button onClick={saveConsultation} disabled={saving}>
                <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Consultation"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
