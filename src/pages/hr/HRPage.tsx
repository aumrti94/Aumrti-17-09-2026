import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasTabAccess } from "@/lib/tabPermissions";
import { Calendar, CheckSquare, Palmtree, DollarSign, Users, FileText, ShieldCheck, AlertTriangle, Award, GraduationCap, Clock, BarChart2, Link2, Calculator, HeartPulse, Star, HeartHandshake } from "lucide-react";
import NABHBadge from "@/components/nabh/NABHBadge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import RosterTab from "@/components/hr/RosterTab";
import AttendanceTab from "@/components/hr/AttendanceTab";
import LeaveManagementTab from "@/components/hr/LeaveManagementTab";
import PayrollTab from "@/components/hr/PayrollTab";
import PayrollRunTab from "@/components/hr/PayrollRunTab";
import StaffDirectoryTab from "@/components/hr/StaffDirectoryTab";
import CredentialingTab from "@/components/hr/CredentialingTab";
import PrivilegesTab from "@/components/hr/PrivilegesTab";
import TrainingCMETab from "@/components/hr/TrainingCMETab";
import StaffInjuriesTab from "@/components/hr/StaffInjuriesTab";
import ExpiringCredentialsTab from "@/components/hr/ExpiringCredentialsTab";
import PayrollIntegrationsTab from "@/components/hr/PayrollIntegrationsTab";
import TrainingComplianceTab from "@/components/hr/TrainingComplianceTab";
import PerformanceAppraisalTab from "@/components/hr/PerformanceAppraisalTab";
import OccupationalHealthTab from "@/components/hr/OccupationalHealthTab";
import BurnoutRiskTab from "@/components/hr/BurnoutRiskTab";
import { Button } from "@/components/ui/button";
import { useCredentialAlert } from "@/contexts/CredentialAlertContext";

const navTabs = [
  { id: "roster",      label: "Roster",               icon: Calendar },
  { id: "attendance",  label: "Attendance",            icon: CheckSquare },
  { id: "leave",       label: "Leave Management",      icon: Palmtree },
  { id: "payroll",     label: "Payroll (Legacy)",      icon: DollarSign },
  { id: "payroll_run", label: "Payroll Run (PF/ESI/TDS)", icon: Calculator },
  { id: "directory",   label: "Staff Directory",       icon: Users },
  { id: "credentials", label: "Credentials",           icon: ShieldCheck },
  { id: "expiring",    label: "Expiring Credentials",  icon: Clock },
  { id: "privileges",  label: "Privileges",            icon: Award },
  { id: "training",    label: "Training & CME",        icon: GraduationCap },
  { id: "compliance",  label: "Training Compliance",   icon: BarChart2 },
  { id: "injuries",              label: "Injury Register",          icon: AlertTriangle },
  { id: "performance",           label: "Performance Appraisals",   icon: Star },
  { id: "occupational_health",   label: "Occupational Health",      icon: HeartPulse },
  { id: "burnout",               label: "Burnout Risk Monitor",     icon: HeartHandshake },
  { id: "payroll_integrations",  label: "Payroll Integrations",     icon: Link2 },
  { id: "reports",               label: "Reports",                  icon: FileText },
];

