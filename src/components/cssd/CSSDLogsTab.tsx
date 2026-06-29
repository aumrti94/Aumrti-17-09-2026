import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

const CSSDLogsTab: React.FC = () => {
  const [cycles, setCycles] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("sterilization_cycles")
      .select("*, cycle_instruments(*, instrument_sets(set_name))")
      .order("cycle_start_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { if (data) setCycles(data); });

    supabase.from("set_issues")
      .select("*, instrument_sets(set_name, set_code)")
      .order("issued_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { if (data) setIssues(data); });
  }, []);

  const flashCycles = cycles.filter(c => c.load_type === "flash");
  const totalCycles = cycles.length;
  const flashPercent = totalCycles > 0 ? ((flashCycles.length / totalCycles) * 100).toFixed(1) : "0";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Flash Sterilization Report */}
      <Card className={parseFloat(flashPercent) > 5 ? "border-red-300 bg-red-50" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Flash Sterilization Report
            {parseFloat(flashPercent) > 5 && <Badge className="bg-red-100 text-red-700 text-[10px]">⚠️ Above NABH threshold</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-bold text-red-600">{flashCycles.length}</p>
              <p className="text-xs text-muted-foreground">Flash cycles this period</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{flashPercent}%</p>
              <p className="text-xs text-muted-foreground">of all cycles (target &lt;1%)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{totalCycles}</p>
              <p className="text-xs text-muted-foreground">Total cycles</p>
            </div>
          </div>
          {flashCycles.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold text-red-700">Flash Justifications:</p>
              {flashCycles.map(c => (
                <p key={c.id} className="text-xs text-red-600">
                  {c.cycle_number} — {c.flash_justification || "No justification recorded"}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sterilization Cycle Log */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Sterilization Cycle Log</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Cycle #</TableHead>
              <TableHead className="text-xs">Autoclave</TableHead>
              <TableHead className="text-xs">Load Type</TableHead>
              <TableHead className="text-xs">Items</TableHead>
              <TableHead className="text-xs">BI</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycles.map(c => (
              <TableRow key={c.id} className={c.load_type === "flash" ? "bg-red-50" : c.status === "failed" ? "bg-red-50" : ""}>
                <TableCell className="text-xs">{format(new Date(c.cycle_start_at), "dd/MM/yyyy HH:mm")}</TableCell>
                <TableCell className="text-xs font-mono">{c.cycle_number}</TableCell>
                <TableCell className="text-xs">{c.autoclave_id}</TableCell>
                <TableCell>
                  <Badge className={`text-[10px] ${c.load_type === "flash" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>{c.load_type}</Badge>
                </TableCell>
                <TableCell className="text-xs">{c.cycle_instruments?.map((ci: any) => ci.instrument_sets?.set_name).filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell>
                  {c.bi_result === "pass" && <Badge className="bg-green-100 text-green-700 text-[10px]">Pass</Badge>}
                  {c.bi_result === "fail" && <Badge className="bg-red-100 text-red-700 text-[10px]">FAIL</Badge>}
                  {c.bi_result === "pending" && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Pending</Badge>}
                </TableCell>
                <TableCell>
                  {c.status === "completed" && <Badge className="bg-green-100 text-green-700 text-[10px]">Completed</Badge>}
                  {c.status === "in_progress" && <Badge className="bg-blue-100 text-blue-700 text-[10px]">In Progress</Badge>}
                  {c.status === "failed" && <Badge className="bg-red-100 text-red-700 text-[10px]">Failed</Badge>}
                  {c.status === "quarantine" && <Badge className="bg-red-100 text-red-700 text-[10px]">Quarantine</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Issue/Return Log */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Issue / Return Log</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Issued</TableHead>
              <TableHead className="text-xs">Set</TableHead>
              <TableHead className="text-xs">Patient</TableHead>
              <TableHead className="text-xs">Instruments</TableHead>
              <TableHead className="text-xs">Returned</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map(i => (
              <TableRow key={i.id} className={i.return_status === "loss_reported" ? "bg-red-50" : ""}>
                <TableCell className="text-xs">{format(new Date(i.issued_at), "dd/MM/yyyy HH:mm")}</TableCell>
                <TableCell className="text-xs">{i.instrument_sets?.set_name}</TableCell>
                <TableCell className="text-xs">{i.patient_uhid || "—"}</TableCell>
                <TableCell className="text-xs">{i.instruments_issued_count}</TableCell>
                <TableCell className="text-xs">
                  {i.returned_at ? format(new Date(i.returned_at), "dd/MM HH:mm") : "—"}
                  {i.loss_count > 0 && <span className="text-red-600 ml-1">(⚠️ {i.loss_count} lost)</span>}
                </TableCell>
                <TableCell>
                  {i.return_status === "complete" && <Badge className="bg-green-100 text-green-700 text-[10px]">Complete</Badge>}
                  {i.return_status === "pending" && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Pending</Badge>}
                  {i.return_status === "loss_reported" && <Badge className="bg-red-100 text-red-700 text-[10px]">Loss Reported</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CSSDLogsTab;
