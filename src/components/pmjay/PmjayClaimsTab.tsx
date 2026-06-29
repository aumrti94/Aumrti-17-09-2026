import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Coins, Bot, Copy, Printer, AlertTriangle, Send } from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { autoPostJournalEntry } from "@/lib/accounting";

interface Claim {
  id: string;
  patient_id: string;
  admission_id: string;
  scheme_id: string;
  bill_id: string | null;
  claim_number: string | null;
  package_code: string;
  package_name: string;
  claimed_amount: number;
  approved_amount: number | null;
  settled_amount: number | null;
  status: string;
  denial_reason: string | null;
  denial_code: string | null;
  appeal_letter: string | null;
  is_resubmitted: boolean;
  submitted_at: string | null;
  settled_at: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-50 text-blue-700",
  under_review: "bg-purple-50 text-purple-700",
  approved: "bg-emerald-50 text-emerald-700",
  partially_approved: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-700",
  settled: "bg-emerald-50 text-emerald-700",
  appealed: "bg-orange-50 text-orange-700",
};

const PmjayClaimsTab: React.FC = () => {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [patients, setPatients] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Claim | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [appealModal, setAppealModal] = useState(false);
  const [appealText, setAppealText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase.from("pmjay_claims").select("*").order("created_at", { ascending: false });
    const rows = (data || []) as Claim[];
    setClaims(rows);

    if (rows.length > 0) {
      const pIds = [...new Set(rows.map(r => r.patient_id))];
      const { data: pData } = await supabase.from("patients").select("id, full_name, dob, gender").in("id", pIds);
      setPatients(Object.fromEntries((pData || []).map(p => [p.id, p.full_name])));
    }
    setLoading(false);
  };

  const filtered = filter === "all" ? claims : claims.filter(c => c.status === filter);

  // ICD lock gate — called before any claim submission
  const checkICDLock = async (admissionId: string): Promise<boolean> => {
    const { data, error } = await (supabase as any).rpc("validate_pmjay_icd_before_claim", {
      p_admission_id: admissionId,
    });
    if (error || !data) {
      toast({
        title: "PMJAY claim cannot be submitted",
        description: "ICD code pending MRD validation. Ask the MRD officer to review and lock the ICD code first.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const submitClaim = async () => {
    if (!selected) return;
    setSubmitting(true);
    const locked = await checkICDLock(selected.admission_id);
    if (!locked) { setSubmitting(false); return; }
    await supabase.from("pmjay_claims").update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
    }).eq("id", selected.id);
    toast({ title: "Claim submitted ✓" });
    loadData();
    setSelected(null);
    setSubmitting(false);
  };

  // FEATURE 3: AI Appeal Letter Generator
  const generateAppeal = async () => {
    if (!selected) return;
    setAiLoading(true);
    try {
      // Fetch patient details for richer context
      const { data: patientData } = await supabase
        .from("patients")
        .select("full_name, dob, gender")
        .eq("id", selected.patient_id)
        .maybeSingle();

      const patientAge = patientData?.dob
        ? Math.floor((Date.now() - new Date(patientData.dob).getTime()) / (365.25 * 86400000))
        : "N/A";

      // Fetch hospital name
      const { data: hospitalData } = await supabase
        .from("hospitals")
        .select("name")
        .limit(1)
        .maybeSingle();

      const response = await callAI({
        featureKey: "appeal_letter",
        hospitalId: "",
        prompt: `Write a formal medical necessity appeal letter for a denied PMJAY/government health scheme claim.

Hospital: ${hospitalData?.name || "Hospital"}
Patient: ${patientData?.full_name || "Patient"}, ${patientAge}yrs, ${patientData?.gender || "N/A"}
Package: ${selected.package_name} (Code: ${selected.package_code})
Claimed amount: ₹${selected.claimed_amount.toLocaleString("en-IN")}
Denial reason: ${selected.denial_reason || "Not specified"}
Denial code: ${selected.denial_code || "Not specified"}

Write a professional appeal letter that:
1. References the denial with specific code
2. Provides clinical justification for medical necessity
3. Cites relevant PMJAY/NHA guidelines supporting this package
4. Requests reconsideration with supporting documents listed
5. Ends with formal closing

Format as a proper letter. Use formal Indian medical correspondence style.
Hospital letterhead will be added. Just write the body content.`,
        maxTokens: 600,
      });

      if (response && !response.error) {
        const text = response.text || "";
        setAppealText(text);
        setAppealModal(true);
        // Auto-save to claim
        await supabase.from("pmjay_claims").update({ appeal_letter: text }).eq("id", selected.id);
      } else {
        console.warn("AI unavailable:", response?.error);
        toast({ title: "AI unavailable — write appeal manually", variant: "destructive" });
      }
    } catch (error) {
      console.error("Appeal generation failed:", error);
      toast({ title: "Failed to generate appeal", variant: "destructive" });
    }
    setAiLoading(false);
  };

  const saveAppeal = async () => {
    if (!selected) return;
    await supabase.from("pmjay_claims").update({ appeal_letter: appealText }).eq("id", selected.id);
    toast({ title: "Appeal saved to claim ✓" });
    setAppealModal(false);
    loadData();
  };

  const markResubmitted = async () => {
    if (!selected) return;
    const locked = await checkICDLock(selected.admission_id);
    if (!locked) return;
    await supabase.from("pmjay_claims").update({
      is_resubmitted: true,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    }).eq("id", selected.id);
    toast({ title: "Claim resubmitted ✓" });
    loadData();
    setSelected(null);
  };

  // D8: Print claim bundle for NHA portal manual submission
  const printClaimBundle = async (claim: Claim) => {
    const { printDocument } = await import("@/lib/printUtils");
    const patientName = patients[claim.patient_id] || "—";
    const { data: adm } = await (supabase as any)
      .from("admissions")
      .select("admitted_at, discharged_at, patients(uhid)")
      .eq("id", claim.admission_id)
      .maybeSingle();
    const uhid = (adm?.patients as any)?.uhid || "—";
    const admDate = adm?.admitted_at ? new Date(adm.admitted_at).toLocaleDateString("en-IN") : "—";
    const disDate = adm?.discharged_at ? new Date(adm.discharged_at).toLocaleDateString("en-IN") : "—";
    printDocument("PMJAY Claim Bundle", `
      <h2 style="color:#1A2F5A">PMJAY Claim Submission Bundle</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Patient Name</td><td style="padding:6px;border:1px solid #ccc">${patientName}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">UHID</td><td style="padding:6px;border:1px solid #ccc">${uhid}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Claim Number</td><td style="padding:6px;border:1px solid #ccc">${claim.claim_number || "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Package Code</td><td style="padding:6px;border:1px solid #ccc">${claim.package_code}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Package Name</td><td style="padding:6px;border:1px solid #ccc">${claim.package_name}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Claimed Amount</td><td style="padding:6px;border:1px solid #ccc">₹${claim.claimed_amount.toLocaleString("en-IN")}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Admission Date</td><td style="padding:6px;border:1px solid #ccc">${admDate}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ccc;font-weight:bold">Discharge Date</td><td style="padding:6px;border:1px solid #ccc">${disDate}</td></tr>
      </table>
      <p style="margin-top:16px;color:#7c3aed;font-size:12px">⚠ Submit this bundle to the NHA BIS portal to complete electronic claim submission.</p>
    `);
  };

  // FEATURE 4: Billing integration — on claim settlement
  const markSettled = async () => {
    if (!selected) return;
    const settledAmt = selected.approved_amount || selected.claimed_amount;

    // Update claim status
    await supabase.from("pmjay_claims").update({
      status: "settled",
      settled_amount: settledAmt,
      settled_at: new Date().toISOString(),
    }).eq("id", selected.id);

    // Create bill payment if bill exists
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase
      .from("users")
      .select("id, hospital_id")
      .eq("auth_user_id", user?.id || "")
      .maybeSingle();

    if (selected.bill_id) {
      await supabase.from("bill_payments").insert({
        hospital_id: userData?.hospital_id || "",
        bill_id: selected.bill_id,
        payment_mode: "pmjay",
        amount: settledAmt,
        transaction_id: selected.claim_number || null,
        received_by: userData?.id || null,
      });

      // D3: fetch total_amount + advance_received to derive patient_payable if not already set
      const { data: billData } = await supabase
        .from("bills")
        .select("paid_amount, patient_payable, total_amount, advance_received")
        .eq("id", selected.bill_id)
        .maybeSingle();

      if (billData) {
        const newPaid = (billData.paid_amount || 0) + settledAmt;
        const derivedPayable = (billData.patient_payable || 0) > 0
          ? billData.patient_payable
          : Math.max(0, (billData.total_amount || 0) - (billData.advance_received || 0) - settledAmt);
        const newBalance = Math.max(0, derivedPayable - newPaid);
        await supabase.from("bills").update({
          paid_amount: newPaid,
          insurance_amount: settledAmt,
          patient_payable: derivedPayable,
          balance_due: newBalance,
          payment_status: newBalance <= 0 ? "paid" : "partial",
        }).eq("id", selected.bill_id);
      }
    }

    // FIN2: post PMJAY settlement to GL (sourceId = pmjay_claim UUID — not a bills row, guard passes)
    await autoPostJournalEntry({
      triggerEvent: "pmjay_claim_settled",
      sourceModule: "insurance",
      sourceId: selected.id,
      amount: settledAmt,
      description: `PMJAY Settlement — ${selected.package_name} — Claim #${selected.claim_number || selected.id.slice(0, 8)}`,
      hospitalId: userData?.hospital_id || "",
      postedBy: user?.id || "",
    });

    // Clear billing on admission
    if (selected.admission_id) {
      await supabase.from("admissions")
        .update({ billing_cleared: true })
        .eq("id", selected.admission_id);
    }

    toast({ title: `₹${settledAmt.toLocaleString("en-IN")} settled & billing updated ✓` });
    loadData();
    setSelected(null);
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left */}
      <div className="w-[320px] border-r border-border bg-background flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-bold">Claims</h3>
          <div className="flex gap-1 mt-2 flex-wrap">
            {["all", "draft", "submitted", "approved", "rejected", "settled"].map(f => (
              <button key={f} onClick={() => setFilter(f)} className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium capitalize",
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              <Coins size={32} className="mx-auto mb-2 opacity-40" />
              No claims found
            </div>
          ) : filtered.map(c => (
            <button key={c.id} onClick={() => setSelected(c)} className={cn(
              "w-full text-left p-3 rounded-lg border transition-colors",
              selected?.id === c.id ? "bg-primary/5 border-primary" : "border-border hover:bg-muted/50"
            )}>
              <div className="flex justify-between items-start">
                <span className="text-[13px] font-medium">{patients[c.patient_id] || "Unknown"}</span>
                <Badge variant="outline" className={cn("text-[9px] capitalize", statusColors[c.status])}>{c.status}</Badge>
              </div>
              <div className="text-[11px] mt-0.5">{c.package_name}</div>
              <div className="text-[11px] font-mono font-medium mt-0.5">₹{c.claimed_amount.toLocaleString("en-IN")}</div>
              {c.submitted_at && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Submitted {formatDistanceToNow(new Date(c.submitted_at), { addSuffix: true })}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right */}
      <div className="flex-1 overflow-y-auto p-5">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Coins size={40} className="opacity-30 mb-2" />
            <p className="text-sm">Select a claim</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-5">
            <div className="flex justify-between items-start">
              <h3 className="text-base font-bold">{selected.package_name}</h3>
              <Badge className={cn("capitalize", statusColors[selected.status])}>{selected.status}</Badge>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground text-[11px]">Patient</span><br/>{patients[selected.patient_id]}</div>
              <div><span className="text-muted-foreground text-[11px]">Claim #</span><br/>{selected.claim_number || "—"}</div>
              <div><span className="text-muted-foreground text-[11px]">Claimed</span><br/>₹{selected.claimed_amount.toLocaleString("en-IN")}</div>
              <div><span className="text-muted-foreground text-[11px]">Approved</span><br/>{selected.approved_amount ? `₹${selected.approved_amount.toLocaleString("en-IN")}` : "—"}</div>
              <div><span className="text-muted-foreground text-[11px]">Settled</span><br/>{selected.settled_amount ? `₹${selected.settled_amount.toLocaleString("en-IN")}` : "—"}</div>
              <div><span className="text-muted-foreground text-[11px]">Resubmitted</span><br/>{selected.is_resubmitted ? "Yes" : "No"}</div>
            </div>

            {/* Draft — Submit Claim (with ICD lock gate) */}
            {selected.status === "draft" && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
                <div className="text-sm font-semibold text-blue-700">Ready to Submit</div>
                <p className="text-[12px] text-blue-600">
                  The system verifies that the ICD code is MRD-locked before submitting this claim.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="gap-1" onClick={submitClaim} disabled={submitting}>
                    <Send size={13} /> {submitting ? "Checking ICD..." : "Submit Claim"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => printClaimBundle(selected)}>
                    <Printer size={13} /> Print for Portal
                  </Button>
                </div>
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  After marking submitted here, log into the NHA BIS portal to complete electronic submission.
                </p>
              </div>
            )}

            {/* Denial section */}
            {selected.status === "rejected" && (
              <div className="bg-red-50 border border-red-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                  <AlertTriangle size={16} /> Claim Rejected
                </div>
                {selected.denial_code && <div className="text-[12px]"><strong>Code:</strong> {selected.denial_code}</div>}
                <div className="text-[12px]"><strong>Reason:</strong> {selected.denial_reason || "Not specified"}</div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="gap-1" onClick={generateAppeal} disabled={aiLoading}>
                    <Bot size={13} /> {aiLoading ? "Generating..." : "Generate Appeal Letter"}
                  </Button>
                  <Button size="sm" className="gap-1" onClick={markResubmitted}>
                    <Send size={13} /> Mark Resubmitted
                  </Button>
                </div>
              </div>
            )}

            {/* Settlement action for approved claims */}
            {selected.status === "approved" && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-2">
                <div className="text-sm font-semibold text-emerald-700">✓ Claim Approved</div>
                <div className="text-[12px]">
                  Approved: ₹{(selected.approved_amount || selected.claimed_amount).toLocaleString("en-IN")}
                </div>
                <Button size="sm" onClick={markSettled} className="gap-1">
                  <Coins size={13} /> Mark Settled & Record Payment
                </Button>
              </div>
            )}

            {/* Existing appeal letter */}
            {selected.appeal_letter && (
              <div className="border border-border rounded-lg p-3">
                <div className="text-[11px] uppercase text-muted-foreground font-semibold mb-1">Saved Appeal Letter</div>
                <p className="text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">{selected.appeal_letter}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Appeal Modal */}
      <Dialog open={appealModal} onOpenChange={setAppealModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI-Generated Appeal Letter</DialogTitle>
          </DialogHeader>
          <Textarea className="min-h-[300px] font-mono text-sm" value={appealText} onChange={e => setAppealText(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(appealText)}>
              <Copy size={13} className="mr-1" /> Copy
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              const { printDocument } = require("@/lib/printUtils");
              printDocument("PMJAY Appeal Letter", `<h2 style="color:#1A2F5A">PMJAY Appeal Letter</h2><pre>${appealText}</pre>`);
            }}>
              <Printer size={13} className="mr-1" /> Print
            </Button>
            <Button size="sm" onClick={saveAppeal}>Save to Claim</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PmjayClaimsTab;
