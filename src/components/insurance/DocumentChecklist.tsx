import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { callAI } from "@/lib/aiProvider";
import { cn } from "@/lib/utils";
import {
  Upload, Eye, Loader2, CheckCircle2, AlertTriangle,
  Bot, Zap, FileText, X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type PlanTier = "manual" | "ai_assisted" | "automated";

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  hint?: string;
  checked: boolean;
  fileUrl: string | null;
  fileName: string | null;
  uploadedAt: string | null;
  aiVerified: boolean | null;   // null=not attempted, true=passed, false=mismatch
  aiIssue: string | null;
  autoFetched: boolean;
}

interface Props {
  preAuthId: string;
  tpaName: string;
  admissionId: string;
  hospitalId: string;
  planTier: PlanTier;
  onReadinessChange?: (ready: boolean, stats: { ready: number; required: number }) => void;
}

// ── Default document list ──────────────────────────────────────────────────

const DEFAULT_TEMPLATES: Omit<
  ChecklistItem,
  "checked" | "fileUrl" | "fileName" | "uploadedAt" | "aiVerified" | "aiIssue" | "autoFetched"
>[] = [
  { id: "admission_note",       label: "Admission Note",               required: true },
  { id: "discharge_summary",    label: "Discharge Summary",            required: true,  hint: "for final claim" },
  { id: "investigation_reports",label: "Investigation Reports",        required: true,  hint: "Blood, Urine, X-Ray, etc." },
  { id: "ot_notes",             label: "OT Notes",                     required: false, hint: "if surgery performed" },
  { id: "implant_sticker",      label: "Implant Sticker",              required: false, hint: "if implant used" },
  { id: "drug_chart",           label: "Drug Chart",                   required: true },
  { id: "nurses_notes",         label: "Nurse's Notes",                required: true },
  { id: "pre_auth_approval",    label: "Pre-Auth Approval Letter",     required: true,  hint: "copy from TPA" },
  { id: "photo_id",             label: "Valid Photo ID",               required: true,  hint: "Aadhaar / PAN" },
  { id: "insurance_card",       label: "Insurance Card / Policy Copy", required: true },
];

const emptyItem = (
  tpl: (typeof DEFAULT_TEMPLATES)[number]
): ChecklistItem => ({
  ...tpl,
  checked: false,
  fileUrl: null,
  fileName: null,
  uploadedAt: null,
  aiVerified: null,
  aiIssue: null,
  autoFetched: false,
});

// ── Auto-fetch config per document id ─────────────────────────────────────
//
// comingSoon: true  — button is shown but disabled; "Coming soon" badge
//                     displayed. Flip to false (or remove the key) once the
//                     backing edge function is deployed.
// comingSoon: false — button is fully enabled (default).

interface AutoFetchEntry {
  label: string;
  comingSoon?: boolean;
  fn: (admissionId: string, hospitalId: string) => Promise<{ url: string; name: string }>;
}

