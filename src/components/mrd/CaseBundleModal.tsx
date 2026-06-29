import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, AlertTriangle, FileDown, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BundleDoc {
  label: string;
  key: string;
  available: boolean;
  count?: number;
  checked: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  record: any;
  hospitalId: string;
}

const CaseBundleModal: React.FC<Props> = ({ open, onClose, record, hospitalId }) => {
  const [docs, setDocs] = useState<BundleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [admissionData, setAdmissionData] = useState<any>(null);
  const [bundleData, setBundleData] = useState<any>({});

  useEffect(() => {
    if (open && record) fetchBundleData();
  }, [open, record]);

  const fetchBundleData = async () => {
    setLoading(true);
    const patientId = record.patient_id;
    const visitId = record.visit_id;

    let admission = null;
    if (visitId) {
      const { data } = await (supabase as any).from("admissions")
        .select("*, patients(full_name, uhid, phone, gender, dob), beds(bed_number), wards(name)")
        .eq("id", visitId).maybeSingle();
      admission = data;
    }
    if (!admission && patientId) {
      const { data } = await (supabase as any).from("admissions")
        .select("*, patients(full_name, uhid, phone, gender, dob), beds(bed_number), wards(name)")
        .eq("patient_id", patientId).eq("hospital_id", hospitalId)
        .order("admitted_at", { ascending: false }).limit(1).maybeSingle();
      admission = data;
    }
    setAdmissionData(admission);

    const admissionId = admission?.id;
    const realData: any = {};

    const [labRes, radRes, billRes, icdRes, labData, radData, billData, icdData] = await Promise.all([
      (supabase as any).from("lab_orders").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("patient_id", patientId),
      (supabase as any).from("radiology_orders").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("patient_id", patientId),
      admissionId
        ? (supabase as any).from("bills").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("admission_id", admissionId)
        : Promise.resolve({ count: 0 }),
      (supabase as any).from("icd_codings").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("visit_id", visitId || "none"),
      // Fetch actual data for bundle
      (supabase as any).from("lab_orders").select("test_name, status, result_value, result_unit, ordered_at").eq("hospital_id", hospitalId).eq("patient_id", patientId).order("ordered_at", { ascending: false }).limit(20),
      (supabase as any).from("radiology_orders").select("study_type, status, report_text, ordered_at").eq("hospital_id", hospitalId).eq("patient_id", patientId).order("ordered_at", { ascending: false }).limit(20),
      admissionId
        ? (supabase as any).from("bills").select("bill_number, bill_date, total_amount, paid_amount, balance_due, bill_status, payment_status").eq("hospital_id", hospitalId).eq("admission_id", admissionId).order("bill_date", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
      (supabase as any).from("icd_codings").select("primary_icd_code, primary_icd_desc, status, ai_suggestion").eq("hospital_id", hospitalId).eq("visit_id", visitId || "none"),
    ]);

    realData.labs = labData.data || [];
    realData.radiology = radData.data || [];
    realData.bills = billData.data || [];
    realData.icdCodings = icdData.data || [];
    setBundleData(realData);

    const bundleDocs: BundleDoc[] = [
      { label: "Admission Note", key: "admission", available: !!admission, checked: true },
      { label: "Discharge Summary", key: "discharge", available: !!admission?.discharged_at, checked: true },
      { label: `Lab Reports (${labRes.count || 0})`, key: "lab", available: (labRes.count || 0) > 0, count: labRes.count || 0, checked: true },
      { label: `Radiology Reports (${radRes.count || 0})`, key: "radiology", available: (radRes.count || 0) > 0, count: radRes.count || 0, checked: true },
      { label: "Operation Notes", key: "ot", available: false, checked: true },
      { label: "Nursing Notes Summary", key: "nursing", available: false, checked: true },
      { label: `Final Bill Summary (${billRes.count || 0})`, key: "bill", available: (billRes.count || 0) > 0, count: billRes.count || 0, checked: true },
      { label: "Pre-Auth Approval Letter", key: "preauth", available: admission?.insurance_type !== "self_pay", checked: true },
      { label: `ICD Coding Sheet (${icdRes.count || 0})`, key: "icd", available: (icdRes.count || 0) > 0, count: icdRes.count || 0, checked: true },
      { label: "FHIR R4 Bundle (ABDM)", key: "fhir", available: !!record.patient_id, checked: false },
    ];

    setDocs(bundleDocs);
    setLoading(false);
  };

  const toggleDoc = (key: string) => {
    setDocs((prev) => prev.map((d) => d.key === key ? { ...d, checked: !d.checked } : d));
  };

  const generateBundlePDF = async () => {
    setGenerating(true);
    const checkedDocs = docs.filter((d) => d.checked && d.available);
    const patientName = record.patients?.full_name || admissionData?.patients?.full_name || "Patient";
    const uhid = record.patients?.uhid || admissionData?.patients?.uhid || "";

    let sections = "";

    // Admission section
    if (checkedDocs.find(d => d.key === "admission") && admissionData) {
      sections += `<div class="section"><div class="section-title">Admission Summary</div>
        <table class="data-table">
          <tr><td class="label">Admission #</td><td>${admissionData.admission_number || "—"}</td></tr>
          <tr><td class="label">Type</td><td>${admissionData.admission_type || "—"}</td></tr>
          <tr><td class="label">Admitted</td><td>${admissionData.admitted_at ? new Date(admissionData.admitted_at).toLocaleString("en-IN") : "—"}</td></tr>
          <tr><td class="label">Ward / Bed</td><td>${admissionData.wards?.name || "—"} / ${admissionData.beds?.bed_number || "—"}</td></tr>
          <tr><td class="label">Diagnosis</td><td>${admissionData.admitting_diagnosis || "—"}</td></tr>
          <tr><td class="label">Insurance</td><td>${admissionData.insurance_type || "self_pay"}</td></tr>
        </table></div>`;
    }

    // Discharge section
    if (checkedDocs.find(d => d.key === "discharge") && admissionData?.discharged_at) {
      sections += `<div class="section"><div class="section-title">Discharge Summary</div>
        <table class="data-table">
          <tr><td class="label">Discharged</td><td>${new Date(admissionData.discharged_at).toLocaleString("en-IN")}</td></tr>
          <tr><td class="label">Discharge Type</td><td>${admissionData.discharge_type || "—"}</td></tr>
          <tr><td class="label">Status</td><td>${admissionData.status}</td></tr>
        </table></div>`;
    }

    // Lab section
    if (checkedDocs.find(d => d.key === "lab") && bundleData.labs?.length > 0) {
      const labRows = bundleData.labs.map((l: any) =>
        `<tr><td>${l.test_name || "—"}</td><td>${l.result_value || "—"} ${l.result_unit || ""}</td><td>${l.status || "—"}</td><td>${l.ordered_at ? new Date(l.ordered_at).toLocaleDateString("en-IN") : "—"}</td></tr>`
      ).join("");
      sections += `<div class="section"><div class="section-title">Lab Reports</div>
        <table class="report-table"><tr><th>Test</th><th>Result</th><th>Status</th><th>Date</th></tr>${labRows}</table></div>`;
    }

    // Radiology section
    if (checkedDocs.find(d => d.key === "radiology") && bundleData.radiology?.length > 0) {
      const radRows = bundleData.radiology.map((r: any) =>
        `<tr><td>${r.study_type || "—"}</td><td>${r.status || "—"}</td><td>${r.ordered_at ? new Date(r.ordered_at).toLocaleDateString("en-IN") : "—"}</td></tr>`
      ).join("");
      sections += `<div class="section"><div class="section-title">Radiology Reports</div>
        <table class="report-table"><tr><th>Study</th><th>Status</th><th>Date</th></tr>${radRows}</table></div>`;
    }

    // Billing section
    if (checkedDocs.find(d => d.key === "bill") && bundleData.bills?.length > 0) {
      const billRows = bundleData.bills.map((b: any) =>
        `<tr><td>${b.bill_number || "—"}</td><td>₹${(b.total_amount || 0).toLocaleString("en-IN")}</td><td>₹${(b.paid_amount || 0).toLocaleString("en-IN")}</td><td>₹${(b.balance_due || 0).toLocaleString("en-IN")}</td><td>${b.payment_status || "—"}</td></tr>`
      ).join("");
      sections += `<div class="section"><div class="section-title">Billing Summary</div>
        <table class="report-table"><tr><th>Bill #</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr>${billRows}</table></div>`;
    }

    // ICD Coding section
    if (checkedDocs.find(d => d.key === "icd") && bundleData.icdCodings?.length > 0) {
      const icdRows = bundleData.icdCodings.map((ic: any) =>
        `<tr><td>${ic.primary_icd_code || "—"}</td><td>${ic.primary_icd_desc || "—"}</td><td>${ic.status || "—"}</td></tr>`
      ).join("");
      sections += `<div class="section"><div class="section-title">ICD Coding Sheet</div>
        <table class="report-table"><tr><th>Code</th><th>Description</th><th>Status</th></tr>${icdRows}</table></div>`;
    }

    // Checklist
    const checklistRows = docs.map((d, i) =>
      `<tr><td>${i + 1}</td><td>${d.label}</td><td class="${d.available ? "status-ok" : "status-na"}">${d.available ? "✓ Available" : "⚠ N/A"}</td></tr>`
    ).join("");

    const html = `<html><head><title>Case Bundle — ${patientName}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 30px; color: #1a1a1a; max-width: 900px; margin: 0 auto; }
      h1 { font-size: 18px; border-bottom: 2px solid #1A2F5A; padding-bottom: 6px; color: #1A2F5A; }
      .meta { margin: 12px 0; font-size: 12px; display: flex; gap: 20px; flex-wrap: wrap; }
      .meta b { color: #1A2F5A; }
      .section { margin: 20px 0; page-break-inside: avoid; }
      .section-title { font-size: 13px; font-weight: bold; color: #1A2F5A; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; text-transform: uppercase; }
      .data-table { width: 100%; font-size: 12px; }
      .data-table td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      .data-table .label { font-weight: bold; width: 160px; color: #555; }
      .report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .report-table th { background: #f0f0f0; border: 1px solid #ddd; padding: 6px; text-align: left; }
      .report-table td { border: 1px solid #ddd; padding: 6px; }
      .status-ok { color: #16a34a; font-weight: bold; }
      .status-na { color: #d97706; }
      .footer { margin-top: 30px; font-size: 10px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
      @media print { body { padding: 15px; } .section { page-break-inside: avoid; } }
    </style></head><body>
      <h1>📋 Case Summary Bundle</h1>
      <div class="meta">
        <span><b>Patient:</b> ${patientName}</span>
        <span><b>UHID:</b> ${uhid}</span>
        ${admissionData ? `<span><b>Admission:</b> ${admissionData.admitted_at ? new Date(admissionData.admitted_at).toLocaleDateString("en-IN") : "—"}</span>` : ""}
        ${admissionData?.discharged_at ? `<span><b>Discharged:</b> ${new Date(admissionData.discharged_at).toLocaleDateString("en-IN")}</span>` : ""}
      </div>

      ${sections}

      <div class="section">
        <div class="section-title">Document Checklist</div>
        <table class="report-table"><tr><th>#</th><th>Document</th><th>Status</th></tr>${checklistRows}</table>
      </div>

      <div class="footer">Generated on ${new Date().toLocaleString("en-IN")} | Hospital ID: ${hospitalId}</div>
    </body></html>`;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    }

    // FHIR R4 Bundle download (separate file)
    if (checkedDocs.find(d => d.key === "fhir") && record.patient_id) {
      try {
        const { data: fhirData, error: fhirErr } = await supabase.functions.invoke("fhir-export", {
          body: { patient_id: record.patient_id },
        });
        if (fhirErr) throw fhirErr;
        const fhirBundle = typeof fhirData === "string" ? JSON.parse(fhirData) : fhirData;
        const blob = new Blob([JSON.stringify(fhirBundle, null, 2)], { type: "application/fhir+json" });
        const fhirUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = fhirUrl;
        a.download = `patient_${record.patients?.uhid || record.patient_id}_fhir_r4.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(fhirUrl);
        toast.success("FHIR R4 Bundle downloaded — ABDM ready");
      } catch (e: any) {
        toast.error(`FHIR export failed: ${e?.message || "unknown"}`);
      }
    }

    setGenerating(false);
    toast.success("Case bundle generated — print or save as PDF");
  };

  const sendWhatsApp = () => {
    const patientName = record.patients?.full_name || "Patient";
    const message = encodeURIComponent(
      `Insurance Audit Bundle for ${patientName} (${record.patients?.uhid || ""}) is ready for download. Please contact the MRD department for access.`
    );
    window.open(`https://wa.me/?text=${message}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">📋 Case Summary Bundle</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {record?.patients?.full_name} — {record?.patients?.uhid}
            {admissionData && (
              <span className="ml-2">
                | Admission: {admissionData.admitted_at ? new Date(admissionData.admitted_at).toLocaleDateString("en-IN") : "—"}
                → {admissionData.discharged_at ? new Date(admissionData.discharged_at).toLocaleDateString("en-IN") : "Active"}
              </span>
            )}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading documents...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Document Checklist</div>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.key} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50">
                    <Checkbox checked={doc.checked} onCheckedChange={() => toggleDoc(doc.key)} disabled={!doc.available} />
                    <span className="flex-1 text-sm">{doc.label}</span>
                    {doc.available ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-green-600" /> {docs.filter((d) => d.available).length} available
              <span className="mx-1">|</span>
              <AlertTriangle className="h-3 w-3 text-amber-500" /> {docs.filter((d) => !d.available).length} not available
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button size="sm" onClick={generateBundlePDF} disabled={generating}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileDown className="h-4 w-4 mr-1" />}
                Generate Full Bundle
              </Button>
              <Button size="sm" variant="outline" onClick={sendWhatsApp}>
                <MessageSquare className="h-4 w-4 mr-1" /> WhatsApp Bundle Link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CaseBundleModal;
