import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { callAI } from "@/lib/aiProvider";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck,
  Bot,
  Lock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { isBefore, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

export type PlanTier = "manual" | "ai_assisted" | "automated";

interface PolicyFields {
  insurerName: string;
  policyNumber: string;
  policyHolderName: string;
  sumInsured: string;
  validFrom: string;
  validTo: string;
  coPaymentPercent: string;
  roomRentLimit: string;
}

const CHECKLIST_ITEMS = [
  { id: "policy_active",    label: "Policy is active (not lapsed)" },
  { id: "patient_covered",  label: "Patient is covered (self / spouse / child / parent)" },
  { id: "waiting_period",   label: "Waiting period completed" },
  { id: "not_excluded",     label: "Procedure not in exclusion list" },
  { id: "sum_available",    label: "Sum insured available (not exhausted)" },
] as const;

type ChecklistId = (typeof CHECKLIST_ITEMS)[number]["id"];

export interface PolicyVerificationData {
  fields: PolicyFields;
  checklist: { id: string; label: string; checked: boolean }[];
}

interface Props {
  planTier: PlanTier;
  hospitalId: string;
  tpaName?: string;
  tpaCode?: string;
  patientName?: string;
  initialPolicyNumber?: string;
  onVerified: (data: PolicyVerificationData) => void;
  onUnverified: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const emptyChecklist = (): Record<ChecklistId, boolean> =>
  Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, false])) as Record<ChecklistId, boolean>;

const confidenceColor = (c: number) =>
  c >= 0.8 ? "text-emerald-600" : c >= 0.5 ? "text-amber-600" : "text-red-500";

// ── Component ──────────────────────────────────────────────────────────────

