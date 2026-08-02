import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfigValues } from "@/hooks/useConfigValues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { differenceInDays, format } from "date-fns";
import { UserCircle, CalendarCheck, Palmtree, DollarSign, FolderArchive, ClipboardCheck, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { openStoredFile, BUCKETS } from "@/lib/storageUrls";

type Me = { id: string; full_name: string; role: string; hospital_id: string };

const SECTIONS = [
  { id: "overview", label: "Overview", icon: UserCircle },
  { id: "attendance", label: "My Attendance", icon: CalendarCheck },
  { id: "leave", label: "My Leave", icon: Palmtree },
  { id: "payslips", label: "My Payslips", icon: DollarSign },
  { id: "documents", label: "My Documents", icon: FolderArchive },
  { id: "requests", label: "Requests", icon: ClipboardCheck },
];

const MyHRPage: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const leaveTypeOptions = useConfigValues("leave_types");
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("overview");

  const [balance, setBalance] = useState<any>(null);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [myRequests, setMyRequests] = useState<{ reg: any[]; ot: any[]; swap: any[] }>({ reg: [], ot: [], swap: [] });

  const monthStart = new Date().toISOString().slice(0, 8) + "01";

  const loadMe = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const { data } = await supabase.from("users").select("id, full_name, role, hospital_id").eq("auth_user_id", authData.user?.id || "").maybeSingle();
    setMe((data as Me) || null);
    setLoading(false);
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const loadAll = useCallback(async () => {
    if (!me) return;
    const year = new Date().getFullYear();
    const [balRes, attRes, leaveRes, itemsRes, slipsRes, docRes, staffRes, regRes, otRes, swapRes] = await Promise.all([
      (supabase as any).from("leave_balance").select("*").eq("user_id", me.id).eq("year", year).maybeSingle(),
      (supabase as any).from("staff_attendance").select("*").eq("user_id", me.id).gte("attendance_date", monthStart).order("attendance_date", { ascending: false }),
      (supabase as any).from("leave_requests").select("*").eq("user_id", me.id).order("applied_at", { ascending: false }),
      (supabase as any).from("payroll_items").select("*, payroll_runs(run_month, status)").eq("user_id", me.id),
      (supabase as any).from("payslips").select("*, payroll_runs(month, year, status)").eq("staff_id", me.id),
      (supabase as any).from("staff_documents").select("*").eq("user_id", me.id).order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", me.hospital_id).eq("is_active", true).neq("id", me.id).order("full_name"),
      (supabase as any).from("attendance_regularization_requests").select("*").eq("user_id", me.id).order("created_at", { ascending: false }),
      (supabase as any).from("overtime_requests").select("*").eq("user_id", me.id).order("created_at", { ascending: false }),
      (supabase as any).from("shift_swap_requests").select("*").eq("requester_id", me.id).order("created_at", { ascending: false }),
    ]);
    setBalance(balRes.data);
    setAttendance(attRes.data || []);
    setLeaves(leaveRes.data || []);
    const legacy = (itemsRes.data || []).map((i: any) => ({ month: i.payroll_runs?.run_month, net: i.net_salary, status: i.payroll_runs?.status }));
    const modern = (slipsRes.data || []).map((s: any) => ({ month: s.payroll_runs ? `${s.payroll_runs.month}/${s.payroll_runs.year}` : "—", net: s.net_pay, status: s.payroll_runs?.status }));
    setPayslips([...modern, ...legacy]);
    setDocs(docRes.data || []);
    setStaff(staffRes.data || []);
    setMyRequests({ reg: regRes.data || [], ot: otRes.data || [], swap: swapRes.data || [] });
  }, [me, monthStart]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Request forms ─────────────────────────────────────────────────────────
  const [leaveForm, setLeaveForm] = useState({ leave_type: "casual", from_date: "", to_date: "", reason: "" });
  const [regForm, setRegForm] = useState({ attendance_date: "", requested_status: "present", reason: "" });
  const [otForm, setOtForm] = useState({ ot_date: "", hours: "", reason: "" });
  const [swapForm, setSwapForm] = useState({ requester_date: "", counterparty_id: "", counterparty_date: "", reason: "" });

  const applyLeave = async () => {
    if (!me || !leaveForm.from_date || !leaveForm.to_date || !leaveForm.reason) { toast({ title: "Fill all fields", variant: "destructive" }); return; }
    const days = differenceInDays(new Date(leaveForm.to_date), new Date(leaveForm.from_date)) + 1;
    const { error } = await (supabase as any).from("leave_requests").insert({
      hospital_id: me.hospital_id, user_id: me.id, leave_type: leaveForm.leave_type,
      from_date: leaveForm.from_date, to_date: leaveForm.to_date, days_count: days, reason: leaveForm.reason,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Leave applied — pending approval" });
    setLeaveForm({ leave_type: "casual", from_date: "", to_date: "", reason: "" });
    loadAll();
  };

  const submitReg = async () => {
    if (!me || !regForm.attendance_date) { toast({ title: "Select date", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("attendance_regularization_requests").insert({
      hospital_id: me.hospital_id, user_id: me.id, attendance_date: regForm.attendance_date, requested_status: regForm.requested_status, reason: regForm.reason || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Regularization requested" });
    setRegForm({ attendance_date: "", requested_status: "present", reason: "" });
    loadAll();
  };

  const submitOt = async () => {
    if (!me || !otForm.ot_date || !otForm.hours) { toast({ title: "Fill date and hours", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("overtime_requests").insert({
      hospital_id: me.hospital_id, user_id: me.id, ot_date: otForm.ot_date, hours: parseFloat(otForm.hours), reason: otForm.reason || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Overtime requested" });
    setOtForm({ ot_date: "", hours: "", reason: "" });
    loadAll();
  };

  const submitSwap = async () => {
    if (!me || !swapForm.requester_date || !swapForm.counterparty_id || !swapForm.counterparty_date) { toast({ title: "Fill all fields", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("shift_swap_requests").insert({
      hospital_id: me.hospital_id, requester_id: me.id, requester_date: swapForm.requester_date,
      counterparty_id: swapForm.counterparty_id, counterparty_date: swapForm.counterparty_date, reason: swapForm.reason || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Swap requested" });
    setSwapForm({ requester_date: "", counterparty_id: "", counterparty_date: "", reason: "" });
    loadAll();
  };

  const statusPill = (s: string) => (
    <Badge className={cn("text-[10px] capitalize",
      s === "approved" ? "bg-emerald-100 text-emerald-800" : s === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800")}>{s}</Badge>
  );

  const Bar = ({ label, used, total }: { label: string; used: number; total: number }) => {
    const pct = total > 0 ? (used / total) * 100 : 0;
    return (
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{label}</span><span className="font-medium">{used}/{total} days</span></div>
        <div className="h-2 bg-muted rounded-full overflow-hidden"><div className={cn("h-full rounded-full", pct < 50 ? "bg-success" : pct < 80 ? "bg-amber-500" : "bg-destructive")} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
      </div>
    );
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  if (!me) return <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">No staff profile linked to your account.</div>;

  return (
    <div className="flex flex-col" style={{ height: "100vh" }}>
      <div className="h-14 flex-shrink-0 bg-card border-b border-border flex items-center gap-3 px-5">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <UserCircle className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-bold">My HR</p>
          <p className="text-[11px] text-muted-foreground">{me.full_name} · {me.role}</p>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex-shrink-0 border-b border-border flex gap-1 px-4 overflow-x-auto">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={cn("flex items-center gap-1.5 px-3 py-2.5 text-xs whitespace-nowrap border-b-2 transition-colors",
                section === s.id ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-5">
        {section === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">Leave Balance {new Date().getFullYear()}</h3>
              {balance ? (
                <>
                  <Bar label="Casual" used={balance.casual_used} total={balance.casual_total} />
                  <Bar label="Sick" used={balance.sick_used} total={balance.sick_total} />
                  <Bar label="Earned" used={balance.earned_used} total={balance.earned_total} />
                </>
              ) : <p className="text-xs text-muted-foreground">No leave balance configured.</p>}
            </div>
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">This Month</h3>
              <p className="text-xs text-muted-foreground">Present: <strong className="text-foreground">{attendance.filter((a) => a.status === "present" || a.status === "late").length}</strong></p>
              <p className="text-xs text-muted-foreground">On Leave: <strong className="text-foreground">{attendance.filter((a) => a.status === "on_leave").length}</strong></p>
              <p className="text-xs text-muted-foreground">Absent: <strong className="text-foreground">{attendance.filter((a) => a.status === "absent").length}</strong></p>
              <p className="text-xs text-muted-foreground mt-2">Pending requests: <strong className="text-foreground">{[...myRequests.reg, ...myRequests.ot, ...myRequests.swap].filter((r) => r.status === "pending").length}</strong></p>
            </div>
          </div>
        )}

        {section === "attendance" && (
          <div className="max-w-2xl border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">In</th><th className="text-left px-3 py-2">Out</th><th className="text-left px-3 py-2">Hours</th><th className="text-left px-3 py-2">OT</th></tr></thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-t border-border"><td className="px-3 py-1.5">{a.attendance_date}</td><td className="px-3 py-1.5 capitalize">{a.status?.replace(/_/g, " ")}</td><td className="px-3 py-1.5">{a.in_time?.slice(0, 5) || "—"}</td><td className="px-3 py-1.5">{a.out_time?.slice(0, 5) || "—"}</td><td className="px-3 py-1.5">{a.hours_worked ?? "—"}</td><td className="px-3 py-1.5">{a.overtime_hours || 0}</td></tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No attendance this month</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {section === "leave" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="border border-border rounded-lg p-4 bg-card space-y-3">
              <h3 className="text-sm font-semibold">Apply for Leave</h3>
              <select className="w-full h-8 text-xs border border-input rounded-md px-2 bg-background" value={leaveForm.leave_type} onChange={(e) => setLeaveForm((f) => ({ ...f, leave_type: e.target.value }))}>
                {leaveTypeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px]">From</Label><Input type="date" className="h-8 text-xs" value={leaveForm.from_date} onChange={(e) => setLeaveForm((f) => ({ ...f, from_date: e.target.value }))} /></div>
                <div><Label className="text-[10px]">To</Label><Input type="date" className="h-8 text-xs" value={leaveForm.to_date} onChange={(e) => setLeaveForm((f) => ({ ...f, to_date: e.target.value }))} /></div>
              </div>
              <Textarea className="text-xs" placeholder="Reason" value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} />
              <Button size="sm" onClick={applyLeave}>Apply</Button>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-2">My Leave Requests</h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {leaves.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-xs border-b border-border/50 pb-1.5">
                    <span className="capitalize">{l.leave_type}</span>
                    <span className="text-muted-foreground">{format(new Date(l.from_date), "dd MMM")}–{format(new Date(l.to_date), "dd MMM")}</span>
                    <span className="ml-auto">{statusPill(l.status)}</span>
                  </div>
                ))}
                {leaves.length === 0 && <p className="text-xs text-muted-foreground">No requests yet</p>}
              </div>
            </div>
          </div>
        )}

        {section === "payslips" && (
          <div className="max-w-xl border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">Month</th><th className="text-right px-3 py-2">Net Pay</th><th className="text-left px-3 py-2">Status</th></tr></thead>
              <tbody>
                {payslips.map((p, i) => (
                  <tr key={i} className="border-t border-border"><td className="px-3 py-1.5">{p.month}</td><td className="px-3 py-1.5 text-right font-semibold">₹{Number(p.net || 0).toLocaleString("en-IN")}</td><td className="px-3 py-1.5 capitalize">{p.status || "—"}</td></tr>
                ))}
                {payslips.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">No payslips yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {section === "documents" && (
          <div className="max-w-2xl space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="border border-border rounded-lg p-3 bg-card flex items-center gap-3 text-xs">
                <FolderArchive className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 capitalize font-medium">{d.doc_type?.replace(/_/g, " ")}</span>
                {d.expiry_date && <span className="text-muted-foreground">exp {d.expiry_date}</span>}
                <button
                  type="button"
                  className="text-primary"
                  title="Open document"
                  onClick={async () => {
                    if (!(await openStoredFile(BUCKETS.hospitalPrivate, d.file_url))) {
                      toast({ title: "Could not open document", variant: "destructive" });
                    }
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            ))}
            {docs.length === 0 && <p className="text-xs text-muted-foreground">No documents on file. Contact HR to upload.</p>}
          </div>
        )}

        {section === "requests" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Regularization */}
            <div className="border border-border rounded-lg p-4 bg-card space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4" /> Regularization</h3>
              <Input type="date" className="h-8 text-xs" value={regForm.attendance_date} onChange={(e) => setRegForm((f) => ({ ...f, attendance_date: e.target.value }))} />
              <select className="w-full h-8 text-xs border border-input rounded-md px-2 bg-background" value={regForm.requested_status} onChange={(e) => setRegForm((f) => ({ ...f, requested_status: e.target.value }))}>
                <option value="present">Present</option><option value="half_day">Half Day</option><option value="on_leave">On Leave</option>
              </select>
              <Input className="h-8 text-xs" placeholder="Reason" value={regForm.reason} onChange={(e) => setRegForm((f) => ({ ...f, reason: e.target.value }))} />
              <Button size="sm" className="w-full" onClick={submitReg}>Submit</Button>
              <div className="space-y-1 pt-1">{myRequests.reg.map((r) => <div key={r.id} className="flex items-center gap-2 text-[11px]"><span>{r.attendance_date}</span><span className="capitalize text-muted-foreground">{r.requested_status.replace(/_/g, " ")}</span><span className="ml-auto">{statusPill(r.status)}</span></div>)}</div>
            </div>
            {/* Overtime */}
            <div className="border border-border rounded-lg p-4 bg-card space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><DollarSign className="h-4 w-4" /> Overtime</h3>
              <Input type="date" className="h-8 text-xs" value={otForm.ot_date} onChange={(e) => setOtForm((f) => ({ ...f, ot_date: e.target.value }))} />
              <Input type="number" className="h-8 text-xs" placeholder="Hours" value={otForm.hours} onChange={(e) => setOtForm((f) => ({ ...f, hours: e.target.value }))} />
              <Input className="h-8 text-xs" placeholder="Reason" value={otForm.reason} onChange={(e) => setOtForm((f) => ({ ...f, reason: e.target.value }))} />
              <Button size="sm" className="w-full" onClick={submitOt}>Submit</Button>
              <div className="space-y-1 pt-1">{myRequests.ot.map((r) => <div key={r.id} className="flex items-center gap-2 text-[11px]"><span>{r.ot_date}</span><span className="text-muted-foreground">{r.hours}h</span><span className="ml-auto">{statusPill(r.status)}</span></div>)}</div>
            </div>
            {/* Shift swap */}
            <div className="border border-border rounded-lg p-4 bg-card space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><CalendarCheck className="h-4 w-4" /> Shift Swap</h3>
              <div><Label className="text-[10px]">My shift date</Label><Input type="date" className="h-8 text-xs" value={swapForm.requester_date} onChange={(e) => setSwapForm((f) => ({ ...f, requester_date: e.target.value }))} /></div>
              <select className="w-full h-8 text-xs border border-input rounded-md px-2 bg-background" value={swapForm.counterparty_id} onChange={(e) => setSwapForm((f) => ({ ...f, counterparty_id: e.target.value }))}>
                <option value="">Swap with…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <div><Label className="text-[10px]">Their shift date</Label><Input type="date" className="h-8 text-xs" value={swapForm.counterparty_date} onChange={(e) => setSwapForm((f) => ({ ...f, counterparty_date: e.target.value }))} /></div>
              <Button size="sm" className="w-full" onClick={submitSwap}>Submit</Button>
              <div className="space-y-1 pt-1">{myRequests.swap.map((r) => <div key={r.id} className="flex items-center gap-2 text-[11px]"><span>{r.requester_date}</span><span className="ml-auto">{statusPill(r.status)}</span></div>)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyHRPage;
