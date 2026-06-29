import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2, Bot, Printer } from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { printDocument, printHeader } from "@/lib/printUtils";
import { formatDateIST } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  patientName: string;
  patientUhid: string;
  chiefComplaint?: string;
  diagnosis?: string;
  doctorName?: string;
  encounterId?: string;
}

const URGENCY_OPTIONS = [
  { value: "routine", label: "Routine", color: "bg-slate-100 text-slate-700" },
  { value: "urgent", label: "Urgent", color: "bg-amber-100 text-amber-700" },
  { value: "emergency", label: "Emergency", color: "bg-red-100 text-red-700" },
] as const;

const ReferralLetterModal: React.FC<Props> = ({
  open, onClose, hospitalId, patientName, patientUhid,
  chiefComplaint = "", diagnosis = "", doctorName = "", encounterId,
}) => {
  const [toDoctor, setToDoctor] = useState("");
  const [toHospitalDept, setToHospitalDept] = useState("");
  const [urgency, setUrgency] = useState<"routine" | "urgent" | "emergency">("routine");
  const [reason, setReason] = useState("");
  const [clinicalSummary, setClinicalSummary] = useState(
    [chiefComplaint, diagnosis].filter(Boolean).join(" | ")
  );
  const [generating, setGenerating] = useState(false);
  const [hospitalName, setHospitalName] = useState("");

  useEffect(() => {
    if (!open || !hospitalId) return;
    supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalName(data?.name || ""));
  }, [open, hospitalId]);

  const generateSummary = async () => {
    if (!chiefComplaint && !diagnosis) return;
    setGenerating(true);
    const response = await callAI({
      featureKey: "discharge_summary",
      hospitalId,
      prompt: `Write a concise clinical referral summary (3–4 sentences) for the following OPD case:
Chief Complaint: ${chiefComplaint || "—"}
Diagnosis / Assessment: ${diagnosis || "—"}
Referring Doctor: Dr. ${doctorName || "—"}
Focus on relevant clinical history, examination findings, reason for referral, and any key investigations done. Do not invent details not provided.`,
      maxTokens: 200,
    });
    if (response.text) setClinicalSummary(response.text);
    setGenerating(false);
  };

  const handlePrint = () => {
    const urgencyColor = urgency === "emergency" ? "#dc2626" : urgency === "urgent" ? "#d97706" : "#475569";
    const body = `
${printHeader(hospitalName, "REFERRAL LETTER", `<p style="font-size:11px;color:#64748b;margin-top:2px;">Date: ${formatDateIST(new Date().toISOString())}</p>`)}
<div style="margin-bottom:16px;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <div>
      <p style="font-size:11px;color:#64748b;margin:0 0 2px;">To Doctor / Specialist</p>
      <p style="font-size:14px;font-weight:700;margin:0;">${toDoctor || "Consultant"}</p>
      ${toHospitalDept ? `<p style="font-size:11px;color:#475569;margin:2px 0 0;">${toHospitalDept}</p>` : ""}
    </div>
    <div style="text-align:right;">
      <span style="background:${urgencyColor}1A;color:${urgencyColor};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;border:1px solid ${urgencyColor}4D;">${urgency}</span>
    </div>
  </div>
</div>

<div style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:14px;">
  <p style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;margin:0 0 8px;">Patient Details</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
    <div><span style="color:#94a3b8;">Name</span><br/><strong>${patientName}</strong></div>
    <div><span style="color:#94a3b8;">UHID</span><br/><strong style="font-family:monospace;">${patientUhid}</strong></div>
  </div>
</div>

<div style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:14px;">
  <p style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;margin:0 0 8px;">Reason for Referral</p>
  <p style="font-size:12px;margin:0;">${reason || "As discussed clinically"}</p>
</div>

<div style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:14px;">
  <p style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;margin:0 0 8px;">Clinical Summary</p>
  <p style="font-size:12px;margin:0;white-space:pre-wrap;">${clinicalSummary || "Please assess and advise."}</p>
</div>

<div style="margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end;">
  <div>
    <p style="font-size:11px;color:#64748b;margin:0;">Referred by</p>
    <p style="font-size:13px;font-weight:700;margin:4px 0 0;">Dr. ${doctorName || "—"}</p>
    <p style="font-size:10px;color:#64748b;margin:2px 0 0;">${hospitalName}</p>
  </div>
  <div style="text-align:center;width:140px;">
    <div style="border-bottom:1px solid #1e293b;height:40px;"></div>
    <p style="font-size:10px;color:#64748b;margin:4px 0 0;">Signature &amp; Stamp</p>
  </div>
</div>`;

    printDocument(`Referral Letter — ${patientName}`, body, { width: 700, height: 800 });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold">Referral Letter</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3">
          {/* Patient info */}
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
            <span className="font-medium">{patientName}</span>
            <span className="text-muted-foreground ml-2">· {patientUhid}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium block mb-1">To Doctor *</label>
              <Input value={toDoctor} onChange={e => setToDoctor(e.target.value)}
                placeholder="Dr. Name, Specialty" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium block mb-1">Hospital / Department</label>
              <Input value={toHospitalDept} onChange={e => setToHospitalDept(e.target.value)}
                placeholder="Hospital / Dept" className="h-8 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Urgency</label>
            <div className="flex gap-2">
              {URGENCY_OPTIONS.map(u => (
                <button key={u.value} onClick={() => setUrgency(u.value)}
                  className={cn("flex-1 h-8 rounded-lg text-xs font-semibold transition-colors",
                    urgency === u.value ? u.color + " ring-2 ring-offset-1 ring-current" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Reason for Referral</label>
            <Input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g., Further evaluation, specialist opinion, procedure" className="h-8 text-sm" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-muted-foreground font-medium">Clinical Summary</label>
              <button onClick={generateSummary} disabled={generating || (!chiefComplaint && !diagnosis)}
                className="text-[10px] flex items-center gap-1 text-primary hover:underline disabled:opacity-40">
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                AI Generate
              </button>
            </div>
            <Textarea value={clinicalSummary} onChange={e => setClinicalSummary(e.target.value)}
              placeholder="Clinical history, findings, investigations, and reason for referral…"
              className="text-sm min-h-[100px]" />
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handlePrint} className="flex-1" disabled={!toDoctor.trim()}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Referral Letter
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferralLetterModal;
