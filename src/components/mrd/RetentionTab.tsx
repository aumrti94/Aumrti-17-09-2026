import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  hospitalId: string;
  userId: string;
}

const RetentionTab: React.FC<Props> = ({ hospitalId, userId }) => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (hospitalId) fetchSchedules(); }, [hospitalId]);

  const fetchSchedules = async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data, error } = await (supabase as any).from("retention_schedules").select("*, patients(full_name, uhid)").eq("hospital_id", hospitalId).eq("is_destroyed", false).order("retain_until", { ascending: true }).limit(100);
    if (error) toast.error(error.message);
    setSchedules(data || []);
    setLoading(false);
  };

  const getRetentionStatus = (retainUntil: string) => {
    const now = new Date();
    const until = new Date(retainUntil);
    const daysRemaining = Math.ceil((until.getTime() - now.getTime()) / 86400000);
    if (daysRemaining < 0) return { label: "OVERDUE", color: "bg-red-600 text-white", days: daysRemaining };
    if (daysRemaining <= 30) return { label: "Due for Review", color: "bg-red-100 text-red-700", days: daysRemaining };
    if (daysRemaining <= 365) return { label: "Review Soon", color: "bg-amber-100 text-amber-700", days: daysRemaining };
    return { label: "On Track", color: "bg-white text-foreground", days: daysRemaining };
  };

  const markReviewed = async (id: string) => {
    const { error } = await (supabase as any).from("retention_schedules").update({
      destruction_authorized_by: userId,
      destruction_date: new Date().toISOString().split("T")[0],
      is_destroyed: true,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked as reviewed & authorised");
    fetchSchedules();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Record Type</TableHead>
              <TableHead>Record Date</TableHead>
              <TableHead>Retain Until</TableHead>
              <TableHead>Days Remaining</TableHead>
              <TableHead>Basis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : schedules.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No retention schedules</TableCell></TableRow>
            ) : schedules.map((s) => {
              const ret = getRetentionStatus(s.retain_until);
              return (
                <TableRow key={s.id} className={ret.days < 0 ? "bg-red-50" : ret.days <= 30 ? "bg-red-50/50" : ret.days <= 365 ? "bg-amber-50/50" : ""}>
                  <TableCell>
                    <div className="text-[13px] font-medium">{s.patients?.full_name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{s.patients?.uhid}</div>
                  </TableCell>
                  <TableCell className="text-xs capitalize">{s.record_type}</TableCell>
                  <TableCell className="text-xs">{s.record_date ? new Date(s.record_date).toLocaleDateString("en-IN") : "—"}</TableCell>
                  <TableCell className="text-xs">{s.retain_until ? new Date(s.retain_until).toLocaleDateString("en-IN") : "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${ret.days < 0 ? "text-red-700 font-bold" : ret.days <= 30 ? "text-red-600" : ret.days <= 365 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {ret.days < 0 ? `${Math.abs(ret.days)}d overdue` : `${ret.days}d`}
                    </span>
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">{s.retention_basis}</TableCell>
                  <TableCell><Badge variant="secondary" className={ret.color}>{ret.label}</Badge></TableCell>
                  <TableCell>
                    {(ret.days <= 30) && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markReviewed(s.id)}>
                        Mark Reviewed
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default RetentionTab;
