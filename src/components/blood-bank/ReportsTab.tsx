import React, { useState, useEffect } from "react";
import BloodDemandForecastPanel from "./BloodDemandForecastPanel";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatBloodGroup, componentLabel } from "@/lib/bloodCompatibility";
import { format, addDays, isSameDay } from "date-fns";

const COMPONENTS = ['rbc','ffp','platelets','whole_blood','cryoprecipitate'];
const GROUPS = ['A','B','AB','O'];
const RH = ['positive','negative'];

const BBReportsTab: React.FC = () => {
  const [units, setUnits] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [crossMatches, setCrossMatches] = useState<any[]>([]);
  const [otSchedules, setOTSchedules] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("blood_units").select("*").then(({ data }) => { if (data) setUnits(data); });
    supabase.from("blood_issues").select("*, blood_units(component)").then(({ data }) => { if (data) setIssues(data); });
    supabase.from("cross_match_records").select("*").then(({ data }) => { if (data) setCrossMatches(data); });

    // Fetch upcoming OT schedules for demand forecast
    const today = new Date().toISOString().split("T")[0];
    const nextWeek = addDays(new Date(), 7).toISOString().split("T")[0];
    supabase.from("ot_schedules")
      .select("id, surgery_name, scheduled_date, surgery_category, patient:patients(full_name, uhid, blood_group)")
      .gte("scheduled_date", today)
      .lte("scheduled_date", nextWeek)
      .in("status", ["scheduled", "confirmed"])
      .order("scheduled_date", { ascending: true })
      .then(({ data }) => { if (data) setOTSchedules(data); });
  }, []);

  const available = units.filter(u => u.status === 'available');
  const expired = units.filter(u => u.status === 'expired' || u.status === 'discarded');
  const cmRatio = issues.length > 0 ? (crossMatches.length / issues.length).toFixed(1) : "—";

  // Estimate blood requirement per surgery category
  const estimateUnits = (category: string): number => {
    const map: Record<string, number> = {
      major: 2, minor: 0, moderate: 1, emergency: 3, cardiac: 4, ortho: 2, neuro: 2, obstetric: 2,
    };
    return map[category?.toLowerCase()] || 1;
  };

  // Aggregate OT demand by blood group
  const demandByGroup: Record<string, number> = {};
  otSchedules.forEach(ot => {
    const bg = (ot.patient as any)?.blood_group || "Unknown";
    const need = estimateUnits(ot.surgery_category);
    demandByGroup[bg] = (demandByGroup[bg] || 0) + need;
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Inventory Matrix */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Current Inventory Snapshot</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Component</TableHead>
                {GROUPS.flatMap(g => RH.map(r => (
                  <TableHead key={g+r} className="text-xs text-center">{formatBloodGroup(g, r)}</TableHead>
                )))}
                <TableHead className="text-xs text-center font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPONENTS.map(comp => {
                const compUnits = available.filter(u => u.component === comp);
                let total = 0;
                return (
                  <TableRow key={comp}>
                    <TableCell className="text-xs font-medium">{componentLabel(comp)}</TableCell>
                    {GROUPS.flatMap(g => RH.map(r => {
                      const count = compUnits.filter(u => u.blood_group === g && u.rh_factor === r).length;
                      total += count;
                      return (
                        <TableCell key={g+r} className={`text-xs text-center ${count === 0 ? 'text-red-500' : count < 3 ? 'text-amber-600' : 'text-green-600'} font-semibold`}>
                          {count}
                        </TableCell>
                      );
                    }))}
                    <TableCell className="text-xs text-center font-bold">{total}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Usage This Month</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{issues.length}</p>
            <p className="text-xs text-muted-foreground">units issued</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">C:T Ratio</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{cmRatio}</p>
            <p className="text-xs text-muted-foreground">Cross-match : Transfusion (target &lt;2.5)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Expiry Waste</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{expired.length}</p>
            <p className="text-xs text-muted-foreground">units expired/discarded</p>
          </CardContent>
        </Card>
      </div>

      {/* OT Demand Forecast */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">🔮 OT Blood Demand Forecast (Next 7 Days)</CardTitle></CardHeader>
        <CardContent>
          {otSchedules.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No scheduled surgeries in the next 7 days.</p>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Surgery</TableHead>
                    <TableHead className="text-xs">Patient</TableHead>
                    <TableHead className="text-xs">Blood Group</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs">Est. Units</TableHead>
                    <TableHead className="text-xs">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otSchedules.map(ot => {
                    const patient = ot.patient as any;
                    const bg = patient?.blood_group || "—";
                    const estUnits = estimateUnits(ot.surgery_category);
                    // Check available stock for this blood group
                    const [group, rh] = bg.includes('+') ? [bg.replace('+',''), 'positive'] : bg.includes('-') ? [bg.replace('-',''), 'negative'] : [null, null];
                    const stockCount = group ? available.filter(u => u.blood_group === group && u.rh_factor === rh && u.component === 'rbc').length : 0;
                    const sufficient = stockCount >= estUnits;

                    return (
                      <TableRow key={ot.id}>
                        <TableCell className="text-xs">{format(new Date(ot.scheduled_date), "dd/MM")}</TableCell>
                        <TableCell className="text-xs font-medium">{ot.surgery_name}</TableCell>
                        <TableCell className="text-xs">{patient?.full_name}</TableCell>
                        <TableCell className="text-xs font-semibold">{bg}</TableCell>
                        <TableCell className="text-xs capitalize">{ot.surgery_category || "—"}</TableCell>
                        <TableCell className="text-xs font-semibold">{estUnits}</TableCell>
                        <TableCell>
                          {group ? (
                            <Badge className={`text-[10px] ${sufficient ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {stockCount} RBC {sufficient ? "✓" : "⚠️"}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No BG</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Summary by blood group */}
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs font-semibold mb-2">Demand Summary by Blood Group</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(demandByGroup).map(([bg, need]) => (
                    <div key={bg} className="bg-background border border-border rounded px-3 py-1.5 text-xs">
                      <span className="font-semibold">{bg}</span>: {need} units needed
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <BloodDemandForecastPanel />
    </div>
  );
};

export default BBReportsTab;
