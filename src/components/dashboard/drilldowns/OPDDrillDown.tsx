import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DoctorRow {
  name: string;
  dept: string;
  patients: number;
}

const OPDDrillDown: React.FC = () => {
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data: visits } = await supabase
      .from("opd_visits")
      .select("doctor_id")
      .eq("visit_date", today)
      .neq("status", "cancelled");

    const doctorCounts: Record<string, number> = {};
    for (const v of visits || []) {
      if (v.doctor_id) {
        doctorCounts[v.doctor_id] = (doctorCounts[v.doctor_id] || 0) + 1;
      }
    }

    const doctorIds = Object.keys(doctorCounts);
    if (doctorIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, department_id")
        .in("id", doctorIds);

      const deptIds = [...new Set((users || []).map(u => u.department_id).filter(Boolean))];
      let deptMap: Record<string, string> = {};
      if (deptIds.length > 0) {
        const { data: depts } = await supabase
          .from("departments")
          .select("id, name")
          .in("id", deptIds as string[]);
        deptMap = Object.fromEntries((depts || []).map(d => [d.id, d.name]));
      }

      const rows: DoctorRow[] = (users || []).map((u) => ({
        name: u.full_name || "Unknown",
        dept: u.department_id ? (deptMap[u.department_id] || "—") : "—",
        patients: doctorCounts[u.id] || 0,
      })).sort((a, b) => b.patients - a.patients);

      setDoctors(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider mb-2">By Doctor</h4>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Doctor</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Dept</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Patients</th>
              </tr>
            </thead>
            <tbody>
              {doctors.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-4 text-muted-foreground">No OPD visits today</td></tr>
              ) : doctors.map((d, i) => (
                <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.dept}</td>
                  <td className="text-right px-3 py-2 font-bold">{d.patients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OPDDrillDown;
