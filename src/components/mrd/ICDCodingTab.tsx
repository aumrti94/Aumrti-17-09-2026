import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Bot, Loader2, Library, Plus, DollarSign, AlertTriangle, CheckCircle2, Lock, ClipboardList } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { toast } from "sonner";
import { useAIAudit } from "@/hooks/useAIAudit";
import AIAuditLogDrawer from "@/components/ai/AIAuditLogDrawer";

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  coded: "bg-blue-100 text-blue-700",
  validated: "bg-green-100 text-green-700",
  billed: "bg-gray-100 text-gray-600",
  mrd_locked: "bg-violet-100 text-violet-700",
};

const MRD_LOCK_ROLES = ["mrd_officer", "super_admin", "hospital_admin"];

interface AISuggestion {
  primary_code: string;
  primary_description: string;
  confidence: number;
  secondary_suggestions?: { code: string; description: string }[];
  reasoning?: string;
}

interface Props {
  hospitalId: string;
  onRefresh?: () => void;
}

const ICDCodingTab: React.FC<Props> = ({ hospitalId, onRefresh }) => {
  const { logAudit } = useAIAudit();
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [primaryCode, setPrimaryCode] = useState("");
  const [primaryDesc, setPrimaryDesc] = useState("");
  const [pcsCode, setPcsCode] = useState("");
  const [secondaryCodes, setSecondaryCodes] = useState<{ code: string; description: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // AI suggestion state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [aiDismissed, setAiDismissed] = useState(false);

  // Revenue impact state
  const [revenueImpact, setRevenueImpact] = useState<{ amount: number; scheme: string } | null>(null);

  // MRD lock state
  const [lockJustification, setLockJustification] = useState("");
  const [locking, setLocking] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Audit log drawer
  const [auditOpen, setAuditOpen] = useState(false);

  useEffect(() => { if (hospitalId) fetchItems(); }, [filter, hospitalId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("role").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: any) => { if (data?.role) setUserRole(data.role); });
    });
  }, []);

  const fetchItems = async () => {
    if (!hospitalId) return;
    setLoading(true);
    let query = (supabase as any).from("icd_codings").select("*").eq("hospital_id", hospitalId).neq("visit_type", "opd").order("created_at", { ascending: false }).limit(100);
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) { toast.error(error.message); setLoading(false); return; }
    setItems(data || []);
    setLoading(false);
  };

  const incrementUseCount = async (code: string) => {
    try {
      await (supabase as any).rpc("increment_icd_use_count", { p_code: code });
    } catch (e) {
      console.warn("Failed to increment use_count:", e);
    }
  };

  const logAIAction = async (action: "accepted" | "rejected", code: string, reason?: string) => {
    try {
      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        feature_key: "icd_coding",
        module: "mrd",
        success: action === "accepted",
        input_summary: `Code: ${code} | Visit: ${selected?.visit_type}/${selected?.visit_id}`,
        output_summary: action === "accepted" ? `Accepted ${code}` : `Rejected ${code}: ${reason || "manual override"}`,
      });
    } catch (e) {
      console.warn("Failed to log AI action:", e);
    }
    // Also log to governance audit trail
    if (aiSuggestion) {
      const auditAction = action === "accepted" ? "accepted" : reason ? "overridden" : "rejected";
      await logAudit(
        {
          hospitalId,
          featureKey: "icd_coding",
          aiOutput: aiSuggestion as unknown as Record<string, unknown>,
          confidence: aiSuggestion.confidence,
          reasoning: aiSuggestion.reasoning,
        },
        auditAction,
        reason ? { value: reason, original_code: code } : undefined
      );
    }
  };

  const fetchRevenueImpact = async (icdCode: string) => {
    try {
      const { data } = await (supabase as any)
        .from("pmjay_packages")
        .select("package_name, package_rate, scheme_name")
        .ilike("procedure_code", `%${icdCode}%`)
        .limit(1);
      if (data && data.length > 0) {
        setRevenueImpact({ amount: data[0].package_rate, scheme: data[0].scheme_name || "PMJAY" });
      } else {
        setRevenueImpact(null);
      }
    } catch {
      setRevenueImpact(null);
    }
  };

  const suggestICDCode = useCallback(async (item: any) => {
    if (!item.visit_id || !item.visit_type || !hospitalId) return;
    if (item.ai_suggestion) return;

    setAiLoading(true);
    setAiSuggestion(null);
    setAiDismissed(false);

    try {
      const { data: efData, error: efError } = await supabase.functions.invoke("ai-icd-suggest", {
        body: { visit_type: item.visit_type, visit_id: item.visit_id, hospital_id: hospitalId },
      });

      let clinicalText = "";
      if (efError || efData?.error) {
        const errMsg = efData?.error || "";
        if (errMsg.includes("No clinical notes")) {
          toast.info("No clinical notes found — enter code manually");
        } else {
          console.warn("ICD edge function:", errMsg || efError);
        }
        return;
      }

      if (typeof efData === "string") {
        clinicalText = efData;
      } else if (efData?.clinical_text) {
        clinicalText = efData.clinical_text;
      } else if (efData?.primary_code) {
        setAiSuggestion(efData as AISuggestion);
        (supabase as any).from("icd_codings").update({
          ai_suggestion: efData.primary_code,
          ai_confidence: efData.confidence,
        }).eq("id", item.id).then(() => {});
        await incrementUseCount(efData.primary_code);
        return;
      }

      if (!clinicalText || clinicalText.trim().length < 10) {
        toast.info("Not enough clinical text for AI suggestion");
        return;
      }

      const { data: settings } = await (supabase as any)
        .from("hospital_icd_settings")
        .select("active_set, show_common_first")
        .eq("hospital_id", hospitalId)
        .maybeSingle();

      const activeSet = settings?.active_set || "all";
      const showCommonFirst = settings?.show_common_first ?? true;

      const searchTerms = clinicalText
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w: string) => w.length > 3)
        .slice(0, 5)
        .join(" | ");

      let query = (supabase as any)
        .from("icd10_codes")
        .select("code, description, category, chapter_desc")
        .eq("is_billable", true)
        .textSearch("description", searchTerms, { type: "websearch", config: "english" });

      if (activeSet === "system_only") {
        query = query.is("hospital_id", null);
      } else if (activeSet === "hospital_only") {
        query = query.eq("hospital_id", hospitalId);
      }

      if (showCommonFirst) {
        query = query.order("common_india", { ascending: false }).order("use_count", { ascending: false });
      }

      query = query.limit(20);
      const { data: candidates } = await query;

      let finalCandidates = candidates;

      if (!finalCandidates || finalCandidates.length === 0) {
        const firstTerm = searchTerms.split(" | ")[0];
        const { data: broadCandidates } = await (supabase as any)
          .from("icd10_codes")
          .select("code, description, category")
          .eq("is_billable", true)
          .ilike("description", `%${firstTerm}%`)
          .order("use_count", { ascending: false })
          .limit(10);

        if (!broadCandidates || broadCandidates.length === 0) {
          return;
        }
        finalCandidates = broadCandidates;
      }

      const codeList = finalCandidates
        .map((c: any) => `${c.code}: ${c.description} (${c.category || ""})`)
        .join("\n");

      const response = await callAI({
        featureKey: "icd_coding",
        hospitalId,
        prompt: `You are a medical coding specialist for an Indian hospital.

Clinical documentation:
"${clinicalText.slice(0, 800)}"

Select the most accurate primary ICD-10 code from this list ONLY.
Also suggest up to 3 secondary codes that commonly co-occur.
Do not suggest codes outside this list.

Available codes:
${codeList}

Return ONLY valid JSON (no markdown, no explanation):
{
  "primary_code": "exact code from list above",
  "primary_description": "exact description from list",
  "confidence": 0.85,
  "secondary_suggestions": [
    {"code": "code", "description": "description"}
  ],
  "reasoning": "one sentence why this code fits"
}`,
        maxTokens: 300,
      });

      if (response.error) {
        console.warn("AI unavailable:", response.error);
        return;
      }

      let parsed: AISuggestion | null = null;
      try {
        const clean = response.text
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(clean);
      } catch {
        return;
      }

      if (!parsed?.primary_code) return;

      // Confidence-based auto-fill
      if (parsed.confidence >= 0.80) {
        setPrimaryCode(parsed.primary_code);
        setPrimaryDesc(parsed.primary_description);
      }

      (supabase as any).from("icd_codings").update({
        ai_suggestion: parsed.primary_code,
        ai_confidence: parsed.confidence,
        primary_icd_code: parsed.confidence >= 0.80 ? parsed.primary_code : undefined,
        primary_icd_desc: parsed.confidence >= 0.80 ? parsed.primary_description : undefined,
      }).eq("id", item.id).then(() => {});

      setAiSuggestion(parsed);
      await incrementUseCount(parsed.primary_code);

    } catch (e) {
      console.error("ICD suggestion failed:", e);
    } finally {
      setAiLoading(false);
    }
  }, [hospitalId]);

  const selectItem = (item: any) => {
    setSelected(item);
    setPrimaryCode(item.primary_icd_code || "");
    setPrimaryDesc(item.primary_icd_desc || "");
    setPcsCode(item.pcs_code || "");
    setSecondaryCodes([]);
    setAiDismissed(false);
    setRevenueImpact(null);

    if (item.status === "validated" && item.primary_icd_code) {
      fetchRevenueImpact(item.primary_icd_code);
    }

    if (item.ai_suggestion) {
      setAiSuggestion({
        primary_code: item.ai_suggestion,
        primary_description: item.primary_icd_desc || item.ai_suggestion,
        confidence: item.ai_confidence || 0,
      });
      setAiLoading(false);
    } else {
      setAiSuggestion(null);
      if (item.status === "pending") {
        suggestICDCode(item);
      }
    }
  };

  const acceptAll = () => {
    if (!aiSuggestion) return;
    setPrimaryCode(aiSuggestion.primary_code);
    setPrimaryDesc(aiSuggestion.primary_description);
    if (aiSuggestion.secondary_suggestions) {
      setSecondaryCodes(aiSuggestion.secondary_suggestions);
    }
    logAIAction("accepted", aiSuggestion.primary_code);
    aiSuggestion.secondary_suggestions?.forEach((s) => incrementUseCount(s.code));
    toast.success("AI suggestion accepted");
  };

  const acceptPrimaryOnly = () => {
    if (!aiSuggestion) return;
    setPrimaryCode(aiSuggestion.primary_code);
    setPrimaryDesc(aiSuggestion.primary_description);
    logAIAction("accepted", aiSuggestion.primary_code);
    toast.success("Primary code accepted");
  };

  const addSecondaryCode = (code: string, description: string) => {
    if (secondaryCodes.find(s => s.code === code)) return;
    setSecondaryCodes(prev => [...prev, { code, description }]);
    incrementUseCount(code);
    toast.success(`Added secondary code: ${code}`);
  };

  const removeSecondaryCode = (code: string) => {
    setSecondaryCodes(prev => prev.filter(s => s.code !== code));
  };

  const dismissAI = () => {
    if (aiSuggestion) {
      logAIAction("rejected", aiSuggestion.primary_code, "dismissed by coder");
    }
    setAiDismissed(true);
  };

  const saveCoding = async (validate = false) => {
    if (!selected) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { data: userData } = await (supabase as any).from("users").select("id").eq("auth_user_id", user.id).maybeSingle();

    const updates: any = {
      primary_icd_code: primaryCode,
      primary_icd_desc: primaryDesc,
      pcs_code: pcsCode || null,
    };

    if (validate) {
      updates.status = "validated";
      updates.validated_by = userData?.id;
      updates.validated_at = new Date().toISOString();
    } else {
      updates.status = "coded";
      updates.coded_by = userData?.id;
      updates.coded_at = new Date().toISOString();
    }

    const { error } = await (supabase as any).from("icd_codings").update(updates).eq("id", selected.id);
    if (error) { toast.error(error.message); setSaving(false); return; }

    if (primaryCode) await incrementUseCount(primaryCode);

    // Log if AI suggestion was used or overridden
    if (aiSuggestion && primaryCode !== aiSuggestion.primary_code) {
      logAIAction("rejected", aiSuggestion.primary_code, `overridden with ${primaryCode}`);
    }

    if (validate) {
      fetchRevenueImpact(primaryCode);
    }

    toast.success(validate ? "Coding validated ✓" : "Coding saved");
    setSelected(null);
    setAiSuggestion(null);
    setSecondaryCodes([]);
    setSaving(false);
    fetchItems();
    onRefresh?.();
  };

  const lockICD = async () => {
    if (!selected || !lockJustification.trim()) {
      toast.error("Justification is required to lock the ICD code");
      return;
    }
    setLocking(true);
    const { error } = await (supabase as any).from("icd_codings").update({
      status: "mrd_locked",
      mrd_justification: lockJustification.trim(),
    }).eq("id", selected.id);
    if (error) { toast.error(error.message); setLocking(false); return; }
    toast.success("ICD code locked ✓ — PMJAY claim submission now unblocked");
    setLockJustification("");
    setSelected(null);
    fetchItems();
    onRefresh?.();
    setLocking(false);
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return "text-green-700";
    if (c >= 0.6) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <div className="flex gap-3 h-full">
      {/* Left panel - queue */}
      <div className="w-[300px] flex flex-col border rounded-lg bg-card">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v); setSelected(null); setLockJustification(""); }} className="p-2">
          <TabsList className="w-full flex-wrap h-auto gap-0.5">
            <TabsTrigger value="pending" className="flex-1 text-xs">Pending</TabsTrigger>
            <TabsTrigger value="coded" className="flex-1 text-xs">Coded</TabsTrigger>
            <TabsTrigger value="validated" className="flex-1 text-xs">Validated</TabsTrigger>
            <TabsTrigger value="mrd_locked" className="flex-1 text-xs">Locked</TabsTrigger>
            <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <ScrollArea className="flex-1">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">No items</p>
          ) : items.map((item) => (
            <button
              key={item.id}
              onClick={() => selectItem(item)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/50 transition-colors ${selected?.id === item.id ? "bg-muted" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{item.visit_type?.toUpperCase() || "—"}</span>
                <Badge variant="secondary" className={`text-[10px] ${statusColors[item.status]}`}>{item.status}</Badge>
              </div>
              {item.ai_suggestion && (
                <div className="text-[10px] text-accent-foreground mt-1 flex items-center gap-1">
                  <Bot className="h-3 w-3" /> AI: {item.ai_suggestion} ({Math.round((item.ai_confidence || 0) * 100)}%)
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {item.created_at ? new Date(item.created_at).toLocaleDateString("en-IN") : ""}
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Right panel - workspace */}
      <div className="flex-1 border rounded-lg bg-card p-4 overflow-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a coding item from the queue
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">ICD Coding Workspace</h3>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={() => setAuditOpen(true)}
              >
                <ClipboardList className="h-3.5 w-3.5" /> AI Audit Log
              </Button>
            </div>

            {/* AI Loading State */}
            {aiLoading && (
              <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-accent-foreground" />
                <span className="text-sm text-accent-foreground">🤖 Searching your ICD-10 library & analysing notes...</span>
              </div>
            )}

            {/* AI Suggestion Box */}
            {aiSuggestion && !aiDismissed && !aiLoading && (
              <div className={`rounded-lg p-3 space-y-2 border-l-[3px] ${
                aiSuggestion.confidence >= 0.80
                  ? "bg-emerald-50 border-l-emerald-500 dark:bg-emerald-950/20"
                  : aiSuggestion.confidence >= 0.60
                    ? "bg-accent/5 border-l-accent/50"
                    : "bg-amber-50 border-l-amber-500 dark:bg-amber-950/20"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-accent-foreground" />
                    <span className="text-sm font-semibold text-accent-foreground">AI Suggestion</span>
                    {aiSuggestion.confidence >= 0.80 ? (
                      <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> High confidence — auto-filled
                      </Badge>
                    ) : aiSuggestion.confidence < 0.60 ? (
                      <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" /> Low confidence — manual review
                      </Badge>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/20 gap-1">
                    <Library className="h-2.5 w-2.5" /> From your ICD-10 library
                  </Badge>
                </div>
                <div className="text-sm font-bold">
                  {aiSuggestion.primary_code} — {aiSuggestion.primary_description}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Confidence:</span>
                  <Progress value={(aiSuggestion.confidence || 0) * 100} className="h-2 flex-1 max-w-[200px]" />
                  <span className={`text-xs font-medium ${confidenceColor(aiSuggestion.confidence)}`}>
                    {Math.round((aiSuggestion.confidence || 0) * 100)}%
                  </span>
                </div>
                {aiSuggestion.reasoning && (
                  <p className="text-xs italic text-muted-foreground">{aiSuggestion.reasoning}</p>
                )}

                {/* Secondary code suggestions */}
                {aiSuggestion.secondary_suggestions && aiSuggestion.secondary_suggestions.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Common secondary codes for this case:</span>
                    <div className="space-y-1">
                      {aiSuggestion.secondary_suggestions.map((s, i) => (
                        <div key={i} className="flex items-center justify-between bg-background/60 rounded px-2 py-1">
                          <span className="text-xs">{s.code} — {s.description}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[10px] px-1.5"
                            onClick={() => addSecondaryCode(s.code, s.description)}
                            disabled={secondaryCodes.some(sc => sc.code === s.code)}
                          >
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="h-7 text-xs" onClick={acceptAll}>
                    <Check className="h-3 w-3 mr-1" /> Accept All
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={acceptPrimaryOnly}>
                    Accept Primary Only
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={dismissAI}>
                    <X className="h-3 w-3 mr-1" /> Dismiss
                  </Button>
                </div>
              </div>
            )}

            {/* Revenue Impact (for validated items) */}
            {selected.status === "validated" && revenueImpact && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                <span className="text-xs text-emerald-700 dark:text-emerald-400">
                  💰 <strong>Coding Impact:</strong> This episode coded correctly could attract <strong>₹{revenueImpact.amount.toLocaleString("en-IN")}</strong> under {revenueImpact.scheme} package
                </span>
              </div>
            )}

            {/* Locked read-only view */}
            {selected.status === "mrd_locked" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 rounded-lg px-3 py-2">
                  <Lock className="h-4 w-4 text-violet-600 shrink-0" />
                  <span className="text-sm font-semibold text-violet-700">MRD Locked — Read Only</span>
                  {selected.mrd_locked_at && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(selected.mrd_locked_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Primary ICD-10 Code</Label>
                  <Input value={selected.primary_icd_code || "—"} readOnly className="bg-muted/40 cursor-not-allowed" />
                  <Input value={selected.primary_icd_desc || "—"} readOnly className="bg-muted/40 cursor-not-allowed" />
                </div>
                {selected.mrd_justification && (
                  <div className="space-y-1">
                    <Label className="text-xs">MRD Justification</Label>
                    <div className="text-sm bg-muted/40 rounded-md px-3 py-2 text-muted-foreground leading-relaxed">
                      {selected.mrd_justification}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Primary ICD-10 */}
                <div className="space-y-2">
                  <Label className="text-xs">Primary ICD-10 Code</Label>
                  <Input value={primaryCode} onChange={(e) => setPrimaryCode(e.target.value)} placeholder="e.g. J18.9" />
                  <Input value={primaryDesc} onChange={(e) => setPrimaryDesc(e.target.value)} placeholder="Description" />
                </div>

                {/* Secondary Codes */}
                {secondaryCodes.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs">Secondary ICD-10 Codes</Label>
                    <div className="space-y-1">
                      {secondaryCodes.map((sc) => (
                        <div key={sc.code} className="flex items-center justify-between bg-muted rounded px-2 py-1">
                          <span className="text-xs font-medium">{sc.code} — {sc.description}</span>
                          <Button size="sm" variant="ghost" className="h-5 text-[10px] text-destructive" onClick={() => removeSecondaryCode(sc.code)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs">Procedure Code (PCS)</Label>
                  <Input value={pcsCode} onChange={(e) => setPcsCode(e.target.value)} placeholder="Optional procedure code" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => saveCoding(false)} disabled={saving || !primaryCode}>
                    Save Coding
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => saveCoding(true)} disabled={saving || !primaryCode}>
                    Validate & Finalise
                  </Button>
                </div>

                {/* Lock ICD section — MRD officer only, after coding is done */}
                {(selected.status === "coded" || selected.status === "validated") &&
                  userRole && MRD_LOCK_ROLES.includes(userRole) && (
                  <div className="border-t border-border pt-3 mt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 text-violet-600" />
                      <span className="text-xs font-semibold text-violet-700">Lock ICD (MRD Final)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Once locked, the code becomes immutable and PMJAY claim submission is unblocked.
                    </p>
                    <Textarea
                      value={lockJustification}
                      onChange={(e) => setLockJustification(e.target.value)}
                      placeholder="MRD justification for the final ICD selection (required)..."
                      rows={2}
                      className="text-xs resize-none"
                    />
                    <Button
                      size="sm"
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                      onClick={lockICD}
                      disabled={locking || !lockJustification.trim() || !primaryCode}
                    >
                      <Lock className="h-3 w-3" />
                      {locking ? "Locking..." : "Lock ICD"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <AIAuditLogDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        hospitalId={hospitalId}
      />
    </div>
  );
};

export default ICDCodingTab;
