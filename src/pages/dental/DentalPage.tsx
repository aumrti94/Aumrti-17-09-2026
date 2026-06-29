import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Search, User, RefreshCw } from "lucide-react";
import ToothChartTab from "@/components/dental/ToothChartTab";
import PeriodontalTab from "@/components/dental/PeriodontalTab";
import TreatmentPlanTab from "@/components/dental/TreatmentPlanTab";
import LabOrdersTab from "@/components/dental/LabOrdersTab";
import type { ChartData } from "@/components/dental/FDIToothChart";

interface DentalToken {
  id: string;
  token_number: string;
  token_prefix: string;
  status: string;
  created_at: string;
  patient_id: string;
  doctor_id: string | null;
  patient?: {
    id: string;
    full_name: string;
    uhid: string;
    gender: string | null;
    dob: string | null;
  };
  doctor?: { full_name: string } | null;
}

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  const diff = Date.now() - new Date(dob).getTime();
  const years = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return `${years}y`;
}

const statusStyles: Record<string, string> = {
  waiting: "border-l-amber-400",
  called: "border-l-orange-400",
  in_consultation: "border-l-blue-400",
  completed: "border-l-green-400 opacity-60",
  no_show: "border-l-muted opacity-40",
  cancelled: "border-l-muted opacity-40",
};

const statusLabel: Record<string, string> = {
  waiting: "Waiting",
  called: "Called",
  in_consultation: "With Doctor",
  completed: "Done",
};

