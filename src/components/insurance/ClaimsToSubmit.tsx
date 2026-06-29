import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Bot, Package, AlertTriangle, Plus, Sparkles, Loader2, Download, CheckCircle2, Clock } from "lucide-react";
import { addDays, differenceInDays, format } from "date-fns";
import DenialPredictorPanel from "@/components/insurance/DenialPredictorPanel";
import ClaimBundleGenerator from "@/components/insurance/ClaimBundleGenerator";
import ClaimsPackWizard from "@/components/insurance/ClaimsPackWizard";
import { Checkbox } from "@/components/ui/checkbox";
import { useInsuranceSubmission, type ClaimSubmitData, type SubmissionMode } from "@/hooks/useInsuranceSubmission";

interface ClaimRow {
  bill_id: string;
  bill_number: string;
  patient_name: string;
  tpa_name: string;
  total_amount: number;
  denial_risk: number;
  has_pre_auth: boolean;
  patient_id: string;
  admission_id?: string | null;
  discharged_at?: string | null;
  submission_deadline?: string | null;
}

function submissionDeadlineBadge(row: ClaimRow): React.ReactNode {
  if (!row.submission_deadline) return null;
  const daysLeft = differenceInDays(new Date(row.submission_deadline), new Date());
  if (daysLeft < 0)
    return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">⚠ Deadline passed ({Math.abs(daysLeft)}d ago)</Badge>;
  if (daysLeft <= 7)
    return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] animate-pulse">🔴 Submit by {format(new Date(row.submission_deadline), "dd/MM/yy")} ({daysLeft}d)</Badge>;
  if (daysLeft <= 15)
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">⏰ {daysLeft}d left to submit</Badge>;
  return null;
}

