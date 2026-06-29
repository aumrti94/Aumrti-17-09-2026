import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface AuditRecord {
  id: string;
  audit_title: string;
  audit_type: string;
  scheduled_date: string;
  conducted_date: string | null;
  auditor_name: string | null;
  chapters_covered: string[];
  findings: string | null;
  score_obtained: number | null;
  score_maximum: number | null;
  status: string;
}

const typeColors: Record<string, string> = {
  internal: "bg-blue-500",
  external: "bg-purple-500",
  nabh_surveillance: "bg-orange-500",
  nabh_accreditation: "bg-orange-600",
  peer: "bg-teal-500",
  unannounced: "bg-red-500",
};

interface Props {
  onScheduleAudit: () => void;
}

const AuditCalendarTab: React.FC<Props> = ({ onScheduleAudit }) => {
  const { toast } = useToast();
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [findings, setFindings] = useState("");
  const [score, setScore] = useState("");

  useEffect(() => {
    loadAudits();
  }, []);

  const loadAudits = async () => {
    const { data } = await supabase.from("audit_records").select("*").order("scheduled_date", { ascending: true });
    setAudits((data as any) || []);
    setLoading(false);
  };

  const markCompleted = async () => {
    if (!selected) return;
    await supabase.from("audit_records").update({
      status: "completed",
      conducted_date: new Date().toISOString().split("T")[0],
      findings,
      score_obtained: score ? parseFloat(score) : null,
      score_maximum: 100,
    }).eq("id", selected.id);
    toast({ title: "Audit marked as completed" });
    setSelected(null);
    loadAudits();
  };

  // Build 3-month calendar data
  const months: { label: string; days: { date: string; audits: AuditRecord[] }[] }[] = [];
  for (let m = 0; m < 3; m++) {
    const d = new Date();
    d.setMonth(d.getMonth() + m);
    const year = d.getFullYear();
    const month = d.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay();
    const days: { date: string; audits: AuditRecord[] }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      days.push({ date: dateStr, audits: audits.filter((a) => a.scheduled_date === dateStr) });
    }
    months.push({
      label: new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" }),
      days,
    });
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Mini calendar strips */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {months.map((m) => (
          <Card key={m.label} className="border">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-foreground mb-2">{m.label}</p>
              <div className="grid grid-cols-7 gap-0.5 text-[9px]">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} className="text-center text-muted-foreground font-medium py-0.5">{d}</div>
                ))}
                {/* Pad first row */}
                {Array.from({ length: new Date(m.days[0]?.date).getDay() }, (_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {m.days.map((day) => (
                  <div
                    key={day.date}
                    className={`text-center py-0.5 rounded relative ${day.audits.length > 0 ? "font-bold" : ""}`}
                  >
                    <span className="text-foreground">{parseInt(day.date.split("-")[2])}</span>
                    {day.audits.length > 0 && (
                      <div className="flex justify-center gap-0.5 mt-0.5">
                        {day.audits.map((a) => (
                          <div key={a.id} className={`w-1.5 h-1.5 rounded-full ${typeColors[a.audit_type] || "bg-primary"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Audit list */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">All Audits</h3>
        <Button size="sm" variant="outline" onClick={onScheduleAudit}>+ Schedule Audit</Button>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Title</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Auditor</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => { setSelected(a); setFindings(a.findings || ""); setScore(a.score_obtained?.toString() || ""); }}>
                <td className="px-3 py-2">{new Date(a.scheduled_date).toLocaleDateString()}</td>
                <td className="px-3 py-2 font-medium text-foreground">{a.audit_title}</td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="text-[9px]">{a.audit_type.replace("_", " ")}</Badge>
                </td>
                <td className="px-3 py-2">{a.auditor_name || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={a.status === "completed" ? "default" : "secondary"} className="text-[9px]">
                    {a.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]">View</Button>
                </td>
              </tr>
            ))}
            {audits.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No audits scheduled yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Audit detail dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{selected?.audit_title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[10px]">Type</Label><p className="font-medium">{selected?.audit_type}</p></div>
              <div><Label className="text-[10px]">Scheduled</Label><p className="font-medium">{selected?.scheduled_date}</p></div>
              <div><Label className="text-[10px]">Auditor</Label><p className="font-medium">{selected?.auditor_name || "—"}</p></div>
              <div><Label className="text-[10px]">Status</Label><p className="font-medium">{selected?.status}</p></div>
            </div>
            {selected?.chapters_covered && selected.chapters_covered.length > 0 && (
              <div>
                <Label className="text-[10px]">Chapters</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selected.chapters_covered.map((c) => (
                    <Badge key={c} variant="secondary" className="text-[9px]">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {selected?.status !== "completed" && (
              <>
                <div>
                  <Label className="text-[10px]">Findings</Label>
                  <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} className="mt-1 text-xs" rows={3} />
                </div>
                <div>
                  <Label className="text-[10px]">Score (%)</Label>
                  <Input type="number" value={score} onChange={(e) => setScore(e.target.value)} className="mt-1" />
                </div>
                <Button size="sm" className="w-full" onClick={markCompleted}>Mark Completed</Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuditCalendarTab;
