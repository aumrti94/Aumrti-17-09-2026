import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeftRight, Plus, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwapReq {
  id: string;
  requester_id: string; requester_name?: string; requester_date: string;
  counterparty_id: string; counterparty_name?: string; counterparty_date: string;
  reason: string | null; status: string;
}

const ShiftSwapPanel: React.FC<{ hospitalId: string; onSwapped?: () => void }> = ({ hospitalId, onSwapped }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reqs, setReqs] = useState<SwapReq[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ requester_id: "", requester_date: "", counterparty_id: "", counterparty_date: "", reason: "" });

  const load = useCallback(async () => {
    const [reqRes, staffRes] = await Promise.all([
      (supabase as any).from("shift_swap_requests")
        .select("*, req:users!shift_swap_requests_requester_id_fkey(full_name), cp:users!shift_swap_requests_counterparty_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setReqs((reqRes.data || []).map((r: any) => ({ ...r, requester_name: r.req?.full_name, counterparty_name: r.cp?.full_name })));
    setStaff(staffRes.data || []);
  }, [hospitalId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const pendingCount = reqs.filter((r) => r.status === "pending").length;

  const submit = async () => {
    if (!form.requester_id || !form.requester_date || !form.counterparty_id || !form.counterparty_date) {
      toast({ title: "Fill both staff and both dates", variant: "destructive" }); return;
    }
    const { error } = await (supabase as any).from("shift_swap_requests").insert({
      hospital_id: hospitalId, requester_id: form.requester_id, requester_date: form.requester_date,
      counterparty_id: form.counterparty_id, counterparty_date: form.counterparty_date, reason: form.reason || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Swap request submitted" });
    setShowForm(false);
    setForm({ requester_id: "", requester_date: "", counterparty_id: "", counterparty_date: "", reason: "" });
    load();
  };

  const decide = async (req: SwapReq, approve: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();

    if (!approve) {
      await (supabase as any).from("shift_swap_requests")
        .update({ status: "rejected", reviewed_by: cu?.id || null, reviewed_at: new Date().toISOString() }).eq("id", req.id);
      setReqs((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: "rejected" } : r)));
      toast({ title: "Swap rejected" });
      return;
    }

    // Approve: both staff must have a shift assigned on their swap dates first.
    const [{ data: rowA }, { data: rowB }] = await Promise.all([
      (supabase as any).from("duty_roster").select("id, shift_id, is_off").eq("user_id", req.requester_id).eq("roster_date", req.requester_date).maybeSingle(),
      (supabase as any).from("duty_roster").select("id, shift_id, is_off").eq("user_id", req.counterparty_id).eq("roster_date", req.counterparty_date).maybeSingle(),
    ]);
    if (!rowA || !rowB) {
      const who = !rowA ? `${req.requester_name} (${req.requester_date})` : `${req.counterparty_name} (${req.counterparty_date})`;
      toast({
        title: "Can't swap — no shift assigned",
        description: `${who} has no shift in the roster. Assign shifts to both staff on the swap dates in the grid above, then approve. (Request left pending.)`,
        variant: "destructive",
      });
      return; // leave request pending
    }

    // Both rows exist → perform the swap, then mark approved.
    await Promise.all([
      (supabase as any).from("duty_roster").update({ shift_id: rowB.shift_id, is_off: rowB.is_off, published_at: null }).eq("id", rowA.id),
      (supabase as any).from("duty_roster").update({ shift_id: rowA.shift_id, is_off: rowA.is_off, published_at: null }).eq("id", rowB.id),
    ]);
    await (supabase as any).from("shift_swap_requests")
      .update({ status: "approved", reviewed_by: cu?.id || null, reviewed_at: new Date().toISOString() }).eq("id", req.id);
    setReqs((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: "approved" } : r)));
    toast({ title: "Shifts swapped" });
    onSwapped?.();
  };

  const statusPill = (s: string) => (
    <Badge className={cn("text-[10px] capitalize",
      s === "approved" ? "bg-emerald-100 text-emerald-800" : s === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800")}>{s}</Badge>
  );

  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      <button className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b" onClick={() => setOpen((o) => !o)}>
        <ArrowLeftRight className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-bold">Shift Swaps</span>
        {pendingCount > 0 && <Badge className="bg-amber-100 text-amber-800 text-[10px]">{pendingCount} pending</Badge>}
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>

      {open && (
        <div className="p-4 space-y-2">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setShowForm(true)}><Plus className="h-3 w-3" /> Request Swap</Button>
          </div>
          {reqs.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No swap requests</div>}
          {reqs.map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-2.5 bg-card text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{r.requester_name}</span>
                <span className="text-muted-foreground">({r.requester_date})</span>
                <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold">{r.counterparty_name}</span>
                <span className="text-muted-foreground">({r.counterparty_date})</span>
                <span className="ml-auto">{statusPill(r.status)}</span>
              </div>
              {r.reason && <p className="text-[11px] text-muted-foreground mt-1">{r.reason}</p>}
              {r.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="h-7 text-[10px] bg-success text-success-foreground hover:bg-success/90 flex-1 gap-1" onClick={() => decide(r, true)}><Check className="h-3 w-3" /> Approve & Swap</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive flex-1 gap-1" onClick={() => decide(r, false)}><X className="h-3 w-3" /> Reject</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Request Shift Swap</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Staff A</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background" value={form.requester_id} onChange={(e) => setForm((f) => ({ ...f, requester_id: e.target.value }))}>
                  <option value="">Select…</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">A's Shift Date</Label>
                <Input type="date" className="h-8 text-xs mt-1" value={form.requester_date} onChange={(e) => setForm((f) => ({ ...f, requester_date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Staff B</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background" value={form.counterparty_id} onChange={(e) => setForm((f) => ({ ...f, counterparty_id: e.target.value }))}>
                  <option value="">Select…</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">B's Shift Date</Label>
                <Input type="date" className="h-8 text-xs mt-1" value={form.counterparty_date} onChange={(e) => setForm((f) => ({ ...f, counterparty_date: e.target.value }))} />
              </div>
            </div>
            <Input className="h-8 text-xs" placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={submit}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShiftSwapPanel;
