import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Loader2, Sparkles, X, ExternalLink, AlertTriangle, Bot,
  CheckCircle2, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GapInput {
  compliance_id: string;
  oe_code: string;
  chapter: string;
  standard_code: string;
  description: string;
  status: string;
}

interface Suggestion {
  compliance_id: string;
  oe_code: string;
  chapter: string;
  suggested_evidence_type: string;
  suggested_evidence_title: string;
  aumrti_module: string;
  aumrti_path: string;
  action_note: string;
  // description enriched client-side
  description?: string;
}

interface Props {
  open: boolean;
  hospitalId: string;
  onClose: () => void;
}

// ─── Evidence type badge colours (mirrors EvidenceManager) ───────────────────

const TYPE_COLOURS: Record<string, string> = {
  Policy:             "bg-blue-100 text-blue-700",
  SOP:                "bg-purple-100 text-purple-700",
  Form:               "bg-green-100 text-green-700",
  Record:             "bg-amber-100 text-amber-700",
  Report:             "bg-indigo-100 text-indigo-700",
  Audit:              "bg-orange-100 text-orange-700",
  Training:           "bg-cyan-100 text-cyan-700",
  Screenshot:         "bg-pink-100 text-pink-700",
  "Committee Minutes":"bg-teal-100 text-teal-700",
};

const STATUS_COLOURS: Record<string, string> = {
  "In Progress":       "bg-blue-50 text-blue-700",
  "Partially Compliant":"bg-amber-50 text-amber-700",
};

// ─── Phase types ──────────────────────────────────────────────────────────────

type Phase = "idle" | "loading" | "results" | "attesting" | "saved";

// ─── Component ────────────────────────────────────────────────────────────────

