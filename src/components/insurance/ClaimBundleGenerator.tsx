import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { printDocument, printHeader, printAmount } from "@/lib/printUtils";

interface Props {
  open: boolean;
  onClose: () => void;
  admissionId: string;
  billId: string;
  patientId: string;
  patientName: string;
  billNumber: string;
  totalAmount: number;
  tpaName: string;
  hospitalId: string;
  onSubmitted?: () => void;
}

interface BundleData {
  hospital: any;
  patient: any;
  admission: any;
  bill: any;
  lineItems: any[];
  preAuth: any | null;
  labItems: any[];
  radReports: any[];
  consents: any[];
  otCases: any[];
}

interface ChecklistState {
  discharge: boolean;
  bill: boolean;
  lineItems: boolean;
  preAuth: boolean;
  labs: boolean;
  radiology: boolean;
  consents: boolean;
  ot: boolean;
  fir_mlc: boolean;
}

const ClaimBundleGenerator: React.FC<Props> = ({
  open, onClose, admissionId, billId, patientId, patientName, billNumber,
  totalAmount, tpaName, hospitalId, onSubmitted,
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<BundleData | null>(null);
  const [checked, setChecked] = useState<ChecklistState>({
    discharge: true, bill: true, lineItems: true, preAuth: true,
    labs: true, radiology: true, consents: false, ot: false, fir_mlc: false,
  });

  useEffect(() => {
    if (open && admissionId) loadBundle();
  }, [open, admissionId]);

  const loadBundle = async () => {
    setLoading(true);
    try {
      const [hospRes, patRes, admRes, billRes, lineRes, preAuthRes, labOrdersRes, radRes, consentRes, otRes] = await Promise.all([
        supabase.from("hospitals").select("*").eq("id", hospitalId).maybeSingle(),
        supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
        supabase.from("admissions").select("*, ward:wards(name), bed:beds(bed_number)").eq("id", admissionId).maybeSingle(),
        supabase.from("bills").select("*").eq("id", billId).maybeSingle(),
        supabase.from("bill_line_items").select("*").eq("bill_id", billId),
        supabase.from("insurance_pre_auth").select("*").eq("admission_id", admissionId).eq("status", "approved").maybeSingle(),
        supabase.from("lab_orders").select("id, order_date, items:lab_order_items(*, test:lab_test_master(test_name, units, reference_range))").eq("admission_id", admissionId),
        supabase.from("radiology_orders").select("id, study_name, modality_type, order_date, reports:radiology_reports(findings, impression, reported_at)").eq("admission_id", admissionId),
        supabase.from("patient_consents").select("*").eq("patient_id", patientId),
        supabase.from("ot_schedules").select("*").eq("admission_id", admissionId),
      ]);

      const labItems = (labOrdersRes.data || []).flatMap((o: any) =>
        (o.items || []).filter((i: any) => i.status === "resulted" || i.status === "validated" || i.result_value)
      );

      const radReports = (radRes.data || []).filter((r: any) => r.reports && r.reports.length > 0);

      setData({
        hospital: hospRes.data,
        patient: patRes.data,
        admission: admRes.data,
        bill: billRes.data,
        lineItems: lineRes.data || [],
        preAuth: preAuthRes.data,
        labItems,
        radReports,
        consents: consentRes.data || [],
        otCases: otRes.data || [],
      });

      const pa = preAuthRes.data as any;
      // Auto-check based on availability
      setChecked({
        discharge: !!admRes.data?.discharged_at,
        bill: !!billRes.data,
        lineItems: (lineRes.data || []).length > 0,
        preAuth: !!preAuthRes.data,
        labs: labItems.length > 0,
        radiology: radReports.length > 0,
        consents: (consentRes.data || []).length > 0,
        ot: (otRes.data || []).length > 0,
        fir_mlc: !!(pa?.is_accident_case && pa?.mlc_number),
      });
    } catch (e: any) {
      toast({ title: "Failed to load bundle", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
  const fmtDateTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString("en-IN") : "—";
  const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const buildBundleHtml = (): string => {
    if (!data) return "";
    const { hospital, patient, admission, bill, lineItems, preAuth, labItems, radReports, consents, otCases } = data;
    const hospName = hospital?.name || "Hospital";
    let html = "";

    // Cover sheet
    html += printHeader(hospName, "INSURANCE CLAIM BUNDLE", `<p style="font-size:11px;color:#64748b;margin-top:6px;">Generated: ${fmtDateTime(new Date().toISOString())}</p>`);
    html += `<div class="section-title">Cover Sheet</div>
      <table>
        <tr><th>Patient Name</th><td>${esc(patient?.full_name)}</td><th>UHID</th><td>${esc(patient?.uhid || patient?.id?.slice(0, 8))}</td></tr>
        <tr><th>Age / Gender</th><td>${esc(patient?.age || "—")} / ${esc(patient?.gender || "—")}</td><th>Phone</th><td>${esc(patient?.phone || "—")}</td></tr>
        <tr><th>Admission #</th><td>${esc(admission?.admission_number || admission?.id?.slice(0, 8))}</td><th>Admit Date</th><td>${fmtDate(admission?.admitted_at)}</td></tr>
        <tr><th>Discharge Date</th><td>${fmtDate(admission?.discharged_at)}</td><th>Diagnosis</th><td>${esc(admission?.admitting_diagnosis || "—")}</td></tr>
        <tr><th>TPA / Insurer</th><td>${esc(tpaName)}</td><th>Pre-Auth #</th><td>${esc(preAuth?.pre_auth_number || "—")}</td></tr>
        <tr><th>Bill #</th><td>${esc(billNumber)}</td><th>Total Claim</th><td class="amount">${printAmount(totalAmount)}</td></tr>
      </table>`;

    // Discharge Summary
    if (checked.discharge) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">1. Discharge Summary</div>
        <div class="row"><span class="label">Admission Date</span><span>${fmtDateTime(admission?.admitted_at)}</span></div>
        <div class="row"><span class="label">Discharge Date</span><span>${fmtDateTime(admission?.discharged_at)}</span></div>
        <div class="row"><span class="label">Ward / Bed</span><span>${esc(admission?.ward?.name || "—")} / ${esc(admission?.bed?.bed_number || "—")}</span></div>
        <div class="row"><span class="label">Admitting Diagnosis</span><span>${esc(admission?.admitting_diagnosis || "—")}</span></div>
        <div class="row"><span class="label">Discharge Type</span><span>${esc(admission?.discharge_type || "—")}</span></div>
        ${admission?.nursing_handover_notes ? `<div style="margin-top:10px;"><strong>Clinical Notes:</strong><pre>${esc(admission.nursing_handover_notes)}</pre></div>` : ""}`;
    }

    // Final Bill + Line Items
    if (checked.bill) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">2. Final Bill — ${esc(billNumber)}</div>
        <div class="row"><span class="label">Bill Date</span><span>${fmtDate(bill?.bill_date)}</span></div>
        <div class="row"><span class="label">Subtotal</span><span class="amount">${printAmount(Number(bill?.subtotal || 0))}</span></div>
        <div class="row"><span class="label">Discount</span><span class="amount">${printAmount(Number(bill?.discount_amount || 0))}</span></div>
        <div class="row"><span class="label">GST</span><span class="amount">${printAmount(Number(bill?.gst_amount || 0))}</span></div>
        <div class="total-row"><span>TOTAL CLAIM AMOUNT</span><span class="amount">${printAmount(Number(bill?.total_amount || totalAmount))}</span></div>`;

      if (checked.lineItems && lineItems.length) {
        html += `<div class="section-title" style="font-size:12px;margin-top:14px;">Bill Line Items</div>
          <table>
            <thead><tr><th>Service</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>
              ${lineItems.map(li => `<tr>
                <td>${esc(li.description)}</td>
                <td>${esc(li.quantity || 1)}</td>
                <td class="amount">${printAmount(Number(li.unit_rate || 0))}</td>
                <td class="amount">${printAmount(Number(li.total_amount || 0))}</td>
              </tr>`).join("")}
            </tbody>
          </table>`;
      }
    }

    // Pre-Auth
    if (checked.preAuth && preAuth) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">3. Pre-Authorization Approval</div>
        <table>
          <tr><th>Pre-Auth Number</th><td>${esc(preAuth.pre_auth_number)}</td></tr>
          <tr><th>Policy Number</th><td>${esc(preAuth.policy_number || "—")}</td></tr>
          <tr><th>Estimated Amount</th><td class="amount">${printAmount(Number(preAuth.estimated_amount || 0))}</td></tr>
          <tr><th>Approved Amount</th><td class="amount">${printAmount(Number(preAuth.approved_amount || 0))}</td></tr>
          <tr><th>Approved On</th><td>${fmtDateTime(preAuth.approved_at)}</td></tr>
          <tr><th>Valid Until</th><td>${fmtDate(preAuth.valid_until)}</td></tr>
          <tr><th>Status</th><td><span class="badge">${esc(preAuth.status)}</span></td></tr>
        </table>`;
    }

    // Lab Reports
    if (checked.labs && labItems.length) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">4. Laboratory Reports</div>
        <table>
          <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
          <tbody>
            ${labItems.map((li: any) => `<tr>
              <td>${esc(li.test?.test_name || "—")}</td>
              <td>${esc(li.result_value || "—")}</td>
              <td>${esc(li.result_unit || li.test?.units || "—")}</td>
              <td>${esc(li.reference_range || li.test?.reference_range || "—")}</td>
              <td>${esc(li.result_flag || "")}</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    }

    // Radiology
    if (checked.radiology && radReports.length) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">5. Radiology Reports</div>`;
      radReports.forEach((r: any) => {
        const rep = r.reports?.[0] || {};
        html += `<div style="margin-bottom:14px;border-left:3px solid #0E7B7B;padding-left:10px;">
          <strong>${esc(r.study_name)} (${esc(r.modality_type)})</strong>
          <div class="label">Date: ${fmtDate(r.order_date)}</div>
          ${rep.findings ? `<div style="margin-top:6px;"><strong>Findings:</strong><br/>${esc(rep.findings)}</div>` : ""}
          ${rep.impression ? `<div style="margin-top:6px;"><strong>Impression:</strong><br/>${esc(rep.impression)}</div>` : ""}
        </div>`;
      });
    }

    // OT Notes
    if (checked.ot && otCases.length) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">6. OT / Surgery Notes</div>`;
      otCases.forEach((ot: any) => {
        html += `<div style="margin-bottom:12px;">
          <strong>${esc(ot.surgery_name)}</strong>
          <div class="label">Date: ${fmtDate(ot.scheduled_date)} | Status: ${esc(ot.status)}</div>
          ${ot.post_op_diagnosis ? `<div>Post-Op Dx: ${esc(ot.post_op_diagnosis)}</div>` : ""}
        </div>`;
      });
    }

    // FIR / MLC (Accident)
    const preAuthAny = preAuth as any;
    if (checked.fir_mlc && preAuthAny?.is_accident_case) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">FIR / MLC — Accident / Trauma</div>
        <table>
          <tr><th>MLC Number</th><td>${esc(preAuthAny.mlc_number || "—")}</td></tr>
          <tr><th>FIR Number</th><td>${esc(preAuthAny.fir_number || "—")}</td></tr>
        </table>
        <div style="margin-top:8px;padding:8px;background:#FEF3C7;border-radius:4px;font-size:11px;color:#92400E;">
          ⚠ This claim involves an accident/trauma case. FIR/MLC copy must be attached as a physical document.
        </div>`;
    }

    // Consents
    if (checked.consents && consents.length) {
      html += `<div style="page-break-before:always;"></div><div class="section-title">7. Consent Forms</div>
        <table>
          <thead><tr><th>Consent Type</th><th>Given</th><th>Date</th></tr></thead>
          <tbody>
            ${consents.map((c: any) => `<tr>
              <td>${esc(c.consent_type)}</td>
              <td>${c.consent_given ? "✓ Yes" : "✗ No"}</td>
              <td>${fmtDateTime(c.consented_at)}</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    }

    return html;
  };

  const handleDownload = async () => {
    if (!data) return;
    const html = buildBundleHtml();
    printDocument(`Claim Bundle — ${billNumber}`, html);

    // Mark bundle generated
    if (data.preAuth) {
      await supabase.from("insurance_pre_auth")
        .update({ bundle_generated_at: new Date().toISOString() })
        .eq("id", data.preAuth.id);
    }
    await supabase.from("insurance_claims")
      .update({ bundle_generated_at: new Date().toISOString() })
      .eq("bill_id", billId);

    toast({ title: "Bundle generated", description: "Print dialog opened" });
  };

  const handleMarkSubmitted = async () => {
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: existing } = await supabase.from("insurance_claims").select("id").eq("bill_id", billId).maybeSingle();

      if (existing) {
        await supabase.from("insurance_claims").update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: userData.user?.id,
        }).eq("id", existing.id);
      } else {
        const claimNumber = `CLM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
        await supabase.from("insurance_claims").insert({
          hospital_id: hospitalId,
          bill_id: billId,
          patient_id: patientId,
          tpa_name: tpaName,
          claim_number: claimNumber,
          claimed_amount: totalAmount,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: userData.user?.id,
        });
      }

      toast({ title: "Claim marked as submitted ✓" });
      onSubmitted?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Submission failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const preAuthAny = data?.preAuth as any;
  const isAccidentCase = !!preAuthAny?.is_accident_case;
  const hasMlc = !!(preAuthAny?.mlc_number);
  const isAccidentBlocked = isAccidentCase && !hasMlc;

  const items: Array<{ key: keyof ChecklistState; label: string; available: boolean; count: number; mandatory?: boolean; blockedHint?: string }> = [
    { key: "discharge", label: "Discharge Summary", available: !!data?.admission?.discharged_at, count: data?.admission?.discharged_at ? 1 : 0 },
    { key: "bill", label: "Final Bill", available: !!data?.bill, count: data?.bill ? 1 : 0 },
    { key: "lineItems", label: "Bill Line Items", available: (data?.lineItems.length || 0) > 0, count: data?.lineItems.length || 0 },
    { key: "preAuth", label: "Pre-Auth Approval Letter", available: !!data?.preAuth, count: data?.preAuth ? 1 : 0 },
    { key: "labs", label: "Lab Reports", available: (data?.labItems.length || 0) > 0, count: data?.labItems.length || 0 },
    { key: "radiology", label: "Radiology Reports", available: (data?.radReports.length || 0) > 0, count: data?.radReports.length || 0 },
    { key: "ot", label: "OT / Surgery Notes", available: (data?.otCases.length || 0) > 0, count: data?.otCases.length || 0 },
    { key: "consents", label: "Consent Forms", available: (data?.consents.length || 0) > 0, count: data?.consents.length || 0 },
    ...(isAccidentCase ? [{
      key: "fir_mlc" as const,
      label: "FIR / MLC Copy (Accident / Trauma — Mandatory)",
      available: hasMlc,
      count: hasMlc ? 1 : 0,
      mandatory: true,
      blockedHint: !hasMlc ? "Enter MLC number in Pre-Auth to enable" : undefined,
    }] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} /> Generate Claim Bundle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">Patient:</span> <span className="font-medium">{patientName}</span></div>
            <div><span className="text-muted-foreground">Bill #:</span> <span className="font-mono">{billNumber}</span></div>
            <div><span className="text-muted-foreground">TPA:</span> {tpaName} • <span className="text-muted-foreground">Amount:</span> ₹{totalAmount.toLocaleString("en-IN")}</div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading documents...
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document Checklist</div>
              {items.map((item) => {
                const borderClass = item.mandatory && !item.available
                  ? "border-red-300 bg-red-50/40"
                  : item.available ? "border-border bg-background" : "border-amber-200 bg-amber-50/40";
                return (
                  <div key={item.key} className={`flex items-center justify-between p-2.5 rounded-md border ${borderClass}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked[item.key]}
                        onCheckedChange={(v) => setChecked(c => ({ ...c, [item.key]: !!v }))}
                        disabled={!item.available}
                      />
                      <div>
                        <div className="text-[13px] font-medium flex items-center gap-2 flex-wrap">
                          {item.label}
                          {item.mandatory && <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">Mandatory</Badge>}
                          {item.available
                            ? <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{item.count} available</Badge>
                            : <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">Not available</Badge>}
                        </div>
                        {item.blockedHint && (
                          <div className="text-[11px] text-red-700 flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={10} /> {item.blockedHint}
                          </div>
                        )}
                        {!item.available && !item.blockedHint && (
                          <div className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={10} /> Document not available — please generate before submission.
                          </div>
                        )}
                      </div>
                    </div>
                    {item.available && <CheckCircle2 size={14} className="text-emerald-600" />}
                  </div>
                );
              })}
            </div>
          )}

          {isAccidentBlocked && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>Accident case:</strong> FIR/MLC copy is mandatory for claim submission. Enter the MLC number in Pre-Auth (Step C) before submitting.
              </span>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="outline"
              onClick={handleDownload}
              disabled={loading || !data || isAccidentBlocked}
              title={isAccidentBlocked ? "Enter MLC/FIR number in Pre-Auth (Step C) before submitting." : undefined}
              className="gap-2"
            >
              <Download size={14} /> Download Claim Bundle
            </Button>
            <Button
              onClick={handleMarkSubmitted}
              disabled={loading || submitting || isAccidentBlocked}
              title={isAccidentBlocked ? "Enter MLC/FIR number in Pre-Auth (Step C) before submitting." : undefined}
              className="gap-2"
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
              Mark as Submitted
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClaimBundleGenerator;