const DentalPage: React.FC = () => {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<DentalToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<DentalToken | null>(null);
  const [activeTab, setActiveTab] = useState("chart");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Chart state
  const [chartData, setChartData] = useState<ChartData>({});
  const [oralHygiene, setOralHygiene] = useState("");
  const [calculus, setCalculus] = useState("");
  const [softTissueNotes, setSoftTissueNotes] = useState("");
  const [chartId, setChartId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: userData } = await supabase
      .from("users")
      .select("id, hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData) { setLoading(false); return; }

    setHospitalId(userData.hospital_id);
    setUserId(userData.id);

    // Find dental department(s)
    const { data: depts } = await supabase
      .from("departments")
      .select("id")
      .eq("hospital_id", userData.hospital_id)
      .ilike("name", "%dental%");

    const deptIds = depts?.map(d => d.id) || [];

    if (deptIds.length === 0) {
      // No dental department — show message
      setTokens([]);
      setLoading(false);
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("opd_tokens")
      .select("id, token_number, token_prefix, status, created_at, patient_id, doctor_id, patient:patients(id, full_name, uhid, gender, dob), doctor:users!opd_tokens_doctor_id_fkey(full_name)")
      .eq("hospital_id", userData.hospital_id)
      .in("department_id", deptIds)
      .eq("visit_date", today)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching dental tokens:", error);
      toast({ title: "Failed to load dental queue", variant: "destructive" });
      setLoading(false);
      return;
    }
    setTokens((data as unknown as DentalToken[]) || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  // Realtime subscription
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("dental-tokens-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "opd_tokens", filter: `hospital_id=eq.${hospitalId}` }, () => fetchTokens())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, fetchTokens]);

  const selectToken = async (token: DentalToken) => {
    setSelectedToken(token);
    setActiveTab("chart");

    const patientId = token.patient?.id || token.patient_id;
    if (!hospitalId || !patientId) return;

    const { data } = await supabase
      .from("dental_charts")
      .select("*")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId)
      .order("chart_date", { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const c = data[0];
      setChartId(c.id);
      setChartData((c.chart_data as any) || {});
      setOralHygiene(c.oral_hygiene || "");
      setCalculus(c.calculus || "");
      setSoftTissueNotes(c.soft_tissue_notes || "");
    } else {
      setChartId(null);
      setChartData({});
      setOralHygiene("");
      setCalculus("");
      setSoftTissueNotes("");
    }
  };

  // Filter tokens by search
  const filtered = tokens.filter(t => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.patient?.full_name?.toLowerCase().includes(q) ||
      t.patient?.uhid?.toLowerCase().includes(q) ||
      t.token_number?.toLowerCase().includes(q)
    );
  });

  const patient = selectedToken?.patient;
  const patientId = patient?.id || selectedToken?.patient_id || "";

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0" style={{ height: 52 }}>
        <h1 className="text-base font-bold">🦷 Dental</h1>
        <div className="flex gap-2 items-center">
          <Badge variant="secondary" className="text-xs">
            {tokens.filter(t => !["completed","cancelled","no_show"].includes(t.status)).length} in queue
          </Badge>
          <Button size="sm" variant="outline" onClick={fetchTokens}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Token Queue */}
        <div className="w-[280px] border-r bg-card flex flex-col shrink-0">
          <div className="p-2 border-b">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search name / UHID / token"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1">
              {loading ? (
                <p className="text-center text-xs text-muted-foreground py-8">Loading queue…</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-muted-foreground">No dental patients in today's queue</p>
                  <p className="text-[10px] text-muted-foreground">
                    Register patients via OPD → select Dental department
                  </p>
                </div>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectToken(t)}
                    className={`w-full text-left p-2 rounded-md text-sm flex items-center gap-2 transition-colors border-l-4 mb-0.5 ${
                      statusStyles[t.status] || ""
                    } ${
                      selectedToken?.id === t.id ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-muted-foreground">
                        {t.token_prefix}{t.token_number}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-xs truncate">{t.patient?.full_name || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.patient?.uhid} · {t.patient?.gender || "—"} · {calcAge(t.patient?.dob ?? null)}
                      </p>
                    </div>
                    {statusLabel[t.status] && (
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {statusLabel[t.status]}
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedToken || !patient ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <span className="text-4xl">🦷</span>
                <p className="text-sm">Select a patient from today's dental queue</p>
                <p className="text-xs text-muted-foreground">
                  Patients appear here after OPD registration → Dental department
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3 shrink-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User size={16} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{patient.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {patient.uhid} · {patient.gender || "—"} · {calcAge(patient.dob)}
                    {selectedToken.doctor?.full_name && ` · Dr. ${selectedToken.doctor.full_name}`}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  {selectedToken.token_prefix}{selectedToken.token_number}
                </Badge>
                {chartId && <Badge variant="secondary" className="text-[10px]">Existing Chart</Badge>}
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="mx-4 mt-2 w-fit shrink-0">
                  <TabsTrigger value="chart">🦷 Tooth Chart</TabsTrigger>
                  <TabsTrigger value="perio">📊 Perio</TabsTrigger>
                  <TabsTrigger value="treatment">📋 Treatment Plan</TabsTrigger>
                  <TabsTrigger value="lab">🔬 Lab Orders</TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-hidden px-4 py-2">
                  <TabsContent value="chart" className="mt-0 h-full">
                    <ToothChartTab
                      patientId={patientId}
                      hospitalId={hospitalId || ""}
                      chartData={chartData}
                      setChartData={setChartData}
                      oralHygiene={oralHygiene}
                      setOralHygiene={setOralHygiene}
                      calculus={calculus}
                      setCalculus={setCalculus}
                      softTissueNotes={softTissueNotes}
                      setSoftTissueNotes={setSoftTissueNotes}
                      chartId={chartId}
                      userId={userId}
                    />
                  </TabsContent>
                  <TabsContent value="perio" className="mt-0 h-full">
                    <PeriodontalTab patientId={patientId} hospitalId={hospitalId || ""} userId={userId} />
                  </TabsContent>
                  <TabsContent value="treatment" className="mt-0 h-full">
                    <TreatmentPlanTab patientId={patientId} hospitalId={hospitalId || ""} userId={userId} />
                  </TabsContent>
                  <TabsContent value="lab" className="mt-0 h-full">
                    <LabOrdersTab patientId={patientId} hospitalId={hospitalId || ""} userId={userId} />
                  </TabsContent>
                </div>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DentalPage;
