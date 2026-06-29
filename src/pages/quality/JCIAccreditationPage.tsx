import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Award, Download, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  compliant:       "bg-green-50 text-green-700 border-green-200",
  in_progress:     "bg-blue-50 text-blue-700 border-blue-200",
  non_compliant:   "bg-red-50 text-red-700 border-red-200",
  not_started:     "bg-muted text-muted-foreground border-border",
  not_applicable:  "bg-slate-50 text-slate-500 border-slate-200",
};

const IPSG_STANDARDS = [
  { code: "IPSG.1",   element: "Identify patients correctly",           desc: "Two patient identifiers used before every care, treatment, or service" },
  { code: "IPSG.2",   element: "Improve effective communication",       desc: "Verbal/telephone orders verified back and read-back protocol" },
  { code: "IPSG.2.1", element: "Critical results reporting",            desc: "Timely reporting of critical test results to responsible clinician" },
  { code: "IPSG.3",   element: "Improve high-alert medication safety",  desc: "High-alert medications identified, labelled, stored separately" },
  { code: "IPSG.3.1", element: "Anticoagulant safety",                  desc: "Anticoagulant therapy safety protocol in place" },
  { code: "IPSG.4",   element: "Ensure safe surgery — time-out",        desc: "Universal protocol: sign-in, time-out, sign-out for every surgical case" },
  { code: "IPSG.5",   element: "Reduce HAI — hand hygiene",             desc: "WHO multimodal hand hygiene improvement strategy implemented" },
  { code: "IPSG.6",   element: "Reduce harm from falls",                desc: "Fall risk assessment and prevention protocol for every patient" },
];

const JCI_CHAPTERS: Record<string, { code: string; element: string }[]> = {
  "ACC — Access to Care": [
    { code: "ACC.1",   element: "Screening at admission" },
    { code: "ACC.2",   element: "Registration and admission process" },
    { code: "ACC.3",   element: "Continuity of care" },
    { code: "ACC.4",   element: "Transfer of care" },
    { code: "ACC.5",   element: "Discharge planning" },
  ],
  "PFR — Patient Rights": [
    { code: "PFR.1",   element: "Patient rights respected and protected" },
    { code: "PFR.2",   element: "Informed consent obtained" },
    { code: "PFR.3",   element: "Complaint / grievance process" },
    { code: "PFR.4",   element: "Privacy and confidentiality" },
    { code: "PFR.5",   element: "Protection from abuse and neglect" },
  ],
  "COP — Care of Patients": [
    { code: "COP.1",   element: "Uniform care delivery across units" },
    { code: "COP.2",   element: "High-risk patient care" },
    { code: "COP.3",   element: "Resuscitation services" },
    { code: "COP.4",   element: "Medication management" },
    { code: "COP.5",   element: "Pain management" },
    { code: "COP.6",   element: "End-of-life care" },
  ],
  "ASC — Anaesthesia & Surgical Care": [
    { code: "ASC.1",   element: "Pre-anaesthesia assessment" },
    { code: "ASC.2",   element: "Anaesthesia care planned and documented" },
    { code: "ASC.3",   element: "Surgical procedure: plan and documentation" },
    { code: "ASC.4",   element: "Operative report" },
    { code: "ASC.5",   element: "Post-anaesthesia care" },
  ],
  "QPS — Quality Improvement": [
    { code: "QPS.1",   element: "Quality governance structure" },
    { code: "QPS.2",   element: "Priority QI activities defined" },
    { code: "QPS.3",   element: "Data collection for QI" },
    { code: "QPS.4",   element: "Data analysis and validation" },
    { code: "QPS.5",   element: "Adverse event analysis" },
  ],
};

