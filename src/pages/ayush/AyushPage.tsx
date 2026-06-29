import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConsultationTab from "@/components/ayush/ConsultationTab";
import PrakritiTab from "@/components/ayush/PrakritiTab";
import PanchakarmaTab from "@/components/ayush/PanchakarmaTab";
import PrescriptionsTab from "@/components/ayush/PrescriptionsTab";
import WalkInModal from "@/components/opd/WalkInModal";

type AyushSystem = "ayurveda" | "homeopathy" | "unani" | "siddha" | "yoga";

const SYSTEMS: { key: AyushSystem; label: string; icon: string }[] = [
  { key: "ayurveda", label: "Ayurveda", icon: "🌿" },
  { key: "homeopathy", label: "Homeopathy", icon: "💊" },
  { key: "unani", label: "Unani", icon: "🌙" },
  { key: "siddha", label: "Siddha", icon: "🪻" },
  { key: "yoga", label: "Yoga & Naturopathy", icon: "🧘" },
];

const SYSTEM_DEPT_MAP: Record<string, string[]> = {
  ayurveda: ["%ayurveda%", "%ayurved%"],
  homeopathy: ["%homeopathy%", "%homoeopathy%", "%homeo%"],
  unani: ["%unani%"],
  siddha: ["%siddha%"],
  yoga: ["%yoga%", "%naturopathy%", "%naturo%"],
};

export default function AyushPage() {
  const [system, setSystem] = useState<AyushSystem>("ayurveda");
  const [activeTab, setActiveTab] = useState("consultation");
  const [kpis, setKpis] = useState({ todayConsults: 0, todayPK: 0, activePatients: 0 });
  const [showNewConsult, setShowNewConsult] = useState(false);
  const [showNewPK, setShowNewPK] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [ayushDeptId, setAyushDeptId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (userData) setHospitalId(userData.hospital_id);
    };
    init();
  }, []);

  // Resolve AYUSH department ID for current system
  useEffect(() => {
    if (!hospitalId) return;
    const resolveDept = async () => {
      const patterns = SYSTEM_DEPT_MAP[system] || [`%${system}%`];
      for (const pattern of patterns) {
        const { data } = await supabase
          .from("departments")
          .select("id")
          .eq("hospital_id", hospitalId)
          .ilike("name", pattern)
          .limit(1);
        if (data && data.length > 0) {
          setAyushDeptId(data[0].id);
          return;
        }
      }
      setAyushDeptId(null);
    };
    resolveDept();
  }, [hospitalId, system]);

  useEffect(() => {
    loadKPIs();
  }, [system]);

  const loadKPIs = async () => {
    const today = new Date().toISOString().split("T")[0];
    const [consults, pk, active] = await Promise.all([
      supabase.from("ayush_encounters").select("id", { count: "exact", head: true })
        .eq("encounter_date", today).eq("system", system),
      supabase.from("panchakarma_schedules").select("id", { count: "exact", head: true })
        .eq("scheduled_date", today).eq("status", "scheduled"),
      supabase.from("ayush_encounters").select("patient_id", { count: "exact", head: true })
        .eq("system", system),
    ]);
    setKpis({
      todayConsults: consults.count || 0,
      todayPK: pk.count || 0,
      activePatients: active.count || 0,
    });
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b bg-background" style={{ height: 52 }}>
        <h1 className="text-base font-bold flex items-center gap-2">🌿 AYUSH & Integrative Medicine</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowWalkIn(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Consultation
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setActiveTab("panchakarma"); setShowNewPK(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Panchakarma
          </Button>
        </div>
      </div>

      {/* System Selector */}
      <div className="flex items-center gap-1 px-4 border-b bg-muted/30" style={{ height: 44 }}>
        {SYSTEMS.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={system === s.key ? "default" : "ghost"}
            className="text-xs"
            onClick={() => setSystem(s.key)}
          >
            {s.icon} {s.label}
          </Button>
        ))}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-3 px-4 py-2 border-b" style={{ height: 72 }}>
        <Card className="shadow-none border">
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Today's Consultations</p>
              <p className="text-xl font-bold font-mono">{kpis.todayConsults}</p>
            </div>
            <Badge variant="secondary">{system}</Badge>
          </CardContent>
        </Card>
        <Card className="shadow-none border">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Panchakarma Today</p>
            <p className="text-xl font-bold font-mono">{kpis.todayPK}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none border">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Active Patients</p>
            <p className="text-xl font-bold font-mono">{kpis.activePatients}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="consultation">📋 Consultation</TabsTrigger>
          <TabsTrigger value="prakriti">🧬 Prakriti</TabsTrigger>
          <TabsTrigger value="panchakarma">🛁 Panchakarma</TabsTrigger>
          <TabsTrigger value="prescriptions">💊 Prescriptions</TabsTrigger>
        </TabsList>
        <TabsContent value="consultation" className="flex-1 overflow-hidden m-0 p-0">
          <ConsultationTab system={system} showNew={showNewConsult} onShowNewDone={() => setShowNewConsult(false)} />
        </TabsContent>
        <TabsContent value="prakriti" className="flex-1 overflow-hidden m-0 p-0">
          <PrakritiTab />
        </TabsContent>
        <TabsContent value="panchakarma" className="flex-1 overflow-hidden m-0 p-0">
          <PanchakarmaTab showNew={showNewPK} onShowNewDone={() => setShowNewPK(false)} />
        </TabsContent>
        <TabsContent value="prescriptions" className="flex-1 overflow-hidden m-0 p-0">
          <PrescriptionsTab system={system} />
        </TabsContent>
      </Tabs>

      {/* WalkIn Registration Modal */}
      {showWalkIn && hospitalId && (
        <WalkInModal
          hospitalId={hospitalId}
          defaultDeptId={ayushDeptId || undefined}
          onClose={() => setShowWalkIn(false)}
          onCreated={() => {
            setShowWalkIn(false);
            setActiveTab("consultation");
            toast.success("Patient registered — token issued");
          }}
        />
      )}
    </div>
  );
}
