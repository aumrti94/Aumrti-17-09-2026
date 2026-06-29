import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface StaffRow {
  name: string;
  dept: string;
  status: "present" | "leave" | "absent";
}

const DoctorsDrillDown: React.FC = () => {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data: doctors } = await supabase
      .from("users")
      .select("id, full_name, department_id")
      .eq("role", "doctor")
      .eq("is_active", true);

    const { data: attendance } = await supabase
      .from("staff_attendance")
      .select("user_id, status")
      .eq("attendance_date", today);

    const attMap: Record<string, string> = {};
    for (const a of attendance || []) {
      attMap[a.user_id] = a.status;
    }

    const deptIds = [...new Set((doctors || []).map(d => d.department_id).filter(Boolean))];
    let deptMap: Record<string, string> = {};
    if (deptIds.length > 0) {
      const { data: depts } = await supabase.from("departments").select("id, name").in("id", deptIds as string[]);
      deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
    }

    const rows: StaffRow[] = (doctors || []).map((d): StaffRow => ({
      name: d.full_name || "Unknown",
      dept: d.department_id ? (deptMap[d.department_id] || "—") : "—",
      status: attMap[d.id] === "leave" ? "leave" as const : "present" as const,
    })).sort((a, b) => {
      const order = { leave: 0, absent: 1, present: 2 };
      return order[a.status] - order[b.status];
    });

    setStaff(rows);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  const statusBadge = (s: string) => {
    if (s === "leave") return { text: "On Leave", cls: "text-[hsl(var(--accent-foreground))] bg-[hsl(var(--accent))]/10" };
    return { text: "On Duty", cls: "text-[hsl(var(--success))] bg-[hsl(var(--success))]/10" };
  };

  return (
    <div className="space-y-4">
      <h4 className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider">Doctor Roster</h4>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Doctor</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Department</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-4 text-muted-foreground">No doctors found</td></tr>
            ) : staff.map((s, i) => {
              const badge = statusBadge(s.status);
              return (
                <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.dept}</td>
                  <td className="text-right px-3 py-2">
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", badge.cls)}>{badge.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DoctorsDrillDown;