export default function JCIAccreditationPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("ipsg");
  const [evidence, setEvidence] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({ "ACC — Access to Care": true });
  const [editRow, setEditRow] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ status: "not_started", evidence_text: "", score: "5" });

  const fetchEvidence = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("jci_evidence_items")
      .select("*")
      .eq("hospital_id", hospitalId);
    const map: Record<string, any> = {};
    (data || []).forEach((r: any) => { map[r.standard_code] = r; });
    setEvidence(map);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchEvidence(); }, [fetchEvidence]);

  const startEdit = (code: string) => {
    const existing = evidence[code];
    setEditForm({
      status: existing?.status || "not_started",
      evidence_text: existing?.evidence_text || "",
      score: String(existing?.score || "5"),
    });
    setEditRow(code);
  };

  const saveRow = async (code: string, chapter: string, element: string) => {
    if (!hospitalId) return;
    setSaving(code);
    await (supabase as any).from("jci_evidence_items").upsert({
      hospital_id: hospitalId,
      standard_code: code,
      chapter,
      element,
      status: editForm.status,
      evidence_text: editForm.evidence_text || null,
      score: parseInt(editForm.score),
      last_assessed: new Date().toISOString().split("T")[0],
      updated_at: new Date().toISOString(),
    }, { onConflict: "hospital_id,standard_code" });
    if (editForm.status === "compliant") {
      await logNABHEvidence(hospitalId, code, `JCI ${code} marked compliant — ${element}`, "compliant");
    }
    setSaving(null);
    setEditRow(null);
    fetchEvidence();
    toast({ title: `${code} saved` });
  };

  const overallScore = () => {
    const items = Object.values(evidence);
    if (!items.length) return 0;
    const scored = items.filter((i: any) => i.score > 0);
    if (!scored.length) return 0;
    return Math.round(scored.reduce((s: number, i: any) => s + i.score, 0) / scored.length * 10);
  };

  const countByStatus = (status: string) =>
    Object.values(evidence).filter((e: any) => e.status === status).length;

  const exportBundle = () => {
    const rows = [["Standard","Element","Status","Score","Evidence","Last Assessed"]];
    Object.values(evidence).forEach((e: any) => {
      rows.push([e.standard_code, e.element, e.status, e.score || "", e.evidence_text || "", e.last_assessed || ""]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `JCI_Evidence_Bundle_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
  };

  const renderRow = (code: string, element: string, chapter: string) => {
    const ev = evidence[code];
    const isEditing = editRow === code;
    return (
      <tr key={code} className="border-b border-border hover:bg-muted/20 transition-colors">
        <td className="px-4 py-2.5">
          <p className="text-[12px] font-mono font-bold text-foreground">{code}</p>
        </td>
        <td className="px-4 py-2.5">
          <p className="text-[12px] text-foreground">{element}</p>
        </td>
        <td className="px-4 py-2.5">
          {isEditing ? (
            <Select value={editForm.status} onValueChange={v => setEditForm(p => ({ ...p, status: v }))}>
              <SelectTrigger className="h-7 text-[11px] w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["not_started","in_progress","compliant","non_compliant","not_applicable"].map(s => (
                  <SelectItem key={s} value={s} className="text-[11px] capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", STATUS_STYLES[ev?.status || "not_started"])}>
              {(ev?.status || "not started").replace(/_/g, " ")}
            </span>
          )}
        </td>
        <td className="px-4 py-2.5">
          {isEditing ? (
            <input type="number" min={0} max={10} value={editForm.score}
              onChange={e => setEditForm(p => ({ ...p, score: e.target.value }))}
              className="h-7 w-14 border border-border rounded px-2 text-[11px]" />
          ) : (
            <span className="text-[12px] text-muted-foreground">{ev?.score ?? "—"}/10</span>
          )}
        </td>
        <td className="px-4 py-2.5 max-w-[200px]">
          {isEditing ? (
            <Textarea value={editForm.evidence_text}
              onChange={e => setEditForm(p => ({ ...p, evidence_text: e.target.value }))}
              rows={2} className="text-[11px] resize-none" placeholder="Evidence description…" />
          ) : (
            <p className="text-[11px] text-muted-foreground line-clamp-2">{ev?.evidence_text || "—"}</p>
          )}
        </td>
        <td className="px-4 py-2.5">
          {isEditing ? (
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => saveRow(code, chapter, element)} disabled={saving === code} className="h-7 text-[11px] gap-1">
                {saving === code ? <Loader2 size={10} className="animate-spin" /> : null}Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditRow(null)} className="h-7 text-[11px]">Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => startEdit(code)} className="h-7 text-[11px] text-primary">Edit</Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">JCI Accreditation</h1>
          <Badge variant="outline" className="text-[11px] ml-1">6th Edition</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={exportBundle} className="gap-1.5 h-8">
          <Download size={12} /> Export Evidence Bundle
        </Button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Score banner */}
          <div className="flex-shrink-0 grid grid-cols-5 gap-3 p-4 bg-muted/20 border-b border-border">
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <p className="text-[24px] font-bold text-foreground">{overallScore()}%</p>
              <p className="text-[11px] text-muted-foreground">Overall Score</p>
            </div>
            {[
              { l: "Compliant", v: countByStatus("compliant"), c: "text-green-600" },
              { l: "In Progress", v: countByStatus("in_progress"), c: "text-blue-600" },
              { l: "Non-Compliant", v: countByStatus("non_compliant"), c: "text-red-600" },
              { l: "Not Started", v: countByStatus("not_started"), c: "text-muted-foreground" },
            ].map(s => (
              <div key={s.l} className="bg-card border border-border rounded-xl p-3 text-center">
                <p className={cn("text-[22px] font-bold", s.c)}>{s.v}</p>
                <p className="text-[11px] text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
              <TabsTrigger value="ipsg" className="text-[13px]">IPSG 1–6</TabsTrigger>
              <TabsTrigger value="matrix" className="text-[13px]">Standards Matrix</TabsTrigger>
            </TabsList>

            {/* ── IPSG 1-6 ── */}
            <TabsContent value="ipsg" className="flex-1 overflow-auto p-5 m-0">
              <div className="max-w-3xl space-y-3">
                <p className="text-[12px] text-muted-foreground">International Patient Safety Goals — operational tracking</p>
                <div className="overflow-hidden border border-border rounded-xl">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50">
                      <tr>
                        {["Standard","Patient Safety Goal","Status","Score","Evidence","Action"].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {IPSG_STANDARDS.map(s => renderRow(s.code, s.element, "IPSG"))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* ── Standards Matrix ── */}
            <TabsContent value="matrix" className="flex-1 overflow-auto p-5 m-0">
              <div className="max-w-4xl space-y-4">
                {Object.entries(JCI_CHAPTERS).map(([chapter, standards]) => {
                  const expanded = expandedChapters[chapter];
                  const chapterCompliant = standards.filter(s => evidence[s.code]?.status === "compliant").length;
                  return (
                    <div key={chapter} className="border border-border rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedChapters(p => ({ ...p, [chapter]: !p[chapter] }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <p className="text-[13px] font-semibold text-foreground">{chapter}</p>
                        </div>
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium",
                          chapterCompliant === standards.length ? "bg-green-50 text-green-700 border-green-200" :
                          chapterCompliant > 0 ? "bg-blue-50 text-blue-700 border-blue-200" :
                          "bg-muted text-muted-foreground border-border"
                        )}>
                          {chapterCompliant}/{standards.length} compliant
                        </span>
                      </button>
                      {expanded && (
                        <table className="w-full text-[12px]">
                          <tbody>
                            {standards.map(s => renderRow(s.code, s.element, chapter.split(" — ")[0]))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
