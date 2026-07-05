import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2, ClipboardCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Attendance Regularization & Overtime approvals. Rendered inside the Attendance
 * tab as a third view. Approving writes back into staff_attendance so the change
 * flows into payroll (leave/OT counts).
 */

interface RegReq { id: string; user_id: string; staff_name?: string; attendance_date: string; requested_status: string; reason: string | null; status: string; }
interface OtReq { id: string; user_id: string; staff_name?: string; ot_date: string; hours: number; reason: string | null; status: string; }

const AttendanceApprovalsPanel: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [regs, setRegs] = useState<RegReq[]>([]);
  const [ots, setOts] = useState<OtReq[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [regRes, otRes] = await Promise.all([
      (supabase as any).from("attendance_regularization_requests").select("*, users!attendance_regularization_requests_user_id_fkey(full_name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("overtime_requests").select("*, users!overtime_requests_user_id_fkey(full_name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
    ]);
    setRegs((regRes.data || []).map((r: any) => ({ ...r, staff_name: r.users?.full_name })));
    setOts((otRes.data || []).map((o: any) => ({ ...o, staff_name: o.users?.full_name })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const reviewer = async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    return cu?.id || null;
  };

  const decideReg = async (req: RegReq, approve: boolean) => {
    const rid = await reviewer();
    await (supabase as any).from("attendance_regularization_requests")
      .update({ status: approve ? "approved" : "rejected", reviewed_by: rid, reviewed_at: new Date().toISOString() }).eq("id", req.id);
    if (approve) {
      await (supabase as any).from("staff_attendance").upsert(
        { hospital_id: hospitalId, user_id: req.user_id, attendance_date: req.attendance_date, status: req.requested_status, source: "regularization" },
        { onConflict: "hospital_id,user_id,attendance_date" }
      );
    }
    setRegs((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: approve ? "approved" : "rejected" } : r)));
    toast({ title: approve ? "Regularization approved & applied" : "Request rejected" });
  };

  const decideOt = async (req: OtReq, approve: boolean) => {
    const rid = await reviewer();
    await (supabase as any).from("overtime_requests")
      .update({ status: approve ? "approved" : "rejected", reviewed_by: rid, reviewed_at: new Date().toISOString() }).eq("id", req.id);
    if (approve) {
      // Add OT hours to the attendance row; create one (present) if none exists.
      const { data: existing } = await (supabase as any).from("staff_attendance")
        .select("id").eq("user_id", req.user_id).eq("attendance_date", req.ot_date).maybeSingle();
      if (existing) {
        await (supabase as any).from("staff_attendance").update({ overtime_hours: req.hours }).eq("id", existing.id);
      } else {
        await (supabase as any).from("staff_attendance").insert(
          { hospital_id: hospitalId, user_id: req.user_id, attendance_date: req.ot_date, status: "present", overtime_hours: req.hours, source: "overtime" }
        );
      }
    }
    setOts((prev) => prev.map((o) => (o.id === req.id ? { ...o, status: approve ? "approved" : "rejected" } : o)));
    toast({ title: approve ? "Overtime approved & applied" : "Request rejected" });
  };

  const statusPill = (s: string) => (
    <Badge className={cn("text-[10px] capitalize",
      s === "approved" ? "bg-emerald-100 text-emerald-800" : s === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800")}>{s}</Badge>
  );

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Regularization */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" /> Regularization Requests</h3>
        <div className="space-y-2">
          {regs.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-lg">No requests</div>}
          {regs.map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-2.5 bg-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold">{r.staff_name}</span>
                <span className="text-[10px] text-muted-foreground">{r.attendance_date}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{r.requested_status.replace(/_/g, " ")}</Badge>
                <span className="ml-auto">{statusPill(r.status)}</span>
              </div>
              {r.reason && <p className="text-[11px] text-muted-foreground mt-1">{r.reason}</p>}
              {r.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="h-7 text-[10px] bg-success text-success-foreground hover:bg-success/90 flex-1 gap-1" onClick={() => decideReg(r, true)}><Check className="h-3 w-3" /> Approve</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive flex-1 gap-1" onClick={() => decideReg(r, false)}><X className="h-3 w-3" /> Reject</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Overtime */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Overtime Requests</h3>
        <div className="space-y-2">
          {ots.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-lg">No requests</div>}
          {ots.map((o) => (
            <div key={o.id} className="border border-border rounded-lg p-2.5 bg-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold">{o.staff_name}</span>
                <span className="text-[10px] text-muted-foreground">{o.ot_date}</span>
                <Badge variant="outline" className="text-[10px]">{o.hours}h</Badge>
                <span className="ml-auto">{statusPill(o.status)}</span>
              </div>
              {o.reason && <p className="text-[11px] text-muted-foreground mt-1">{o.reason}</p>}
              {o.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="h-7 text-[10px] bg-success text-success-foreground hover:bg-success/90 flex-1 gap-1" onClick={() => decideOt(o, true)}><Check className="h-3 w-3" /> Approve</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive flex-1 gap-1" onClick={() => decideOt(o, false)}><X className="h-3 w-3" /> Reject</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AttendanceApprovalsPanel;
