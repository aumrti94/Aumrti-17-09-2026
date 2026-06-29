import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useHospitalId } from "@/hooks/useHospitalId";
import CouplesTab from "@/components/ivf/CouplesTab";
import CyclesTab from "@/components/ivf/CyclesTab";
import StimulationTab from "@/components/ivf/StimulationTab";
import EmbryologyTab from "@/components/ivf/EmbryologyTab";
import EmbryoBankTab from "@/components/ivf/EmbryoBankTab";
import AndrologyTab from "@/components/ivf/AndrologyTab";
import ICMRComplianceTab from "@/components/ivf/ICMRComplianceTab";

interface KPIs {
  activeCycles: number;
  monitoringToday: number;
  embryosStored: number;
  consentExpiring: number;
}

const IVFPage = () => {
  const { hospitalId } = useHospitalId();
  const [tab, setTab] = useState("couples");
  const [kpis, setKpis] = useState<KPIs>({ activeCycles: 0, monitoringToday: 0, embryosStored: 0, consentExpiring: 0 });
  const [showRegister, setShowRegister] = useState(false);
  const [showStartCycle, setShowStartCycle] = useState(false);

  const loadKPIs = async () => {
    if (!hospitalId) return;
    const today = new Date().toISOString().split("T")[0];
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    const [cycles, monitoring, stored, expiring] = await Promise.all([
      supabase.from("ivf_cycles").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .not("status", "in", '("positive","negative","cancelled")'),
      supabase.from("stimulation_monitoring").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("scan_date", today),
      supabase.from("embryo_bank").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("disposition", "stored"),
      supabase.from("embryo_bank").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("disposition", "stored").lte("consent_expiry", in30),
    ]);

    setKpis({
      activeCycles: cycles.count || 0,
      monitoringToday: monitoring.count || 0,
      embryosStored: stored.count || 0,
      consentExpiring: expiring.count || 0,
    });
  };

  useEffect(() => { loadKPIs(); }, [hospitalId]);

  const kpiCards = [
    { label: "Active Cycles", value: kpis.activeCycles, color: "text-primary" },
    { label: "Monitoring Today", value: kpis.monitoringToday, color: "text-teal-700" },
    { label: "Embryos Stored", value: kpis.embryosStored, color: "text-blue-700" },
    { label: "Consent Expiring", value: kpis.consentExpiring, color: kpis.consentExpiring > 0 ? "text-amber-600" : "text-muted-foreground" },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b bg-background" style={{ height: 52 }}>
        <h1 className="text-base font-bold">🧬 IVF & Assisted Reproduction</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowRegister(true); setTab("couples"); }}>
            + Register Couple
          </Button>
          <Button size="sm" onClick={() => { setShowStartCycle(true); setTab("cycles"); }}>
            + Start Cycle
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2 border-b" style={{ height: 72 }}>
        {kpiCards.map((k) => (
          <Card key={k.label} className="flex flex-col items-center justify-center p-2">
            <span className={`text-xl font-bold font-mono ${k.color}`}>{k.value}</span>
            <span className="text-xs text-muted-foreground">{k.label}</span>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="justify-start px-4 border-b rounded-none bg-background h-11 shrink-0">
          <TabsTrigger value="couples">👫 Couples</TabsTrigger>
          <TabsTrigger value="cycles">🔄 Cycles</TabsTrigger>
          <TabsTrigger value="stimulation">📊 Stimulation</TabsTrigger>
          <TabsTrigger value="embryology">🧫 Embryology</TabsTrigger>
          <TabsTrigger value="embryo-bank">❄️ Embryo Bank</TabsTrigger>
          <TabsTrigger value="andrology">💉 Andrology</TabsTrigger>
          <TabsTrigger value="icmr">📋 ICMR</TabsTrigger>
        </TabsList>

        <TabsContent value="couples" className="flex-1 overflow-auto m-0 p-4">
          <CouplesTab showRegister={showRegister} onCloseRegister={() => setShowRegister(false)} onRefreshKPIs={loadKPIs} />
        </TabsContent>
        <TabsContent value="cycles" className="flex-1 overflow-auto m-0 p-4">
          <CyclesTab showStartCycle={showStartCycle} onCloseStartCycle={() => setShowStartCycle(false)} onRefreshKPIs={loadKPIs} />
        </TabsContent>
        <TabsContent value="stimulation" className="flex-1 overflow-auto m-0 p-4">
          <StimulationTab />
        </TabsContent>
        <TabsContent value="embryology" className="flex-1 overflow-auto m-0 p-4">
          <EmbryologyTab />
        </TabsContent>
        <TabsContent value="embryo-bank" className="flex-1 overflow-auto m-0 p-4">
          <EmbryoBankTab onRefreshKPIs={loadKPIs} />
        </TabsContent>
        <TabsContent value="andrology" className="flex-1 overflow-auto m-0 p-4">
          <AndrologyTab />
        </TabsContent>
        <TabsContent value="icmr" className="flex-1 overflow-auto m-0 p-4">
          <ICMRComplianceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default IVFPage;