const EvidenceGapsModal: React.FC<Props> = ({ open, hospitalId, onClose }) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("idle");
  const [gapCount, setGapCount] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attested, setAttested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  // ── Fetch + AI call ─────────────────────────────────────────────────────────

  const run = useCallback(async () => {
    setPhase("loading");
    setSuggestions([]);
    setSelected(new Set());
    setAttested(false);

    try {
      // 1. Fetch compliance rows that are In Progress or Partially Compliant
      const { data: compRows, error: compErr } = await (supabase as any)
        .from("nabh_hospital_compliance")
        .select("id, status, nabh_standards(standard_code, objective_element_code, chapter_code, description)")
        .eq("hospital_id", hospitalId)
        .in("status", ["In Progress", "Partially Compliant"]);

      if (compErr) throw compErr;
      if (!compRows || compRows.length === 0) {
        toast({ title: "No gaps found", description: "All In Progress / Partially Compliant standards already have evidence, or none exist." });
        setPhase("idle");
        return;
      }

      // 2. Find which compliance IDs already have at least one evidence item
      const allIds = (compRows as any[]).map((r: any) => r.id);
      const { data: withEvidence } = await (supabase as any)
        .from("nabh_evidence_items")
        .select("nabh_compliance_id")
        .eq("hospital_id", hospitalId)
        .in("nabh_compliance_id", allIds)
        .not("nabh_compliance_id", "is", null);

      const coveredSet = new Set<string>(
        (withEvidence || []).map((e: any) => e.nabh_compliance_id as string),
      );

      // 3. Keep only those with 0 evidence items
      const gaps: GapInput[] = (compRows as any[])
        .filter((r: any) => !coveredSet.has(r.id))
        .slice(0, 25)
        .map((r: any) => ({
          compliance_id: r.id,
          oe_code: r.nabh_standards?.objective_element_code ?? r.nabh_standards?.standard_code ?? "—",
          chapter: r.nabh_standards?.chapter_code ?? "—",
          standard_code: r.nabh_standards?.standard_code ?? "—",
          description: (r.nabh_standards?.description ?? "").substring(0, 120),
          status: r.status,
        }));

      if (gaps.length === 0) {
        toast({ title: "No uncovered gaps", description: "All partially-compliant standards already have at least one evidence item attached." });
        setPhase("idle");
        return;
      }

      setGapCount(gaps.length);

      // 4. Call AI
      const { data: aiData, error: aiErr } = await supabase.functions.invoke("ai-nabh-assistant", {
        body: {
          hospital_id: hospitalId,
          context_type: "evidence_gaps",
          context_filter: { gaps },
        },
      });

      if (aiErr || (aiData as any)?.error) {
        const msg = aiErr?.message || (aiData as any)?.error || "AI call failed";
        throw new Error(msg);
      }

      // 5. Enrich suggestions with descriptions from the gaps list
      const descMap: Record<string, string> = {};
      const statusMap: Record<string, string> = {};
      gaps.forEach(g => {
        descMap[g.compliance_id] = g.description;
        statusMap[g.compliance_id] = g.status;
      });

      const enriched: Suggestion[] = ((aiData as any)?.suggestions ?? []).map((s: Suggestion) => ({
        ...s,
        description: descMap[s.compliance_id] ?? "",
        status: statusMap[s.compliance_id] ?? "",
      }));

      setSuggestions(enriched);
      // Select all by default
      setSelected(new Set(enriched.map(s => s.compliance_id)));
      setPhase("results");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Evidence gap analysis failed", description: msg, variant: "destructive" });
      setPhase("idle");
    }
  }, [hospitalId, toast]);

  // ── Toggle selection ────────────────────────────────────────────────────────

  const toggleAll = () => {
    if (selected.size === suggestions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(suggestions.map(s => s.compliance_id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Attestation accept → bulk save ─────────────────────────────────────────

  const handleSave = async () => {
    if (!attested) return;
    setSaving(true);
    const toSave = suggestions.filter(s => selected.has(s.compliance_id));
    try {
      const rows = toSave.map(s => ({
        hospital_id: hospitalId,
        nabh_compliance_id: s.compliance_id,
        title: s.suggested_evidence_title,
        evidence_type: s.suggested_evidence_type,
        module_reference: s.aumrti_module,
        notes: `[AI Suggested] ${s.action_note}`,
      }));
      const { error } = await (supabase as any).from("nabh_evidence_items").insert(rows);
      if (error) throw error;
      // Log attestation
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await (supabase as any).from("ai_attestations").insert({
          hospital_id: hospitalId,
          feature: "nabh_assistant",
          ai_output: { suggestions: toSave } as unknown as Record<string, unknown>,
          attested_by: user?.id ?? null,
          attested_at: new Date().toISOString(),
          edited_before_save: false,
          disclaimer_shown: true,
        });
      } catch (_) { /* non-blocking */ }

      setSavedCount(toSave.length);
      setPhase("saved");
      toast({ title: "Draft evidence items saved", description: `${toSave.length} items added. Open each standard to review.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Previewtext for attestation area ──────────────────────────────────────

  const selectedSuggestions = suggestions.filter(s => selected.has(s.compliance_id));
  const attestPreview = selectedSuggestions
    .map(s => `${s.oe_code} (${s.chapter}) — ${s.suggested_evidence_title} [${s.suggested_evidence_type}]\nAction: ${s.action_note}`)
    .join("\n\n");

  const handleClose = () => {
    setPhase("idle");
    setSuggestions([]);
    setSelected(new Set());
    setAttested(false);
    onClose();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <div>
              <h2 className="text-base font-bold">Find Evidence Gaps (AI)</h2>
              <p className="text-xs text-muted-foreground">
                Finds In Progress / Partially Compliant OEs with zero evidence → AI suggests what to collect
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Idle */}
          {phase === "idle" && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div className="rounded-full bg-violet-100 p-4">
                <Sparkles className="h-8 w-8 text-violet-600" />
              </div>
              <div>
                <p className="font-semibold text-base">AI Evidence Gap Analysis</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Scans all In Progress and Partially Compliant standards where no evidence has been
                  attached yet. AI suggests the specific evidence type and the Aumrti module to
                  generate it from.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center text-xs">
                <Badge variant="outline">Up to 25 OEs analysed</Badge>
                <Badge variant="outline">Zero-evidence gaps only</Badge>
                <Badge variant="outline">Module path included</Badge>
              </div>
            </div>
          )}

          {/* Loading */}
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
              <p className="text-sm">Scanning compliance records and querying AI…</p>
            </div>
          )}

          {/* Results */}
          {phase === "results" && suggestions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{suggestions.length}</span> gaps found
                  {gapCount > suggestions.length && ` (showing first 25 of ${gapCount})`}
                  {" · "}
                  <span className="font-semibold text-foreground">{selected.size}</span> selected
                </p>
                <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                  {selected.size === suggestions.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="px-2 py-2 w-8">
                        <Checkbox
                          checked={selected.size === suggestions.length}
                          onCheckedChange={toggleAll}
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">OE Code</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Gap Description</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Suggested Evidence</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Module</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map(s => (
                      <tr
                        key={s.compliance_id}
                        className={cn(
                          "border-b last:border-0 hover:bg-muted/20 align-top transition-colors cursor-pointer",
                          selected.has(s.compliance_id) ? "bg-violet-50/30" : "",
                        )}
                        onClick={() => toggleOne(s.compliance_id)}
                      >
                        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(s.compliance_id)}
                            onCheckedChange={() => toggleOne(s.compliance_id)}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono font-semibold text-foreground">{s.oe_code}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 w-fit">{s.chapter}</Badge>
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <p className="text-muted-foreground leading-snug line-clamp-2" title={s.description}>{s.description}</p>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] border-0",
                              STATUS_COLOURS[(s as any).status ?? ""] ?? "bg-muted text-muted-foreground"
                            )}
                          >
                            {(s as any).status ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] border-0 w-fit",
                                TYPE_COLOURS[s.suggested_evidence_type] ?? "bg-muted text-muted-foreground"
                              )}
                            >
                              {s.suggested_evidence_type}
                            </Badge>
                            <span className="text-[11px] font-medium text-foreground leading-snug max-w-[160px]" title={s.suggested_evidence_title}>
                              {s.suggested_evidence_title.length > 50
                                ? s.suggested_evidence_title.slice(0, 50) + "…"
                                : s.suggested_evidence_title}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[180px]">
                          <p className="text-muted-foreground text-[11px] leading-snug">{s.action_note}</p>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => { handleClose(); navigate(s.aumrti_path); }}
                            className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium transition-colors rounded px-1.5 py-1 hover:bg-blue-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {s.aumrti_module}
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* AI disclaimer */}
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>AI suggestions only.</strong> Review each recommendation before saving. Saved items are
                  marked as Draft — you must attach the actual document from the relevant module.
                </span>
              </div>
            </div>
          )}

          {/* Attestation panel */}
          {phase === "attesting" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-300 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>AI-Generated Content Warning:</strong> These evidence suggestions were generated by AI
                  based on NABH 6th Edition standards. Review each suggestion carefully before saving as draft
                  evidence items. You must subsequently attach the actual documents.
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-1.5">
                  Suggestions to save ({selected.size} items)
                </p>
                <div className="border rounded-lg p-3 bg-muted/30 max-h-48 overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap font-sans text-foreground leading-relaxed">
                    {attestPreview}
                  </pre>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="evidence-attest"
                  checked={attested}
                  onCheckedChange={v => setAttested(!!v)}
                />
                <Label htmlFor="evidence-attest" className="text-xs leading-relaxed cursor-pointer">
                  I have reviewed these AI-generated evidence suggestions, verified their relevance to each
                  NABH standard, and accept that these will be saved as <strong>draft</strong> items requiring
                  actual document attachment.
                </Label>
              </div>
            </div>
          )}

          {/* Saved */}
          {phase === "saved" && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-base text-emerald-700">
                  {savedCount} draft evidence items saved
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Open each standard in the compliance matrix to attach the actual documents.
                  Items are tagged as AI-suggested in the notes field.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t bg-muted/30 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {phase === "saved" ? "Close" : "Cancel"}
          </Button>

          <div className="flex items-center gap-2">
            {phase === "idle" && (
              <Button size="sm" onClick={run} className="bg-violet-600 hover:bg-violet-700 text-white">
                <Sparkles className="h-4 w-4 mr-1.5" />
                Analyse Gaps
              </Button>
            )}

            {phase === "results" && (
              <>
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button
                  size="sm"
                  onClick={() => setPhase("attesting")}
                  disabled={selected.size === 0}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  <Bot className="h-4 w-4 mr-1.5" />
                  Save {selected.size} as Draft Evidence
                </Button>
              </>
            )}

            {phase === "attesting" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setPhase("results")}>
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!attested || saving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {saving
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</>
                    : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Accept & Save {selected.size} Items</>}
                </Button>
              </>
            )}

            {phase === "saved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setSuggestions([]); setSelected(new Set()); setAttested(false); setPhase("idle"); }}
              >
                Run Again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EvidenceGapsModal;
