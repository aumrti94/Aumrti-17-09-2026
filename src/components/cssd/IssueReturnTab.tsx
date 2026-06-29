import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { AlertTriangle } from "lucide-react";

interface Props {
  showIssue: boolean;
  onCloseIssue: () => void;
  onRefresh: () => void;
}

const IssueReturnTab: React.FC<Props> = ({ showIssue, onCloseIssue, onRefresh }) => {
  const { toast } = useToast();
  const [sterileSets, setSterileSets] = useState<any[]>([]);
  const [pendingReturns, setPendingReturns] = useState<any[]>([]);
  const [issueSetId, setIssueSetId] = useState("");
  const [issuePatientUhid, setIssuePatientUhid] = useState("");

  // Return form
  const [returnItem, setReturnItem] = useState<any>(null);
  const [returnedCount, setReturnedCount] = useState(0);
  const [damagedCount, setDamagedCount] = useState(0);
  const [lossReason, setLossReason] = useState("");

  const fetchData = async () => {
    const [setsRes, issuesRes] = await Promise.all([
      supabase.from("instrument_sets").select("*").eq("status", "sterile"),
      supabase.from("set_issues").select("*, instrument_sets(set_name, set_code)").eq("return_status", "pending").order("issued_at", { ascending: false }),
    ]);
    if (setsRes.data) setSterileSets(setsRes.data);
    if (issuesRes.data) setPendingReturns(issuesRes.data);
  };

  useEffect(() => { fetchData(); }, []);

  const issueSet = async () => {
    if (!issueSetId) { toast({ title: "Select a set", variant: "destructive" }); return; }
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;
    const set = sterileSets.find(s => s.id === issueSetId);
    if (!set) return;

    await supabase.from("set_issues").insert({
      hospital_id: user.hospital_id,
      set_id: issueSetId,
      patient_uhid: issuePatientUhid || null,
      issued_by: user.id,
      instruments_issued_count: set.instrument_count || 0,
    });
    await supabase.from("instrument_sets").update({ status: "in_use" }).eq("id", issueSetId);

    toast({ title: `Set ${set.set_name} issued` });
    setIssueSetId("");
    setIssuePatientUhid("");
    onCloseIssue();
    fetchData();
    onRefresh();
  };

  const processReturn = async () => {
    if (!returnItem) return;
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    const lostCount = returnItem.instruments_issued_count - returnedCount - damagedCount;
    const hasLoss = lostCount > 0;

    await supabase.from("set_issues").update({
      returned_at: new Date().toISOString(),
      returned_by: user.id,
      instruments_returned_count: returnedCount,
      damaged_count: damagedCount,
      loss_count: Math.max(0, lostCount),
      return_status: hasLoss ? "loss_reported" : "complete",
      loss_reason: hasLoss ? lossReason : null,
    }).eq("id", returnItem.id);

    await supabase.from("instrument_sets").update({ status: "dirty" }).eq("id", returnItem.set_id);

    if (hasLoss) {
      await supabase.from("clinical_alerts").insert({
        hospital_id: user.hospital_id,
        alert_type: "instrument_loss",
        severity: "high",
        alert_message: `${lostCount} instrument(s) not accounted for from ${returnItem.instrument_sets?.set_name}. Verify with OT team.`,
      });
      toast({ title: "⚠️ Instrument loss reported", description: `${lostCount} instrument(s) missing`, variant: "destructive" });
    } else {
      toast({ title: "Set returned — marked dirty for reprocessing" });
    }

    setReturnItem(null);
    setReturnedCount(0);
    setDamagedCount(0);
    setLossReason("");
    fetchData();
    onRefresh();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Issue */}
      <div className="w-1/2 border-r border-border overflow-y-auto p-4 space-y-4">
        <h3 className="text-sm font-bold">Issue Set to OT</h3>
        <div>
          <Label className="text-xs">Set (sterile only)</Label>
          <Select value={issueSetId} onValueChange={setIssueSetId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select set..." /></SelectTrigger>
            <SelectContent>
              {sterileSets.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.set_name} ({s.set_code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Patient UHID</Label>
          <Input value={issuePatientUhid} onChange={e => setIssuePatientUhid(e.target.value)} className="h-9" placeholder="Auto-fills from OT schedule" />
        </div>
        <Button className="w-full" onClick={issueSet} disabled={!issueSetId}>Issue Set</Button>

        {sterileSets.length === 0 && (
          <p className="text-xs text-amber-600 text-center py-4">No sterile sets available. Process a sterilization cycle first.</p>
        )}
      </div>

      {/* Return */}
      <div className="w-1/2 overflow-y-auto p-4 space-y-3">
        <h3 className="text-sm font-bold">Pending Returns</h3>
        {pendingReturns.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No pending returns</p>}
        {pendingReturns.map(pr => (
          <div key={pr.id} className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">{pr.instrument_sets?.set_name}</span>
                <p className="text-[11px] text-muted-foreground">{pr.instrument_sets?.set_code} · {pr.instruments_issued_count} instruments</p>
              </div>
              <Badge variant="outline" className="text-[10px]">{formatDistanceToNow(new Date(pr.issued_at), { addSuffix: true })}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Patient: {pr.patient_uhid || "—"}</p>
            <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => { setReturnItem(pr); setReturnedCount(pr.instruments_issued_count); }}>
              Process Return
            </Button>
          </div>
        ))}
      </div>

      {/* Return Modal */}
      <Dialog open={!!returnItem} onOpenChange={() => setReturnItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Process Return — {returnItem?.instrument_sets?.set_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Issued: {returnItem?.instruments_issued_count} instruments</p>
            <div>
              <Label className="text-xs">Instruments Returned</Label>
              <Input type="number" value={returnedCount} onChange={e => setReturnedCount(parseInt(e.target.value) || 0)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Damaged</Label>
              <Input type="number" value={damagedCount} onChange={e => setDamagedCount(parseInt(e.target.value) || 0)} className="h-9" />
            </div>

            {returnItem && (returnItem.instruments_issued_count - returnedCount - damagedCount) > 0 && (
              <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                <p className="text-sm text-red-700 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  {returnItem.instruments_issued_count - returnedCount - damagedCount} instrument(s) not accounted for
                </p>
                <div className="mt-2">
                  <Label className="text-xs text-red-700">Loss Reason (mandatory)</Label>
                  <Textarea value={lossReason} onChange={e => setLossReason(e.target.value)} rows={2} className="border-red-300" placeholder="Verify with OT team..." />
                </div>
              </div>
            )}

            {returnItem && returnedCount + damagedCount > returnItem.instruments_issued_count && (
              <p className="text-xs text-red-600">Count exceeds issued instruments — please verify</p>
            )}

            <Button className="w-full" onClick={processReturn}
              disabled={returnItem && (returnItem.instruments_issued_count - returnedCount - damagedCount) > 0 && !lossReason}>
              Confirm Return
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Issue Modal (from header button) */}
      <Dialog open={showIssue} onOpenChange={onCloseIssue}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Issue Set to OT</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Set (sterile only)</Label>
              <Select value={issueSetId} onValueChange={setIssueSetId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select set..." /></SelectTrigger>
                <SelectContent>
                  {sterileSets.map(s => <SelectItem key={s.id} value={s.id}>{s.set_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Patient UHID</Label>
              <Input value={issuePatientUhid} onChange={e => setIssuePatientUhid(e.target.value)} className="h-9" />
            </div>
            <Button className="w-full" onClick={issueSet}>Issue Set</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IssueReturnTab;
