import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Download, FileSpreadsheet, FileText, Table2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { DateRange } from "@/hooks/useAnalyticsData";

const EXPORT_SCOPES = [
  { id: "current", label: "Current Tab View" },
  { id: "full", label: "Full Analytics Report" },
  { id: "digest", label: "AI Digest" },
] as const;

const FORMATS = [
  { id: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet },
  { id: "pdf", label: "PDF Report", icon: FileText },
  { id: "csv", label: "CSV Data", icon: Table2 },
] as const;

const SECTIONS = [
  { id: "revenue", label: "Revenue Summary", default: true },
  { id: "clinical", label: "Clinical Statistics", default: true },
  { id: "doctors", label: "Doctor Performance", default: true },
  { id: "departments", label: "Department P&L", default: true },
  { id: "quality", label: "Quality Indicators", default: true },
  { id: "raw", label: "Raw Data Tables (large file)", default: false },
] as const;

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: DateRange;
  activeTab: string;
}

const ExportModal: React.FC<ExportModalProps> = ({ open, onOpenChange, range, activeTab }) => {
  const [scope, setScope] = useState<string>("current");
  const [format, setFormat] = useState<string>("xlsx");
  const [sections, setSections] = useState<Set<string>>(new Set(SECTIONS.filter(s => s.default).map(s => s.id)));
  const [loading, setLoading] = useState(false);

  const toggleSection = (id: string) => {
    setSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      const hospitalId = await getHospitalId();
      if (!hospitalId) throw new Error("No hospital");

      if (format === "pdf") {
        const { printDocument } = require("@/lib/printUtils");
        printDocument("Analytics Report", `<h2 style="color:#1A2F5A">Analytics Report</h2><p>Report exported from Aumrti HMS Analytics</p>`);
        toast.success("PDF print dialog opened ✓");
        onOpenChange(false);
        setLoading(false);
        return;
      }

      const wb = XLSX.utils.book_new();

      if (sections.has("revenue") && (scope !== "current" || activeTab === "revenue")) {
        const { data: bills } = await supabase.from("bills")
          .select("bill_date, bill_number, bill_type, total_amount, paid_amount, balance_due, payment_status")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .order("bill_date");

        const rows = (bills || []).map(b => ({
          Date: b.bill_date,
          "Bill #": b.bill_number,
          Type: b.bill_type,
          Billed: b.total_amount,
          Collected: b.paid_amount,
          Outstanding: b.balance_due,
          Status: b.payment_status,
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws, "Revenue");
      }

      if (sections.has("clinical") && (scope !== "current" || activeTab === "clinical")) {
        const { data: opd } = await supabase.from("opd_encounters")
          .select("created_at, token_id, chief_complaint, diagnosis")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
          .order("created_at");

        const rows = (opd || []).map(o => ({
          Date: o.created_at?.split("T")[0],
          Token: o.token_id,
          Complaint: o.chief_complaint,
          Diagnosis: o.diagnosis,
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "Clinical");
      }

      if (sections.has("doctors") && (scope !== "current" || activeTab === "doctors")) {
        const { data: docs } = await supabase.from("users")
          .select("full_name, role, department_id")
          .eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true);

        const ws = XLSX.utils.json_to_sheet((docs || []).map(d => ({
          Name: d.full_name, Role: d.role, Department: d.department_id,
        })));
        XLSX.utils.book_append_sheet(wb, ws, "Doctors");
      }

      if (sections.has("departments") && (scope !== "current" || activeTab === "departments")) {
        const { data: depts } = await supabase.from("departments")
          .select("name, type, is_active").eq("hospital_id", hospitalId);

        const ws = XLSX.utils.json_to_sheet((depts || []).map(d => ({
          Department: d.name, Type: d.type, Active: d.is_active ? "Yes" : "No",
        })));
        XLSX.utils.book_append_sheet(wb, ws, "Departments");
      }

      if (sections.has("quality") && (scope !== "current" || activeTab === "quality")) {
        const { data: qi } = await supabase.from("quality_indicators")
          .select("indicator_name, value, target, unit, category, period")
          .eq("hospital_id", hospitalId);

        const ws = XLSX.utils.json_to_sheet((qi || []).map(q => ({
          Indicator: q.indicator_name, Value: q.value, Target: q.target,
          Unit: q.unit, Category: q.category, Period: q.period,
        })));
        XLSX.utils.book_append_sheet(wb, ws, "Quality");
      }

      if (wb.SheetNames.length === 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No data selected"]]), "Empty");
      }

      if (format === "csv" && wb.SheetNames.length > 0) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `analytics_${range.from}_${range.to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        XLSX.writeFile(wb, `analytics_${range.from}_${range.to}.xlsx`);
      }

      toast.success("Report downloaded ✓");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Export Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scope */}
          <div className="space-y-2">
            <label className="text-[12px] font-medium text-muted-foreground uppercase">What to export</label>
            <div className="flex flex-col gap-1.5">
              {EXPORT_SCOPES.map(s => (
                <button key={s.id} onClick={() => setScope(s.id)}
                  className={cn("text-left px-3 py-2 rounded-lg text-[13px] border transition-colors",
                    scope === s.id ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
                  )}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground uppercase">Date Range</label>
            <p className="text-[13px] text-foreground">{range.from} → {range.to}</p>
          </div>

          {/* Format */}
          <div className="space-y-2">
            <label className="text-[12px] font-medium text-muted-foreground uppercase">Format</label>
            <div className="flex gap-2">
              {FORMATS.map(f => (
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={cn("flex-1 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border transition-colors",
                    format === f.id ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
                  )}>
                  <f.icon size={14} /> {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sections */}
          {scope === "full" && (
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-muted-foreground uppercase">Include sections</label>
              <div className="space-y-1.5">
                {SECTIONS.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <Checkbox checked={sections.has(s.id)} onCheckedChange={() => toggleSection(s.id)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleExport} disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Generate & Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExportModal;
