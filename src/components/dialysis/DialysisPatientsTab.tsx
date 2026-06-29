import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search } from "lucide-react";

interface Props {
  showRegister: boolean;
  onCloseRegister: () => void;
  onRefresh: () => void;
}

const SEROLOGY_BADGE: Record<string, string> = {
  positive: "bg-red-100 text-red-700",
  negative: "bg-green-100 text-green-700",
  vaccinated: "bg-blue-100 text-blue-700",
  unknown: "bg-amber-100 text-amber-700",
};

const MACHINE_TYPE_LABEL: Record<string, { bg: string; text: string }> = {
  clean: { bg: "bg-green-100", text: "text-green-700" },
  hbv: { bg: "bg-amber-100", text: "text-amber-700" },
  hcv: { bg: "bg-red-100", text: "text-red-700" },
  hiv: { bg: "bg-purple-100", text: "text-purple-700" },
  isolated: { bg: "bg-muted", text: "text-muted-foreground" },
};

const deriveMachineType = (hbv: string, hcv: string, hiv: string): string => {
  if (hbv === "positive") return "hbv";
  if (hcv === "positive") return "hcv";
  if (hiv === "positive") return "hiv";
  if (hbv === "unknown" || hcv === "unknown" || hiv === "unknown") return "isolated";
  return "clean";
};

