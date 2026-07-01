import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Loader2, FileText, AlertTriangle, Printer, PenLine, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printDocument, printHeader } from "@/lib/printUtils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { logRecordAccess } from "@/lib/ims";
import { logAudit } from "@/lib/auditLog";
import { formatDateIST } from "@/lib/dateUtils";

// ── SHA-256 of a string ──────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Inline signature pad for discharge ───────────────────────────────────────
function SignaturePad({ onCapture, cleared }: { onCapture: (v: string | null) => void; cleared: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStrokes = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    onCapture(null);
  }, [cleared]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={canvasRef}
      width={380} height={100}
      className="w-full border border-border rounded-lg bg-slate-50 touch-none cursor-crosshair"
      onPointerDown={e => {
        drawing.current = true;
        const ctx = canvasRef.current!.getContext("2d")!;
        const { x, y } = pos(e);
        ctx.beginPath(); ctx.moveTo(x, y);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!drawing.current) return;
        const ctx = canvasRef.current!.getContext("2d")!;
        ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
        const { x, y } = pos(e);
        ctx.lineTo(x, y); ctx.stroke();
        hasStrokes.current = true;
      }}
      onPointerUp={() => {
        drawing.current = false;
        if (hasStrokes.current && canvasRef.current)
          onCapture(canvasRef.current.toDataURL("image/png"));
      }}
      onPointerLeave={() => { drawing.current = false; }}
    />
  );
}

interface Props {
  admissionId: string;
  hospitalId: string;
  billingCleared?: boolean;
  dischargeType?: string;
  onSummaryDone: () => void;
}

