import React, { useState, useEffect } from "react";
import { format, differenceInDays } from "date-fns";
import { Check, X, CalendarIcon, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useConfigValues } from "@/hooks/useConfigValues";

interface LeaveRequest {
  id: string;
  user_id: string;
  full_name: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  days_count: number;
  reason: string;
  status: string;
  applied_at: string;
}

interface LeaveBalanceData {
  casual_total: number; casual_used: number;
  sick_total: number; sick_used: number;
  earned_total: number; earned_used: number;
  comp_off_balance: number;
}


const LeaveManagementTab: React.FC = () => {
  const { toast } = useToast();
  const leaveTypeOptions = useConfigValues("leave_types");
  const [filter, setFilter] = useState("pending");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [balance, setBalance] = useState<LeaveBalanceData | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyForm, setApplyForm] = useState({ userId: "", leaveType: "casual", fromDate: undefined as Date | undefined, toDate: undefined as Date | undefined, reason: "" });
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [childrenCount, setChildrenCount] = useState(0);
  const [maternityUsed, setMaternityUsed] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data: reqData } = await (supabase as any)
        .from("leave_requests")
        .select("*, users!leave_requests_user_id_fkey(full_name)")
        .order("applied_at", { ascending: false });

      setRequests(
        (reqData || []).map((r: any) => ({
          ...r,
          full_name: r.users?.full_name || "Unknown",
        }))
      );

      const { data: staffData } = await supabase.from("users").select("id, full_name").eq("is_active", true).order("full_name");
      setStaff(staffData || []);
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedStaff) { setBalance(null); return; }
    const loadBalance = async () => {
      const year = new Date().getFullYear();
      const { data } = await (supabase as any)
        .from("leave_balance")
        .select("*")
        .eq("user_id", selectedStaff)
        .eq("year", year)
        .maybeSingle();
      setBalance(data as LeaveBalanceData | null);
    };
    loadBalance();
  }, [selectedStaff]);

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  const handleApprove = async (id: string) => {
    const req = requests.find((r) => r.id === id);
    if (!req) return;

    await (supabase as any).from("leave_requests").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);

    // Update leave balance
    const year = new Date().getFullYear();
    const leaveCol = `${req.leave_type}_used` as string;
    if (["casual", "sick", "earned"].includes(req.leave_type)) {
      const { data: bal } = await (supabase as any).from("leave_balance").select("*").eq("user_id", req.user_id).eq("year", year).maybeSingle();
      if (bal) {
        await (supabase as any).from("leave_balance").update({ [leaveCol]: (bal as any)[leaveCol] + req.days_count }).eq("id", bal.id);
      }
    }

    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r)));
    toast({ title: "Leave approved" });
  };

  const handleReject = async () => {
    if (!rejectId) return;
    await (supabase as any).from("leave_requests").update({ status: "rejected", reviewer_notes: rejectNotes, reviewed_at: new Date().toISOString() }).eq("id", rejectId);
    setRequests((prev) => prev.map((r) => (r.id === rejectId ? { ...r, status: "rejected" } : r)));
    setRejectId(null);
    setRejectNotes("");
    toast({ title: "Leave rejected" });
  };

  const loadMaternityData = async (userId: string) => {
    const { data: sp } = await (supabase as any)
      .from("staff_profiles")
      .select("children_count")
      .eq("user_id", userId)
      .maybeSingle();
    setChildrenCount(Number(sp?.children_count) || 0);

    const year = new Date().getFullYear();
    const { data: leaves } = await (supabase as any)
      .from("leave_requests")
      .select("days_count")
      .eq("user_id", userId)
      .eq("leave_type", "maternity")
      .eq("status", "approved")
      .gte("from_date", `${year}-01-01`);
    setMaternityUsed((leaves || []).reduce((s: number, l: any) => s + Number(l.days_count || 0), 0));
  };

  const handleApplyLeave = async () => {
    if (!applyForm.userId || !applyForm.fromDate || !applyForm.toDate || !applyForm.reason) {
      toast({ title: "Fill all fields", variant: "destructive" });
      return;
    }

    const days = differenceInDays(applyForm.toDate, applyForm.fromDate) + 1;

    if (applyForm.leaveType === "maternity") {
      const maxDays = childrenCount >= 2 ? 84 : 182;
      const remaining = maxDays - maternityUsed;
      if (days > remaining) {
        toast({
          title: "Maternity Leave Limit Exceeded",
          description: `Eligible: ${maxDays} days (${childrenCount >= 2 ? "12 wks — 2+ children" : "26 wks"}). Already used: ${maternityUsed} days. Remaining: ${remaining} days. Requested: ${days} days.`,
          variant: "destructive",
        });
        return;
      }
    }

    const { data: userData } = await supabase.from("users").select("hospital_id").eq("id", applyForm.userId).maybeSingle();
    if (!userData) return;

    const { error } = await (supabase as any).from("leave_requests").insert({
      hospital_id: userData.hospital_id,
      user_id: applyForm.userId,
      leave_type: applyForm.leaveType,
      from_date: format(applyForm.fromDate, "yyyy-MM-dd"),
      to_date: format(applyForm.toDate, "yyyy-MM-dd"),
      days_count: days,
      reason: applyForm.reason,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Leave applied — pending approval" });
      setShowApplyModal(false);
      setApplyForm({ userId: "", leaveType: "casual", fromDate: undefined, toDate: undefined, reason: "" });
      // Reload
      const { data: reqData } = await (supabase as any).from("leave_requests").select("*, users!leave_requests_user_id_fkey(full_name)").order("applied_at", { ascending: false });
      setRequests((reqData || []).map((r: any) => ({ ...r, full_name: r.users?.full_name || "Unknown" })));
    }
  };

  const statusPill = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-accent/10 text-accent-foreground",
      approved: "bg-success/10 text-success",
      rejected: "bg-destructive/10 text-destructive",
      cancelled: "bg-muted text-muted-foreground",
    };
    return <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium capitalize", colors[status])}>{status}</span>;
  };

  const BalanceBar = ({ label, used, total }: { label: string; used: number; total: number }) => {
    const pct = total > 0 ? (used / total) * 100 : 0;
    const color = pct < 50 ? "bg-success" : pct < 80 ? "bg-accent" : "bg-destructive";
    return (
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-foreground">{used} / {total} days</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left — Requests Queue */}
      <div className="w-[360px] border-r border-border flex flex-col bg-card">
        <div className="p-3 border-b border-border">
          <div className="flex gap-1.5 mb-2">
            {["pending", "approved", "rejected", "all"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[10px] px-2.5 py-1 rounded-full font-medium capitalize transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {f} {f !== "all" && `(${requests.filter((r) => r.status === f).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filtered.map((req) => (
            <div key={req.id} className="bg-background rounded-lg border border-border p-3">
              <div className="flex items-start justify-between mb-1">
                <span className="text-xs font-semibold text-foreground">{req.full_name}</span>
                {statusPill(req.status)}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium capitalize">{req.leave_type}</span>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(req.from_date), "dd MMM")} – {format(new Date(req.to_date), "dd MMM")} · {req.days_count}d
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{req.reason}</p>
              {req.status === "pending" && (
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-[10px] bg-success text-success-foreground hover:bg-success/90 flex-1 gap-1" onClick={() => handleApprove(req.id)}>
                    <Check className="h-3 w-3" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive flex-1 gap-1" onClick={() => setRejectId(req.id)}>
                    <X className="h-3 w-3" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">No leave requests</div>
          )}
        </div>
      </div>

      {/* Right — Balance Overview */}
      <div className="flex-1 flex flex-col overflow-hidden p-5">
        <div className="flex items-center gap-3 mb-4">
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger className="w-[260px] h-9 text-xs">
              <SelectValue placeholder="Select staff to view balance" />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">{s.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" className="ml-auto text-xs gap-1.5" onClick={() => setShowApplyModal(true)}>
            <Plus className="h-3 w-3" /> Apply Leave for Staff
          </Button>
        </div>

        {balance ? (
          <div className="bg-card rounded-lg border border-border p-5 max-w-md">
            <h3 className="text-sm font-semibold text-foreground mb-4">Leave Balance — {new Date().getFullYear()}</h3>
            <BalanceBar label="Casual Leave" used={balance.casual_used} total={balance.casual_total} />
            <BalanceBar label="Sick Leave" used={balance.sick_used} total={balance.sick_total} />
            <BalanceBar label="Earned Leave" used={balance.earned_used} total={balance.earned_total} />
            {balance.comp_off_balance > 0 && (
              <div className="text-xs text-muted-foreground mt-2">Comp-off balance: {balance.comp_off_balance} days</div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a staff member to view leave balance
          </div>
        )}
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Rejection Reason</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for rejecting leave..." value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} className="text-xs" />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={handleReject}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply leave modal */}
      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Apply Leave for Staff</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={applyForm.userId} onValueChange={(v) => { setApplyForm((p) => ({ ...p, userId: v })); loadMaternityData(v); }}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => <SelectItem key={s.id} value={s.id} className="text-xs">{s.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={applyForm.leaveType} onValueChange={(v) => setApplyForm((p) => ({ ...p, leaveType: v }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {leaveTypeOptions.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {applyForm.leaveType === "maternity" && applyForm.userId && (() => {
              const maxDays = childrenCount >= 2 ? 84 : 182;
              const remaining = maxDays - maternityUsed;
              return (
                <div className="text-xs rounded-md bg-pink-50 border border-pink-200 px-3 py-2 text-pink-800 space-y-0.5">
                  <p className="font-semibold">Maternity Benefit Act, 1961</p>
                  <p>Entitlement: {maxDays} days ({childrenCount >= 2 ? "12 weeks — 2 or more surviving children" : "26 weeks"})</p>
                  <p>Already used this year: <strong>{maternityUsed} days</strong></p>
                  <p>Remaining: <strong className={remaining <= 0 ? "text-red-600" : ""}>{remaining} days</strong></p>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex-1 text-xs gap-1.5">
                    <CalendarIcon className="h-3 w-3" />
                    {applyForm.fromDate ? format(applyForm.fromDate, "dd MMM") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={applyForm.fromDate} onSelect={(d) => setApplyForm((p) => ({ ...p, fromDate: d }))} className="p-3 pointer-events-auto" /></PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex-1 text-xs gap-1.5">
                    <CalendarIcon className="h-3 w-3" />
                    {applyForm.toDate ? format(applyForm.toDate, "dd MMM") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={applyForm.toDate} onSelect={(d) => setApplyForm((p) => ({ ...p, toDate: d }))} className="p-3 pointer-events-auto" /></PopoverContent>
              </Popover>
            </div>
            {applyForm.fromDate && applyForm.toDate && (
              <div className="text-xs text-muted-foreground">
                Duration: {differenceInDays(applyForm.toDate, applyForm.fromDate) + 1} day(s)
              </div>
            )}
            <Textarea placeholder="Reason for leave..." value={applyForm.reason} onChange={(e) => setApplyForm((p) => ({ ...p, reason: e.target.value }))} className="text-xs" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowApplyModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleApplyLeave}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeaveManagementTab;
