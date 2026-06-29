import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileSpreadsheet, Users, Receipt, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatDateTimeIST } from "@/lib/dateUtils";

interface AuditEntry {
  id: string;
  user_name: string | null;
  user_role: string | null;
  action: string;
  module: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any>;
  created_at: string;
}

const DATE_FILTERS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

function getDateFrom(filter: string): string | null {
  const now = new Date();
  if (filter === "today") return now.toISOString().split("T")[0];
  if (filter === "week") { now.setDate(now.getDate() - 7); return now.toISOString().split("T")[0]; }
  if (filter === "month") { now.setMonth(now.getMonth() - 1); return now.toISOString().split("T")[0]; }
  return null;
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const SettingsBackupPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("today");
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) return;
    setLoading(true);
    const dateFrom = getDateFrom(dateFilter);
    let query = (supabase as any).from("audit_log")
      .select("id, user_name, user_role, action, module, entity_type, entity_id, details, created_at")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    query.then(({ data }: any) => { setLogs(data || []); setLoading(false); });
  }, [hospitalId, dateFilter]);

  const formatDate = (iso: string) => formatDateTimeIST(iso);

  const exportAuditLog = () => {
    if (!logs.length) { toast({ title: "No audit data to export" }); return; }
    downloadCSV("audit_log.csv",
      ["Date", "User", "Role", "Action", "Module", "Entity Type", "Entity ID"],
      logs.map(l => [formatDate(l.created_at), l.user_name || "—", l.user_role || "—", l.action, l.module, l.entity_type || "", l.entity_id || ""])
    );
    toast({ title: "Audit log exported" });
  };

  const exportData = async (type: string) => {
    if (!hospitalId) return;
    setExporting(type);
    try {
      if (type === "patients") {
        const { data } = await supabase.from("patients").select("uhid, full_name, phone, gender, dob, blood_group, created_at").eq("hospital_id", hospitalId);
        if (!data?.length) { toast({ title: "No patient data" }); return; }
        downloadCSV("patients_export.csv",
          ["UHID", "Name", "Phone", "Gender", "DOB", "Blood Group", "Registered"],
          data.map(p => [p.uhid, p.full_name, p.phone || "", p.gender || "", p.dob || "", p.blood_group || "", p.created_at])
        );
      } else if (type === "bills") {
        const { data } = await supabase.from("bills").select("bill_number, bill_type, bill_date, total_amount, paid_amount, balance_due, payment_status, bill_status").eq("hospital_id", hospitalId).order("bill_date", { ascending: false });
        if (!data?.length) { toast({ title: "No bill data" }); return; }
        downloadCSV("bills_export.csv",
          ["Bill No", "Type", "Date", "Total", "Paid", "Balance", "Payment Status", "Bill Status"],
          data.map(b => [b.bill_number, b.bill_type, b.bill_date, String(b.total_amount), String(b.paid_amount), String(b.balance_due), b.payment_status, b.bill_status])
        );
      } else if (type === "staff") {
        const { data } = await supabase.from("users").select("full_name, role, email, phone, is_active").eq("hospital_id", hospitalId);
        if (!data?.length) { toast({ title: "No staff data" }); return; }
        downloadCSV("staff_export.csv",
          ["Name", "Role", "Email", "Phone", "Active"],
          data.map(u => [u.full_name || "", u.role || "", u.email || "", u.phone || "", u.is_active ? "Yes" : "No"])
        );
      }
      toast({ title: `${type} data exported` });
    } catch (err) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <SettingsPageWrapper title="Backup & Export" hideSave>
      <div className="space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Data Export</h2>
          <p className="text-sm text-muted-foreground mb-4">Export your hospital data at any time.</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Users, key: "patients", label: "Export All Patients", desc: "CSV of patients table" },
              { icon: Receipt, key: "bills", label: "Export All Bills", desc: "CSV of bills + payments" },
              { icon: FileSpreadsheet, key: "staff", label: "Export Staff Data", desc: "CSV of users + profiles" },
            ].map((e) => (
              <button key={e.key} onClick={() => exportData(e.key)}
                disabled={exporting === e.key}
                className="bg-card border border-border rounded-lg p-4 text-left hover:border-primary transition-colors disabled:opacity-50">
                {exporting === e.key ? <Loader2 size={20} className="text-muted-foreground mb-2 animate-spin" /> : <e.icon size={20} className="text-muted-foreground mb-2" />}
                <p className="text-sm font-medium text-foreground">{e.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{e.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-foreground">Audit Log</h2>
              <div className="flex gap-1">
                {DATE_FILTERS.map(f => (
                  <button key={f.value} onClick={() => setDateFilter(f.value)}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                      dateFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}>{f.label}</button>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={exportAuditLog}>
              <Download size={13} /> Export Audit Log
            </Button>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">User</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Action</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Module</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Entity</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading...
                  </td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No audit entries for this period
                  </td></tr>
                ) : logs.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">{formatDate(l.created_at)}</td>
                    <td className="px-3 py-2 text-foreground">{l.user_name || "System"}</td>
                    <td className="px-3 py-2 text-foreground capitalize">{l.action}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{l.module}</Badge></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.entity_type ? `${l.entity_type}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex items-start gap-3 bg-accent/30 border border-border rounded-lg p-4">
          <Info size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Automatic Backups</p>
            <p className="text-xs text-muted-foreground mt-1">Your data is automatically backed up daily. Point-in-time recovery available. Contact support for restore requests.</p>
          </div>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsBackupPage;