const DischargeSummaryGenerator: React.FC<Props> = ({ admissionId, hospitalId, billingCleared = true, dischargeType = "regular", onSummaryDone }) => {
  const [summary, setSummary] = useState("");
  const [generating, setGenerating] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [icdStatus, setIcdStatus] = useState<{
    status: string;
    primary_icd_code: string | null;
    primary_icd_desc: string | null;
    mrd_locked_at: string | null;
  } | null>(null);
  const [dischargeWarnings, setDischargeWarnings] = useState<string[]>([]);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [showSigModal, setShowSigModal] = useState(false);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [sigClearCount, setSigClearCount] = useState(0);
  const pendingUserRef = useRef<{ authId: string; dbId: string | null } | null>(null);

  useEffect(() => {
    (supabase as any)
      .from("icd_codings")
      .select("status, primary_icd_code, primary_icd_desc, mrd_locked_at")
      .eq("visit_id", admissionId)
      .eq("visit_type", "ipd")
      .maybeSingle()
      .then(({ data }: any) => setIcdStatus(data || null));
  }, [admissionId]);

  const generate = async () => {
    setGenerating(true);
    setSummary("");

    try {
      const { data, error } = await supabase.functions.invoke("ai-discharge-summary", {
        body: { admission_id: admissionId },
      });

      const errMsg: string | undefined = data?.error || error?.message;
      if (errMsg) {
        const isNoKey = errMsg.includes("No AI provider") || errMsg.includes("No API key");
        toast.error(
          isNoKey
            ? "No AI provider configured. Go to Settings → API Hub to add an API key."
            : `AI unavailable: ${errMsg}`,
          { duration: 8000 }
        );
        return;
      }

      const s = data?.structured;
      if (!s) {
        toast.error("AI returned an empty response. Write the summary manually.");
        return;
      }

      // Format structured JSON into readable plain-text for the summary textarea
      const medsLines = Array.isArray(s.discharge_medications)
        ? (s.discharge_medications as any[]).map((m) =>
            `• ${m.drug || m.drug_name || ""}${m.dose ? " — " + m.dose : ""}${m.frequency ? " " + m.frequency : ""}${m.duration ? " × " + m.duration : ""}${m.instructions ? " (" + m.instructions + ")" : ""}`.trim()
          ).join("\n")
        : "";

      const icd = s.icd_codes as any;
      const icdLine = icd?.primary && icd.primary !== "Pending"
        ? `Primary: ${icd.primary}${Array.isArray(icd.secondary) && icd.secondary.length ? "\nSecondary: " + (icd.secondary as string[]).join(", ") : ""}`
        : "";

      const vitals = s.vitals_at_discharge as any;
      const vitalsLine = vitals
        ? `BP: ${vitals.bp || "—"}, HR: ${vitals.hr || "—"}, SpO2: ${vitals.spo2 || "—"}, Temp: ${vitals.temp || "—"}, RR: ${vitals.rr || "—"}`
        : "";

      const formatted = [
        s.final_diagnosis   ? `FINAL DIAGNOSIS:\n${s.final_diagnosis}` : "",
        icdLine             ? `\nICD-10 CODES:\n${icdLine}` : "",
        Array.isArray(s.comorbidities) && (s.comorbidities as string[]).length
          ? `\nCOMORBIDITIES:\n${(s.comorbidities as string[]).map((c) => `• ${c}`).join("\n")}`
          : "",
        Array.isArray(s.procedures_performed) && (s.procedures_performed as string[]).length
          ? `\nPROCEDURES PERFORMED:\n${(s.procedures_performed as string[]).map((p) => `• ${p}`).join("\n")}`
          : "",
        s.hospital_course   ? `\nHOSPITAL COURSE:\n${s.hospital_course}` : "",
        vitalsLine          ? `\nVITALS AT DISCHARGE:\n${vitalsLine}` : "",
        medsLines           ? `\nDISCHARGE MEDICATIONS:\n${medsLines}` : "",
        s.diet_instructions ? `\nDIET:\n${s.diet_instructions}` : "",
        s.activity_restrictions ? `\nACTIVITY:\n${s.activity_restrictions}` : "",
        Array.isArray(s.follow_up_appointments) && (s.follow_up_appointments as string[]).length
          ? `\nFOLLOW-UP:\n${(s.follow_up_appointments as string[]).map((f) => `• ${f}`).join("\n")}`
          : "",
        Array.isArray(s.red_flag_symptoms) && (s.red_flag_symptoms as string[]).length
          ? `\nWARNING SIGNS (return to ER immediately if):\n${(s.red_flag_symptoms as string[]).map((r) => `• ${r}`).join("\n")}`
          : "",
        s.patient_friendly_summary ? `\nPATIENT INSTRUCTIONS:\n${s.patient_friendly_summary}` : "",
      ].filter(Boolean).join("\n");

      setSummary(formatted.trim());
      toast.success("Discharge summary generated");

      // Fire-and-forget audit log
      (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        feature_key: "discharge_summary",
        module: "ipd",
        success: true,
        input_summary: `Admission ${admissionId}`,
        output_summary: `Generated ${formatted.length} chars`,
      }).then(() => {});

    } catch (err: any) {
      const msg: string = err?.message || "Unknown error";
      const isNotDeployed = msg.includes("Failed to send a request to the Edge Function");
      const isNetwork = msg === "Failed to fetch" || msg.toLowerCase().includes("networkerror") || msg.toLowerCase().includes("failed to fetch");
      toast.error(
        isNotDeployed
          ? "AI service not reachable — the edge function may not be deployed. Run: supabase functions deploy ai-discharge-summary, then set an API key in Settings → API Hub."
          : isNetwork
            ? "Cannot reach the AI service. Check your connection and ensure the edge function is deployed."
            : `AI error: ${msg}`,
        { duration: 10000 }
      );
    } finally {
      setGenerating(false);
    }
  };

  const checkDischargeCompleteness = async (): Promise<string[]> => {
    const warnings: string[] = [];
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const since2h = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();

    // Check: at least 1 nursing vitals entry in last 24h
    const { count: vitalsCount } = await (supabase as any)
      .from("nursing_vitals")
      .select("id", { count: "exact", head: true })
      .eq("admission_id", admissionId)
      .gte("recorded_at", since24h);

    if ((vitalsCount ?? 0) === 0) {
      warnings.push("No nursing vitals recorded in the last 24 hours.");
    }

    // Check: no pending MAR entries older than 2 hours
    const { count: pendingMar } = await (supabase as any)
      .from("med_admin_records")
      .select("id", { count: "exact", head: true })
      .eq("admission_id", admissionId)
      .eq("status", "pending")
      .lt("scheduled_time", since2h);

    if ((pendingMar ?? 0) > 0) {
      warnings.push(`${pendingMar} medication dose(s) are overdue (pending for more than 2 hours).`);
    }

    return warnings;
  };

  const signSummary = async () => {
    if (!summary.trim()) {
      toast.error("Summary is empty");
      return;
    }
    if (!billingCleared) {
      toast.error("Cannot discharge — billing not cleared");
      return;
    }

    // Run completeness check (only once — skip if already acknowledged)
    if (!warningsAcknowledged) {
      const warnings = await checkDischargeCompleteness();
      if (warnings.length > 0) {
        setDischargeWarnings(warnings);
        return;
      }
    }

    // Pre-fetch the user so the modal confirmation is instant
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await (supabase as any).from("users")
      .select("id").eq("auth_user_id", user.id).maybeSingle();
    pendingUserRef.current = { authId: user.id, dbId: userData?.id ?? null };

    // Open signature gate — actual discharge runs in executeDischarge()
    setSigDataUrl(null);
    setSigClearCount(c => c + 1);
    setShowSigModal(true);
  };

  // Called when doctor draws and confirms signature in the modal
  const executeDischarge = useCallback(async () => {
    if (!sigDataUrl) {
      toast.error("Please draw your signature before confirming");
      return;
    }
    setShowSigModal(false);
    setSigning(true);

    const dbUserId = pendingUserRef.current?.dbId ?? null;
    const now = new Date().toISOString();
    const signatureHash = await sha256(sigDataUrl + now);

    const { error } = await supabase.from("admissions").update({
      discharge_summary_done: true,
      discharge_notes: summary,
      status: "discharged",
      discharge_type: dischargeType,
      discharged_at: now,
      discharge_signed_by: dbUserId,
      discharge_signed_at: now,
      discharge_signature_hash: signatureHash,
    } as any).eq("id", admissionId);

    if (error) {
      toast.error(error.message);
      setSigning(false);
      return;
    }

    // Get bed for housekeeping + patient_id for ABHA linking (+ death routing fields)
    const { data: adm } = await supabase.from("admissions")
      .select("bed_id, ward_id, patient_id, is_mlc, admitting_diagnosis").eq("id", admissionId).maybeSingle();

    // Death case: route the body into the Mortuary pipeline (mirrors Emergency).
    // The formal MCCD is completed in the Mortuary module; here we just register the body.
    if (dischargeType === "expired" && adm?.patient_id) {
      const bodyNum = `BODY-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`;
      const { error: mortErr } = await (supabase as any).from("mortuary_admissions").insert({
        hospital_id: hospitalId,
        patient_id: adm.patient_id,
        admission_id: admissionId,
        body_number: bodyNum,
        time_of_death: now,
        pronounced_by: dbUserId,
        cause_of_death: (adm as any).admitting_diagnosis || "Under evaluation",
        manner_of_death: "undetermined",
        is_mlc: (adm as any).is_mlc || false,
        status: "in_mortuary",
        notes: "Patient expired during IPD admission. Complete MCCD in the Mortuary module.",
      });
      if (mortErr) {
        console.error("Mortuary admission failed:", mortErr.message);
        toast.error("Discharge recorded, but mortuary registration failed — register the body manually in Mortuary.");
      } else {
        toast.success(`Body registered to Mortuary — Body No: ${bodyNum}. Complete the MCCD in the Mortuary module.`);
      }
      logNABHEvidence(hospitalId, "COP.10",
        `IPD death — body registered to mortuary (${bodyNum}) for admission ${admissionId}${(adm as any).is_mlc ? " [MLC]" : ""}.`);
    }

    if (adm?.bed_id) {
      await supabase.from("beds").update({ status: "cleaning" as any }).eq("id", adm.bed_id);
      const { data: bedData } = await supabase.from("beds").select("bed_number").eq("id", adm.bed_id).maybeSingle();

      await (supabase as any).from("housekeeping_tasks").insert({
        hospital_id: hospitalId,
        task_type: "bed_turnover",
        ward_id: adm.ward_id,
        bed_id: adm.bed_id,
        room_number: bedData?.bed_number || null,
        triggered_by: "discharge",
        trigger_ref_id: admissionId,
        priority: "high",
        status: "pending",
        checklist: [
          { item: "Remove soiled linen", done: false },
          { item: "Clean mattress with disinfectant", done: false },
          { item: "Fit fresh linen", done: false },
          { item: "Clean bedside table", done: false },
          { item: "Mop floor", done: false },
          { item: "Supervisor inspection", done: false },
        ],
      });

      toast.success(`Patient discharged — housekeeping task created for bed ${bedData?.bed_number || ""}`);
    } else {
      toast.success("Patient discharged");
    }

    setSigned(true);
    setSigning(false);
    logAudit({ action: "updated", module: "ipd", entityType: "admission", entityId: admissionId, details: { action: "discharged" } });

    // Fire-and-forget ABHA care context linking (non-blocking)
    if (adm?.patient_id) {
      supabase.functions.invoke("abdm-auto-link-care-context", {
        body: {
          hospital_id: hospitalId,
          patient_id: adm.patient_id,
          event_type: "ipd_discharged",
          source_id: admissionId,
        },
      }).catch(() => {});
    }

    // Fire-and-forget HCX FHIR R4 claim auto-submission for insurance patients
    {
      const { data: insuranceBill } = await (supabase as any)
        .from("bills")
        .select("id, insurance_amount")
        .eq("admission_id", admissionId)
        .eq("bill_type", "ipd")
        .eq("bill_status", "final")
        .gt("insurance_amount", 0)
        .maybeSingle();
      if (insuranceBill?.id) {
        supabase.functions.invoke("hcx-claim-submit", {
          body: { hospital_id: hospitalId, bill_id: insuranceBill.id, claim_type: "claim" },
        }).catch(() => {});
      }
    }

    // WhatsApp discharge summary (non-blocking)
    try {
      const { data: patient } = await supabase.from("patients")
        .select("full_name, uhid, phone")
        .eq("id", (await supabase.from("admissions").select("patient_id").eq("id", admissionId).maybeSingle()).data?.patient_id)
        .maybeSingle();

      const phone = patient?.phone;
      if (phone && summary) {
        const shortSummary = summary.slice(0, 300).replace(/\n/g, " ");
        const msg = `🏥 Discharge Summary\n\nPatient: ${patient.full_name} (${patient.uhid})\nDate: ${formatDateIST(new Date().toISOString())}\n\n${shortSummary}...\n\nPlease follow your doctor's instructions. For emergencies, contact the hospital.`;
        const clean = phone.replace(/\D/g, "");
        const intl = clean.startsWith("91") ? clean : `91${clean}`;
        window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
        toast.success("Discharge summary sent via WhatsApp");
      }
    } catch (whatsErr) {
      console.error("WhatsApp discharge failed:", whatsErr);
    }

    logNABHEvidence(hospitalId, "COP.10",
      `Discharge summary signed and patient discharged: ${admissionId}, signatureHash: ${signatureHash}, AI-assisted: ${summary ? "Yes" : "No"}`);

    onSummaryDone();
  }, [sigDataUrl, summary, dischargeType, admissionId, hospitalId, onSummaryDone]);

  const handlePrint = async () => {
    if (!summary) return;
    logRecordAccess({ hospitalId, recordType: "IPD_Record", recordId: admissionId, action: "print" });

    const { data: hospital } = await supabase.from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
    const { data: patient } = await supabase.from("admissions")
      .select("patients(full_name, uhid, dob, gender)")
      .eq("id", admissionId).maybeSingle();

    const p = patient?.patients as any;
    const body = `
      ${printHeader(hospital?.name || "Hospital", "DISCHARGE SUMMARY")}
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:20px;">
        <div>
          <div><span class="label">Patient:</span> <b>${p?.full_name || "—"}</b></div>
          <div><span class="label">UHID:</span> <b>${p?.uhid || "—"}</b></div>
          <div><span class="label">Age/Sex:</span> <span>${p?.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000) : "—"}y / ${p?.gender || "—"}</span></div>
        </div>
        <div style="text-align:right">
          <div><span class="label">Discharge Date:</span> <b>${new Date().toLocaleDateString("en-IN")}</b></div>
          <div><span class="label">Type:</span> <span style="text-transform:capitalize"><b>${dischargeType}</b></span></div>
        </div>
      </div>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:#1e293b;">
        ${summary}
      </div>
      <div style="margin-top:60px;display:flex;justify-content:flex-end;">
        <div style="text-align:center;width:200px;border-top:1px solid #1e293b;padding-top:8px;">
          <p style="margin:0;font-weight:bold;">Treating Consultant</p>
          <p style="margin:0;font-size:10px;color:#64748b;">Hospital ID: ${hospitalId.slice(0, 8)}</p>
        </div>
      </div>
    `;

    printDocument(`DischargeSummary_${p?.uhid || "IPD"}`, body);
  };

  if (signed) {
    return (
      <div className="text-center py-6 space-y-2">
        <p className="text-sm font-semibold text-emerald-600">✅ Discharge summary signed — patient discharged</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!summary ? (
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Use AI to generate a draft, or type the summary manually below.</p>
        </div>
      ) : (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            AI-Generated — Doctor must review and sign before discharge
          </span>
        </div>
      )}
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Type discharge summary here, or click 'Generate with AI' to auto-fill..."
        className="min-h-[250px] text-sm font-sans leading-relaxed"
      />
      {/* ICD Coding Status — read-only indicator for discharge workflow */}
      <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${
        icdStatus?.status === "mrd_locked"
          ? "bg-violet-50 border-violet-200 text-violet-700"
          : icdStatus?.status === "validated"
            ? "bg-blue-50 border-blue-200 text-blue-700"
            : icdStatus?.status === "coded"
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-muted border-border text-muted-foreground"
      }`}>
        <div className="flex-1 min-w-0">
          <span className="font-semibold">ICD: </span>
          {icdStatus?.status === "mrd_locked" && (
            <>
              <span>ICD Locked ✓ (MRD) — </span>
              <span className="font-mono">{icdStatus.primary_icd_code}</span>
              {icdStatus.primary_icd_desc && <span className="opacity-80"> · {icdStatus.primary_icd_desc}</span>}
              {icdStatus.mrd_locked_at && (
                <span className="opacity-60 ml-1">
                  · {new Date(icdStatus.mrd_locked_at).toLocaleDateString("en-IN")}
                </span>
              )}
            </>
          )}
          {icdStatus?.status === "validated" && <span>MRD Validated — awaiting lock</span>}
          {icdStatus?.status === "coded" && <span>Doctor Suggested — awaiting MRD validation</span>}
          {(!icdStatus || icdStatus.status === "pending") && <span>ICD Coding Pending</span>}
        </div>
      </div>

      {/* Discharge completeness warnings */}
      {dischargeWarnings.length > 0 && !warningsAcknowledged && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs font-bold text-amber-800">Discharge Checklist — Issues Found</p>
          </div>
          <ul className="text-xs text-amber-800 space-y-1 pl-5 list-disc">
            {dischargeWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs border-amber-400 text-amber-700"
              onClick={() => setDischargeWarnings([])}
            >
              Go Back
            </Button>
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => { setWarningsAcknowledged(true); setDischargeWarnings([]); }}
            >
              Acknowledge & Proceed
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={generate} disabled={generating} size="sm">
          {generating ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Analysing...</> : <><Bot className="h-4 w-4 mr-1" /> Generate with AI</>}
        </Button>
        <Button onClick={signSummary} disabled={signing} className="flex-1">
          {signing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
          Sign Discharge Summary & Discharge
        </Button>
        {summary && (
          <Button variant="outline" onClick={handlePrint} size="sm">
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        )}
      </div>

      {/* ── Discharge e-signature modal (NABH COP.10) ────────────────────── */}
      <Dialog open={showSigModal} onOpenChange={setShowSigModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Doctor Signature — Discharge Authorisation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-xs text-muted-foreground">
              Draw your signature below. By signing, you confirm the discharge summary is clinically accurate and authorise patient discharge.
            </p>
            <SignaturePad onCapture={setSigDataUrl} cleared={sigClearCount} />
            {sigDataUrl && (
              <p className="text-xs text-emerald-600 font-medium">✓ Signature captured</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSigClearCount(c => c + 1)}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Clear
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs"
                disabled={!sigDataUrl || signing}
                onClick={executeDischarge}
              >
                {signing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Confirm & Discharge Patient
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DischargeSummaryGenerator;
