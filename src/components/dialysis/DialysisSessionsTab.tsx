import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  in_progress: "bg-blue-100 text-blue-700",
  scheduled: "bg-muted text-muted-foreground",
  missed: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

const DialysisSessionsTab: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    (supabase as any).from("dialysis_sessions")
      .select("*, dialysis_patients(patients(full_name, uhid)), dialysis_machines(machine_name)")
      .order("session_date", { ascending: false })
      .limit(100)
      .then(({ data }) => { if (data) setSessions(data); });
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Date</TableHead>
            <TableHead className="text-xs">Patient</TableHead>
            <TableHead className="text-xs">Machine</TableHead>
            <TableHead className="text-xs">Pre-Weight</TableHead>
            <TableHead className="text-xs">Post-Weight</TableHead>
            <TableHead className="text-xs">UF (mL)</TableHead>
            <TableHead className="text-xs">Kt/V</TableHead>
            <TableHead className="text-xs">Complications</TableHead>
            <TableHead className="text-xs">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map(s => (
            <TableRow key={s.id}>
              <TableCell className="text-xs">{s.session_date}</TableCell>
              <TableCell className="text-xs">{s.dialysis_patients?.patients?.full_name || "—"}</TableCell>
              <TableCell className="text-xs">{s.dialysis_machines?.machine_name || "—"}</TableCell>
              <TableCell className="text-xs">{s.pre_weight_kg || "—"} kg</TableCell>
              <TableCell className="text-xs">{s.post_weight_kg || "—"} kg</TableCell>
              <TableCell className="text-xs">{s.uf_achieved_ml || "—"}</TableCell>
              <TableCell className="text-xs">
                {s.kt_v ? <span className={Number(s.kt_v) < 1.2 ? "text-red-600 font-bold" : "text-green-600 font-medium"}>{s.kt_v}</span> : "—"}
              </TableCell>
              <TableCell className="text-xs">{s.complications?.join(", ") || "—"}</TableCell>
              <TableCell><Badge className={`text-[10px] ${statusColor[s.status] || ""}`}>{s.status}</Badge></TableCell>
            </TableRow>
          ))}
          {sessions.length === 0 && (
            <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No sessions recorded</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default DialysisSessionsTab;
