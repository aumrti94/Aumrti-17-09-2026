import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Printer } from "lucide-react";
import { printDocument } from "@/lib/printUtils";

interface Props { hospitalId: string; }

interface MaternityRecord {
  id: string;
  patient_name: string;
  patient_age: number | null;
  admission_date: string | null;
  delivery_date: string | null;
  delivery_type: string | null;
  outcome: string | null;
  discharge_date: string | null;
  admission_number: string | null;
}

const MaternityRegisterTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<MaternityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("obstetric_records")
      .select(`
        id, delivery_date, delivery_type, outcome,
        admissions!obstetric_records_admission_id_fkey(
          admission_number, admitted_at, discharged_at,
          patients!admissions_patient_id_fkey(full_name, date_of_birth)
        )
      `)
      .eq("hospital_id", hospitalId)
      .gte("delivery_date", fromDate)
      .lte("delivery_date", toDate)
      .order("delivery_date", { ascending: false })
      .limit(200);

    setRecords((data || []).map((r: any, idx: number) => {
      const adm = r.admissions;
      const patient = adm?.patients;
      const dob = patient?.date_of_birth;
      const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : null;
      return {
        id: r.id,
        patient_name: patient?.full_name || "—",
        patient_age: age,
        admission_date: adm?.admitted_at ? adm.admitted_at.split("T")[0] : null,
        delivery_date: r.delivery_date || null,
        delivery_type: r.delivery_type || null,
        outcome: r.outcome || null,
        discharge_date: adm?.discharged_at ? adm.discharged_at.split("T")[0] : null,
        admission_number: adm?.admission_number || null,
      };
    }));
    setLoading(false);
  }, [hospitalId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const exportCSV = () => {
    const header = ["Sr.No.", "Admission No.", "Patient Name", "Age", "Admission Date", "Delivery Date", "Type of Delivery", "Outcome", "Discharge Date"].join(",");
    const rows = records.map((r, i) =>
      [i + 1, r.admission_number || "—", `"${r.patient_name}"`, r.patient_age ?? "—", r.admission_date || "—", r.delivery_date || "—", r.delivery_type || "—", r.outcome || "—", r.discharge_date || "—"].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Maternity_Register_Form8_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printForm8 = async () => {
    let hospitalName = "Hospital";
    const { data: h } = await (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
    if (h) hospitalName = h.name;

    const rows = records.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.admission_number || "—"}</td>
        <td>${r.patient_name}</td>
        <td style="text-align:center">${r.patient_age ?? "—"}</td>
        <td>${r.admission_date ? new Date(r.admission_date).toLocaleDateString("en-IN") : "—"}</td>
        <td>${r.delivery_date ? new Date(r.delivery_date).toLocaleDateString("en-IN") : "—"}</td>
        <td>${r.delivery_type || "—"}</td>
        <td>${r.outcome || "—"}</td>
        <td>${r.discharge_date ? new Date(r.discharge_date).toLocaleDateString("en-IN") : "—"}</td>
      </tr>`).join("");

    const body = `
      <div style="text-align:center;margin-bottom:16px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0">${hospitalName}</h2>
        <h3 style="font-size:13px;font-weight:600;margin:4px 0">FORM 8 — Maternity Register</h3>
        <p style="font-size:11px;color:#64748b;margin:0">Under the Maternity Benefit Act, 1961 | Period: ${fromDate} to ${toDate}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#1A2F5A;color:white;">
            <th style="padding:6px;border:1px solid #94a3b8">Sr.No.</th>
            <th style="padding:6px;border:1px solid #94a3b8;text-align:left">Adm. No.</th>
            <th style="padding:6px;border:1px solid #94a3b8;text-align:left">Patient Name</th>
            <th style="padding:6px;border:1px solid #94a3b8">Age</th>
            <th style="padding:6px;border:1px solid #94a3b8">Adm. Date</th>
            <th style="padding:6px;border:1px solid #94a3b8">Delivery Date</th>
            <th style="padding:6px;border:1px solid #94a3b8">Type of Delivery</th>
            <th style="padding:6px;border:1px solid #94a3b8">Outcome</th>
            <th style="padding:6px;border:1px solid #94a3b8">Discharge Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;font-size:10px;color:#64748b;">Total entries: ${records.length} | Generated: ${new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" })}</p>`;

    printDocument(`Maternity_Form8_${fromDate}_${toDate}`, body, { width: 1100, height: 800 });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card">
        <span className="text-xs font-semibold text-muted-foreground">Period:</span>
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-7 text-xs w-36" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-7 text-xs w-36" />
        <Button size="sm" onClick={load} className="h-7 text-xs">Load</Button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCSV} className="h-7 text-xs gap-1">
            <Download className="h-3 w-3" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={printForm8} className="h-7 text-xs gap-1">
            <Printer className="h-3 w-3" /> Print Form 8
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
        ) : records.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No obstetric records found for this period.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur z-10">
              <tr className="text-[10px] font-semibold text-muted-foreground uppercase border-b border-border">
                <th className="px-3 py-2 text-center">#</th>
                <th className="px-3 py-2 text-left">Adm. No.</th>
                <th className="px-3 py-2 text-left">Patient Name</th>
                <th className="px-3 py-2 text-center">Age</th>
                <th className="px-3 py-2">Adm. Date</th>
                <th className="px-3 py-2">Delivery Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Discharge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {records.map((r, i) => (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{r.admission_number || "—"}</td>
                  <td className="px-3 py-2 font-medium">{r.patient_name}</td>
                  <td className="px-3 py-2 text-center">{r.patient_age ?? "—"}</td>
                  <td className="px-3 py-2">{r.admission_date ? new Date(r.admission_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                  <td className="px-3 py-2">{r.delivery_date ? new Date(r.delivery_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                  <td className="px-3 py-2 capitalize">{r.delivery_type || "—"}</td>
                  <td className="px-3 py-2 capitalize">{r.outcome || "—"}</td>
                  <td className="px-3 py-2">{r.discharge_date ? new Date(r.discharge_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MaternityRegisterTab;