const ClaimsToSubmit: React.FC = () => {
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selectedForReview, setSelectedForReview] = useState<ClaimRow | null>(null);
  const [bundleFor, setBundleFor] = useState<ClaimRow | null>(null);
  const [hospitalId, setHospitalId] = useState<string>("");
  const [planTier, setPlanTier] = useState<SubmissionMode>("manual");
  const [aiScores, setAiScores] = useState<Record<string, number>>({});
  const [highRiskConfirmed, setHighRiskConfirmed] = useState<Record<string, boolean>>({});
  const [showWizard, setShowWizard] = useState(false);
  const { toast } = useToast();

  const submission = useInsuranceSubmission(hospitalId);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: userData } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (userData?.hospital_id) {
      setHospitalId(userData.hospital_id);
      // Load plan tier for submission mode gating
      const { data: insSettings } = await (supabase as any)
        .from("hospital_insurance_settings")
        .select("plan_tier")
        .eq("hospital_id", userData.hospital_id)
        .maybeSingle();
      if (insSettings?.plan_tier) setPlanTier(insSettings.plan_tier as SubmissionMode);
    }
    // Get finalised bills for insurance patients that don't have claims yet
    const { data: bills } = await supabase
      .from("bills")
      .select("id, bill_number, patient_id, total_amount, admission_id")
      .in("bill_status", ["final", "draft"])
      .neq("bill_type", "opd"); // focus on IPD/emergency

    if (!bills?.length) { setRows([]); setLoading(false); return; }

    const billIds = bills.map(b => b.id);
    const patientIds = [...new Set(bills.map(b => b.patient_id))];
    const admissionIds = bills.map(b => b.admission_id).filter(Boolean) as string[];

    const [claimsRes, patientsRes, admRes, preAuthRes] = await Promise.all([
      supabase.from("insurance_claims").select("bill_id").in("bill_id", billIds),
      supabase.from("patients").select("id, full_name").in("id", patientIds),
      admissionIds.length ? (supabase as any).from("admissions").select("id, insurance_type, discharged_at").in("id", admissionIds).neq("insurance_type", "self_pay") : Promise.resolve({ data: [] }),
      admissionIds.length ? supabase.from("insurance_pre_auth").select("admission_id, status").in("admission_id", admissionIds) : Promise.resolve({ data: [] }),
    ]);

    const claimedBills = new Set((claimsRes.data || []).map(c => c.bill_id));
    const pMap = Object.fromEntries((patientsRes.data || []).map(p => [p.id, p.full_name]));
    const insuranceAdmissions = new Set((admRes.data || []).map((a: any) => a.id));
    const dischargeMap: Record<string, string | null> = Object.fromEntries(
      (admRes.data || []).map((a: any) => [a.id, (a as any).discharged_at || null])
    );
    const preAuthMap = Object.fromEntries((preAuthRes.data || []).map(pa => [pa.admission_id, pa.status]));

    const eligible = bills.filter(b => !claimedBills.has(b.id) && b.admission_id && insuranceAdmissions.has(b.admission_id));

    setRows(eligible.map(b => {
      const hasPreAuth = preAuthMap[b.admission_id!] === "approved";
      // Simple risk score
      let risk = 40;
      if (hasPreAuth) risk -= 20;
      if (Number(b.total_amount) > 200000) risk += 15;
      risk = Math.max(0, Math.min(100, risk));

      const dischargedAt = b.admission_id ? (dischargeMap[b.admission_id] ?? null) : null;
      const submissionDeadline = dischargedAt
        ? addDays(new Date(dischargedAt), 60).toISOString().slice(0, 10)
        : null;

      return {
        bill_id: b.id,
        bill_number: b.bill_number,
        patient_name: pMap[b.patient_id] || "Unknown",
        tpa_name: "Insurance",
        total_amount: Number(b.total_amount || 0),
        denial_risk: risk,
        has_pre_auth: hasPreAuth,
        patient_id: b.patient_id,
        admission_id: b.admission_id,
        discharged_at: dischargedAt,
        submission_deadline: submissionDeadline,
      };
    }));
    setLoading(false);
  };

  const handleSubmitClaim = async (row: ClaimRow) => {
    setSubmitting(row.bill_id);
    const claimData: ClaimSubmitData = {
      bill_id:      row.bill_id,
      patient_id:   row.patient_id,
      tpa_name:     row.tpa_name,
      total_amount: row.total_amount,
      denial_risk:  row.denial_risk,
      patient_name: row.patient_name,
      bill_number:  row.bill_number,
      has_pre_auth: row.has_pre_auth,
      admission_id: row.admission_id,
      ai_score:     aiScores[row.bill_id],
    };
    const result = await submission.submitClaim(claimData, planTier);
    if (result?.success) loadData();
    setSubmitting(null);
  };

  const riskBadge = (risk: number) => {
    if (risk <= 30) return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">🟢 Low {risk}%</Badge>;
    if (risk <= 60) return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">🟡 Medium {risk}%</Badge>;
    return <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">🔴 High {risk}%</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-foreground">Bills ready for claim submission</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)}>
          <Plus size={14} /> New Claim
        </Button>
      </div>
      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Patient</TableHead>
              <TableHead className="text-[11px]">Bill #</TableHead>
              <TableHead className="text-[11px]">TPA</TableHead>
              <TableHead className="text-[11px]">Amount</TableHead>
              <TableHead className="text-[11px]">Pre-Auth</TableHead>
              <TableHead className="text-[11px]">Denial Risk</TableHead>
              <TableHead className="text-[11px]">Submit By</TableHead>
              <TableHead className="text-[11px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">No claims ready to submit</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.bill_id}>
                <TableCell className="text-[13px] font-medium">{r.patient_name}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{r.bill_number}</TableCell>
                <TableCell className="text-xs">{r.tpa_name}</TableCell>
                <TableCell className="text-[13px] font-bold tabular-nums">₹{r.total_amount.toLocaleString("en-IN")}</TableCell>
                <TableCell>
                  {r.has_pre_auth
                    ? <Badge className="bg-emerald-50 text-emerald-700 text-[10px]">✓ Approved</Badge>
                    : <Badge variant="outline" className="text-[10px] text-amber-600">Missing</Badge>}
                </TableCell>
                <TableCell>{riskBadge(r.denial_risk)}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    {r.discharged_at
                      ? submissionDeadlineBadge(r) ?? (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock size={10} />
                            {r.submission_deadline ? format(new Date(r.submission_deadline), "dd/MM/yy") : "—"}
                          </span>
                        )
                      : <span className="text-[10px] text-muted-foreground">Still admitted</span>
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-[11px] h-7 gap-1" onClick={() => setBundleFor(r)} disabled={!r.admission_id}>
                        <Package size={12} /> Bundle
                      </Button>
                      <Button
                        size="sm"
                        variant={aiScores[r.bill_id] !== undefined ? "outline" : "default"}
                        className={`text-[11px] h-7 gap-1 ${aiScores[r.bill_id] !== undefined ? "" : "bg-violet-600 hover:bg-violet-700"}`}
                        onClick={() => setSelectedForReview(r)}
                      >
                        <Bot size={12} /> {aiScores[r.bill_id] !== undefined ? `AI: ${aiScores[r.bill_id]}%` : "AI Review"}
                      </Button>

                      {/* Plan A — Manual */}
                      {planTier === "manual" && (
                        <Button
                          size="sm"
                          className="text-[11px] h-7 gap-1"
                          onClick={() => handleSubmitClaim(r)}
                          disabled={
                            submitting === r.bill_id ||
                            submission.submitting ||
                            aiScores[r.bill_id] === undefined ||
                            (aiScores[r.bill_id] > 50 && !highRiskConfirmed[r.bill_id])
                          }
                          title={aiScores[r.bill_id] === undefined ? "Run AI Review first" : undefined}
                        >
                          {submitting === r.bill_id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          ✓ Submit
                        </Button>
                      )}

                      {/* Plan B — AI Assisted */}
                      {planTier === "ai_assisted" && (
                        <Button
                          size="sm"
                          className="text-[11px] h-7 gap-1 bg-violet-600 hover:bg-violet-700"
                          onClick={() => handleSubmitClaim(r)}
                          disabled={
                            submitting === r.bill_id ||
                            submission.submitting ||
                            aiScores[r.bill_id] === undefined ||
                            (aiScores[r.bill_id] > 50 && !highRiskConfirmed[r.bill_id])
                          }
                        >
                          {submitting === r.bill_id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Sparkles size={12} />}
                          📄 Generate Letter
                        </Button>
                      )}

                      {/* Plan C — Automated */}
                      {planTier === "automated" && (
                        <Button
                          size="sm"
                          className="text-[11px] h-7 gap-1 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => handleSubmitClaim(r)}
                          disabled={
                            submitting === r.bill_id ||
                            submission.submitting ||
                            aiScores[r.bill_id] === undefined ||
                            (aiScores[r.bill_id] > 50 && !highRiskConfirmed[r.bill_id])
                          }
                        >
                          {submitting === r.bill_id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Bot size={12} />}
                          🤖 Auto-Submit
                        </Button>
                      )}
                    </div>

                    {/* Inline progress / result for this row */}
                    {submitting === r.bill_id && submission.progress && (
                      <p className="text-[10px] text-primary animate-pulse">{submission.progress}</p>
                    )}
                    {aiScores[r.bill_id] === undefined && (
                      <p className="text-[10px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle size={10} /> Run AI Review before submitting
                      </p>
                    )}
                    {aiScores[r.bill_id] !== undefined && aiScores[r.bill_id] > 50 && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={!!highRiskConfirmed[r.bill_id]}
                          onCheckedChange={v => setHighRiskConfirmed(prev => ({ ...prev, [r.bill_id]: !!v }))}
                        />
                        <span className="text-[10px] text-red-600 font-medium">High risk — I confirm and proceed</span>
                      </label>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* AI Denial Predictor Panel */}
      {selectedForReview && hospitalId && (
        <div className="mt-4 max-w-xl">
          <DenialPredictorPanel
            claimData={{
              tpa_name: selectedForReview.tpa_name,
              claimed_amount: selectedForReview.total_amount,
              documents_count: selectedForReview.has_pre_auth ? 3 : 1,
            }}
            preAuthNumber={selectedForReview.has_pre_auth ? "PA-APPROVED" : null}
            hospitalId={hospitalId}
            onRiskAssessed={score => {
              setAiScores(prev => ({ ...prev, [selectedForReview.bill_id]: score }));
              setSelectedForReview(null);
            }}
            onProceedSubmit={() => {
              handleSubmitClaim(selectedForReview);
              setSelectedForReview(null);
            }}
          />
        </div>
      )}

      {bundleFor && bundleFor.admission_id && hospitalId && (
        <ClaimBundleGenerator
          open={!!bundleFor}
          onClose={() => setBundleFor(null)}
          admissionId={bundleFor.admission_id}
          billId={bundleFor.bill_id}
          patientId={bundleFor.patient_id}
          patientName={bundleFor.patient_name}
          billNumber={bundleFor.bill_number}
          totalAmount={bundleFor.total_amount}
          tpaName={bundleFor.tpa_name}
          hospitalId={hospitalId}
          onSubmitted={() => { setBundleFor(null); loadData(); }}
        />
      )}

      <ClaimsPackWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onCreated={() => { setShowWizard(false); loadData(); }}
      />

      {/* ── AI Cover Letter Modal (Plan B) ── */}
      <Dialog open={submission.coverLetter.open} onOpenChange={submission.closeCoverLetter}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" />
              AI-Generated Claim Cover Letter
              {submission.coverLetter.claimData?.claimNumber && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  — {submission.coverLetter.claimData.claimNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/50 rounded-lg p-4 leading-relaxed">
              {submission.coverLetter.text}
            </pre>
          </div>
          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <Button className="gap-1.5" onClick={submission.downloadCoverLetter}>
              <Download size={14} /> Download Letter
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={async () => {
                await submission.confirmCoverLetterSubmitted();
                loadData();
              }}
            >
              <CheckCircle2 size={14} /> Mark as Submitted
            </Button>
            <p className="text-xs text-muted-foreground ml-auto">
              Download, attach documents, email to TPA, then mark submitted.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClaimsToSubmit;
