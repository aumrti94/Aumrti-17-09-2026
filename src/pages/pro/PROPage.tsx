import React, { useState, useEffect, useCallback, useRef } from "react";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { format, differenceInHours, differenceInMinutes } from "date-fns";
import { Plus, Star, ClipboardList, Users, FileText, BarChart3, AlertTriangle, CheckCircle, Clock, Phone, MessageSquare, Printer, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend } from "recharts";

const CATEGORY_COLORS: Record<string, string> = {
  clinical_care: "#EF4444", billing: "#F59E0B", staff_behaviour: "#8B5CF6",
  facility_cleanliness: "#10B981", food: "#06B6D4", waiting_time: "#F97316",
  communication: "#3B82F6", privacy: "#EC4899", other: "#94A3B8",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700",
};

const STATUS_STEPS = ["open", "acknowledged", "in_progress", "resolved", "closed"];

const RIGHTS_EN = [
  "Right to respectful care regardless of religion, caste, or economic status",
  "Right to know your diagnosis, treatment plan, and alternatives",
  "Right to privacy and confidentiality of medical information",
  "Right to refuse treatment after understanding consequences",
  "Right to know the identity of treating doctors and nurses",
  "Right to be informed of hospital charges in advance",
  "Right to safe and clean environment",
  "Right to file a complaint / grievance",
];

const RESPONSIBILITIES_EN = [
  "Provide complete and accurate medical history",
  "Follow the treatment plan prescribed",
  "Respect hospital staff and other patients",
  "Follow hospital rules and visiting hours",
  "Pay hospital bills as per agreed terms",
  "Inform staff of any changes in your condition",
];

const PROPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const { toast } = useToast();
  const [tab, setTab] = useState("grievances");

  // KPI
  const [openGrievances, setOpenGrievances] = useState(0);
  const [slaBreached, setSlaBreached] = useState(0);
  const [avgCsat, setAvgCsat] = useState(0);
  const [activeVisitors, setActiveVisitors] = useState(0);
  const [rightsNotSigned, setRightsNotSigned] = useState(0);

  // Grievances
  const [grievances, setGrievances] = useState<any[]>([]);
  const [selectedGrievance, setSelectedGrievance] = useState<any>(null);
  const [grievanceFilter, setGrievanceFilter] = useState("open");
  const [grievanceModal, setGrievanceModal] = useState(false);
  const [gForm, setGForm] = useState({ patient_name: "", patient_phone: "", category: "clinical_care", severity: "medium", description: "", channel: "counter" });

  // Resolution
  const [resNotes, setResNotes] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [resolution, setResolution] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [staffList, setStaffList] = useState<any[]>([]);

  // Feedback
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [avgNps, setAvgNps] = useState(0);
  const [feedbackCount, setFeedbackCount] = useState(0);

  // Visitor passes
  const [visitors, setVisitors] = useState<any[]>([]);
  const [visitorModal, setVisitorModal] = useState(false);
  const [vForm, setVForm] = useState({ patient_search: "", patient_id: "", visitor_name: "", relation: "", visitor_phone: "", purpose: "", valid_hours: "2" });
  const [patientResults, setPatientResults] = useState<any[]>([]);

  // Rights
  const [pendingRights, setPendingRights] = useState<any[]>([]);
  const [rightsModal, setRightsModal] = useState(false);
  const [rightsPatient, setRightsPatient] = useState<any>(null);
  const [rightsLang, setRightsLang] = useState("english");
  const [guardianName, setGuardianName] = useState("");
  const [witnessName, setWitnessName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Analytics
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [csatTrend, setCsatTrend] = useState<any[]>([]);

  const loadKPIs = useCallback(async () => {
    const [gRes, slRes, csRes, vRes] = await Promise.all([
      supabase.from("grievances").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).not("status", "in", '("resolved","closed")'),
      supabase.from("grievances").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("sla_breached", true).neq("status", "closed"),
      supabase.from("feedback_records").select("overall_csat").eq("hospital_id", hospitalId).not("overall_csat", "is", null),
      supabase.from("visitor_passes").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "active"),
    ]);
    setOpenGrievances(gRes.count || 0);
    setSlaBreached(slRes.count || 0);
    if (csRes.data && csRes.data.length > 0) {
      const avg = csRes.data.reduce((s: number, r: any) => s + r.overall_csat, 0) / csRes.data.length;
      setAvgCsat(Math.round(avg * 10) / 10);
    }
    setActiveVisitors(vRes.count || 0);

    // Rights not signed
    const today = new Date().toISOString().split("T")[0];
    const { data: admitted } = await supabase.from("admissions").select("id, patient_id").eq("hospital_id", hospitalId).eq("status", "admitted");
    if (admitted && admitted.length > 0) {
      const { data: signed } = await supabase.from("patient_rights_acknowledgements").select("admission_id").eq("hospital_id", hospitalId);
      const signedIds = new Set((signed || []).map((s: any) => s.admission_id));
      const notSigned = admitted.filter(a => !signedIds.has(a.id));
      setRightsNotSigned(notSigned.length);
    }
  }, []);

  const loadGrievances = useCallback(async () => {
    let q = supabase.from("grievances").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false });
    if (grievanceFilter === "open") q = q.in("status", ["open", "acknowledged"]);
    else if (grievanceFilter === "in_progress") q = q.eq("status", "in_progress");
    else if (grievanceFilter === "resolved") q = q.in("status", ["resolved", "closed"]);
    const { data } = await q.limit(100);
    setGrievances(data || []);
  }, [grievanceFilter]);

  const loadFeedbacks = useCallback(async () => {
    const { data } = await supabase.from("feedback_records").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(100);
    setFeedbacks(data || []);
    if (data && data.length > 0) {
      setFeedbackCount(data.length);
      const npsScores = data.filter((f: any) => f.nps_score !== null);
      if (npsScores.length > 0) {
        const promoters = npsScores.filter((f: any) => f.nps_score >= 9).length;
        const detractors = npsScores.filter((f: any) => f.nps_score <= 6).length;
        setAvgNps(Math.round(((promoters - detractors) / npsScores.length) * 100));
      }
    }
  }, []);

  const loadVisitors = useCallback(async () => {
    const { data } = await supabase.from("visitor_passes").select("*").eq("hospital_id", hospitalId).order("issued_at", { ascending: false }).limit(100);
    setVisitors(data || []);
  }, []);

  const loadPendingRights = useCallback(async () => {
    const { data: admitted } = await supabase.from("admissions").select("id, patient_id, ward_id, admitted_at").eq("hospital_id", hospitalId).eq("status", "admitted");
    if (!admitted || admitted.length === 0) { setPendingRights([]); return; }
    const { data: signed } = await supabase.from("patient_rights_acknowledgements").select("admission_id").eq("hospital_id", hospitalId);
    const signedIds = new Set((signed || []).map((s: any) => s.admission_id));
    const pending = admitted.filter(a => !signedIds.has(a.id));
    // Get patient names
    if (pending.length > 0) {
      const patIds = [...new Set(pending.map(p => p.patient_id))];
      const { data: patients } = await supabase.from("patients").select("id, full_name").in("id", patIds);
      const patMap = new Map((patients || []).map((p: any) => [p.id, p.full_name]));
      const { data: wards } = await supabase.from("wards").select("id, name").eq("hospital_id", hospitalId);
      const wardMap = new Map((wards || []).map((w: any) => [w.id, w.name]));
      setPendingRights(pending.map(p => ({
        ...p,
        patient_name: patMap.get(p.patient_id) || "Unknown",
        ward_name: wardMap.get(p.ward_id) || "—",
      })));
    } else {
      setPendingRights([]);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId).limit(200);
    setStaffList(data || []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const { data: allG } = await supabase.from("grievances").select("category, created_at, tat_hours").eq("hospital_id", hospitalId);
    if (allG) {
      const catCount: Record<string, number> = {};
      allG.forEach((g: any) => { catCount[g.category] = (catCount[g.category] || 0) + 1; });
      setCategoryData(Object.entries(catCount).map(([name, value]) => ({ name: name.replace(/_/g, " "), value, fill: CATEGORY_COLORS[name] || "#94A3B8" })));
    }
  }, []);

  useEffect(() => { loadKPIs(); loadStaff(); }, []);
  useEffect(() => {
    if (tab === "grievances") loadGrievances();
    else if (tab === "feedback") loadFeedbacks();
    else if (tab === "visitors") loadVisitors();
    else if (tab === "rights") loadPendingRights();
    else if (tab === "analytics") { loadAnalytics(); }
  }, [tab, grievanceFilter]);

  // SLA check interval
  useEffect(() => {
    const checkSLA = async () => {
      const { data } = await supabase.from("grievances").select("id, severity, acknowledged_at, status, sla_breached")
        .eq("hospital_id", hospitalId).not("status", "in", '("resolved","closed")').eq("sla_breached", false);
      if (!data) return;
      const now = new Date();
      for (const g of data) {
        if (!g.acknowledged_at) continue;
        const hrs = differenceInHours(now, new Date(g.acknowledged_at));
        const breach = (g.severity === "high" || g.severity === "critical") ? hrs >= 24 : hrs >= 48;
        if (breach) {
          await supabase.from("grievances").update({ sla_breached: true }).eq("id", g.id);
        }
      }
      loadKPIs();
    };
    checkSLA();
    const interval = setInterval(checkSLA, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const submitGrievance = async () => {
    if (!gForm.patient_name || !gForm.description) { toast({ title: "Patient name and description required", variant: "destructive" }); return; }
    const { error } = await supabase.from("grievances").insert({
      hospital_id: hospitalId,
      patient_name: gForm.patient_name,
      patient_phone: gForm.patient_phone || null,
      category: gForm.category,
      severity: gForm.severity,
      description: gForm.description,
      channel: gForm.channel,
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
    });
    if (error) { toast({ title: "Failed to submit grievance", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Grievance submitted & auto-acknowledged" });
    setGrievanceModal(false);
    setGForm({ patient_name: "", patient_phone: "", category: "clinical_care", severity: "medium", description: "", channel: "counter" });
    loadGrievances();
    loadKPIs();
  };

  const resolveGrievance = async () => {
    if (!selectedGrievance || !resolution) return;
    const now = new Date();
    const created = new Date(selectedGrievance.created_at);
    const tat = Math.round(differenceInMinutes(now, created) / 6) / 10;
    const { error } = await supabase.from("grievances").update({
      status: "resolved",
      resolved_at: now.toISOString(),
      resolution,
      root_cause: rootCause || null,
      tat_hours: tat,
    }).eq("id", selectedGrievance.id);
    if (error) { toast({ title: "Failed", variant: "destructive" }); return; }
    toast({ title: "Grievance resolved" });
    logNABHEvidence(hospitalId, "PCC.6",
      `Grievance resolved: ${selectedGrievance.category}, TAT: ${tat} hrs, Patient satisfied: pending`);
    // WhatsApp
    if (selectedGrievance.patient_phone) {
      const msg = `Dear ${selectedGrievance.patient_name}, your grievance regarding ${selectedGrievance.category.replace(/_/g, " ")} has been resolved. Resolution: ${resolution}. If not satisfied, please contact us. — Patient Relations Team`;
      window.open(`https://wa.me/91${selectedGrievance.patient_phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    }
    setSelectedGrievance(null);
    setResolution("");
    setRootCause("");
    setResNotes("");
    loadGrievances();
    loadKPIs();
  };

  const assignGrievance = async () => {
    if (!selectedGrievance || !assignTo) return;
    await supabase.from("grievances").update({ assigned_to: assignTo, status: "in_progress" }).eq("id", selectedGrievance.id);
    toast({ title: "Grievance assigned" });
    loadGrievances();
    setSelectedGrievance({ ...selectedGrievance, assigned_to: assignTo, status: "in_progress" });
  };

  // Visitor pass
  const searchPatients = async (q: string) => {
    setVForm(f => ({ ...f, patient_search: q }));
    if (q.length < 2) { setPatientResults([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, phone").eq("hospital_id", hospitalId).or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10);
    setPatientResults(data || []);
  };

  const issueVisitorPass = async () => {
    if (!vForm.patient_id || !vForm.visitor_name || !vForm.relation) { toast({ title: "Required fields missing", variant: "destructive" }); return; }
    const now = new Date();
    const validUntil = new Date(now.getTime() + parseInt(vForm.valid_hours) * 60 * 60 * 1000);
    const seq = Date.now().toString().slice(-6);
    const passNumber = `VP-${now.getFullYear()}-${seq}`;
    const { error } = await supabase.from("visitor_passes").insert({
      hospital_id: hospitalId,
      patient_id: vForm.patient_id,
      visitor_name: vForm.visitor_name,
      visitor_phone: vForm.visitor_phone || null,
      relation: vForm.relation,
      purpose: vForm.purpose || null,
      valid_until: validUntil.toISOString(),
      pass_number: passNumber,
      scanned_entry_at: now.toISOString(),
      issued_by: null,
    });
    if (error) { toast({ title: "Failed to issue pass", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Visitor pass ${passNumber} issued` });
    setVisitorModal(false);
    setVForm({ patient_search: "", patient_id: "", visitor_name: "", relation: "", visitor_phone: "", purpose: "", valid_hours: "2" });
    loadVisitors();
    loadKPIs();
  };

  const markExit = async (id: string) => {
    await supabase.from("visitor_passes").update({ scanned_exit_at: new Date().toISOString(), status: "expired" }).eq("id", id);
    toast({ title: "Visitor exit recorded" });
    loadVisitors();
    loadKPIs();
  };

  // Signature canvas
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0F172A";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  };

  useEffect(() => { if (rightsModal) setTimeout(initCanvas, 100); }, [rightsModal]);

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const saveRightsAck = async () => {
    if (!rightsPatient) return;
    const canvas = canvasRef.current;
    const sig = canvas ? canvas.toDataURL("image/png") : null;
    const { error } = await supabase.from("patient_rights_acknowledgements").insert({
      hospital_id: hospitalId,
      patient_id: rightsPatient.patient_id,
      admission_id: rightsPatient.id,
      language: rightsLang,
      digital_signature: sig,
      acknowledged_by_name: guardianName || rightsPatient.patient_name,
      witness_name: witnessName || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Patient rights acknowledged — NABH PCC.1 ✓" });
    logNABHEvidence(hospitalId, "PCC.1",
      `Patient rights acknowledged: ${rightsPatient.patient_name || "Patient"}, Language: ${rightsLang}, Signature captured.`);
    setRightsModal(false);
    setGuardianName("");
    setWitnessName("");
    loadPendingRights();
    loadKPIs();
  };

  const getTimeAgo = (d: string) => {
    const hrs = differenceInHours(new Date(), new Date(d));
    if (hrs < 1) return `${differenceInMinutes(new Date(), new Date(d))} min ago`;
    if (hrs < 24) return `${hrs} hrs ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getSlaStatus = (g: any) => {
    if (g.sla_breached) return <Badge className="bg-red-500 text-white animate-pulse text-[10px]">SLA BREACHED</Badge>;
    if (!g.acknowledged_at || g.status === "resolved" || g.status === "closed") return null;
    const hrs = differenceInHours(new Date(), new Date(g.acknowledged_at));
    const limit = (g.severity === "high" || g.severity === "critical") ? 24 : 48;
    const remaining = limit - hrs;
    if (remaining <= 4) return <Badge className="bg-orange-500 text-white text-[10px]">{remaining}h left</Badge>;
    return <Badge variant="outline" className="text-[10px] text-green-600">{remaining}h left</Badge>;
  };

  const renderStars = (n: number) => "⭐".repeat(Math.round(n));

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] border-b border-border shrink-0">
        <h1 className="text-base font-bold text-foreground">🤝 Patient Relations</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setGrievanceModal(true)}><Plus size={14} className="mr-1" />New Grievance</Button>
          <Button size="sm" variant="outline" onClick={() => setVisitorModal(true)}><Plus size={14} className="mr-1" />Visitor Pass</Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3 px-4 py-2 shrink-0">
        {[
          { label: "Open Grievances", value: openGrievances, icon: ClipboardList, color: "text-orange-600" },
          { label: "SLA Breached", value: slaBreached, icon: AlertTriangle, color: "text-red-600" },
          { label: "Avg CSAT", value: `${avgCsat}/5`, icon: Star, color: "text-yellow-600" },
          { label: "Active Visitors", value: activeVisitors, icon: Users, color: "text-blue-600" },
          { label: "Rights Not Signed", value: rightsNotSigned, icon: FileText, color: "text-purple-600" },
        ].map(k => (
          <Card key={k.label} className="p-3 flex items-center gap-3">
            <k.icon size={20} className={k.color} />
            <div>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-bold font-mono">{k.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="grievances">📋 Grievances</TabsTrigger>
          <TabsTrigger value="feedback">⭐ Feedback</TabsTrigger>
          <TabsTrigger value="visitors">🪪 Visitor Passes</TabsTrigger>
          <TabsTrigger value="rights">📜 Patient Rights</TabsTrigger>
          <TabsTrigger value="analytics">📊 Analytics</TabsTrigger>
        </TabsList>

        {/* TAB 1 — Grievances */}
        <TabsContent value="grievances" className="flex-1 overflow-hidden">
          <div className="flex gap-3 h-full">
            {/* Left queue */}
            <div className="w-[300px] shrink-0 flex flex-col border rounded-lg">
              <div className="p-2 border-b flex gap-1 flex-wrap">
                {["open", "in_progress", "resolved", "all"].map(f => (
                  <Button key={f} size="sm" variant={grievanceFilter === f ? "default" : "ghost"} className="text-xs h-7" onClick={() => setGrievanceFilter(f)}>
                    {f === "open" ? "Open" : f === "in_progress" ? "In Progress" : f === "resolved" ? "Resolved" : "All"}
                  </Button>
                ))}
              </div>
              <ScrollArea className="flex-1">
                {grievances.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No grievances</p>}
                {grievances.map(g => (
                  <button key={g.id} onClick={() => { setSelectedGrievance(g); setResolution(g.resolution || ""); setRootCause(g.root_cause || ""); }}
                    className={`w-full text-left p-3 border-b hover:bg-muted/50 transition ${selectedGrievance?.id === g.id ? "bg-muted" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="text-[10px]" style={{ backgroundColor: CATEGORY_COLORS[g.category], color: "#fff" }}>{g.category.replace(/_/g, " ")}</Badge>
                      <Badge className={`text-[10px] ${SEVERITY_COLORS[g.severity]}`}>{g.severity}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{g.patient_name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{g.description}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">{getTimeAgo(g.created_at)}</span>
                      {getSlaStatus(g)}
                    </div>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {/* Right detail */}
            <div className="flex-1 border rounded-lg overflow-hidden">
              {!selectedGrievance ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a grievance to view details</div>
              ) : (
                <ScrollArea className="h-full p-4">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{selectedGrievance.patient_name}</h3>
                        {selectedGrievance.patient_phone && <p className="text-sm text-muted-foreground flex items-center gap-1"><Phone size={12} />{selectedGrievance.patient_phone}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Badge className={SEVERITY_COLORS[selectedGrievance.severity]}>{selectedGrievance.severity}</Badge>
                        <Badge variant="outline">{selectedGrievance.channel}</Badge>
                      </div>
                    </div>

                    <p className="text-sm">{selectedGrievance.description}</p>

                    {/* SLA Stepper */}
                    <div className="flex items-center gap-1 py-2">
                      {STATUS_STEPS.map((s, i) => {
                        const currentIdx = STATUS_STEPS.indexOf(selectedGrievance.status);
                        const done = i <= currentIdx;
                        return (
                          <React.Fragment key={s}>
                            <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                              {done ? <CheckCircle size={12} /> : <Clock size={12} />}
                              {s.replace(/_/g, " ")}
                            </div>
                            {i < STATUS_STEPS.length - 1 && <div className={`h-0.5 w-4 ${done ? "bg-primary" : "bg-muted"}`} />}
                          </React.Fragment>
                        );
                      })}
                    </div>

                    {getSlaStatus(selectedGrievance)}

                    {/* Assignment */}
                    {selectedGrievance.status !== "resolved" && selectedGrievance.status !== "closed" && (
                      <Card className="p-3 space-y-2">
                        <p className="text-sm font-medium">Assign to Staff</p>
                        <div className="flex gap-2">
                          <Select value={assignTo} onValueChange={setAssignTo}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Select staff" /></SelectTrigger>
                            <SelectContent>
                              {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.full_name} ({s.role})</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button size="sm" onClick={assignGrievance} disabled={!assignTo}>Assign</Button>
                        </div>
                      </Card>
                    )}

                    {/* Resolution */}
                    {selectedGrievance.status !== "resolved" && selectedGrievance.status !== "closed" && (
                      <Card className="p-3 space-y-2">
                        <p className="text-sm font-medium">Resolution</p>
                        <Textarea placeholder="Root cause..." value={rootCause} onChange={e => setRootCause(e.target.value)} className="text-sm" rows={2} />
                        <Textarea placeholder="Resolution taken..." value={resolution} onChange={e => setResolution(e.target.value)} className="text-sm" rows={2} />
                        <Button size="sm" onClick={resolveGrievance} disabled={!resolution} className="bg-green-600 hover:bg-green-700">
                          <CheckCircle size={14} className="mr-1" />Mark Resolved
                        </Button>
                      </Card>
                    )}

                    {selectedGrievance.status === "resolved" && (
                      <Card className="p-3 bg-green-50 dark:bg-green-950/20 space-y-1">
                        <p className="text-sm font-medium text-green-700">✓ Resolved</p>
                        {selectedGrievance.root_cause && <p className="text-xs"><strong>Root cause:</strong> {selectedGrievance.root_cause}</p>}
                        <p className="text-xs"><strong>Resolution:</strong> {selectedGrievance.resolution}</p>
                        {selectedGrievance.tat_hours && <p className="text-xs text-muted-foreground">TAT: {selectedGrievance.tat_hours} hours</p>}
                      </Card>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 2 — Feedback */}
        <TabsContent value="feedback" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">Overall CSAT</p>
                <p className="text-2xl font-bold">{avgCsat}/5</p>
                <p>{renderStars(avgCsat)}</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">NPS Score</p>
                <p className={`text-2xl font-bold ${avgNps > 50 ? "text-green-600" : avgNps > 0 ? "text-yellow-600" : "text-red-600"}`}>{avgNps}</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xs text-muted-foreground">Responses This Month</p>
                <p className="text-2xl font-bold font-mono">{feedbackCount}</p>
              </Card>
            </div>
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Sentiment</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedbacks.map(f => (
                    <TableRow key={f.id} className={f.overall_csat && f.overall_csat <= 2 ? "bg-red-50 dark:bg-red-950/20" : ""}>
                      <TableCell><Badge variant="outline" className="text-xs">{f.channel}</Badge></TableCell>
                      <TableCell>{f.overall_csat ? renderStars(f.overall_csat) : "—"}</TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm">{f.comment || "—"}</TableCell>
                      <TableCell>
                        {f.sentiment && <Badge className={`text-[10px] ${f.sentiment === "positive" ? "bg-green-100 text-green-700" : f.sentiment === "negative" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}>{f.sentiment}</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{f.created_at ? format(new Date(f.created_at), "dd/MM/yy") : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {feedbacks.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No feedback records yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* TAB 3 — Visitor Passes */}
        <TabsContent value="visitors" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <Card className="p-2 bg-blue-50 dark:bg-blue-950/20 text-xs text-blue-700 shrink-0">
              <strong>ICU:</strong> Max 2 visitors per shift (9AM-1PM, 5PM-7PM only) · <strong>NICU:</strong> Parents only, max 2 hours per visit
            </Card>
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pass #</TableHead>
                    <TableHead>Visitor</TableHead>
                    <TableHead>Relation</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visitors.map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs">{v.pass_number}</TableCell>
                      <TableCell className="text-sm font-medium">{v.visitor_name}</TableCell>
                      <TableCell className="text-sm">{v.relation}</TableCell>
                      <TableCell className="text-xs">{v.scanned_entry_at ? format(new Date(v.scanned_entry_at), "HH:mm") : "—"}</TableCell>
                      <TableCell className="text-xs">{format(new Date(v.valid_until), "HH:mm")}</TableCell>
                      <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"} className="text-[10px]">{v.status}</Badge></TableCell>
                      <TableCell>
                        {v.status === "active" && !v.scanned_exit_at && (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => markExit(v.id)}>Mark Exit</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visitors.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No visitor passes issued</TableCell></TableRow>}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* TAB 4 — Patient Rights */}
        <TabsContent value="rights" className="flex-1 overflow-hidden">
          <div className="flex flex-col h-full gap-3">
            <Card className="p-2 bg-purple-50 dark:bg-purple-950/20 text-xs text-purple-700 shrink-0">
              <strong>NABH PCC.1:</strong> All admitted patients must acknowledge patient rights & responsibilities within 24 hours of admission.
            </Card>
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Admitted</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRights.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">{p.patient_name}</TableCell>
                      <TableCell className="text-sm">{p.ward_name}</TableCell>
                      <TableCell className="text-xs">{p.admitted_at ? format(new Date(p.admitted_at), "dd/MM/yy HH:mm") : "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" className="text-xs h-7" onClick={() => { setRightsPatient(p); setRightsModal(true); }}>Get Signature →</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {pendingRights.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-green-600 py-8">✓ All admitted patients have acknowledged rights</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* TAB 5 — Analytics */}
        <TabsContent value="analytics" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-2 gap-4 pb-4">
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">Grievance Categories</h3>
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                        {categoryData.map((c, i) => <Cell key={i} fill={c.fill} />)}
                      </Pie>
                      <ReTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-12">No data yet</p>}
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">SLA Compliance</h3>
                <div className="space-y-3 py-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Open Grievances</p>
                    <p className="text-3xl font-bold font-mono">{openGrievances}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">SLA Breached</p>
                    <p className="text-3xl font-bold font-mono text-red-600">{slaBreached}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Compliance Rate</p>
                    <p className="text-3xl font-bold font-mono text-green-600">
                      {openGrievances > 0 ? Math.round(((openGrievances - slaBreached) / openGrievances) * 100) : 100}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* New Grievance Modal */}
      <Dialog open={grievanceModal} onOpenChange={setGrievanceModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Grievance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Patient name *" value={gForm.patient_name} onChange={e => setGForm(f => ({ ...f, patient_name: e.target.value }))} />
            <Input placeholder="Phone number" value={gForm.patient_phone} onChange={e => setGForm(f => ({ ...f, patient_phone: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={gForm.category} onValueChange={v => setGForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CATEGORY_COLORS).map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={gForm.severity} onValueChange={v => setGForm(f => ({ ...f, severity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "critical"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Description *" value={gForm.description} onChange={e => setGForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            <Select value={gForm.channel} onValueChange={v => setGForm(f => ({ ...f, channel: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["counter", "portal", "whatsapp", "phone", "email", "written"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter><Button onClick={submitGrievance}>Submit Grievance</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visitor Pass Modal */}
      <Dialog open={visitorModal} onOpenChange={setVisitorModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Issue Visitor Pass</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Input placeholder="Search patient..." value={vForm.patient_search} onChange={e => searchPatients(e.target.value)} />
              {patientResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 bg-background border rounded-md shadow-md mt-1 max-h-32 overflow-auto">
                  {patientResults.map(p => (
                    <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => {
                      setVForm(f => ({ ...f, patient_id: p.id, patient_search: p.full_name }));
                      setPatientResults([]);
                    }}>{p.full_name} — {p.phone}</button>
                  ))}
                </div>
              )}
            </div>
            <Input placeholder="Visitor name *" value={vForm.visitor_name} onChange={e => setVForm(f => ({ ...f, visitor_name: e.target.value }))} />
            <Input placeholder="Relation *" value={vForm.relation} onChange={e => setVForm(f => ({ ...f, relation: e.target.value }))} />
            <Input placeholder="Visitor phone" value={vForm.visitor_phone} onChange={e => setVForm(f => ({ ...f, visitor_phone: e.target.value }))} />
            <Input placeholder="Purpose" value={vForm.purpose} onChange={e => setVForm(f => ({ ...f, purpose: e.target.value }))} />
            <div className="flex gap-2">
              {["1", "2", "4", "8"].map(h => (
                <Button key={h} size="sm" variant={vForm.valid_hours === h ? "default" : "outline"} className="text-xs" onClick={() => setVForm(f => ({ ...f, valid_hours: h }))}>{h}hr</Button>
              ))}
            </div>
          </div>
          <DialogFooter><Button onClick={issueVisitorPass}>Issue Pass</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rights Acknowledgement Modal */}
      <Dialog open={rightsModal} onOpenChange={setRightsModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>Patient Rights & Responsibilities</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-3">
            {["english", "hindi", "telugu", "tamil"].map(l => (
              <Button key={l} size="sm" variant={rightsLang === l ? "default" : "outline"} className="text-xs capitalize" onClick={() => setRightsLang(l)}>{l}</Button>
            ))}
          </div>
          <div className="border rounded-lg p-4 bg-muted/30 space-y-3 text-sm">
            <h3 className="font-bold text-center">PATIENT RIGHTS AND RESPONSIBILITIES</h3>
            <div>
              <p className="font-semibold mb-1">YOUR RIGHTS:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                {RIGHTS_EN.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </div>
            <div>
              <p className="font-semibold mb-1">YOUR RESPONSIBILITIES:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                {RESPONSIBILITIES_EN.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </div>
          </div>
          <div className="space-y-2 mt-3">
            <Input placeholder="Patient / Guardian Name" value={guardianName} onChange={e => setGuardianName(e.target.value)} />
            <Input placeholder="Witness Name (Nurse/PRO)" value={witnessName} onChange={e => setWitnessName(e.target.value)} />
            <p className="text-xs font-medium">Signature:</p>
            <canvas ref={canvasRef} width={400} height={120} className="border rounded cursor-crosshair w-full"
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={() => setIsDrawing(false)} onMouseLeave={() => setIsDrawing(false)} />
            <Button size="sm" variant="ghost" className="text-xs" onClick={clearCanvas}>Clear Signature</Button>
          </div>
          <DialogFooter><Button onClick={saveRightsAck}>Save Acknowledgement</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PROPage;
