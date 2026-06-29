import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Target, CalendarDays, AlertTriangle, RefreshCw, Bug, FlaskConical, Archive, ClipboardCheck, ShieldAlert, ClipboardList, TrendingUp, Building2, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import NABHDashboard from "@/components/quality/NABHDashboard";
import QualityIndicatorsTab from "@/components/quality/QualityIndicatorsTab";
import AuditCalendarTab from "@/components/quality/AuditCalendarTab";
import IncidentReportsTab from "@/components/quality/IncidentReportsTab";
import CAPATrackerTab from "@/components/quality/CAPATrackerTab";
import InfectionControlTab from "@/components/quality/InfectionControlTab";
import AntibioticStewardshipTab from "@/components/quality/AntibioticStewardshipTab";
import FileIncidentModal from "@/components/quality/FileIncidentModal";
import ScheduleAuditModal from "@/components/quality/ScheduleAuditModal";
import PainManagementTab from "@/components/quality/PainManagementTab";

const navTabs = [
  { id: "nabh", label: "NABH Dashboard", emoji: "📊" },
  { id: "indicators", label: "Quality Indicators", emoji: "🎯" },
  { id: "audits", label: "Audit Calendar", emoji: "📅" },
  { id: "incidents", label: "Incident Reports", emoji: "🚨" },
  { id: "capa", label: "CAPA Tracker", emoji: "🔄" },
  { id: "infection", label: "Infection Control", emoji: "🦠" },
  { id: "antibiotic", label: "Antibiotic Stewardship", emoji: "💊" },
  { id: "pain",       label: "Pain Management",        emoji: "🩹" },
];

const QualityPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("nabh");
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportingZip, setExportingZip] = useState(false);
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const exportNABHBundle = async () => {
    if (!hospitalId) return;
    setExportingZip(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const [evidenceRes, incidentRes, auditRes] = await Promise.all([
        (supabase as any).from("nabh_evidence_log").select("*").eq("hospital_id", hospitalId).order("logged_at", { ascending: false }).limit(500),
        (supabase as any).from("incident_reports").select("id, incident_date, incident_type, severity_level, description, status, reported_by, created_at").eq("hospital_id", hospitalId).order("incident_date", { ascending: false }).limit(500),
        (supabase as any).from("audit_logs").select("id, action, table_name, created_at, user_id").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(500),
      ]);

      const toCSV = (rows: any[], cols: string[]) => {
        const header = cols.join(",");
        const body = (rows || []).map(r =>
          cols.map(c => {
            const v = String(r[c] ?? "").replace(/"/g, '""');
            return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v}"` : v;
          }).join(",")
        ).join("\n");
        return header + "\n" + body;
      };

      zip.file("nabh_evidence_log.csv", toCSV(evidenceRes.data || [], ["id", "criterion_number", "description", "compliance_status", "logged_at", "logged_by"]));
      zip.file("incident_reports.csv", toCSV(incidentRes.data || [], ["id", "incident_date", "incident_type", "severity_level", "description", "status", "reported_by", "created_at"]));
      zip.file("audit_logs.csv", toCSV(auditRes.data || [], ["id", "action", "table_name", "user_id", "created_at"]));

      const { data: hosp } = await (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
      const hospitalName = (hosp?.name || "Hospital").replace(/\s+/g, "_");
      const date = new Date().toISOString().split("T")[0];

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NABH-Evidence-${hospitalName}-${date}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "NABH Evidence Bundle exported", description: `3 CSV files zipped — ${(blob.size / 1024).toFixed(0)} KB` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
    setExportingZip(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "nabh": return <NABHDashboard />;
      case "indicators": return <QualityIndicatorsTab />;
      case "audits": return <AuditCalendarTab onScheduleAudit={() => setAuditModalOpen(true)} />;
      case "incidents": return <IncidentReportsTab key={refreshKey} onFileIncident={() => setIncidentModalOpen(true)} />;
      case "capa": return <CAPATrackerTab />;
      case "infection": return <InfectionControlTab />;
      case "antibiotic": return <AntibioticStewardshipTab />;
      case "pain": return hospitalId ? <PainManagementTab hospitalId={hospitalId} /> : null;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <span className="text-base font-bold text-foreground">Quality & Compliance</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportNABHBundle} disabled={exportingZip}>
            <Archive className="h-3.5 w-3.5 mr-1" />
            {exportingZip ? "Exporting…" : "Export Evidence Bundle"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIncidentModalOpen(true)}>
            + File Incident
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAuditModalOpen(true)}>
            + Schedule Audit
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[220px] bg-card border-r border-border flex flex-col">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <span className="text-sm">{tab.emoji}</span>
              <span className="flex-1">{tab.label}</span>
            </button>
          ))}
          <div className="mt-auto border-t border-border">
            <button
              onClick={() => navigate("/quality/events")}
              className="h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left w-full text-muted-foreground hover:bg-muted/50 hover:text-primary"
            >
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span className="flex-1">Events & Incidents</span>
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1">→</span>
            </button>
            <button
              onClick={() => navigate("/nabh/compliance")}
              className="h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left w-full text-muted-foreground hover:bg-muted/50 hover:text-primary"
            >
              <ClipboardCheck className="h-4 w-4 shrink-0" />
              <span className="flex-1">NABH Matrix</span>
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1">→</span>
            </button>
            <button
              onClick={() => navigate("/quality/clinical-audits")}
              className="h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left w-full text-muted-foreground hover:bg-muted/50 hover:text-primary"
            >
              <ClipboardList className="h-4 w-4 shrink-0" />
              <span className="flex-1">Clinical Audits</span>
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1">→</span>
            </button>
            <button
              onClick={() => navigate("/quality/qi-projects")}
              className="h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left w-full text-muted-foreground hover:bg-muted/50 hover:text-primary"
            >
              <TrendingUp className="h-4 w-4 shrink-0" />
              <span className="flex-1">QI Projects</span>
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1">→</span>
            </button>
            <button
              onClick={() => navigate("/quality/committees")}
              className="h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left w-full text-muted-foreground hover:bg-muted/50 hover:text-primary"
            >
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="flex-1">Committees</span>
              <span className="text-[10px] bg-primary/10 text-primary rounded px-1">→</span>
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>

      <FileIncidentModal
        open={incidentModalOpen}
        onOpenChange={setIncidentModalOpen}
        onFiled={() => setRefreshKey((k) => k + 1)}
      />
      <ScheduleAuditModal open={auditModalOpen} onOpenChange={setAuditModalOpen} />
    </div>
  );
};

export default QualityPage;