const PolicyVerificationPanel: React.FC<Props> = ({
  planTier,
  hospitalId,
  tpaName = "",
  tpaCode = "",
  patientName = "",
  initialPolicyNumber = "",
  onVerified,
  onUnverified,
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fields, setFields] = useState<PolicyFields>({
    insurerName: tpaName,
    policyNumber: initialPolicyNumber,
    policyHolderName: "",
    sumInsured: "",
    validFrom: "",
    validTo: "",
    coPaymentPercent: "",
    roomRentLimit: "",
  });

  // Sync insurer name when TPA selection changes in the parent form
  useEffect(() => {
    if (tpaName) setFields((p) => ({ ...p, insurerName: tpaName }));
  }, [tpaName]);

  // Sync policy number when parent form value changes (e.g. loaded from DB)
  useEffect(() => {
    if (initialPolicyNumber) setFields((p) => ({ ...p, policyNumber: initialPolicyNumber }));
  }, [initialPolicyNumber]);

  const [checklist, setChecklist] = useState<Record<ChecklistId, boolean>>(emptyChecklist);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  // AI extraction
  const [aiLoading, setAiLoading] = useState(false);
  const [confidence, setConfidence] = useState<Partial<Record<keyof PolicyFields, number>>>({});

  // Live TPA verify (automated tier)
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveResult, setLiveResult] = useState<{ success: boolean; message: string } | null>(null);

  const mutateField = (key: keyof PolicyFields, value: string) => {
    setFields((p) => ({ ...p, [key]: value }));
    // Any manual field change invalidates an existing verification
    if (isVerified) {
      setIsVerified(false);
      onUnverified();
    }
  };

  const allChecked = CHECKLIST_ITEMS.every((i) => checklist[i.id]);

  const confirmVerification = () => {
    if (!allChecked) {
      toast({ title: "Complete all checklist items first", variant: "destructive" });
      return;
    }
    setIsVerified(true);
    setChecklistOpen(false);
    onVerified({
      fields,
      checklist: CHECKLIST_ITEMS.map((i) => ({
        id: i.id,
        label: i.label,
        checked: checklist[i.id],
      })),
    });
    toast({ title: "Policy verified ✓" });
  };

  // ── AI PDF/image extraction ──────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setAiLoading(true);
    try {
      let docContent = "";

      if (file.type.startsWith("image/")) {
        // Encode as base64 so a vision-capable model can read it
        const b64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        docContent = `[ATTACHED IMAGE: ${file.name}]\nBase64 data URI (first 200 chars): ${b64.substring(0, 200)}`;
      } else {
        // For text-based PDFs, FileReader.text() extracts the embedded text stream
        const raw = await file.text();
        // Strip binary noise from PDF containers; keep printable ASCII + newlines
        docContent = raw.startsWith("%PDF")
          ? raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").substring(0, 5000)
          : raw.substring(0, 5000);
      }

      const prompt = `You are an expert insurance document parser for Indian health insurance policies (IRDAI-regulated).
Extract the following fields from the document. Return ONLY a valid JSON object — no markdown, no explanation:
{
  "insurer_name":        { "value": "<string>",      "confidence": <0.0–1.0> },
  "policy_number":       { "value": "<string>",      "confidence": <0.0–1.0> },
  "insured_name":        { "value": "<string>",      "confidence": <0.0–1.0> },
  "sum_insured":         { "value": "<number_only>", "confidence": <0.0–1.0> },
  "valid_from":          { "value": "<YYYY-MM-DD>",  "confidence": <0.0–1.0> },
  "valid_to":            { "value": "<YYYY-MM-DD>",  "confidence": <0.0–1.0> },
  "co_payment_percent":  { "value": "<number_only>", "confidence": <0.0–1.0> },
  "room_rent_limit":     { "value": "<number_only>", "confidence": <0.0–1.0> }
}
Use empty string and 0 confidence for any field not found.

Document:
${docContent}`;

      const result = await callAI({
        featureKey: "document_ocr",
        hospitalId,
        prompt,
        maxTokens: 700,
      });

      if (result.error) throw new Error(result.error);

      const cleaned = result.text.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const pick = (key: string, fallback: string) =>
        parsed[key]?.value ? String(parsed[key].value) : fallback;

      setFields((p) => ({
        insurerName:      pick("insurer_name",       p.insurerName),
        policyNumber:     pick("policy_number",      p.policyNumber),
        policyHolderName: pick("insured_name",       p.policyHolderName),
        sumInsured:       pick("sum_insured",        p.sumInsured),
        validFrom:        pick("valid_from",         p.validFrom),
        validTo:          pick("valid_to",           p.validTo),
        coPaymentPercent: pick("co_payment_percent", p.coPaymentPercent),
        roomRentLimit:    pick("room_rent_limit",    p.roomRentLimit),
      }));

      const conf = (key: string) => Number(parsed[key]?.confidence ?? 0);
      setConfidence({
        insurerName:      conf("insurer_name"),
        policyNumber:     conf("policy_number"),
        policyHolderName: conf("insured_name"),
        sumInsured:       conf("sum_insured"),
        validFrom:        conf("valid_from"),
        validTo:          conf("valid_to"),
        coPaymentPercent: conf("co_payment_percent"),
        roomRentLimit:    conf("room_rent_limit"),
      });

      // Invalidate any prior verification since fields changed
      setIsVerified(false);
      onUnverified();

      toast({
        title: "Policy data extracted ✓",
        description: "Review highlighted fields and click Verify Policy.",
      });
    } catch (err: any) {
      toast({
        title: "AI extraction failed",
        description: err?.message ?? "Enter details manually or try again.",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  // ── Live TPA API verify ──────────────────────────────────────────────────

  const liveVerify = async () => {
    if (!fields.policyNumber) {
      toast({ title: "Policy number is required for live verification", variant: "destructive" });
      return;
    }
    setLiveLoading(true);
    setLiveResult(null);
    try {
      const { data, error } = await (supabase as any).functions.invoke("tpa-verify-policy", {
        body: {
          tpa_code: tpaCode,
          policy_number: fields.policyNumber,
          patient_name: patientName,
        },
      });
      if (error) throw error;

      const success = !!data?.verified;
      setLiveResult({ success, message: data?.message ?? "Verification complete" });

      if (success) {
        if (data.sum_insured) mutateField("sumInsured", String(data.sum_insured));
        if (data.valid_to)    mutateField("validTo", data.valid_to);
        toast({ title: "Live verification successful ✓" });
      }
    } catch (err: any) {
      setLiveResult({ success: false, message: err?.message ?? "TPA API unavailable" });
    } finally {
      setLiveLoading(false);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const policyExpired =
    fields.validTo
      ? isBefore(parseISO(fields.validTo), new Date())
      : false;

  // ── Sub-components ────────────────────────────────────────────────────────

  const ConfidencePip: React.FC<{ field: keyof PolicyFields }> = ({ field }) => {
    const c = confidence[field];
    if (c === undefined) return null;
    return (
      <span
        title={`AI confidence: ${Math.round(c * 100)}%`}
        className={cn("ml-1.5 text-[10px] font-semibold tabular-nums", confidenceColor(c))}
      >
        ● {Math.round(c * 100)}%
      </span>
    );
  };

  const FieldLabel: React.FC<{ label: string; field: keyof PolicyFields }> = ({ label, field }) => (
    <Label className="text-xs font-semibold">
      {label}
      <ConfidencePip field={field} />
    </Label>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* ── Section header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
        <div className="flex items-center gap-2">
          {isVerified
            ? <CheckCircle2 size={14} className="text-emerald-600" />
            : <ShieldCheck size={14} className="text-amber-600" />
          }
          <span className="text-sm font-semibold">Step 0 — Policy Verification</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              isVerified
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            )}
          >
            {isVerified ? "Verified" : "Required"}
          </Badge>
        </div>

        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0",
            planTier === "automated"  ? "bg-violet-50 text-violet-700 border-violet-200" :
            planTier === "ai_assisted"? "bg-blue-50 text-blue-700 border-blue-200" :
                                        "bg-muted text-muted-foreground border-border"
          )}
        >
          {planTier === "automated" ? "Automated" : planTier === "ai_assisted" ? "AI Assisted" : "Manual"}
        </Badge>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Fields grid ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel label="Insurer Name" field="insurerName" />
            <Input className="mt-1 h-8 text-sm" placeholder="e.g. Star Health"
              value={fields.insurerName} onChange={(e) => mutateField("insurerName", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Policy Number" field="policyNumber" />
            <Input className="mt-1 h-8 text-sm" placeholder="Policy / Certificate No."
              value={fields.policyNumber} onChange={(e) => mutateField("policyNumber", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Policy Holder Name" field="policyHolderName" />
            <Input className="mt-1 h-8 text-sm" placeholder="As on policy document"
              value={fields.policyHolderName} onChange={(e) => mutateField("policyHolderName", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Sum Insured (₹)" field="sumInsured" />
            <Input className="mt-1 h-8 text-sm" type="number" placeholder="500000"
              value={fields.sumInsured} onChange={(e) => mutateField("sumInsured", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Valid From" field="validFrom" />
            <Input className="mt-1 h-8 text-sm" type="date"
              value={fields.validFrom} onChange={(e) => mutateField("validFrom", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Valid To" field="validTo" />
            <Input
              className={cn("mt-1 h-8 text-sm", policyExpired && "border-red-400 focus-visible:ring-red-400")}
              type="date"
              value={fields.validTo}
              onChange={(e) => mutateField("validTo", e.target.value)}
            />
            {policyExpired && (
              <p className="text-[10px] text-red-600 mt-0.5 flex items-center gap-1">
                <AlertTriangle size={10} /> Policy has expired — submission may be rejected
              </p>
            )}
          </div>

          <div>
            <FieldLabel label="Co-payment %" field="coPaymentPercent" />
            <Input className="mt-1 h-8 text-sm" type="number" min="0" max="100" placeholder="0"
              value={fields.coPaymentPercent} onChange={(e) => mutateField("coPaymentPercent", e.target.value)} />
          </div>

          <div>
            <FieldLabel label="Room Rent Limit (₹ / day)" field="roomRentLimit" />
            <Input className="mt-1 h-8 text-sm" type="number" placeholder="5000"
              value={fields.roomRentLimit} onChange={(e) => mutateField("roomRentLimit", e.target.value)} />
          </div>
        </div>

        {/* ── Action row ── */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">

          {/* Plan A — Manual checklist (always available) */}
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 gap-1.5 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            onClick={() => setChecklistOpen(true)}
          >
            <ShieldCheck size={12} />
            Verify Policy
          </Button>

          {/* Plan B — AI Extract (ai_assisted + automated) */}
          {(planTier === "ai_assisted" || planTier === "automated") && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
                disabled={aiLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                {aiLoading
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Bot size={12} />
                }
                {aiLoading ? "Extracting…" : "🤖 AI Extract from Policy PDF"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}

          {/* Plan C — Live TPA API verify */}
          {planTier === "automated" ? (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
              disabled={liveLoading}
              onClick={liveVerify}
            >
              {liveLoading
                ? <Loader2 size={12} className="animate-spin" />
                : <span>⚡</span>
              }
              {liveLoading ? "Verifying…" : "Live Verify via TPA API"}
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 border border-border px-3 py-1.5 rounded-md">
              <Lock size={10} />
              Live TPA API — Available in Automated Plan
            </div>
          )}
        </div>

        {/* ── Live verify result banner ── */}
        {liveResult && (
          <div className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2 text-sm border",
            liveResult.success
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-700"
          )}>
            {liveResult.success
              ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              : <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            }
            {liveResult.message}
          </div>
        )}

        {/* ── Verified summary bar ── */}
        {isVerified && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>Policy verified — all checklist items confirmed.</span>
            <button
              className="ml-auto text-xs underline underline-offset-2 hover:no-underline"
              onClick={() => { setIsVerified(false); onUnverified(); }}
            >
              Re-verify
            </button>
          </div>
        )}
      </div>

      {/* ── Checklist modal ── */}
      <Dialog open={checklistOpen} onOpenChange={setChecklistOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck size={16} className="text-emerald-600" />
              Policy Verification Checklist
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <p className="text-xs text-muted-foreground pb-1">
              Confirm all items. Pre-auth submission is blocked until the policy is verified.
            </p>

            {CHECKLIST_ITEMS.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded accent-emerald-600 shrink-0"
                  checked={checklist[item.id]}
                  onChange={(e) =>
                    setChecklist((p) => ({ ...p, [item.id]: e.target.checked }))
                  }
                />
                <span className={cn(
                  "text-sm",
                  checklist[item.id] ? "text-foreground" : "text-muted-foreground"
                )}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setChecklistOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!allChecked}
              onClick={confirmVerification}
            >
              <CheckCircle2 size={12} />
              Confirm Verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PolicyVerificationPanel;
