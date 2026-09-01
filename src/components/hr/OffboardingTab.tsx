import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { printDocument, printHeader } from "@/lib/printUtils";
import { autoPostJournalEntry } from "@/lib/accounting";
import { UserMinus, Plus, Loader2, FileText, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

const CLEARANCE_ITEMS = [
  { key: "it", label: "IT / Systems access revoked" },
  { key: "pharmacy", label: "Pharmacy / drug returns" },
  { key: "stores", label: "Stores / assets returned" },
  { key: "finance", label: "Finance — advances / dues cleared" },
  { key: "hr", label: "HR — ID card, biometric removed" },
  { key: "department", label: "Department handover complete" },
];

const EXIT_TYPES = [
  { value: "resignation", label: "Resignation" },
  { value: "termination", label: "Termination" },
  { value: "retirement", label: "Retirement" },
  { value: "end_of_contract", label: "End of Contract" },
];

const STATUS_COLOR: Record<string, string> = {
  initiated: "bg-amber-100 text-amber-800",
  clearance: "bg-blue-100 text-blue-800",
  settled: "bg-indigo-100 text-indigo-800",
  completed: "bg-emerald-100 text-emerald-800",
};

interface Exit {
  id: string;
  user_id: string;
  staff_name?: string;
  exit_type: string;
  reason: string | null;
  notice_date: string | null;
  last_working_day: string | null;
  clearance: Record<string, boolean>;
  status: string;
}

const OffboardingTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [exits, setExits] = useState<Exit[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [showInit, setShowInit] = useState(false);
  const [form, setForm] = useState({ user_id: "", exit_type: "resignation", notice_date: "", last_working_day: "", reason: "" });

  const [active, setActive] = useState<Exit | null>(null);
  const [ffs, setFfs] = useState({ years: 0, basic: 0, gratuity: 0, leave_encashment: 0, pending_salary: "", bonus: "", deductions: "" });
  const [computing, setComputing] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [exitRes, staffRes] = await Promise.all([
      (supabase as any).from("staff_exits").select("*, users!staff_exits_user_id_fkey(full_name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setExits((exitRes.data || []).map((e: any) => ({ ...e, staff_name: e.users?.full_name, clearance: e.clearance || {} })));
    setStaff(staffRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const initiateExit = async () => {
    if (!form.user_id || !form.last_working_day) { toast({ title: "Select staff and last working day", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("staff_exits").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      exit_type: form.exit_type,
      notice_date: form.notice_date || null,
      last_working_day: form.last_working_day,
      reason: form.reason || null,
      status: "initiated",
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Exit initiated" });
    setShowInit(false);
    setForm({ user_id: "", exit_type: "resignation", notice_date: "", last_working_day: "", reason: "" });
    load();
  };

  const toggleClearance = async (exit: Exit, key: string) => {
    const next = { ...exit.clearance, [key]: !exit.clearance[key] };
    const allDone = CLEARANCE_ITEMS.every((c) => next[c.key]);
    await (supabase as any).from("staff_exits").update({ clearance: next, status: allDone ? "clearance" : exit.status }).eq("id", exit.id);
    const updated = { ...exit, clearance: next, status: allDone ? "clearance" : exit.status };
    setExits((prev) => prev.map((e) => (e.id === exit.id ? updated : e)));
    if (active?.id === exit.id) setActive(updated);
  };

  const openSettlement = async (exit: Exit) => {
    setActive(exit);
    setComputing(true);
    // Salary + joining date from staff_profiles; earned leave from leave_balance
    const [{ data: sp }, { data: bal }] = await Promise.all([
      (supabase as any).from("staff_profiles").select("basic_salary, created_at").eq("user_id", exit.user_id).maybeSingle(),
      (supabase as any).from("leave_balance").select("earned_total, earned_used").eq("user_id", exit.user_id).eq("year", new Date().getFullYear()).maybeSingle(),
    ]);
    const basic = Number(sp?.basic_salary) || 0;
    const joining = sp?.created_at ? new Date(sp.created_at) : null;
    const lwd = exit.last_working_day ? new Date(exit.last_working_day) : new Date();
    const years = joining ? (lwd.getTime() - joining.getTime()) / (1000 * 60 * 60 * 24 * 365.25) : 0;
    const gratuity = years >= 5 ? Math.round((basic * 15 / 26) * Math.floor(years)) : 0;
    const encashable = Math.max(0, (Number(bal?.earned_total) || 0) - (Number(bal?.earned_used) || 0));
    const leave_encashment = Math.round(encashable * (basic / 30));
    setFfs({ years: Math.round(years * 10) / 10, basic, gratuity, leave_encashment, pending_salary: "", bonus: "", deductions: "" });
    setComputing(false);
  };

  const netPayable = () =>
    ffs.gratuity + ffs.leave_encashment + (parseFloat(ffs.pending_salary) || 0) + (parseFloat(ffs.bonus) || 0) - (parseFloat(ffs.deductions) || 0);

  const settle = async () => {
    if (!active) return;
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    const net = netPayable();
    const { error } = await (supabase as any).from("full_final_settlements").insert({
      hospital_id: hospitalId,
      staff_exit_id: active.id,
      years_of_service: ffs.years,
      last_basic: ffs.basic,
      gratuity: ffs.gratuity,
      leave_encashment: ffs.leave_encashment,
      pending_salary: parseFloat(ffs.pending_salary) || 0,
      bonus: parseFloat(ffs.bonus) || 0,
      deductions: parseFloat(ffs.deductions) || 0,
      net_payable: net,
      settled_by: cu?.id || null,
    });
    if (error) { toast({ title: "Failed to settle", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("staff_exits").update({ status: "completed" }).eq("id", active.id);
    await supabase.from("users").update({ is_active: false }).eq("id", active.user_id);

    // Post the F&F payout to the General Ledger (mirrors payroll approval posting)
    await postFfsToLedger(active, cu?.id || null, net);

    toast({ title: "Full & Final settled", description: `${active.staff_name} deactivated · ₹${net.toLocaleString("en-IN")} net · posted to accounts.` });
    printStatement(active, net);
    setActive(null);
    load();
  };

  const postFfsToLedger = async (exit: Exit, postedBy: string | null, net: number) => {
    if (!hospitalId) return;
    const earnings = ffs.gratuity + ffs.leave_encashment + (parseFloat(ffs.pending_salary) || 0) + (parseFloat(ffs.bonus) || 0);
    const deductions = parseFloat(ffs.deductions) || 0;
    if (earnings <= 0) return;

    await autoPostJournalEntry({
      triggerEvent: "payroll_processed",
      sourceModule: "hr",
      sourceId: exit.id,
      amount: net,
      description: `Full & Final — ${exit.staff_name}`,
      hospitalId,
      postedBy: postedBy || undefined,
    });

    // The autoPostJournalEntry() call above is the real posting path: it resolves accounts from
    // the hospital's 'payroll_processed' auto_posting_rule, allocates entry_number via next_seq,
    // and records a miss in accounting_posting_failures when no rule is configured.
    //
    // A second, manual posting used to follow here. It never worked — it wrote journal_number /
    // status / reference_type / created_by (the columns are entry_number / entry_type /
    // source_module / posted_by) and then inserted into "journal_entry_lines", which does not
    // exist; the real table is journal_line_items. Every error was discarded, so the failure was
    // invisible. Its account codes were invented too: 5002 is "Salaries - Nurses" and 2103/2104
    // do not exist in the seeded chart of accounts, so had it ever run it would have booked the
    // settlement against the wrong accounts.
    //
    // Removed rather than repaired: repairing it would double-post every full & final
    // settlement, because autoPostJournalEntry() has already posted it.
  };

  const printStatement = async (exit: Exit, net: number) => {
    let hospitalName = "Hospital";
    const { data: h } = await (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
    if (h) hospitalName = h.name || "Hospital";
    const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    const row = (k: string, v: string, bold = false) => `<tr><td style="padding:5px 8px;color:#475569">${k}</td><td style="padding:5px 8px;text-align:right;${bold ? "font-weight:700" : ""}">${v}</td></tr>`;
    const body = `
      ${printHeader(hospitalName, "Full & Final Settlement Statement")}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">
        ${row("Employee", exit.staff_name || "—")}
        ${row("Exit Type", EXIT_TYPES.find((t) => t.value === exit.exit_type)?.label || exit.exit_type)}
        ${row("Last Working Day", exit.last_working_day || "—")}
        ${row("Completed Years of Service", String(ffs.years))}
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0"></td></tr>
        ${row("Gratuity (Act 1972)", inr(ffs.gratuity))}
        ${row("Leave Encashment", inr(ffs.leave_encashment))}
        ${row("Pending Salary", inr(parseFloat(ffs.pending_salary) || 0))}
        ${row("Bonus / Ex-gratia", inr(parseFloat(ffs.bonus) || 0))}
        ${row("Less: Deductions / Recoveries", "-" + inr(parseFloat(ffs.deductions) || 0))}
        <tr style="background:#e8f5e9"><td style="padding:8px;font-weight:700;color:#1b5e20">Net Payable</td><td style="padding:8px;text-align:right;font-weight:700;font-size:15px;color:#1b5e20">${inr(net)}</td></tr>
      </table>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px">
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px">Employee Signature</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px">Authorised Signatory</div></div>
      </div>`;
    printDocument("Full & Final Settlement", body);
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-12 flex-shrink-0 border-b border-border flex items-center gap-3 px-5">
        <UserMinus className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Exit & Full-and-Final</span>
        <Button size="sm" className="ml-auto text-xs gap-1.5" onClick={() => setShowInit(true)}>
          <Plus className="h-3 w-3" /> Initiate Exit
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {exits.length === 0 && <div className="text-center py-16 text-muted-foreground text-sm">No exits recorded.</div>}
        {exits.map((e) => {
          const doneCount = CLEARANCE_ITEMS.filter((c) => e.clearance[c.key]).length;
          return (
            <div key={e.id} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{e.staff_name}</span>
                    <Badge variant="outline" className="text-[10px]">{EXIT_TYPES.find((t) => t.value === e.exit_type)?.label}</Badge>
                    <Badge className={cn("text-[10px]", STATUS_COLOR[e.status])}>{e.status}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">LWD: {e.last_working_day || "—"} · Clearance {doneCount}/{CLEARANCE_ITEMS.length}</p>
                </div>
                {e.status !== "completed" && (
                  <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => openSettlement(e)}>
                    <Calculator className="h-3 w-3" /> Settle F&F
                  </Button>
                )}
              </div>
              {/* Clearance checklist */}
              {e.status !== "completed" && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 mt-2">
                  {CLEARANCE_ITEMS.map((c) => (
                    <label key={c.key} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input type="checkbox" checked={!!e.clearance[c.key]} onChange={() => toggleClearance(e, c.key)} />
                      <span className={cn(e.clearance[c.key] && "line-through text-muted-foreground")}>{c.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Initiate exit dialog */}
      <Dialog open={showInit} onOpenChange={setShowInit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Initiate Exit</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Staff</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background"
                value={form.user_id} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}>
                <option value="">Select staff…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Exit Type</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background"
                  value={form.exit_type} onChange={(e) => setForm((f) => ({ ...f, exit_type: e.target.value }))}>
                  {EXIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Notice Date</Label>
                <Input type="date" className="h-8 text-xs mt-1" value={form.notice_date} onChange={(e) => setForm((f) => ({ ...f, notice_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Last Working Day</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={form.last_working_day} onChange={(e) => setForm((f) => ({ ...f, last_working_day: e.target.value }))} />
            </div>
            <Textarea className="text-xs" placeholder="Reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowInit(false)}>Cancel</Button>
            <Button size="sm" onClick={initiateExit}>Initiate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* F&F settlement dialog */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm">Full & Final — {active?.staff_name}</DialogTitle></DialogHeader>
          {computing ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Computing…</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-muted/40 rounded-md p-2">Service: <strong>{ffs.years} yrs</strong> · Last Basic: <strong>₹{ffs.basic.toLocaleString("en-IN")}</strong></div>
                <div className="bg-muted/40 rounded-md p-2">Gratuity: <strong>₹{ffs.gratuity.toLocaleString("en-IN")}</strong>{ffs.years < 5 && <span className="text-amber-600"> (&lt;5 yrs)</span>}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Leave Encashment</Label>
                  <Input type="number" className="h-8 text-xs mt-0.5" value={ffs.leave_encashment} onChange={(e) => setFfs((s) => ({ ...s, leave_encashment: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Pending Salary</Label>
                  <Input type="number" className="h-8 text-xs mt-0.5" value={ffs.pending_salary} onChange={(e) => setFfs((s) => ({ ...s, pending_salary: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Bonus / Ex-gratia</Label>
                  <Input type="number" className="h-8 text-xs mt-0.5" value={ffs.bonus} onChange={(e) => setFfs((s) => ({ ...s, bonus: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Deductions / Recoveries</Label>
                  <Input type="number" className="h-8 text-xs mt-0.5" value={ffs.deductions} onChange={(e) => setFfs((s) => ({ ...s, deductions: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <span className="text-xs font-semibold text-emerald-800">Net Payable</span>
                <span className="text-base font-bold text-emerald-800">₹{netPayable().toLocaleString("en-IN")}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Settling records the F&F, deactivates the staff account, and prints the statement.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActive(null)}>Cancel</Button>
            <Button size="sm" onClick={settle} disabled={computing}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Settle & Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OffboardingTab;
