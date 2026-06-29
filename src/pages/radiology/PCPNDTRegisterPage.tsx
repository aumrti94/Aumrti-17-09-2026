import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, Search, ChevronLeft, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PCPNDTRecord {
  id: string;
  form_number: string | null;
  created_at: string;
  patient_age: number | null;
  last_menstrual_period: string | null;
  gestational_age_weeks: number | null;
  indication: string | null;
  indication_category: string | null;
  referred_by: string | null;
  consent_given: boolean | null;
  no_sex_determination_declared: boolean | null;
  patients: { full_name: string; uhid: string } | null;
  radiology_orders: { study_name: string; order_date: string } | null;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function getMonthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1).toISOString();
  const to = new Date(y, m, 0, 23, 59, 59).toISOString();
  return { from, to };
}

const PCPNDTRegisterPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const navigate = useNavigate();
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["pcpndt-register", hospitalId, month, dateFrom, dateTo],
    queryFn: async () => {
      if (!hospitalId) return [];
      let query = (supabase as any)
        .from("pcpndt_records")
        .select(`
          id, form_number, created_at, patient_age,
          last_menstrual_period, gestational_age_weeks,
          indication, indication_category, referred_by,
          consent_given, no_sex_determination_declared,
          patients(full_name, uhid),
          radiology_orders(study_name, order_date)
        `)
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false });

      if (dateFrom) {
        query = query.gte("created_at", new Date(dateFrom).toISOString());
      } else if (month) {
        const { from } = getMonthRange(month);
        query = query.gte("created_at", from);
      }

      if (dateTo) {
        query = query.lte("created_at", new Date(dateTo + "T23:59:59").toISOString());
      } else if (month) {
        const { to } = getMonthRange(month);
        query = query.lte("created_at", to);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PCPNDTRecord[];
    },
    enabled: !!hospitalId,
  });

  const filtered = records.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.patients?.full_name?.toLowerCase().includes(q) ||
      r.patients?.uhid?.toLowerCase().includes(q) ||
      r.form_number?.toLowerCase().includes(q) ||
      r.referred_by?.toLowerCase().includes(q)
    );
  });

  const handleExportCSV = () => {
    const headers = [
      "Form No.", "Date", "Patient Name", "UHID", "Age", "Study",
      "LMP", "GA (weeks)", "Indication", "Referred By", "Consent", "Declaration",
    ];
    const rows = filtered.map((r) => [
      r.form_number || "",
      formatDate(r.created_at),
      r.patients?.full_name || "",
      r.patients?.uhid || "",
      r.patient_age ?? "",
      r.radiology_orders?.study_name || "",
      r.last_menstrual_period ? formatDate(r.last_menstrual_period) : "",
      r.gestational_age_weeks ?? "",
      r.indication || "",
      r.referred_by || "",
      r.consent_given ? "Yes" : "No",
      r.no_sex_determination_declared ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PCPNDT_Register_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const monthLabel = new Date(month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" });
    const rows = filtered.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.form_number || ""}</td>
        <td>${formatDate(r.created_at)}</td>
        <td>${r.patients?.full_name || ""}<br><small>${r.patients?.uhid || ""}</small></td>
        <td>${r.patient_age ?? ""}</td>
        <td>${r.radiology_orders?.study_name || ""}</td>
        <td>${r.last_menstrual_period ? formatDate(r.last_menstrual_period) : ""}</td>
        <td>${r.gestational_age_weeks != null ? r.gestational_age_weeks + " wks" : ""}</td>
        <td>${r.indication || ""}</td>
        <td>${r.referred_by || ""}</td>
        <td style="text-align:center">${r.consent_given ? "✓" : "✗"}</td>
        <td style="text-align:center">${r.no_sex_determination_declared ? "✓" : "✗"}</td>
      </tr>
    `).join("");

    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PCPNDT Register — ${monthLabel}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
          h2 { font-size: 14px; margin: 0 0 2px; }
          p { font-size: 11px; color: #666; margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #1e3a5f; color: white; padding: 5px 4px; text-align: left; font-size: 10px; }
          td { padding: 4px; border-bottom: 1px solid #e5e7eb; font-size: 10px; vertical-align: top; }
          tr:nth-child(even) td { background: #f9fafb; }
          .notice { background: #fef3c7; border: 1px solid #f59e0b; padding: 6px 10px; margin-bottom: 12px; font-size: 10px; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <h2>PCPNDT Form F Register</h2>
        <p>${monthLabel} — Total: ${filtered.length} cases</p>
        <div class="notice">⚖️ This register is maintained under the PC-PNDT Act, 1994. Confidential medical record.</div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Form No.</th><th>Date</th><th>Patient</th><th>Age</th>
              <th>Study</th><th>LMP</th><th>GA</th><th>Indication</th>
              <th>Referred By</th><th>Consent</th><th>Declaration</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:16px;font-size:10px;color:#999">Printed: ${new Date().toLocaleString("en-IN")}</p>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="flex flex-col h-full bg-muted/30">
      {/* Header */}
      <div className="shrink-0 bg-card border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/radiology")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold text-foreground">PCPNDT Register</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Form F records under PC-PNDT Act, 1994</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={handleExportCSV}>
              <Download size={12} /> Export CSV
            </Button>
            <Button size="sm" className="gap-1 h-8 text-xs bg-[hsl(220,55%,23%)] hover:bg-[hsl(220,55%,30%)]" onClick={handlePrint}>
              <Printer size={12} /> Print Register
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, UHID, form no..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Month:</label>
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setDateFrom(""); setDateTo(""); }}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground">From:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setMonth(""); }}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background"
            />
            <label className="text-xs text-muted-foreground">To:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setMonth(""); }}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background"
            />
          </div>
        </div>
      </div>

      {/* Legal notice */}
      <div className="mx-6 mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <AlertTriangle size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-amber-800">
          <strong>PCPNDT Act 1994:</strong> This register must be made available for inspection by the Appropriate Authority at any time. Records must be retained for at least 2 years.
        </p>
      </div>

      {/* Count */}
      <div className="mx-6 mt-2 text-xs text-muted-foreground">
        {isLoading ? "Loading..." : `${filtered.length} record${filtered.length !== 1 ? "s" : ""} found`}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto mx-6 mt-2 mb-6">
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[hsl(220,55%,23%)] text-white">
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">#</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Form No.</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Date</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Patient</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Age</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Study</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">LMP</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">GA</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px] max-w-[160px]">Indication</th>
                <th className="px-3 py-2.5 text-left font-semibold text-[11px]">Referred By</th>
                <th className="px-3 py-2.5 text-center font-semibold text-[11px]">Consent</th>
                <th className="px-3 py-2.5 text-center font-semibold text-[11px]">Declaration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">No PCPNDT records found for this period.</td></tr>
              )}
              {filtered.map((r, i) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                      {r.form_number || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-foreground">{r.patients?.full_name || "—"}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{r.patients?.uhid}</p>
                  </td>
                  <td className="px-3 py-2">{r.patient_age != null ? `${r.patient_age}y` : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.radiology_orders?.study_name || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.last_menstrual_period ? formatDate(r.last_menstrual_period) : "—"}</td>
                  <td className="px-3 py-2">{r.gestational_age_weeks != null ? `${r.gestational_age_weeks}w` : "—"}</td>
                  <td className="px-3 py-2 max-w-[160px]">
                    <p className="truncate" title={r.indication || ""}>{r.indication || "—"}</p>
                    {r.indication_category && (
                      <span className="text-[9px] text-violet-600 bg-violet-50 px-1 py-0.5 rounded">{r.indication_category.replace(/_/g, " ")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.referred_by || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {r.consent_given
                      ? <Badge className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 h-5">Yes</Badge>
                      : <Badge className="text-[9px] bg-red-50 text-red-700 border-red-200 h-5">No</Badge>
                    }
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.no_sex_determination_declared
                      ? <Badge className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 h-5">Yes</Badge>
                      : <Badge className="text-[9px] bg-red-50 text-red-700 border-red-200 h-5">No</Badge>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PCPNDTRegisterPage;
