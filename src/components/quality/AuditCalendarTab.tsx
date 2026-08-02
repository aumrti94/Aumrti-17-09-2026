import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

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

/** Max coloured dots drawn in a day cell before collapsing to "+n". */
const MAX_DOTS = 3;

/**
 * Local-safe YYYY-MM-DD. `new Date("2026-07-01")` parses as UTC midnight and
 * then reports the *local* day, which is off by one behind UTC — so dates are
 * always built from local components instead.
 */
const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Formats a YYYY-MM-DD string without going through UTC parsing. */
const formatISODate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

interface MonthGrid {
  label: string;
  key: string;
  firstDow: number;
  isCurrent: boolean;
  days: { date: string; audits: AuditRecord[] }[];
}

interface Props {
  onScheduleAudit: (date?: string) => void;
}

const AuditCalendarTab: React.FC<Props> = ({ onScheduleAudit }) => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [findings, setFindings] = useState("");
  const [score, setScore] = useState("");
  const [saving, setSaving] = useState(false);
  /** Whole-window shift in months; 0 keeps the current month centred. */
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadAudits = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error } = await supabase
      .from("audit_records")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("scheduled_date", { ascending: true });
    if (error) {
      toast({ title: "Could not load audits", description: error.message, variant: "destructive" });
    }
    setAudits((data as any) || []);
    setLoading(false);
  }, [hospitalId, toast]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  const markCompleted = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // Destructured and row-checked: audit_records had no UPDATE policy at all
      // until migration 20261011000090, so this silently matched zero rows while
      // still toasting success.
      const { data, error } = await supabase
        .from("audit_records")
        .update({
          status: "completed",
          conducted_date: toISODate(new Date()),
          findings,
          score_obtained: score ? parseFloat(score) : null,
          score_maximum: 100,
        })
        .eq("id", selected.id)
        .select("id");

      if (error) throw error;
      if (!data?.length) throw new Error("The audit was not updated. Please retry.");

      toast({ title: "Audit marked as completed" });
      setSelected(null);
      void loadAudits();
    } catch (err: any) {
      toast({ title: "Could not complete audit", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Three months: previous, current, next — current always in the middle.
  // Each month is built from an explicit day-1 date; mutating a single Date with
  // setMonth() skipped September entirely when run on the 31st, because
  // 31 September does not exist and rolls forward into October.
  const months = useMemo<MonthGrid[]>(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}`;
    const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);

    return [-1, 0, 1].map((delta) => {
      const first = new Date(base.getFullYear(), base.getMonth() + delta, 1);
      const year = first.getFullYear();
      const month = first.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const days = Array.from({ length: daysInMonth }, (_, i) => {
        const date = toISODate(new Date(year, month, i + 1));
        return { date, audits: audits.filter((a) => a.scheduled_date === date) };
      });

      return {
        key: `${year}-${month}`,
        label: first.toLocaleString(undefined, { month: "long", year: "numeric" }),
        firstDow: first.getDay(),
        isCurrent: `${year}-${month}` === todayKey,
        days,
      };
    });
  }, [audits, monthOffset]);

  const visibleAudits = useMemo(
    () => (selectedDate ? audits.filter((a) => a.scheduled_date === selectedDate) : audits),
    [audits, selectedDate],
  );

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Month window controls */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Audit Calendar
        </h3>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            aria-label="Previous month"
            onClick={() => setMonthOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] px-2"
            disabled={monthOffset === 0}
            onClick={() => setMonthOffset(0)}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            aria-label="Next month"
            onClick={() => setMonthOffset((o) => o + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mini calendar strips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {months.map((m) => (
          <Card key={m.key} className={m.isCurrent ? "border-primary/40" : "border"}>
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-foreground mb-2">
                {m.label}
                {m.isCurrent && (
                  <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">this month</span>
                )}
              </p>
              <div className="grid grid-cols-7 gap-0.5 text-[9px]">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} className="text-center text-muted-foreground font-medium py-0.5">{d}</div>
                ))}
                {/* Pad to the first weekday, using the value computed with the month. */}
                {Array.from({ length: m.firstDow }, (_, i) => <div key={`pad-${i}`} />)}
                {m.days.map((day) => {
                  const isSelected = selectedDate === day.date;
                  const count = day.audits.length;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setSelectedDate(isSelected ? null : day.date)}
                      aria-pressed={isSelected}
                      aria-label={`${formatISODate(day.date)}, ${count} audit${count === 1 ? "" : "s"}`}
                      className={`text-center py-0.5 rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        count > 0 ? "font-bold" : ""
                      } ${isSelected ? "ring-1 ring-primary bg-primary/10" : ""}`}
                    >
                      <span className="text-foreground">{parseInt(day.date.split("-")[2], 10)}</span>
                      {count > 0 && (
                        <span className="flex justify-center items-center gap-0.5 mt-0.5">
                          {day.audits.slice(0, MAX_DOTS).map((a) => (
                            <span
                              key={a.id}
                              className={`w-1.5 h-1.5 rounded-full ${typeColors[a.audit_type] || "bg-primary"}`}
                            />
                          ))}
                          {count > MAX_DOTS && (
                            <span className="text-[7px] text-muted-foreground leading-none">
                              +{count - MAX_DOTS}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Audit list — filtered to the selected day when one is picked */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {selectedDate ? formatISODate(selectedDate) : "All Audits"}
          </h3>
          {selectedDate && (
            <>
              <Badge variant="secondary" className="text-[9px]">
                {visibleAudits.length} scheduled
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] gap-1"
                onClick={() => setSelectedDate(null)}
              >
                <X className="h-3 w-3" /> Clear
              </Button>
            </>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => onScheduleAudit(selectedDate ?? undefined)}>
          + Schedule Audit
        </Button>
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
            {visibleAudits.map((a) => (
              <tr
                key={a.id}
                className="border-t border-border hover:bg-muted/30 cursor-pointer"
                onClick={() => {
                  setSelected(a);
                  setFindings(a.findings || "");
                  setScore(a.score_obtained?.toString() || "");
                }}
              >
                <td className="px-3 py-2">{formatISODate(a.scheduled_date)}</td>
                <td className="px-3 py-2 font-medium text-foreground">{a.audit_title}</td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="text-[9px]">{a.audit_type.replace(/_/g, " ")}</Badge>
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
            {visibleAudits.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  {selectedDate
                    ? `No audits scheduled on ${formatISODate(selectedDate)}`
                    : "No audits scheduled yet"}
                </td>
              </tr>
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
              <div><Label className="text-[10px]">Scheduled</Label><p className="font-medium">{selected ? formatISODate(selected.scheduled_date) : ""}</p></div>
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
                <Button size="sm" className="w-full" onClick={markCompleted} disabled={saving}>
                  {saving ? "Saving…" : "Mark Completed"}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuditCalendarTab;