const AUTO_FETCH_CONFIG: Record<string, AutoFetchEntry> = {
  // ── ENABLED: calls the existing ai-discharge-summary edge function, ──────
  // serialises the structured JSON response to plain text, and uploads it
  // directly to the insurance-documents storage bucket so the viewer works.
  discharge_summary: {
    label: "Generate from EMR",
    fn: async (admissionId, hospitalId) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "ai-discharge-summary",
        { body: { admission_id: admissionId } }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.structured) throw new Error("No discharge summary generated — check AI provider config");

      const s = data.structured as Record<string, any>;
      const meds: string = Array.isArray(s.discharge_medications)
        ? s.discharge_medications
            .map((m: any) => `  • ${m.drug} ${m.dose || ""} ${m.frequency || ""} for ${m.duration || "—"}${m.instructions ? ` (${m.instructions})` : ""}`.trim())
            .join("\n")
        : "—";

      const lines = [
        `DISCHARGE SUMMARY — AI Generated`,
        `Date: ${new Date().toLocaleDateString("en-IN")}  |  Admission: ${admissionId}`,
        `Patient: ${data.patient_name ?? "—"}`,
        "",
        "═══ FINAL DIAGNOSIS ════════════════════════════════════",
        s.final_diagnosis ?? "—",
        "",
        "ICD-10: Primary — " + (s.icd_codes?.primary ?? "Pending"),
        ...(Array.isArray(s.icd_codes?.secondary) && s.icd_codes.secondary.length
          ? ["         Secondary — " + s.icd_codes.secondary.join(", ")]
          : []),
        "",
        "═══ HOSPITAL COURSE ══════════════════════════════════════",
        s.hospital_course ?? "—",
        "",
        "═══ PROCEDURES PERFORMED ════════════════════════════════",
        ...(Array.isArray(s.procedures_performed) && s.procedures_performed.length
          ? s.procedures_performed.map((p: string) => `  • ${p}`)
          : ["  None"]),
        "",
        "═══ VITALS AT DISCHARGE ══════════════════════════════════",
        s.vitals_at_discharge
          ? `BP ${s.vitals_at_discharge.bp ?? "—"}  HR ${s.vitals_at_discharge.hr ?? "—"}  SpO2 ${s.vitals_at_discharge.spo2 ?? "—"}  Temp ${s.vitals_at_discharge.temp ?? "—"}  RR ${s.vitals_at_discharge.rr ?? "—"}`
          : "—",
        "",
        "═══ DISCHARGE MEDICATIONS ════════════════════════════════",
        meds,
        "",
        "═══ DIET & ACTIVITY ══════════════════════════════════════",
        "Diet: " + (s.diet_instructions ?? "—"),
        "Activity: " + (s.activity_restrictions ?? "—"),
        "",
        "═══ FOLLOW-UP ════════════════════════════════════════════",
        ...(Array.isArray(s.follow_up_appointments)
          ? s.follow_up_appointments.map((f: string) => `  • ${f}`)
          : ["  —"]),
        "",
        "═══ RED FLAGS — RETURN IMMEDIATELY IF ═══════════════════",
        ...(Array.isArray(s.red_flag_symptoms)
          ? s.red_flag_symptoms.map((r: string) => `  ⚠ ${r}`)
          : ["  —"]),
        "",
        "═══ PATIENT SUMMARY (SIMPLE LANGUAGE) ═══════════════════",
        s.patient_friendly_summary ?? "—",
        "",
        s.emergency_contact_note ?? "",
        "",
        "── Generated by Aumrti HMS AI · For clinical use only ──",
      ].join("\n");

      const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
      const path = `${hospitalId}/${admissionId}/discharge_summary_${Date.now()}.txt`;
      const { data: up, error: upErr } = await supabase.storage
        .from("insurance-documents")
        .upload(path, blob, { upsert: true });
      if (upErr) throw upErr;

      return { url: up.path, name: "discharge_summary.txt" };
    },
  },

  // ── ENABLED: export-lab-reports ──────────────────────────────────────────
  investigation_reports: {
    label: "Pull from Lab Module",
    fn: async (admissionId, hospitalId) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "export-lab-reports",
        { body: { admission_id: admissionId, hospital_id: hospitalId } }
      );
      if (error) throw error;
      return { url: data.file_url, name: "lab_reports.pdf" };
    },
  },

  // ── ENABLED: export-drug-chart ───────────────────────────────────────────
  drug_chart: {
    label: "Pull from Pharmacy",
    fn: async (admissionId, hospitalId) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "export-drug-chart",
        { body: { admission_id: admissionId, hospital_id: hospitalId } }
      );
      if (error) throw error;
      return { url: data.file_url, name: "drug_chart.pdf" };
    },
  },

  // ── ENABLED: export-nursing-notes ────────────────────────────────────────
  nurses_notes: {
    label: "Pull from Nursing Kardex",
    fn: async (admissionId, hospitalId) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "export-nursing-notes",
        { body: { admission_id: admissionId, hospital_id: hospitalId } }
      );
      if (error) throw error;
      return { url: data.file_url, name: "nursing_notes.pdf" };
    },
  },
};

// ── Component ──────────────────────────────────────────────────────────────

