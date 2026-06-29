import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Sparkles, Printer, Save, X,
  ShieldCheck, AlertTriangle, Activity, FlaskConical, ClipboardList, Users,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContextSummary {
  period?: string;
  safety_events?: { total: number; by_severity: Record<string, number>; by_type: Record<string, number>; open_sentinel_events: number };
  infection_control?: { total_new_events: number; by_type: Record<string, number>; device_related: number };
  clinical_audits?: { activity_count: number; by_status: Record<string, number>; recent_titles: string[] };
  capa?: { overdue_count: number; high_priority_overdue: number; top_overdue: { description: string; days_overdue: number; committee?: string }[] };
  nabh_compliance_changes?: { total_updated: number; moved_to_compliant: number; moved_to_non_compliant: number; new_critical_risks: number };
}

interface DigestResult {
  narrative: string;
  context_summary: ContextSummary;
}

interface Props {
  open: boolean;
  hospitalId: string;
  onClose: () => void;
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

const Stat = ({ label, value, colour }: { label: string; value: number | string; colour: string }) => (
  <div className={cn("flex items-center justify-between rounded px-2.5 py-1.5 text-xs", colour)}>
    <span className="text-current/70">{label}</span>
    <span className="font-bold ml-3">{value}</span>
  </div>
);

// ─── Collapsible context panel ────────────────────────────────────────────────

const ContextPanel = ({ summary }: { summary: ContextSummary }) => {
  const [open, setOpen] = useState(false);
  const s = summary.safety_events;
  const i = summary.infection_control;
  const a = summary.clinical_audits;
  const c = summary.capa;
  const n = summary.nabh_compliance_changes;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 text-xs font-medium transition-colors"
      >
        <span>Data snapshot ({summary.period ?? "last 7 days"})</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="p-3 grid grid-cols-2 gap-3 text-xs">
          {s && (
            <div className="space-y-1">
              <p className="font-semibold flex items-center gap-1 text-muted-foreground">
                <Activity className="h-3 w-3" /> Patient Safety
              </p>
              <Stat label="Total events" value={s.total} colour="bg-orange-50 text-orange-700" />
              <Stat label="Open sentinels" value={s.open_sentinel_events} colour={s.open_sentinel_events > 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"} />
              {Object.entries(s.by_severity).map(([k, v]) => (
                <Stat key={k} label={k} value={v} colour="bg-muted text-muted-foreground" />
              ))}
            </div>
          )}
          {i && (
            <div className="space-y-1">
              <p className="font-semibold flex items-center gap-1 text-muted-foreground">
                <FlaskConical className="h-3 w-3" /> Infection Control
              </p>
              <Stat label="New infections" value={i.total_new_events} colour="bg-purple-50 text-purple-700" />
              <Stat label="Device-related" value={i.device_related} colour={i.device_related > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"} />
              {Object.entries(i.by_type).map(([k, v]) => (
                <Stat key={k} label={k} value={v} colour="bg-muted text-muted-foreground" />
              ))}
            </div>
          )}
          {a && (
            <div className="space-y-1">
              <p className="font-semibold flex items-center gap-1 text-muted-foreground">
                <ClipboardList className="h-3 w-3" /> Clinical Audits
              </p>
              <Stat label="Activity (7 days)" value={a.activity_count} colour="bg-blue-50 text-blue-700" />
              {Object.entries(a.by_status).map(([k, v]) => (
                <Stat key={k} label={k} value={v} colour="bg-muted text-muted-foreground" />
              ))}
            </div>
          )}
          {c && (
            <div className="space-y-1">
              <p className="font-semibold flex items-center gap-1 text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> CAPA / Actions
              </p>
              <Stat label="Overdue actions" value={c.overdue_count} colour={c.overdue_count > 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"} />
              <Stat label="High priority" value={c.high_priority_overdue} colour={c.high_priority_overdue > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"} />
            </div>
          )}
          {n && (
            <div className="col-span-2 space-y-1">
              <p className="font-semibold flex items-center gap-1 text-muted-foreground">
                <ShieldCheck className="h-3 w-3" /> NABH Compliance Movement
              </p>
              <div className="flex gap-2">
                <Stat label="Standards updated" value={n.total_updated} colour="bg-indigo-50 text-indigo-700" />
                <Stat label="→ Compliant" value={n.moved_to_compliant} colour="bg-green-50 text-green-700" />
                <Stat label="→ Non-Compliant" value={n.moved_to_non_compliant} colour={n.moved_to_non_compliant > 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"} />
                <Stat label="New Critical" value={n.new_critical_risks} colour={n.new_critical_risks > 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const ALLOWED_ROLES = ["super_admin", "hospital_admin", "medical_superintendent", "quality_head", "quality_manager", "quality_officer"];

const WeeklyDigestModal: React.FC<Props> = ({ open, hospitalId, onClose }) => {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DigestResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const dateLabel = format(new Date(), "d MMM yyyy");

  // ── Generate ────────────────────────────────────────────────────────────────

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    setSavedId(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-nabh-assistant", {
        body: { hospital_id: hospitalId, context_type: "weekly_digest" },
      });
      if (error || (data as any)?.error) {
        const msg = error?.message || (data as any)?.error || "Generation failed";
        toast({ title: "Generation failed", description: msg, variant: "destructive" });
        return;
      }
      setResult(data as DigestResult);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ── Print ───────────────────────────────────────────────────────────────────

  const handlePrint = () => {
    if (!result) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const paragraphs = result.narrative
      .split("\n")
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return "<br/>";
        // Section headings are all-caps lines ending with ":"
        if (/^[A-Z &\/]+:/.test(trimmed)) {
          return `<h3 style="margin:14px 0 4px;font-size:12px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.5px">${trimmed}</h3>`;
        }
        return `<p style="margin:0 0 6px;font-size:11px;line-height:1.6">${trimmed}</p>`;
      })
      .join("");

    win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>NABH Weekly Quality Digest – ${dateLabel}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; }
  .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 16px; }
  .hospital { font-size: 10px; color: #666; margin-bottom: 4px; }
  .title { font-size: 17px; font-weight: 700; color: #1e3a5f; }
  .subtitle { font-size: 11px; color: #555; margin-top: 2px; }
  .narrative { margin-bottom: 20px; }
  .footer { margin-top: 30px; border-top: 1px solid #ccc; padding-top: 10px; display: flex; justify-content: space-between; }
  .sig { font-size: 10px; color: #555; }
  .sig strong { display: block; margin-top: 20px; border-top: 1px solid #999; padding-top: 4px; font-size: 10px; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div class="header">
  <div class="hospital">NABH Quality Management System</div>
  <div class="title">NABH Weekly Quality Digest</div>
  <div class="subtitle">Period: Last 7 days &nbsp;|&nbsp; Generated: ${dateLabel}</div>
</div>
<div class="narrative">${paragraphs}</div>
<div class="footer">
  <div class="sig">Prepared by<strong>Quality Department</strong></div>
  <div class="sig">Reviewed by<strong>Quality Head / Manager</strong></div>
  <div class="sig">Approved by<strong>Medical Superintendent</strong></div>
</div>
</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  // ── Save as Evidence ────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any)
        .from("nabh_evidence_items")
        .insert({
          hospital_id: hospitalId,
          title: `NABH Weekly Quality Digest – ${dateLabel}`,
          evidence_type: "Report",
          module_reference: "NABHMatrixPage",
          notes: result.narrative,
        })
        .select("id")
        .single();
      if (error) throw error;
      setSavedId(data?.id ?? "saved");
      toast({ title: "Evidence saved", description: "Weekly Digest added to NABH evidence repository." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <div>
              <h2 className="text-base font-bold">NABH Weekly Quality Digest</h2>
              <p className="text-xs text-muted-foreground">AI-generated · last 7 days · {dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {!result && !generating && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div className="rounded-full bg-violet-100 p-4">
                <Sparkles className="h-8 w-8 text-violet-600" />
              </div>
              <div>
                <p className="font-semibold text-base">Generate Weekly Quality Digest</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Fetches 7 days of safety events, IPC infections, audit activity, overdue CAPAs, and NABH compliance movement.
                  AI writes a concise narrative for the Medical Superintendent.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {["Patient Safety", "Infection Control", "Clinical Audits", "CAPA", "NABH Compliance"].map(t => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
            </div>
          )}

          {generating && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
              <p className="text-sm">Fetching data and generating digest…</p>
            </div>
          )}

          {result && (
            <>
              {/* Narrative */}
              <div className="bg-card border rounded-lg p-4">
                <div className="prose prose-sm max-w-none">
                  {result.narrative.split("\n").map((line, idx) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={idx} className="h-2" />;
                    if (/^[A-Z &\/]+:/.test(trimmed)) {
                      const [head, ...rest] = trimmed.split(":");
                      return (
                        <p key={idx} className="text-sm mt-3 mb-1">
                          <span className="font-bold text-foreground uppercase tracking-wide text-xs">{head}:</span>
                          {rest.length > 0 && <span className="text-muted-foreground font-normal normal-case tracking-normal">{rest.join(":")}</span>}
                        </p>
                      );
                    }
                    return <p key={idx} className="text-sm text-muted-foreground leading-relaxed">{trimmed}</p>;
                  })}
                </div>
              </div>

              {/* Context stats (collapsible) */}
              <ContextPanel summary={result.context_summary} />

              {savedId && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <ShieldCheck className="h-4 w-4" />
                  Saved to NABH evidence repository. Available in compliance matrix.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <div className="flex items-center gap-2">
            {result && (
              <>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1.5" /> Print
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={handleSave}
                  disabled={saving || !!savedId}
                >
                  {saving
                    ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    : <Save className="h-4 w-4 mr-1.5" />}
                  {savedId ? "Saved" : "Save as Evidence"}
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { setResult(null); setSavedId(null); }}
                >
                  Regenerate
                </Button>
              </>
            )}
            {!result && (
              <Button
                size="sm"
                onClick={generate}
                disabled={generating}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {generating
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-4 w-4 mr-1.5" /> Generate Digest</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { ALLOWED_ROLES as DIGEST_ALLOWED_ROLES };
export default WeeklyDigestModal;
