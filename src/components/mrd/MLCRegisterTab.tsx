import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { printDocument, printHeader } from "@/lib/printUtils";
import { Printer, Search } from "lucide-react";

interface MLCCase {
  id: string;
  mlc_number: string;
  case_type: string;
  incident_date: string | null;
  incident_place: string | null;
  police_station: string | null;
  police_informed: boolean;
  fir_number: string | null;
  created_at: string;
  patient: { full_name: string; uhid: string } | null;
  ed_visit: { triage_category: string } | null;
}

const CASE_TYPE_LABELS: Record<string, string> = {
  road_accident: "Road Traffic Accident",
  assault: "Assault / Violence",
  poisoning: "Poisoning",
  burns: "Burns",
  fall: "Fall from Height",
  sexual_assault: "Sexual Assault",
  other: "Other",
};

interface Props {
  hospitalId: string;
}

const MLCRegisterTab: React.FC<Props> = ({ hospitalId }) => {
  const [cases, setCases] = useState<MLCCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [caseTypeFilter, setCaseTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchCases = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    let query = (supabase as any)
      .from("mlc_cases")
      .select("id, mlc_number, case_type, incident_date, incident_place, police_station, police_informed, fir_number, created_at, patient:patients(full_name, uhid), ed_visit:ed_visits(triage_category)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });

    if (caseTypeFilter !== "all") {
      query = query.eq("case_type", caseTypeFilter);
    }
    if (dateFrom) {
      query = query.gte("created_at", dateFrom);
    }
    if (dateTo) {
      query = query.lte("created_at", dateTo + "T23:59:59");
    }

    const { data, error } = await query;
    if (!error) setCases(data || []);
    setLoading(false);
  }, [hospitalId, caseTypeFilter, dateFrom, dateTo]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const filtered = search
    ? cases.filter((c) =>
        c.mlc_number.toLowerCase().includes(search.toLowerCase()) ||
        (c.patient?.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.patient?.uhid || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.police_station || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.fir_number || "").toLowerCase().includes(search.toLowerCase())
      )
    : cases;

  const handlePrintRegister = async () => {
    const { data: hospital } = await supabase.from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();

    const rows = filtered.map((c, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td><b>${c.mlc_number}</b></td>
        <td>${c.patient?.full_name || "—"}<br><span style="font-size:10px;color:#64748b">${c.patient?.uhid || ""}</span></td>
        <td>${CASE_TYPE_LABELS[c.case_type] || c.case_type}</td>
        <td>${c.incident_date ? new Date(c.incident_date).toLocaleDateString("en-IN") : "—"}</td>
        <td>${c.incident_place || "—"}</td>
        <td>${c.police_station || "—"}</td>
        <td>${c.fir_number || "—"}</td>
        <td style="text-align:center">
          <span style="padding:2px 6px;border-radius:4px;font-size:10px;background:${c.police_informed ? "#dcfce7" : "#fee2e2"};color:${c.police_informed ? "#15803d" : "#dc2626"}">
            ${c.police_informed ? "Yes" : "No"}
          </span>
        </td>
        <td style="font-size:10px">${new Date(c.created_at).toLocaleDateString("en-IN")}</td>
      </tr>
    `).join("");

    const body = `
      ${printHeader(hospital?.name || "Hospital", "MLC REGISTER", `<p style="font-size:12px">${hospital?.address || ""}</p><p style="font-size:11px;color:#64748b">Generated: ${new Date().toLocaleString("en-IN")} — Total: ${filtered.length} cases</p>`)}
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:10px">
        <thead>
          <tr style="background:#1e293b;color:white">
            <th style="padding:6px 4px">#</th>
            <th style="padding:6px 4px">MLC No.</th>
            <th style="padding:6px 4px">Patient</th>
            <th style="padding:6px 4px">Case Type</th>
            <th style="padding:6px 4px">Incident Date</th>
            <th style="padding:6px 4px">Place</th>
            <th style="padding:6px 4px">Police Station</th>
            <th style="padding:6px 4px">FIR No.</th>
            <th style="padding:6px 4px">Police Informed</th>
            <th style="padding:6px 4px">Registered</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:40px;display:flex;justify-content:space-between;padding-top:20px;border-top:1px solid #e2e8f0;">
        <div style="text-align:center;width:40%"><div style="border-top:1px solid #334155;padding-top:4px;font-size:11px;color:#64748b">MRD Officer Signature</div></div>
        <div style="text-align:center;width:40%"><div style="border-top:1px solid #334155;padding-top:4px;font-size:11px;color:#64748b">Medical Superintendent Signature</div></div>
      </div>`;

    printDocument(`MLC_Register_${new Date().toISOString().slice(0, 10)}`, body);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MLC no., patient, FIR…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={caseTypeFilter} onValueChange={setCaseTypeFilter}>
          <SelectTrigger className="h-8 text-sm w-48">
            <SelectValue placeholder="All case types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Case Types</SelectItem>
            {Object.entries(CASE_TYPE_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" placeholder="From" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" placeholder="To" />
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-sm" onClick={handlePrintRegister} disabled={filtered.length === 0}>
          <Printer className="h-3.5 w-3.5" /> Print Register
        </Button>
        <span className="text-[11px] text-muted-foreground">{filtered.length} case{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading MLC cases…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center gap-2">
            <span className="text-2xl">⚖️</span>
            <p className="text-sm text-muted-foreground">No MLC cases found</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-muted/80">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground whitespace-nowrap">MLC No.</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground">Patient</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground">Case Type</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground whitespace-nowrap">Incident Date</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground">Place</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground">Police Station</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground">FIR No.</th>
                <th className="text-center px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground whitespace-nowrap">Police Informed</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground whitespace-nowrap">Registered On</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[12px] font-bold text-red-700">{c.mlc_number}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-foreground">{c.patient?.full_name || "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{c.patient?.uhid || ""}</p>
                  </td>
                  <td className="px-3 py-2.5 text-sm">{CASE_TYPE_LABELS[c.case_type] || c.case_type}</td>
                  <td className="px-3 py-2.5 text-sm whitespace-nowrap">
                    {c.incident_date ? new Date(c.incident_date).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-sm max-w-[140px] truncate">{c.incident_place || "—"}</td>
                  <td className="px-3 py-2.5 text-sm">{c.police_station || "—"}</td>
                  <td className="px-3 py-2.5 text-sm font-mono">{c.fir_number || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.police_informed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {c.police_informed ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                    {new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MLCRegisterTab;