const DocumentChecklist: React.FC<Props> = ({
  preAuthId,
  tpaName,
  admissionId,
  hospitalId,
  planTier,
  onReadinessChange,
}) => {
  const { toast } = useToast();

  const [items, setItems] = useState<ChecklistItem[]>(
    DEFAULT_TEMPLATES.map(emptyItem)
  );
  const [uploading,    setUploading]    = useState<Record<string, boolean>>({});
  const [aiVerifying,  setAiVerifying]  = useState<Record<string, boolean>>({});
  const [autoFetching, setAutoFetching] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load saved state + TPA custom docs on mount ────────────────────────

  useEffect(() => {
    if (!preAuthId || !hospitalId) return;

    const load = async () => {
      const [paRes, tpaRes] = await Promise.all([
        (supabase as any)
          .from("insurance_pre_auth")
          .select("document_checklist")
          .eq("id", preAuthId)
          .maybeSingle(),
        (supabase as any)
          .from("tpa_config")
          .select("required_documents")
          .eq("tpa_name", tpaName)
          .eq("hospital_id", hospitalId)
          .maybeSingle(),
      ]);

      const savedList: ChecklistItem[] = paRes.data?.document_checklist ?? [];
      const tpaExtras: string[] = tpaRes.data?.required_documents ?? [];

      // Build items: start from defaults, restore saved state, append TPA extras
      const savedMap = new Map(savedList.map((i: ChecklistItem) => [i.id, i]));

      const merged: ChecklistItem[] = DEFAULT_TEMPLATES.map((tpl) => ({
        ...emptyItem(tpl),
        ...(savedMap.get(tpl.id) ?? {}),
      }));

      // Add TPA-specific extras not already in defaults
      tpaExtras.forEach((label: string) => {
        const id = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        if (!merged.find((m) => m.id === id)) {
          merged.push({
            ...emptyItem({ id, label, required: true }),
            ...(savedMap.get(id) ?? {}),
          });
        } else {
          // TPA requires this doc — mark as required even if default says optional
          const idx = merged.findIndex((m) => m.id === id);
          if (idx !== -1) merged[idx] = { ...merged[idx], required: true };
        }
      });

      setItems(merged);
    };

    load();
  }, [preAuthId, tpaName, hospitalId]);

  // ── Notify parent of readiness changes ────────────────────────────────

  useEffect(() => {
    const requiredItems = items.filter((i) => i.required);
    const readyItems    = items.filter((i) => isItemReady(i));
    const requiredReady = requiredItems.filter((i) => isItemReady(i));

    onReadinessChange?.(
      requiredReady.length === requiredItems.length,
      { ready: readyItems.length, required: requiredItems.length }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Persist to Supabase (debounced 800 ms) ─────────────────────────────

  const scheduleSave = useCallback(
    (nextItems: ChecklistItem[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!preAuthId) return;
        setSaving(true);
        await (supabase as any)
          .from("insurance_pre_auth")
          .update({ document_checklist: nextItems })
          .eq("id", preAuthId);
        setSaving(false);
      }, 800);
    },
    [preAuthId]
  );

  const mutateItem = useCallback(
    (id: string, patch: Partial<ChecklistItem>) => {
      setItems((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        );
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  // ── Upload handler ─────────────────────────────────────────────────────

  const handleUpload = async (item: ChecklistItem, file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 5 MB allowed", variant: "destructive" });
      return;
    }

    setUploading((p) => ({ ...p, [item.id]: true }));
    try {
      const safeName = item.label.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
      const ext      = file.name.split(".").pop() ?? "pdf";
      const path     = `${hospitalId}/${admissionId}/${safeName}_${Date.now()}.${ext}`;

      const { data: up, error: upErr } = await supabase.storage
        .from("insurance-documents")
        .upload(path, file, { upsert: true });

      if (upErr) throw upErr;

      // Store only the storage path — bucket is private, so we generate
      // signed URLs at view time instead of persisting a public URL.
      mutateItem(item.id, {
        fileUrl: up.path,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        checked: true,
        aiVerified: null,
        aiIssue: null,
        autoFetched: false,
      });

      toast({ title: `${item.label} uploaded ✓` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading((p) => ({ ...p, [item.id]: false }));
    }
  };

  // ── AI verify ─────────────────────────────────────────────────────────

  const handleAIVerify = async (item: ChecklistItem) => {
    if (!item.fileUrl) return;
    setAiVerifying((p) => ({ ...p, [item.id]: true }));

    try {
      // Resolve a short-lived URL: for manually-uploaded files (storage paths)
      // generate a signed URL; for auto-fetched edge-function URLs use as-is.
      let fetchUrl = item.fileUrl;
      if (!fetchUrl.startsWith("http")) {
        const { data: signed, error: signErr } = await supabase.storage
          .from("insurance-documents")
          .createSignedUrl(fetchUrl, 3600);
        if (signErr || !signed?.signedUrl) throw new Error("Could not load file for verification");
        fetchUrl = signed.signedUrl;
      }

      const res  = await fetch(fetchUrl);
      const blob = await res.blob();
      let docContent = "";

      if (blob.type.startsWith("image/")) {
        const b64 = await new Promise<string>((ok, fail) => {
          const reader = new FileReader();
          reader.onload  = () => ok((reader.result as string).split(",")[1] ?? "");
          reader.onerror = fail;
          reader.readAsDataURL(blob);
        });
        docContent = `[IMAGE — base64 prefix: ${b64.substring(0, 120)}]`;
      } else {
        const rawText = await blob.text();
        docContent = rawText.startsWith("%PDF")
          ? rawText.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").substring(0, 3500)
          : rawText.substring(0, 3500);
      }

      const prompt = `You are an insurance document verifier for an Indian hospital.
The billing team claims this uploaded file is a "${item.label}".
Examine the document content below and determine whether it actually is a "${item.label}".

For context, a "${item.label}" typically contains:
${docTypeHints(item.label)}

Document content (partial):
${docContent}

Reply ONLY with a JSON object — no markdown, no explanation:
{"matches": boolean, "confidence": 0-100, "issue": "<empty string if matches is true, otherwise one-line description of what is wrong>"}`;

      const result = await callAI({
        featureKey: "document_ocr",
        hospitalId,
        prompt,
        maxTokens: 300,
      });

      if (result.error) throw new Error(result.error);
      const parsed = JSON.parse(
        result.text.replace(/```json\n?|\n?```/g, "").trim()
      );

      mutateItem(item.id, {
        aiVerified: !!parsed.matches,
        aiIssue: parsed.matches ? null : (parsed.issue || "Document type mismatch"),
      });
    } catch (err: any) {
      toast({
        title: "AI verification failed",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setAiVerifying((p) => ({ ...p, [item.id]: false }));
    }
  };

  // ── Auto-fetch from EMR ────────────────────────────────────────────────

  const handleAutoFetch = async (item: ChecklistItem) => {
    const cfg = AUTO_FETCH_CONFIG[item.id];
    if (!cfg) {
      toast({ title: "Auto-fetch not available for this document type", variant: "destructive" });
      return;
    }

    setAutoFetching((p) => ({ ...p, [item.id]: true }));
    try {
      const { url, name } = await cfg.fn(admissionId, hospitalId);
      mutateItem(item.id, {
        fileUrl: url,
        fileName: name,
        uploadedAt: new Date().toISOString(),
        checked: true,
        autoFetched: true,
        aiVerified: null,
        aiIssue: null,
      });
      toast({ title: `${item.label} auto-fetched from EMR ✓` });
    } catch (err: any) {
      if (isFunctionMissingError(err)) {
        toast({
          title: "Auto-pull not available yet — please upload this document manually",
        });
      } else {
        toast({
          title: `Auto-fetch failed for ${item.label}`,
          description: err?.message ?? "Check edge function logs",
          variant: "destructive",
        });
      }
    } finally {
      setAutoFetching((p) => ({ ...p, [item.id]: false }));
    }
  };

  // ── Derived compliance stats ───────────────────────────────────────────

  const requiredItems = items.filter((i) => i.required);
  const readyCount    = items.filter((i) => isItemReady(i)).length;
  const requiredReady = requiredItems.filter((i) => isItemReady(i)).length;
  const allReady      = requiredReady === requiredItems.length;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
        <div className="flex items-center gap-2">
          <FileText size={14} className={allReady ? "text-emerald-600" : "text-amber-600"} />
          <span className="text-sm font-semibold">Document Checklist</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              allReady
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            )}
          >
            {readyCount}/{items.length} ready
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              planTier === "automated"   ? "bg-violet-50 text-violet-700 border-violet-200" :
              planTier === "ai_assisted" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                           "bg-muted text-muted-foreground border-border"
            )}
          >
            {planTier === "automated" ? "Automated" : planTier === "ai_assisted" ? "AI Assisted" : "Manual"}
          </Badge>
        </div>
      </div>

      {/* Checklist rows */}
      <div className="divide-y divide-border">
        {items.map((item) => {
          const isReady     = isItemReady(item);
          const isUploading = !!uploading[item.id];
          const isVerifying = !!aiVerifying[item.id];
          const isFetching  = !!autoFetching[item.id];
          const anyBusy     = isUploading || isVerifying || isFetching;

          return (
            <div
              key={item.id}
              className={cn(
                "px-4 py-3 flex items-start gap-3 transition-colors",
                isReady ? "bg-background" : item.required ? "bg-amber-50/30" : "bg-background"
              )}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded accent-emerald-600 shrink-0 cursor-pointer"
                checked={item.checked}
                onChange={(e) => mutateItem(item.id, { checked: e.target.checked })}
              />

              {/* Label + hint + badges */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.required && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-600 border-red-200 bg-red-50">
                      Required
                    </Badge>
                  )}
                  {item.hint && (
                    <span className="text-[10px] text-muted-foreground">({item.hint})</span>
                  )}
                </div>

                {/* Status badges row */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {item.autoFetched && (
                    <Badge className="text-[10px] px-1.5 py-0 bg-violet-600 text-white border-violet-600">
                      Auto-Fetched ✓
                    </Badge>
                  )}
                  {item.fileUrl && !item.autoFetched && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200">
                      Uploaded ✓
                    </Badge>
                  )}
                  {!item.fileUrl && (
                    <Badge variant="outline" className={cn(
                      "text-[10px] px-1.5 py-0",
                      item.required
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-muted text-muted-foreground border-border"
                    )}>
                      {item.required ? "Missing ⚠️" : "Optional"}
                    </Badge>
                  )}

                  {/* AI verification badge */}
                  {item.aiVerified === true && (
                    <Badge className="text-[10px] px-1.5 py-0 bg-blue-600 text-white">
                      ✓ Verified by AI
                    </Badge>
                  )}
                  {item.aiVerified === false && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-50 text-red-700 border-red-200 max-w-[240px] truncate">
                      ⚠️ Mismatch — {item.aiIssue ?? "see details"}
                    </Badge>
                  )}

                  {/* File name */}
                  {item.fileName && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                      {item.fileName}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {/* View */}
                {item.fileUrl && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      // Auto-fetched files carry a full URL; manually uploaded
                      // files store only a storage path — generate a 1-hour
                      // signed URL for those.
                      if (item.fileUrl!.startsWith("http")) {
                        window.open(item.fileUrl!, "_blank", "noopener,noreferrer");
                        return;
                      }
                      const { data, error } = await supabase.storage
                        .from("insurance-documents")
                        .createSignedUrl(item.fileUrl!, 3600);
                      if (error || !data?.signedUrl) {
                        toast({ title: "Could not open document", variant: "destructive" });
                        return;
                      }
                      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                    }}
                    title="View document"
                  >
                    <Eye size={12} />
                  </Button>
                )}

                {/* Remove */}
                {item.fileUrl && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={anyBusy}
                    title="Remove uploaded file"
                    onClick={() =>
                      mutateItem(item.id, {
                        fileUrl: null, fileName: null, uploadedAt: null,
                        aiVerified: null, aiIssue: null, autoFetched: false,
                      })
                    }
                  >
                    <X size={12} />
                  </Button>
                )}

                {/* Upload */}
                <>
                  <input
                    ref={(el) => { fileInputRefs.current[item.id] = el; }}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(item, f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1 px-2"
                    disabled={anyBusy}
                    onClick={() => fileInputRefs.current[item.id]?.click()}
                  >
                    {isUploading
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Upload size={11} />
                    }
                    {isUploading ? "Uploading…" : item.fileUrl ? "Replace" : "Upload"}
                  </Button>
                </>

                {/* AI Verify — ai_assisted + automated, only when file present */}
                {(planTier === "ai_assisted" || planTier === "automated") && item.fileUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1 px-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                    disabled={anyBusy}
                    onClick={() => handleAIVerify(item)}
                  >
                    {isVerifying
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Bot size={11} />
                    }
                    {isVerifying ? "Verifying…" : "🤖 AI Verify"}
                  </Button>
                )}

                {/* Auto-Fetch — automated tier only */}
                {planTier === "automated" && AUTO_FETCH_CONFIG[item.id] && !item.fileUrl && (() => {
                  const fetchCfg = AUTO_FETCH_CONFIG[item.id];
                  return (
                    <>
                      {fetchCfg.comingSoon && (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 text-muted-foreground border-border bg-muted/50"
                        >
                          Coming soon
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1 px-2 border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40"
                        disabled={anyBusy || !!fetchCfg.comingSoon}
                        title={fetchCfg.comingSoon ? "This auto-pull is not yet available — upload manually" : undefined}
                        onClick={() => handleAutoFetch(item)}
                      >
                        {isFetching
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Zap size={11} />
                        }
                        {isFetching ? "Fetching…" : `🤖 ${fetchCfg.label}`}
                      </Button>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compliance gate footer */}
      <div className={cn(
        "px-4 py-3 border-t border-border flex items-center justify-between gap-3",
        allReady ? "bg-emerald-50/60" : "bg-amber-50/60"
      )}>
        <div className="flex items-center gap-2">
          {allReady
            ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            : <AlertTriangle size={14} className="text-amber-600 shrink-0" />
          }
          <span className="text-xs font-medium">
            {allReady
              ? "All required documents are ready for submission."
              : `${requiredReady}/${requiredItems.length} required documents ready — ${requiredItems.length - requiredReady} still missing.`
            }
          </span>
        </div>

        {!allReady && (
          <Badge variant="outline" className="text-xs shrink-0 bg-amber-50 text-amber-800 border-amber-300">
            ⚠️ Complete checklist first
          </Badge>
        )}
      </div>
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Detects Supabase edge-function-not-found and network errors so we can
// show a friendly "upload manually" toast instead of a generic failure.
function isFunctionMissingError(err: unknown): boolean {
  const msg = ((err as any)?.message ?? "").toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.context?.status;
  return (
    status === 404 ||
    status === 503 ||
    msg.includes("failed to send") ||
    msg.includes("function not found") ||
    msg.includes("functionsfetcherror") ||
    msg.includes("functionshttperror") ||
    msg.includes("not found")
  );
}

function isItemReady(item: ChecklistItem): boolean {
  return (item.autoFetched || (item.checked && item.fileUrl !== null));
}

function docTypeHints(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("discharge"))
    return "- Patient name and UHID\n- Principal diagnosis\n- Date of admission and discharge\n- Treating doctor's signature\n- Summary of treatment provided";
  if (lower.includes("admission"))
    return "- Patient demographics\n- Chief complaint\n- Initial assessment\n- Provisional diagnosis";
  if (lower.includes("investigation") || lower.includes("report"))
    return "- Lab values (CBC, LFT, RFT, etc.) or imaging report\n- Date of test\n- Reference ranges\n- Lab stamp / radiologist signature";
  if (lower.includes("ot") || lower.includes("operation"))
    return "- Procedure name\n- Surgeon name\n- Anaesthesia type\n- Date and duration of surgery";
  if (lower.includes("implant"))
    return "- Implant brand and model\n- Batch / lot number\n- Price sticker or invoice";
  if (lower.includes("drug") || lower.includes("pharmacy"))
    return "- Medication names and doses\n- Dates of administration\n- Nurse / pharmacist signature";
  if (lower.includes("nurse"))
    return "- Vital signs charts\n- Nursing observations\n- Date-wise entries";
  if (lower.includes("pre-auth") || lower.includes("approval"))
    return "- TPA/insurer letterhead\n- Approval reference number\n- Approved amount\n- Valid period";
  if (lower.includes("id") || lower.includes("aadhaar") || lower.includes("pan"))
    return "- Aadhaar card or PAN card\n- Photograph of patient\n- Name matching admission record";
  if (lower.includes("insurance") || lower.includes("policy"))
    return "- Policy number\n- Insured name\n- TPA/insurer name\n- Policy validity period";
  return "- Relevant patient information\n- Date\n- Authorised signatures";
}

export default DocumentChecklist;
