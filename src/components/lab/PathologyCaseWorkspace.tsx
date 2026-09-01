import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Printer, Save, PenLine, CheckCircle2, Lock, Sparkles } from "lucide-react";
import { printDocument, printHeader } from "@/lib/printUtils";
import { logRecordAccess } from "@/lib/ims";
import { draftHistopathImpression } from "@/lib/labReportNarrative";
import { useCredentialGate } from "@/components/hr/useCredentialGate";
import { notifyOrderingDoctorPathology } from "@/lib/resultNotifications";

// Pathology case detail / structured report / dual sign-off (lab plan Phase 7).

export interface PathologyCase {
  id: string;
  case_number: string;
  case_type: string;
  specimen_type: string | null;
  specimen_site: string | null;
  clinical_history: string | null;
  gross_description: string | null;
  microscopic_description: string | null;
  impression: string | null;
  status: string;
  first_signed_by: string | null;
  first_signed_at: string | null;
  final_signed_by: string | null;
  final_signed_at: string | null;
  received_at: string | null;
  patient_id: string;
  lab_order_id: string | null;
  patients?: { full_name: string; uhid: string; gender: string | null; dob: string | null } | null;
}

const PATHOLOGIST_ROLES = ["doctor", "pathologist"];

interface Props {
  caseId: string;
  hospitalId: string;
  onChanged: () => void;
}