const HRPage: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const { permissions, role } = useHospitalContext();
  const { expiringCount } = useCredentialAlert();
  const [activeTab, setActiveTab] = useState("roster");
  const [kpis, setKpis] = useState({
    total: 0,
    present: 0,
    onLeave: 0,
    licenseAlerts: 0,
    privilegeReviews: 0,
    trainingOverdue: 0,
  });

  useEffect(() => {
    const loadKpis = async () => {
      if (!hospitalId) return;

      const today = new Date().toISOString().split("T")[0];
      const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString().split("T")[0];

      const [userData, attendance, licenseCount, privilegeCount, trainingCount] = await Promise.all([
        supabase.from("users").select("id").eq("is_active", true).eq("hospital_id", hospitalId),
        supabase.from("staff_attendance").select("status").eq("attendance_date", today).eq("hospital_id", hospitalId),
        (supabase as any).from("staff_credentials")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId)
          .not("expiry_date", "is", null)
          .lte("expiry_date", in30Days),
        (supabase as any).from("staff_privileges")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId)
          .eq("active", true)
          .not("review_due_date", "is", null)
          .lte("review_due_date", today),
        (supabase as any).from("staff_training_records")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId)
          .eq("completed", true)
          .in("training_type", ["BLS", "ALS", "Fire Safety", "NABH", "Infection Control", "Waste Management"])
          .lte("end_date", twoYearsAgo),
      ]);

      const total = userData.data?.length || 0;
      const present = attendance.data?.filter((a: any) => a.status === "present" || a.status === "late").length || 0;
      const onLeave = attendance.data?.filter((a: any) => a.status === "on_leave").length || 0;

      setKpis({
        total,
        present,
        onLeave,
        licenseAlerts: licenseCount.count || 0,
        privilegeReviews: privilegeCount.count || 0,
        trainingOverdue: trainingCount.count || 0,
      });
    };
    loadKpis();
  }, [activeTab, hospitalId]);

  const renderContent = () => {
    switch (activeTab) {
      case "roster":      return <RosterTab />;
      case "attendance":  return <AttendanceTab />;
      case "leave":       return <LeaveManagementTab />;
      case "payroll":     return <PayrollTab />;
      case "payroll_run": return <PayrollRunTab />;
      case "directory":   return <StaffDirectoryTab />;
      case "credentials": return hospitalId ? <CredentialingTab hospitalId={hospitalId} /> : null;
      case "expiring":    return <ExpiringCredentialsTab />;
      case "privileges":  return hospitalId ? <PrivilegesTab hospitalId={hospitalId} /> : null;
      case "training":    return hospitalId ? <TrainingCMETab hospitalId={hospitalId} /> : null;
      case "compliance":  return hospitalId ? <TrainingComplianceTab hospitalId={hospitalId} /> : null;
      case "injuries":               return <StaffInjuriesTab />;
      case "performance":            return hospitalId ? <PerformanceAppraisalTab hospitalId={hospitalId} /> : null;
      case "occupational_health":    return hospitalId ? <OccupationalHealthTab hospitalId={hospitalId} /> : null;
      case "burnout":                return hospitalId ? <BurnoutRiskTab hospitalId={hospitalId} /> : null;
      case "payroll_integrations":   return hospitalId ? <PayrollIntegrationsTab hospitalId={hospitalId} /> : null;
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Coming Soon</p>
              <p className="text-xs mt-1">This section is under development</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <span className="text-base font-bold text-foreground">HR & Staff</span>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
            👥 {kpis.total} Staff
          </span>
          <span className="text-xs px-3 py-1 rounded-full bg-success/10 text-success font-medium">
            ✓ {kpis.present} Present
          </span>
          {kpis.onLeave > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent-foreground font-medium">
              🏖️ {kpis.onLeave} Leave
            </span>
          )}
          {kpis.licenseAlerts > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-destructive/10 text-destructive font-medium">
              ⚠️ {kpis.licenseAlerts} License Alerts
            </span>
          )}
          {kpis.privilegeReviews > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">
              🏅 {kpis.privilegeReviews} Privilege Reviews
            </span>
          )}
          {kpis.trainingOverdue > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-destructive/10 text-destructive font-medium">
              🎓 {kpis.trainingOverdue} Training Overdue
            </span>
          )}
        </div>
        <NABHBadge standardCodes={["HRM.1", "HRM.2", "HRM.3", "HRM.5"]} />
        <Button size="sm" variant="outline" onClick={() => navigate("/settings/staff")}>
          + Add Staff
        </Button>
      </div>

      {/* Expiring credentials banner */}
      {expiringCount > 0 && (
        <div className="flex-shrink-0 bg-red-50 border-b border-red-200 px-5 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="text-sm text-red-700 font-medium">
            {expiringCount} credential{expiringCount !== 1 ? "s" : ""} expiring soon or already expired.
          </span>
          <button
            onClick={() => setActiveTab("expiring")}
            className="ml-auto text-xs text-red-700 font-semibold underline hover:no-underline"
          >
            Review →
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Nav */}
        <div className="w-[220px] bg-card border-r border-border flex flex-col overflow-y-auto">
          {navTabs.filter((tab) => hasTabAccess("hr", tab.id, permissions, role)).map((tab) => {
            const Icon = tab.icon;
            const isExpiring = tab.id === "expiring";
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left shrink-0",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{tab.label}</span>
                {isExpiring && expiringCount > 0 && (
                  <span className="h-5 min-w-[20px] rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center px-1 ml-1">
                    {expiringCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default HRPage;