const DialysisPatientsTab: React.FC<Props> = ({ showRegister, onCloseRegister, onRefresh }) => {
  const { toast } = useToast();
  const [dPatients, setDPatients] = useState<any[]>([]);
  const [allPatients, setAllPatients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);

  // Registration form
  const [patientId, setPatientId] = useState("");
  const [diagnosis, setDiagnosis] = useState("esrd");
  const [accessType, setAccessType] = useState("av_fistula");
  const [accessSite, setAccessSite] = useState("");
  const [hbv, setHbv] = useState("negative");
  const [hcv, setHcv] = useState("negative");
  const [hiv, setHiv] = useState("negative");
  const [dryWeight, setDryWeight] = useState("");
  const [frequency, setFrequency] = useState("3_per_week");
  const [duration, setDuration] = useState("4");
  const [patientSearch, setPatientSearch] = useState("");

  const fetchData = async () => {
    const res = await (supabase as any).from("dialysis_patients").select("*, patients(full_name, uhid, age, gender)").eq("is_active", true).order("registered_at", { ascending: false });
    if (res.data) setDPatients(res.data);
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (showRegister && allPatients.length === 0) {
      supabase.from("patients").select("id, full_name, uhid").order("full_name").then(({ data }) => {
        if (data) setAllPatients(data);
      });
    }
  }, [showRegister]);

  const register = async () => {
    if (!patientId) { toast({ title: "Select a patient", variant: "destructive" }); return; }
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;
    const machineType = deriveMachineType(hbv, hcv, hiv);

    const { error } = await (supabase as any).from("dialysis_patients").insert({
      hospital_id: user.hospital_id,
      patient_id: patientId,
      diagnosis,
      access_type: accessType,
      access_site: accessSite || null,
      hbv_status: hbv,
      hcv_status: hcv,
      hiv_status: hiv,
      machine_type_required: machineType,
      dry_weight_kg: parseFloat(dryWeight) || null,
      dialysis_frequency: frequency,
      session_duration_hrs: parseFloat(duration) || 4,
      treating_doctor: user.id,
    });

    if (error) {
      toast({ title: error.message.includes("unique") ? "Patient already registered in dialysis" : error.message, variant: "destructive" });
      return;
    }

    toast({ title: `Patient registered — assigned to ${machineType.toUpperCase()} machines` });
    onCloseRegister();
    fetchData();
    onRefresh();
  };

  const viewDetail = async (dp: any) => {
    setSelectedDetail(dp);
    const { data } = await (supabase as any).from("dialysis_sessions").select("*").eq("dialysis_patient_id", dp.id).order("session_date", { ascending: false }).limit(20);
    if (data) setSessions(data);
  };

  const machineType = deriveMachineType(hbv, hcv, hiv);
  const mtStyle = MACHINE_TYPE_LABEL[machineType];
  const filtered = dPatients.filter(p =>
    p.patients?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.patients?.uhid?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAllPatients = allPatients.filter(p =>
    p.full_name?.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.uhid?.toLowerCase().includes(patientSearch.toLowerCase())
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Patient List */}
      <div className="w-[340px] border-r border-border overflow-y-auto p-3 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patients..." className="h-8 pl-8 text-xs" />
        </div>

        {filtered.map(p => {
          const mt = MACHINE_TYPE_LABEL[p.machine_type_required] || MACHINE_TYPE_LABEL.clean;
          return (
            <button key={p.id} onClick={() => viewDetail(p)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedDetail?.id === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{p.patients?.full_name}</span>
                <Badge className={`text-[9px] ${mt.bg} ${mt.text}`}>{p.machine_type_required.toUpperCase()}</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground">{p.patients?.uhid} · {p.diagnosis.toUpperCase()} · {p.access_type.replace(/_/g, " ")}</p>
              <div className="flex gap-1 mt-1">
                <Badge className={`text-[8px] ${SEROLOGY_BADGE[p.hbv_status]}`}>HBV:{p.hbv_status}</Badge>
                <Badge className={`text-[8px] ${SEROLOGY_BADGE[p.hcv_status]}`}>HCV:{p.hcv_status}</Badge>
                <Badge className={`text-[8px] ${SEROLOGY_BADGE[p.hiv_status]}`}>HIV:{p.hiv_status}</Badge>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No dialysis patients registered</p>}
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedDetail ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold">{selectedDetail.patients?.full_name}</h3>
              <p className="text-xs text-muted-foreground">{selectedDetail.patients?.uhid} · {selectedDetail.diagnosis.toUpperCase()} · {selectedDetail.access_type.replace(/_/g, " ")} ({selectedDetail.access_site || "—"})</p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="border border-border rounded-lg p-3 text-center">
                <p className="text-xl font-bold">{sessions.length}</p>
                <p className="text-[10px] text-muted-foreground">Total Sessions</p>
              </div>
              <div className="border border-border rounded-lg p-3 text-center">
                <p className="text-xl font-bold">{sessions.filter(s => s.status === "completed").length}</p>
                <p className="text-[10px] text-muted-foreground">Completed</p>
              </div>
              <div className="border border-border rounded-lg p-3 text-center">
                <p className="text-xl font-bold">
                  {sessions.filter(s => s.kt_v).length > 0
                    ? (sessions.filter(s => s.kt_v).reduce((a, s) => a + Number(s.kt_v), 0) / sessions.filter(s => s.kt_v).length).toFixed(2)
                    : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">Avg Kt/V</p>
              </div>
              <div className="border border-border rounded-lg p-3 text-center">
                <p className="text-xl font-bold">
                  {sessions.length > 0
                    ? Math.round((sessions.filter(s => s.status === "completed").length / sessions.length) * 100)
                    : 0}%
                </p>
                <p className="text-[10px] text-muted-foreground">Compliance</p>
              </div>
            </div>

            <h4 className="text-sm font-semibold">Recent Sessions</h4>
            <div className="space-y-1">
              {sessions.map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs border-b border-border py-1.5">
                  <span>{s.session_date}</span>
                  <span>Pre: {s.pre_weight_kg || "—"}kg → Post: {s.post_weight_kg || "—"}kg</span>
                  <span>Kt/V: {s.kt_v ? <span className={Number(s.kt_v) < 1.2 ? "text-red-600 font-bold" : "text-green-600"}>{s.kt_v}</span> : "—"}</span>
                  <Badge variant="outline" className="text-[9px]">{s.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">Select a patient to view details</p>
        )}
      </div>

      {/* Registration Modal */}
      <Dialog open={showRegister} onOpenChange={onCloseRegister}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register Dialysis Patient</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Link Patient *</Label>
              <Input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search by name or UHID..." className="h-9" />
              {patientSearch && (
                <div className="border border-border rounded max-h-32 overflow-y-auto mt-1">
                  {filteredAllPatients.slice(0, 10).map(p => (
                    <button key={p.id} onClick={() => { setPatientId(p.id); setPatientSearch(p.full_name); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted ${patientId === p.id ? "bg-primary/10" : ""}`}>
                      {p.full_name} ({p.uhid})
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Diagnosis *</Label>
                <Select value={diagnosis} onValueChange={setDiagnosis}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["esrd","aki","ckd_stage4","ckd_stage5","other"].map(d => <SelectItem key={d} value={d} className="uppercase text-xs">{d.replace(/_/g," ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Access Type *</Label>
                <Select value={accessType} onValueChange={setAccessType}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["av_fistula","av_graft","tunneled_catheter","non_tunneled_catheter","peritoneal"].map(a => <SelectItem key={a} value={a} className="text-xs capitalize">{a.replace(/_/g," ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Access Site</Label><Input value={accessSite} onChange={e => setAccessSite(e.target.value)} className="h-9" placeholder="e.g. Left arm AVF" /></div>

            <div className="border border-border rounded-lg p-3 space-y-2">
              <Label className="text-xs font-bold text-red-700">⚠️ Serology (determines machine assignment)</Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">HBsAg</Label>
                  <Select value={hbv} onValueChange={setHbv}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["positive","negative","vaccinated","unknown"].map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">HCV</Label>
                  <Select value={hcv} onValueChange={setHcv}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["positive","negative","unknown"].map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">HIV</Label>
                  <Select value={hiv} onValueChange={setHiv}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["positive","negative","unknown"].map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className={`text-xs font-semibold px-3 py-1.5 rounded ${mtStyle.bg} ${mtStyle.text}`}>
                Machine Assignment: {machineType.toUpperCase()} machines
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Dry Weight (kg)</Label><Input value={dryWeight} onChange={e => setDryWeight(e.target.value)} className="h-9" type="number" /></div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2_per_week">2×/week</SelectItem>
                    <SelectItem value="3_per_week">3×/week</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="alternate_day">Alternate day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Duration (hrs)</Label><Input value={duration} onChange={e => setDuration(e.target.value)} className="h-9" type="number" /></div>
            </div>

            <Button className="w-full" onClick={register} disabled={!patientId}>Register Dialysis Patient</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DialysisPatientsTab;
