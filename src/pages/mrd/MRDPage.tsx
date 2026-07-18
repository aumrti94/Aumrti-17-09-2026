import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GatedTabsTrigger, GatedAction } from "@/components/access/GatedTabsTrigger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilePlus, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import RecordsIndexTab from "@/components/mrd/RecordsIndexTab";
import ICDCodingTab from "@/components/mrd/ICDCodingTab";
import RecordRequestsTab from "@/components/mrd/RecordRequestsTab";
import DeathCertificatesTab from "@/components/mrd/DeathCertificatesTab";
import RetentionTab from "@/components/mrd/RetentionTab";
import MaternityRegisterTab from "@/components/mrd/MaternityRegisterTab";
import MLCRegisterTab from "@/components/mrd/MLCRegisterTab";
import CodingAccuracyAuditPanel from "@/components/mrd/CodingAccuracyAuditPanel";

const MRDPage: React.FC = () => {
  const [kpis, setKpis] = useState({ totalRecords: 0, pendingCoding: 0, pendingRequests: 0, dueDestruction: 0 });
  const [activeTab, setActiveTab] = useState("records");
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [showDeathCert, setShowDeathCert] = useState(false);
  const [hospitalId, setHospitalId] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => { init(); }, []);

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await (supabase as any).from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!userData) return;
    setHospitalId(userData.hospital_id);
    setUserId(userData.id);
    fetchKPIs(userData.hospital_id);
  };

  const fetchKPIs = useCallback(async (hid?: string) => {
    const h = hid || hospitalId;
    if (!h) return;
    const [r1, r2, r3, r4] = await Promise.all([
      (supabase as any).from("medical_records").select("*", { count: "exact", head: true }).eq("hospital_id", h),
      (supabase as any).from("icd_codings").select("*", { count: "exact", head: true }).eq("hospital_id", h).eq("status", "pending"),
      (supabase as any).from("record_requests").select("*", { count: "exact", head: true }).eq("hospital_id", h).eq("status", "pending"),
      (supabase as any).from("retention_schedules").select("*", { count: "exact", head: true }).eq("hospital_id", h).eq("is_destroyed", false).lte("retain_until", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]),
    ]);
    setKpis({
      totalRecords: r1.count || 0,
      pendingCoding: r2.count || 0,
      pendingRequests: r3.count || 0,
      dueDestruction: r4.count || 0,
    });
  }, [hospitalId]);

  const handleNewRequest = () => {
    setActiveTab("requests");
    // Small delay to ensure tab mounts before opening modal
    setTimeout(() => setShowNewRequest(true), 50);
  };

  const handleDeathCert = () => {
    setActiveTab("death");
    setTimeout(() => setShowDeathCert(true), 50);
  };

  const kpiCards = [
    { label: "Total Records", value: kpis.totalRecords, color: "text-primary" },
    { label: "Pending ICD Coding", value: kpis.pendingCoding, color: "text-amber-600" },
    { label: "Pending Requests", value: kpis.pendingRequests, color: "text-blue-600" },
    { label: "Due for Destruction", value: kpis.dueDestruction, color: "text-destructive" },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background" style={{ height: 52 }}>
        <h1 className="text-base font-bold flex items-center gap-2">🗂️ Medical Records</h1>
        <div className="flex gap-2">
          <GatedAction module="mrd" action="new_request">
            <Button size="sm" variant="outline" onClick={handleNewRequest}>
              <FilePlus className="h-4 w-4 mr-1" /> New Record Request
            </Button>
          </GatedAction>
          <GatedAction module="mrd" action="death_certificate">
            <Button size="sm" variant="outline" onClick={handleDeathCert}>
              <ScrollText className="h-4 w-4 mr-1" /> Death Certificate
            </Button>
          </GatedAction>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3" style={{ height: 72 }}>
        {kpiCards.map((k) => (
          <Card key={k.label} className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-muted-foreground">{k.label}</span>
            <span className={`text-lg font-bold ${k.color}`}>{k.value}</span>
          </Card>
        ))}
      </div>

      {/* Tabs - controlled */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="w-fit" style={{ height: 44 }}>
          <GatedTabsTrigger module="mrd" value="records">📋 Records Index</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="icd">🏷️ ICD Coding</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="requests">📨 Requests</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="death">📜 Death Certs</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="retention">📅 Retention</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="maternity">🤱 Form 8</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="mlc">⚖️ MLC Register</GatedTabsTrigger>
          <GatedTabsTrigger module="mrd" value="coding_audit">🔍 Coding Audit</GatedTabsTrigger>
        </TabsList>

        <TabsContent value="records" className="flex-1 overflow-hidden mt-2">
          <RecordsIndexTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="icd" className="flex-1 overflow-hidden mt-2">
          <ICDCodingTab hospitalId={hospitalId} onRefresh={() => fetchKPIs()} />
        </TabsContent>
        <TabsContent value="requests" className="flex-1 overflow-hidden mt-2">
          <RecordRequestsTab hospitalId={hospitalId} userId={userId} showNewRequest={showNewRequest} onCloseNewRequest={() => setShowNewRequest(false)} onRefresh={() => fetchKPIs()} />
        </TabsContent>
        <TabsContent value="death" className="flex-1 overflow-hidden mt-2">
          <DeathCertificatesTab hospitalId={hospitalId} showCreate={showDeathCert} onCloseCreate={() => setShowDeathCert(false)} onRefresh={() => fetchKPIs()} />
        </TabsContent>
        <TabsContent value="retention" className="flex-1 overflow-hidden mt-2">
          <RetentionTab hospitalId={hospitalId} userId={userId} />
        </TabsContent>
        <TabsContent value="maternity" className="flex-1 overflow-hidden mt-2">
          <MaternityRegisterTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="mlc" className="flex-1 overflow-hidden mt-2">
          {hospitalId && <MLCRegisterTab hospitalId={hospitalId} />}
        </TabsContent>
        <TabsContent value="coding_audit" className="flex-1 overflow-hidden mt-2">
          {hospitalId && <CodingAccuracyAuditPanel hospitalId={hospitalId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MRDPage;
