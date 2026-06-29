import React, { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { RefreshCw, Package, ArrowUpDown, ClipboardList, Plus } from "lucide-react";
import SterilizeTab from "@/components/cssd/SterilizeTab";
import SetsInstrumentsTab from "@/components/cssd/SetsInstrumentsTab";
import IssueReturnTab from "@/components/cssd/IssueReturnTab";
import CSSDLogsTab from "@/components/cssd/CSSDLogsTab";

interface KPIs {
  sterile: number;
  dirty: number;
  quarantine: number;
  pendingBi: number;
}

const CSSDPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [tab, setTab] = useState("sterilize");
  const [kpis, setKpis] = useState<KPIs>({ sterile: 0, dirty: 0, quarantine: 0, pendingBi: 0 });
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [showIssue, setShowIssue] = useState(false);

  const fetchKpis = async () => {
    if (!hospitalId) return;
    const { data: sets } = await supabase.from("instrument_sets").select("status").eq("hospital_id", hospitalId);
    const { data: cycles } = await supabase.from("sterilization_cycles").select("bi_result, status").eq("hospital_id", hospitalId).eq("biological_indicator_used", true);
    if (sets) {
      setKpis({
        sterile: sets.filter((s: any) => s.status === "sterile").length,
        dirty: sets.filter((s: any) => s.status === "dirty" || s.status === "processing").length,
        quarantine: sets.filter((s: any) => s.status === "quarantine").length,
        pendingBi: cycles?.filter((c: any) => c.bi_result === "pending" && c.status === "in_progress").length || 0,
      });
    }
  };

  useEffect(() => { fetchKpis(); }, [hospitalId]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] bg-background border-b border-border px-5 flex items-center justify-between shrink-0">
        <span className="text-base font-bold text-foreground">🏥 CSSD — Central Sterile Supply</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-green-100 text-green-700 border-green-200">
            {kpis.sterile} Sets Ready
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
            {kpis.dirty} Awaiting Processing
          </span>
          {kpis.quarantine > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">
              {kpis.quarantine} Quarantined
            </span>
          )}
          {kpis.pendingBi > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
              {kpis.pendingBi} BI Pending
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowNewCycle(true); setTab("sterilize"); }}>
            <Plus className="w-4 h-4 mr-1" /> New Cycle
          </Button>
          <Button size="sm" onClick={() => { setShowIssue(true); setTab("issue"); }}>
            <ArrowUpDown className="w-4 h-4 mr-1" /> Issue Set to OT
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 w-full justify-start rounded-none border-b border-border bg-muted/30 px-4 shrink-0">
          <TabsTrigger value="sterilize" className="gap-1.5"><RefreshCw className="w-4 h-4" /> Sterilize</TabsTrigger>
          <TabsTrigger value="sets" className="gap-1.5"><Package className="w-4 h-4" /> Sets & Instruments</TabsTrigger>
          <TabsTrigger value="issue" className="gap-1.5"><ArrowUpDown className="w-4 h-4" /> Issue / Return</TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><ClipboardList className="w-4 h-4" /> Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="sterilize" className="flex-1 overflow-hidden m-0">
          <SterilizeTab showNewCycle={showNewCycle} onCloseNewCycle={() => setShowNewCycle(false)} onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="sets" className="flex-1 overflow-hidden m-0">
          <SetsInstrumentsTab onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="issue" className="flex-1 overflow-hidden m-0">
          <IssueReturnTab showIssue={showIssue} onCloseIssue={() => setShowIssue(false)} onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="logs" className="flex-1 overflow-hidden m-0">
          <CSSDLogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CSSDPage;
