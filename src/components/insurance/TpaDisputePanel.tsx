import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Scale, Plus, ExternalLink, Send, AlertTriangle, CheckCircle2,
  Loader2, TrendingDown, Calendar, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Dispute {
  id: string;
  claim_id: string | null;
  dispute_amount: number;
  claimed_amount: number;
  settled_amount: number;
  dispute_reason: string;
  dispute_category: string;
  status: string;
  tpa_reference: string | null;
  tpa_response: string | null;
  recovery_amount: number | null;
  escalation_level: number;
  next_followup_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DisputeComm {
  id: string;
  direction: string;
  channel: string;
  subject: string | null;
  body: string;
  sent_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  raised:             "bg-blue-50 text-blue-700 border-blue-300",
  acknowledged:       "bg-sky-50 text-sky-700 border-sky-300",
  under_review:       "bg-amber-50 text-amber-700 border-amber-300",
  partially_settled:  "bg-violet-50 text-violet-700 border-violet-300",
  settled:            "bg-emerald-50 text-emerald-700 border-emerald-300",
  written_off:        "bg-slate-100 text-slate-500 border-slate-300",
};

const CAT_LABELS: Record<string, string> = {
  underpayment:     "Underpayment",
  non_coverage:     "Non-Coverage",
  deduction_error:  "Deduction Error",
  coding_mismatch:  "Coding Mismatch",
  other:            "Other",
};

const inr = (n: number | null | undefined) =>
  `₹${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

// ── Dispute letter template ────────────────────────────────────────────────────
function generateDisputeLetter(dispute: Dispute, hospitalName: string, tpaName: string): string {
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const underpayment = dispute.dispute_amount;

  return `Date: ${today}

To,
The Claims Manager,
${tpaName}

Subject: Dispute Against Claim Settlement — Underpayment of ${inr(underpayment)}

Dear Sir/Madam,

We, ${hospitalName}, write to formally dispute the settlement of the above-referenced claim.

CLAIM DETAILS
─────────────────────────────────────────
Claim Reference (Internal): ${dispute.claim_id?.slice(0, 12).toUpperCase() ?? "N/A"}
TPA Reference: ${dispute.tpa_reference ?? "Pending"}
Claimed Amount: ${inr(dispute.claimed_amount)}
Settled Amount: ${inr(dispute.settled_amount)}
Disputed Amount: ${inr(underpayment)}
Category: ${CAT_LABELS[dispute.dispute_category] ?? "Other"}

GROUNDS FOR DISPUTE
─────────────────────────────────────────
${dispute.dispute_reason}

We request you to:
1. Review the claim settlement and provide justification for the shortfall.
2. Release the underpaid amount of ${inr(underpayment)} within 15 working days.
3. Provide the settlement summary and deduction breakup in writing.

Failure to respond within 15 working days shall necessitate escalation to the Insurance Regulatory and Development Authority of India (IRDAI) / Grievance Cell.

Yours faithfully,

_______________________________
Authorized Signatory
${hospitalName}`;
}

const TpaDisputePanel: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  const [disputes, setDisputes]         = useState<Dispute[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<Dispute | null>(null);
  const [comms, setComms]               = useState<DisputeComm[]>([]);
  const [loadingComms, setLoadingComms] = useState(false);

  // New dispute form
  const [showNew, setShowNew]         = useState(false);
  const [newForm, setNewForm]         = useState({
    claimed_amount: "", settled_amount: "", dispute_reason: "",
    dispute_category: "underpayment", tpa_reference: "",
  });
  const [saving, setSaving] = useState(false);

  // Update form
  const [showUpdate, setShowUpdate]   = useState(false);
  const [updateForm, setUpdateForm]   = useState({
    status: "", tpa_response: "", tpa_reference: "",
    recovery_amount: "", next_followup_at: "",
  });
  const [updating, setUpdating] = useState(false);

  // Communication form
  const [showAddComm, setShowAddComm] = useState(false);
  const [commForm, setCommForm]       = useState({ channel: "email", subject: "", body: "" });
  const [addingComm, setAddingComm]   = useState(false);

  const [hospitalName, setHospitalName] = useState("Our Hospital");

  const fetchDisputes = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tpa_disputes")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });
    if (data) setDisputes(data as Dispute[]);

    // Fetch hospital name
    const { data: hosp } = await supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
    if (hosp) setHospitalName((hosp as any).name || "Our Hospital");

    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const loadComms = async (disputeId: string) => {
    setLoadingComms(true);
    const { data } = await (supabase as any)
      .from("tpa_dispute_communications")
      .select("*")
      .eq("dispute_id", disputeId)
      .order("sent_at", { ascending: true });
    setComms(data ?? []);
    setLoadingComms(false);
  };

  const selectDispute = (d: Dispute) => {
    setSelected(d);
    loadComms(d.id);
    setUpdateForm({
      status:           d.status,
      tpa_response:     d.tpa_response ?? "",
      tpa_reference:    d.tpa_reference ?? "",
      recovery_amount:  d.recovery_amount ? String(d.recovery_amount) : "",
      next_followup_at: d.next_followup_at ?? "",
    });
  };

  const createDispute = async () => {
    if (!hospitalId || !newForm.claimed_amount || !newForm.settled_amount || !newForm.dispute_reason) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    const claimed  = Number(newForm.claimed_amount);
    const settled  = Number(newForm.settled_amount);
    const disputed = Math.max(0, claimed - settled);

    const { error } = await (supabase as any).from("tpa_disputes").insert({
      hospital_id:      hospitalId,
      dispute_amount:   disputed,
      claimed_amount:   claimed,
      settled_amount:   settled,
      dispute_reason:   newForm.dispute_reason,
      dispute_category: newForm.dispute_category,
      tpa_reference:    newForm.tpa_reference || null,
      status:           "raised",
      next_followup_at: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    });

    setSaving(false);
    if (error) {
      toast({ title: "Failed to create dispute", description: error.message, variant: "destructive" });
    } else {
      setShowNew(false);
      setNewForm({ claimed_amount: "", settled_amount: "", dispute_reason: "", dispute_category: "underpayment", tpa_reference: "" });
      fetchDisputes();
      toast({ title: "Dispute raised ✓" });
    }
  };

  const updateDispute = async () => {
    if (!selected) return;
    setUpdating(true);
    const { error } = await (supabase as any).from("tpa_disputes").update({
      status:           updateForm.status,
      tpa_response:     updateForm.tpa_response || null,
      tpa_reference:    updateForm.tpa_reference || null,
      recovery_amount:  updateForm.recovery_amount ? Number(updateForm.recovery_amount) : null,
      next_followup_at: updateForm.next_followup_at || null,
      updated_at:       new Date().toISOString(),
      escalation_level: updateForm.status === "under_review" && selected.escalation_level < 1 ? 1 : selected.escalation_level,
      escalated_at:     updateForm.status === "under_review" && !selected.escalation_level ? new Date().toISOString() : undefined,
    }).eq("id", selected.id);

    setUpdating(false);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else { fetchDisputes(); setShowUpdate(false); toast({ title: "Dispute updated ✓" }); }
  };

  const addCommunication = async () => {
    if (!selected || !commForm.body.trim()) return;
    setAddingComm(true);
    const { error } = await (supabase as any).from("tpa_dispute_communications").insert({
      hospital_id: hospitalId,
      dispute_id:  selected.id,
      direction:   "outbound",
      channel:     commForm.channel,
      subject:     commForm.subject || null,
      body:        commForm.body,
    });
    setAddingComm(false);
    if (error) toast({ title: "Failed to log", description: error.message, variant: "destructive" });
    else { loadComms(selected.id); setShowAddComm(false); setCommForm({ channel: "email", subject: "", body: "" }); toast({ title: "Communication logged" }); }
  };

  const printLetter = () => {
    if (!selected) return;
    const letter = generateDisputeLetter(selected, hospitalName, "TPA / Insurance Company");
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><body><pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;padding:32px;">${letter}</pre></body></html>`);
      w.document.close();
      w.print();
    }
  };

  // Stats
  const totalDisputed  = disputes.reduce((s, d) => s + d.dispute_amount, 0);
  const totalRecovered = disputes.reduce((s, d) => s + (d.recovery_amount ?? 0), 0);
  const openCount      = disputes.filter(d => !["settled","written_off"].includes(d.status)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Disputed", value: inr(totalDisputed), color: "text-red-700" },
          { label: "Recovered", value: inr(totalRecovered), color: "text-emerald-700 font-bold" },
          { label: "Open Disputes", value: String(openCount), color: openCount > 0 ? "text-amber-700 font-bold" : "text-slate-500" },
        ].map(s => (
          <div key={s.label} className="border border-border rounded-lg p-3 bg-card">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className={cn("text-[20px] mt-0.5", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold flex items-center gap-2">
          <Scale size={14} className="text-muted-foreground" /> TPA Dispute Register
        </h3>
        <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowNew(true)}>
          <Plus size={12} /> Raise Dispute
        </Button>
      </div>

      {/* Main layout */}
      <div className="flex gap-4 min-h-[400px]">
        {/* Left: dispute list */}
        <div className="w-[300px] shrink-0 border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {disputes.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">No disputes raised</p>
              </div>
            ) : (
              disputes.map(d => (
                <button
                  key={d.id}
                  onClick={() => selectDispute(d)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors",
                    selected?.id === d.id && "bg-blue-50 border-l-2 border-l-blue-500"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[12px] font-bold text-red-700">{inr(d.dispute_amount)}</span>
                    <Badge variant="outline" className={cn("text-[9px]", STATUS_COLORS[d.status] || "")}>
                      {d.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{d.dispute_reason.slice(0, 60)}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{CAT_LABELS[d.dispute_category]}</span>
                    {d.next_followup_at && (
                      <span className={cn(
                        "flex items-center gap-0.5",
                        new Date(d.next_followup_at) < new Date() ? "text-red-500" : ""
                      )}>
                        <Calendar size={9} />
                        {new Date(d.next_followup_at).toLocaleDateString("en-IN")}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: dispute detail */}
        <div className="flex-1 border border-border rounded-lg overflow-hidden flex flex-col">
          {selected ? (
            <>
              <div className="shrink-0 px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-3">
                <TrendingDown size={14} className="text-red-500" />
                <div>
                  <span className="text-[13px] font-bold">Dispute — {inr(selected.dispute_amount)}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{CAT_LABELS[selected.dispute_category]}</span>
                </div>
                <div className="flex-1" />
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={printLetter}>
                  <FileText size={11} /> Letter
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => setShowAddComm(true)}>
                  <Send size={11} /> Log Comm.
                </Button>
                <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => setShowUpdate(true)}>
                  Update
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Amounts */}
                <div className="grid grid-cols-3 gap-3 text-[12px]">
                  {[
                    { label: "Claimed", value: inr(selected.claimed_amount) },
                    { label: "Settled", value: inr(selected.settled_amount) },
                    { label: "Recovered", value: inr(selected.recovery_amount) },
                  ].map(f => (
                    <div key={f.label} className="bg-muted/40 rounded p-2">
                      <p className="text-[10px] text-muted-foreground">{f.label}</p>
                      <p className="font-semibold mt-0.5">{f.value}</p>
                    </div>
                  ))}
                </div>

                {/* Details */}
                <div className="bg-muted/30 rounded p-3 text-[12px] space-y-1">
                  <p><span className="text-muted-foreground">TPA Ref:</span> {selected.tpa_reference || "—"}</p>
                  <p><span className="text-muted-foreground">Escalation Level:</span> {["None", "Manager", "Legal"][selected.escalation_level] || "None"}</p>
                  {selected.next_followup_at && (
                    <p className={cn(
                      "flex items-center gap-1",
                      new Date(selected.next_followup_at) < new Date() ? "text-red-600 font-medium" : ""
                    )}>
                      <Calendar size={11} />
                      <span>Follow-up: {new Date(selected.next_followup_at).toLocaleDateString("en-IN")}</span>
                      {new Date(selected.next_followup_at) < new Date() && <AlertTriangle size={11} />}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Dispute Reason</p>
                  <p className="text-[13px] bg-muted/30 rounded p-2">{selected.dispute_reason}</p>
                </div>

                {selected.tpa_response && (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">TPA Response</p>
                    <p className="text-[12px] bg-blue-50 border border-blue-200 rounded p-2">{selected.tpa_response}</p>
                  </div>
                )}

                {/* Communication log */}
                <div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Communication Log</p>
                  {loadingComms ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : comms.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">No communications logged yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {comms.map(c => (
                        <div key={c.id} className={cn(
                          "border rounded p-2 text-[11px]",
                          c.direction === "outbound" ? "border-blue-200 bg-blue-50/50 ml-4" : "border-muted bg-muted/30 mr-4"
                        )}>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[9px] capitalize">{c.channel}</Badge>
                            <span className="text-[9px] text-muted-foreground">{c.direction}</span>
                            <span className="text-[9px] text-muted-foreground ml-auto">
                              {formatDistanceToNow(new Date(c.sent_at), { addSuffix: true })}
                            </span>
                          </div>
                          {c.subject && <p className="font-medium mb-0.5">{c.subject}</p>}
                          <p className="whitespace-pre-wrap">{c.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Scale size={36} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[13px] text-muted-foreground">Select a dispute to review</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Dispute Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Raise TPA Dispute</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Claimed Amount (₹) *</Label>
                <Input type="number" value={newForm.claimed_amount} onChange={e => setNewForm(f => ({ ...f, claimed_amount: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Settled Amount (₹) *</Label>
                <Input type="number" value={newForm.settled_amount} onChange={e => setNewForm(f => ({ ...f, settled_amount: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Dispute Amount: {
                  newForm.claimed_amount && newForm.settled_amount
                    ? inr(Math.max(0, Number(newForm.claimed_amount) - Number(newForm.settled_amount)))
                    : "—"
                }</Label>
              </div>
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <select value={newForm.dispute_category} onChange={e => setNewForm(f => ({ ...f, dispute_category: e.target.value }))}
                className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">TPA Reference (if known)</Label>
              <Input value={newForm.tpa_reference} onChange={e => setNewForm(f => ({ ...f, tpa_reference: e.target.value }))} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Dispute Reason / Details *</Label>
              <Textarea value={newForm.dispute_reason} onChange={e => setNewForm(f => ({ ...f, dispute_reason: e.target.value }))} rows={3} className="mt-1 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button size="sm" onClick={createDispute} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : "Raise Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Dialog */}
      <Dialog open={showUpdate} onOpenChange={setShowUpdate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Dispute</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Status</Label>
              <select value={updateForm.status} onChange={e => setUpdateForm(f => ({ ...f, status: e.target.value }))}
                className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">TPA Reference</Label>
              <Input value={updateForm.tpa_reference} onChange={e => setUpdateForm(f => ({ ...f, tpa_reference: e.target.value }))} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">TPA Response</Label>
              <Textarea value={updateForm.tpa_response} onChange={e => setUpdateForm(f => ({ ...f, tpa_response: e.target.value }))} rows={2} className="mt-1 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Recovery Amount (₹)</Label>
                <Input type="number" value={updateForm.recovery_amount} onChange={e => setUpdateForm(f => ({ ...f, recovery_amount: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Next Follow-up Date</Label>
                <Input type="date" value={updateForm.next_followup_at} onChange={e => setUpdateForm(f => ({ ...f, next_followup_at: e.target.value }))} className="mt-1 h-8 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowUpdate(false)}>Cancel</Button>
            <Button size="sm" onClick={updateDispute} disabled={updating}>
              {updating ? <Loader2 size={12} className="animate-spin" /> : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Communication Dialog */}
      <Dialog open={showAddComm} onOpenChange={setShowAddComm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Channel</Label>
              <select value={commForm.channel} onChange={e => setCommForm(f => ({ ...f, channel: e.target.value }))}
                className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                {["email","letter","call","portal","whatsapp"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={commForm.subject} onChange={e => setCommForm(f => ({ ...f, subject: e.target.value }))} className="mt-1 h-8 text-sm" placeholder="Re: Dispute Letter..." />
            </div>
            <div>
              <Label className="text-xs">Communication Body *</Label>
              <Textarea value={commForm.body} onChange={e => setCommForm(f => ({ ...f, body: e.target.value }))} rows={4} className="mt-1 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowAddComm(false)}>Cancel</Button>
            <Button size="sm" onClick={addCommunication} disabled={addingComm || !commForm.body.trim()}>
              {addingComm ? <Loader2 size={12} className="animate-spin" /> : "Log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TpaDisputePanel;