const PathologyCaseWorkspace: React.FC<Props> = ({ caseId, hospitalId, onChanged }) => {
  const { toast } = useToast();
  const { guard, gateElement } = useCredentialGate(hospitalId);
  const { role } = useHospitalContext();
  const [pcase, setPcase] = useState<PathologyCase | null>(null);
  const [gross, setGross] = useState("");
  const [micro, setMicro] = useState("");
  const [impression, setImpression] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState("");
  const [nablNumber, setNablNumber] = useState("");
  // AI impression draft (Phase 16) — fills the textarea only; pathologist edits/signs.
  const [impressionDrafting, setImpressionDrafting] = useState(false);

  const canSign = PATHOLOGIST_ROLES.includes(role || "");
  // Once first-signed, content is locked (only sign-off / amendment changes state).
  const contentLocked = !!pcase?.first_signed_at;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setCurrentUserId(data.id); });
    });
    supabase.from("hospitals").select("name, nabl_accreditation_number").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => { if (data) { setHospitalName((data as any).name || ""); setNablNumber((data as any).nabl_accreditation_number || ""); } });
  }, [hospitalId]);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("pathology_cases")
      .select("*, patients(full_name, uhid, gender, dob)")
      .eq("id", caseId)
      .maybeSingle();
    if (data) {
      setPcase(data);
      setGross(data.gross_description || "");
      setMicro(data.microscopic_description || "");
      setImpression(data.impression || "");
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const draftImpression = async () => {
    if (!pcase || !micro.trim()) {
      toast({ title: "Enter the microscopic description first", variant: "destructive" });
      return;
    }
    setImpressionDrafting(true);
    const draft = await draftHistopathImpression({
      hospitalId,
      patientId: pcase.patient_id,
      caseType: pcase.case_type,
      specimenType: pcase.specimen_type,
      specimenSite: pcase.specimen_site,
      clinicalHistory: pcase.clinical_history,
      grossDescription: gross,
      microscopicDescription: micro,
    });
    setImpressionDrafting(false);
    if (draft) setImpression(draft);
    else toast({ title: "Could not draft an impression", description: "AI unavailable — enter it manually.", variant: "destructive" });
  };

  const saveReport = async () => {
    if (!pcase) return;
    setSaving(true);
    const status = pcase.status === "registered" ? "reporting" : pcase.status;
    await (supabase as any).from("pathology_cases").update({
      gross_description: gross,
      microscopic_description: micro,
      impression,
      status: status === "reporting" && impression.trim() ? "pending_signoff" : status,
      updated_at: new Date().toISOString(),
    }).eq("id", pcase.id);
    setSaving(false);
    toast({ title: "Report saved" });
    load(); onChanged();
  };

  const firstSignOff = async () => {
    if (!pcase || !currentUserId) return;
    if (!impression.trim()) { toast({ title: "Enter an impression before signing", variant: "destructive" }); return; }
    setSaving(true);
    await (supabase as any).from("pathology_cases").update({
      gross_description: gross,
      microscopic_description: micro,
      impression,
      status: "pending_signoff",
      first_signed_by: currentUserId,
      first_signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", pcase.id);
    setSaving(false);
    toast({ title: "✓ First sign-off recorded — awaiting second pathologist" });
    load(); onChanged();
  };

  const finalSignOff = async () => {
    if (!pcase || !currentUserId) return;
    // Dual sign-off: the second signature must be a DIFFERENT pathologist.
    if (pcase.first_signed_by === currentUserId) {
      toast({ title: "Final sign-off must be a different pathologist", variant: "destructive" });
      return;
    }
    // License-validity gate on the signing pathologist before release
    guard({ clinicianId: currentUserId, module: "lab", action: "validate_result", recordId: pcase.id }, doFinalSignOff);
  };

  const doFinalSignOff = async () => {
    if (!pcase || !currentUserId) return;
    setSaving(true);
    await (supabase as any).from("pathology_cases").update({
      status: "signed_off",
      final_signed_by: currentUserId,
      final_signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", pcase.id);

    // Tell the clinician who ordered the biopsy. A signed-out histopathology report is the
    // one result a doctor is most likely to be actively waiting on, and until now sign-off
    // notified nobody outside the lab.
    notifyOrderingDoctorPathology(pcase.id, currentUserId).catch(() => {});

    setSaving(false);
    toast({ title: "✓ Report signed off" });
    load(); onChanged();
  };

  const printReport = () => {
    if (!pcase) return;
    const p = pcase.patients;
    const age = p?.dob ? `${Math.floor((Date.now() - new Date(p.dob).getTime()) / 3.15576e10)}y` : "";
    const draft = pcase.status !== "signed_off";
    const body = `
      ${printHeader(hospitalName || "Pathology Report", pcase.case_type === "cytology" ? "Cytology Report" : "Histopathology Report", nablNumber ? `NABL: ${nablNumber}` : undefined)}
      <div style="position:relative">
        ${draft ? `<div style="position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:70px;color:rgba(180,80,0,0.12);font-weight:900;letter-spacing:4px;pointer-events:none">DRAFT</div>` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:14px;font-size:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
          <div><span style="color:#64748b">Patient:</span> <strong>${p?.full_name || "—"}</strong></div>
          <div><span style="color:#64748b">Case No:</span> <strong>${pcase.case_number}</strong></div>
          <div><span style="color:#64748b">UHID:</span> ${p?.uhid || "—"}</div>
          <div><span style="color:#64748b">Age/Sex:</span> ${age} ${p?.gender || ""}</div>
          <div><span style="color:#64748b">Specimen:</span> ${pcase.specimen_type || "—"}</div>
          <div><span style="color:#64748b">Site:</span> ${pcase.specimen_site || "—"}</div>
        </div>
        <h3 style="margin:10px 0 3px">Clinical History</h3><p style="white-space:pre-wrap;margin:0">${pcase.clinical_history || "—"}</p>
        <h3 style="margin:12px 0 3px">Gross Description</h3><p style="white-space:pre-wrap;margin:0">${gross || "—"}</p>
        <h3 style="margin:12px 0 3px">Microscopic Description</h3><p style="white-space:pre-wrap;margin:0">${micro || "—"}</p>
        <h3 style="margin:12px 0 3px">Impression / Diagnosis</h3><p style="white-space:pre-wrap;margin:0;font-weight:bold">${impression || "—"}</p>
        <div style="margin-top:28px;font-size:12px;color:#334155">
          ${pcase.final_signed_at ? `<p>Electronically signed off — ${new Date(pcase.final_signed_at).toLocaleString("en-IN")}</p>` : `<p style="color:#b45309">Not yet signed off — provisional</p>`}
        </div>
      </div>`;
    logRecordAccess({ hospitalId, recordType: "Pathology_Report", recordId: pcase.id, patientId: pcase.patient_id, action: "print" });
    printDocument(`Pathology Report – ${p?.full_name || "Patient"}`, body);
  };

  if (!pcase) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading case…</div>;
  }

  const STATUS_BADGE: Record<string, string> = {
    registered: "bg-muted text-muted-foreground",
    grossing: "bg-blue-100 text-blue-700",
    reporting: "bg-blue-100 text-blue-700",
    pending_signoff: "bg-amber-100 text-amber-700",
    signed_off: "bg-emerald-100 text-emerald-700",
    amended: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {gateElement}
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-lg font-bold">{pcase.patients?.full_name}</p>
          <p className="text-xs text-muted-foreground">{pcase.patients?.uhid} · {pcase.case_number}</p>
        </div>
        <Badge className={STATUS_BADGE[pcase.status]}>{pcase.status.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="capitalize">{pcase.case_type}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={printReport}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      {contentLocked && pcase.status !== "signed_off" && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-[12px] text-amber-800">
          <Lock size={13} /> First sign-off recorded — report content is locked pending the second pathologist's sign-off.
        </div>
      )}

      {/* Specimen meta */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Meta label="Specimen" value={pcase.specimen_type} />
        <Meta label="Site" value={pcase.specimen_site} />
        <Meta label="Received" value={pcase.received_at ? new Date(pcase.received_at).toLocaleDateString("en-IN") : null} />
      </div>
      {pcase.clinical_history && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Clinical History</p>
          <p className="text-sm whitespace-pre-wrap">{pcase.clinical_history}</p>
        </div>
      )}

      {/* Structured report */}
      <ReportField label="Gross Description" value={gross} onChange={setGross} disabled={contentLocked} />
      <ReportField label="Microscopic Description" value={micro} onChange={setMicro} disabled={contentLocked} />
      <ReportField
        label="Impression / Diagnosis" value={impression} onChange={setImpression} disabled={contentLocked} highlight
        action={!contentLocked && (
          <button onClick={draftImpression} disabled={impressionDrafting}
            className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold hover:bg-primary/20 disabled:opacity-50 flex items-center gap-1">
            <Sparkles size={10} /> {impressionDrafting ? "Drafting…" : "AI Draft"}
          </button>
        )}
      />

      {/* Sign-off trail */}
      {(pcase.first_signed_at || pcase.final_signed_at) && (
        <div className="text-[12px] text-muted-foreground space-y-0.5 border-t border-border pt-3">
          {pcase.first_signed_at && <p>First sign-off: {new Date(pcase.first_signed_at).toLocaleString("en-IN")}</p>}
          {pcase.final_signed_at && <p className="text-emerald-700 font-medium">Final sign-off: {new Date(pcase.final_signed_at).toLocaleString("en-IN")}</p>}
        </div>
      )}

      {/* Actions */}
      {pcase.status !== "signed_off" && (
        <div className="flex items-center gap-2 pt-1">
          {!contentLocked && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={saveReport} disabled={saving}>
              <Save size={14} /> Save Draft
            </Button>
          )}
          {canSign && !pcase.first_signed_at && (
            <Button size="sm" className="gap-1.5 bg-amber-600 hover:bg-amber-700" onClick={firstSignOff} disabled={saving}>
              <PenLine size={14} /> First Sign-off
            </Button>
          )}
          {canSign && pcase.first_signed_at && !pcase.final_signed_at && (
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={finalSignOff} disabled={saving}>
              <CheckCircle2 size={14} /> Final Sign-off (2nd pathologist)
            </Button>
          )}
          {!canSign && (
            <p className="text-[12px] text-muted-foreground">Sign-off requires a pathologist / doctor role.</p>
          )}
        </div>
      )}
    </div>
  );
};

const Meta: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="bg-muted/40 rounded-md px-3 py-2">
    <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
    <p className="text-sm font-medium capitalize">{value || "—"}</p>
  </div>
);

const ReportField: React.FC<{ label: string; value: string; onChange: (v: string) => void; disabled?: boolean; highlight?: boolean; action?: React.ReactNode }> = ({ label, value, onChange, disabled, highlight, action }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <p className={`text-xs font-semibold uppercase ${highlight ? "text-blue-700" : "text-muted-foreground"}`}>{label}</p>
      {action}
    </div>
    <Textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      placeholder={disabled ? "" : `Enter ${label.toLowerCase()}…`}
      className={`text-sm min-h-[90px] ${highlight ? "border-blue-200" : ""} ${disabled ? "bg-muted/40" : ""}`}
    />
  </div>
);

export default PathologyCaseWorkspace;
