import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DialysisReportsTab: React.FC = () => {
  const [patients, setPatients] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      (supabase as any).from("dialysis_patients").select("*, patients(full_name, uhid)").eq("is_active", true),
      (supabase as any).from("dialysis_sessions").select("*, dialysis_patients(patients(full_name))").order("session_date", { ascending: false }).limit(500),
      (supabase as any).from("dialysis_machines").select("*").eq("is_active", true),
    ]).then(([pRes, sRes, mRes]: any[]) => {
      if (pRes.data) setPatients(pRes.data);
      if (sRes.data) setSessions(sRes.data);
      if (mRes.data) setMachines(mRes.data);
    });
  }, []);

  // Adequacy: patients with avg Kt/V < 1.2
  const patientKtv = patients.map(p => {
    const pSessions = sessions.filter(s => s.dialysis_patient_id === p.id && s.kt_v);
    const avg = pSessions.length > 0 ? pSessions.reduce((a, s) => a + Number(s.kt_v), 0) / pSessions.length : null;
    return { ...p, avgKtv: avg, sessionCount: pSessions.length };
  });

  const lowKtv = patientKtv.filter(p => p.avgKtv !== null && p.avgKtv < 1.2);

  // Compliance
  const patientCompliance = patients.map(p => {
    const pSessions = sessions.filter(s => s.dialysis_patient_id === p.id);
    const total = pSessions.length;
    const completed = pSessions.filter(s => s.status === "completed").length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { ...p, total, completed, pct };
  });

  const lowCompliance = patientCompliance.filter(p => p.pct < 80 && p.total > 0);

  // Machine utilization
  const machineUtil = machines.map(m => {
    const mSessions = sessions.filter(s => s.machine_id === m.id && s.status === "completed");
    return { ...m, usedSessions: mSessions.length };
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Adequacy */}
      <Card className={lowKtv.length > 0 ? "border-red-300" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Dialysis Adequacy (Kt/V)
            {lowKtv.length > 0 && <Badge className="bg-red-100 text-red-700 text-[10px]">⚠️ {lowKtv.length} below target</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Patient</TableHead>
                <TableHead className="text-xs">Sessions</TableHead>
                <TableHead className="text-xs">Avg Kt/V</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patientKtv.filter(p => p.avgKtv !== null).map(p => (
                <TableRow key={p.id} className={p.avgKtv! < 1.2 ? "bg-red-50" : ""}>
                  <TableCell className="text-xs">{p.patients?.full_name}</TableCell>
                  <TableCell className="text-xs">{p.sessionCount}</TableCell>
                  <TableCell className="text-xs font-mono font-bold">{p.avgKtv!.toFixed(2)}</TableCell>
                  <TableCell>
                    {p.avgKtv! >= 1.2
                      ? <Badge className="bg-green-100 text-green-700 text-[10px]">Adequate</Badge>
                      : <Badge className="bg-red-100 text-red-700 text-[10px]">Inadequate</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {patientKtv.filter(p => p.avgKtv !== null).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No Kt/V data available</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Compliance */}
      <Card className={lowCompliance.length > 0 ? "border-amber-300" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Session Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Patient</TableHead>
                <TableHead className="text-xs">Scheduled</TableHead>
                <TableHead className="text-xs">Completed</TableHead>
                <TableHead className="text-xs">Compliance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patientCompliance.filter(p => p.total > 0).map(p => (
                <TableRow key={p.id} className={p.pct < 80 ? "bg-amber-50" : ""}>
                  <TableCell className="text-xs">{p.patients?.full_name}</TableCell>
                  <TableCell className="text-xs">{p.total}</TableCell>
                  <TableCell className="text-xs">{p.completed}</TableCell>
                  <TableCell className="text-xs font-bold">{p.pct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Machine Utilization */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Machine Utilization</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {machineUtil.map(m => (
              <div key={m.id} className="border border-border rounded-lg p-3 text-center">
                <p className="text-sm font-medium">{m.machine_name}</p>
                <p className="text-2xl font-bold">{m.usedSessions}</p>
                <p className="text-[10px] text-muted-foreground">completed sessions</p>
                <Badge className="text-[9px] mt-1" variant="outline">{m.machine_type}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DialysisReportsTab;
