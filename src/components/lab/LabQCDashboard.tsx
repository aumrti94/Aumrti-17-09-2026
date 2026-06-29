import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { ScatterChart, Scatter, XAxis, YAxis, ReferenceLine, ResponsiveContainer, CartesianGrid, Tooltip } from "recharts";
import EmptyState from "@/components/EmptyState";

interface QCEntry {
  id: string;
  test_name: string;
  analyzer: string;
  level: string;
  value: number;
  mean: number;
  sd: number;
  recorded_at: string;
  recorded_by: string;
}

interface WestgardWarning {
  rule: string;
  severity: "warning" | "reject";
  message: string;
}

const checkWestgardRules = (qcValues: number[], mean: number, sd: number): WestgardWarning[] => {
  const warnings: WestgardWarning[] = [];
  const n = qcValues.length;
  if (n < 2 || sd === 0) return warnings;

  const latest = qcValues[n - 1];
  const zscore = (latest - mean) / sd;

  // 1-3s rule
  if (Math.abs(zscore) > 3)
    warnings.push({ rule: "1-3s", severity: "reject", message: "Latest QC value exceeds 3 SD — run rejected" });

  // 1-2s rule
  if (Math.abs(zscore) > 2 && Math.abs(zscore) <= 3)
    warnings.push({ rule: "1-2s", severity: "warning", message: "Latest QC value exceeds 2 SD — check equipment" });

  // 2-2s rule
  if (n >= 2) {
    const prev = qcValues[n - 2];
    const prevZ = (prev - mean) / sd;
    if (zscore > 2 && prevZ > 2)
      warnings.push({ rule: "2-2s", severity: "reject", message: "Two consecutive QC values exceed +2 SD — systematic error" });
    if (zscore < -2 && prevZ < -2)
      warnings.push({ rule: "2-2s", severity: "reject", message: "Two consecutive QC values below -2 SD — systematic error" });
  }

  // R-4s rule
  if (n >= 2) {
    const prev = qcValues[n - 2];
    const prevZ = (prev - mean) / sd;
    if (Math.abs(zscore - prevZ) > 4)
      warnings.push({ rule: "R-4s", severity: "reject", message: "Range between consecutive values > 4 SD — random error" });
  }

  // 10x rule
  if (n >= 10) {
    const last10 = qcValues.slice(-10);
    const allAbove = last10.every(v => v > mean);
    const allBelow = last10.every(v => v < mean);
    if (allAbove || allBelow)
      warnings.push({ rule: "10x", severity: "warning", message: "10 consecutive values on same side of mean — drift detected" });
  }

  return warnings;
};

interface Props {
  hospitalId: string;
}

const LabQCDashboard: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [entries, setEntries] = useState<QCEntry[]>([]);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedAnalyzer, setSelectedAnalyzer] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Add form
  const [newTest, setNewTest] = useState("");
  const [newAnalyzer, setNewAnalyzer] = useState("");
  const [newLevel, setNewLevel] = useState("L1");
  const [newValue, setNewValue] = useState("");
  const [newMean, setNewMean] = useState("");
  const [newSD, setNewSD] = useState("");

  useEffect(() => {
    loadEntries();
  }, [hospitalId]);

  const loadEntries = async () => {
    const { data } = await (supabase as any)
      .from("lab_qc_entries")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("recorded_at", { ascending: true })
      .limit(500);
    setEntries(data || []);
  };

  const tests = [...new Set(entries.map(e => e.test_name))];
  const analyzers = [...new Set(entries.map(e => e.analyzer))];

  const filtered = entries.filter(e => {
    if (selectedTest && e.test_name !== selectedTest) return false;
    if (selectedAnalyzer && e.analyzer !== selectedAnalyzer) return false;
    return true;
  });

  // Group by test+analyzer+level for Westgard
  const groups: Record<string, QCEntry[]> = {};
  filtered.forEach(e => {
    const key = `${e.test_name}|${e.analyzer}|${e.level}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const handleAdd = async () => {
    const val = parseFloat(newValue);
    const mean = parseFloat(newMean);
    const sd = parseFloat(newSD);
    if (isNaN(val) || isNaN(mean) || isNaN(sd) || !newTest || !newAnalyzer) {
      toast({ title: "Fill all fields", variant: "destructive" });
      return;
    }

    await (supabase as any).from("lab_qc_entries").insert({
      hospital_id: hospitalId,
      test_name: newTest,
      analyzer: newAnalyzer,
      level: newLevel,
      value: val,
      mean,
      sd,
      recorded_at: new Date().toISOString(),
    });

    // Log NABL evidence
    logNABHEvidence(hospitalId, "NABL.QC", `QC run: ${newTest} on ${newAnalyzer} Level ${newLevel}, Value=${val}, Mean=${mean}, SD=${sd}`);

    toast({ title: "✓ QC entry recorded" });
    setShowAdd(false);
    setNewValue("");
    loadEntries();
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-5 py-3 flex items-center gap-3">
        <h2 className="text-sm font-bold text-foreground">QC Dashboard — Westgard Rules</h2>
        <div className="flex-1" />
        <Select value={selectedTest} onValueChange={setSelectedTest}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="All Tests" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all_tests">All Tests</SelectItem>
            {tests.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedAnalyzer} onValueChange={setSelectedAnalyzer}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="All Analyzers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all_analyzers">All Analyzers</SelectItem>
            {analyzers.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="text-xs h-8" onClick={() => setShowAdd(true)}>
          <Plus size={14} className="mr-1" /> Record QC
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {Object.keys(groups).length === 0 && (
          <EmptyState icon="📊" title="No QC data" description="Record your first QC run to start monitoring" />
        )}

        {Object.entries(groups).map(([key, groupEntries]) => {
          const [testName, analyzer, level] = key.split("|");
          const mean = groupEntries[0]?.mean || 0;
          const sd = groupEntries[0]?.sd || 1;
          const values = groupEntries.map(e => e.value);
          const warnings = checkWestgardRules(values, mean, sd);
          const hasReject = warnings.some(w => w.severity === "reject");
          const hasWarning = warnings.some(w => w.severity === "warning");

          const chartData = groupEntries.map((e, i) => ({
            index: i + 1,
            value: e.value,
            date: e.recorded_at?.split("T")[0],
            zscore: sd > 0 ? ((e.value - mean) / sd).toFixed(2) : "0",
          }));

          return (
            <div key={key} className={cn(
              "bg-card border rounded-lg p-4",
              hasReject ? "border-destructive" : hasWarning ? "border-amber-300" : "border-border"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-bold text-foreground">{testName}</p>
                  <p className="text-[10px] text-muted-foreground">{analyzer} · Level {level} · Mean: {mean} ± {sd}</p>
                </div>
                <div className="flex items-center gap-2">
                  {hasReject && (
                    <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <XCircle size={10} /> REJECT
                    </span>
                  )}
                  {hasWarning && !hasReject && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle size={10} /> WARNING
                    </span>
                  )}
                  {!hasReject && !hasWarning && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 size={10} /> PASS
                    </span>
                  )}
                </div>
              </div>

              {/* Levey-Jennings Chart */}
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 5, left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="index" type="number" tick={{ fontSize: 10 }} label={{ value: "Run #", fontSize: 10, position: "insideBottom", offset: -2 }} />
                    <YAxis
                      domain={[mean - 4 * sd, mean + 4 * sd]}
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => v.toFixed(1)}
                    />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-card border border-border rounded px-2 py-1 text-[10px] shadow">
                            <p>Run #{d.index} · {d.date}</p>
                            <p className="font-bold">Value: {d.value} (z={d.zscore})</p>
                          </div>
                        );
                      }}
                    />
                    {/* SD bands */}
                    <ReferenceLine y={mean} stroke="hsl(var(--foreground))" strokeWidth={1} label={{ value: "Mean", fontSize: 9 }} />
                    <ReferenceLine y={mean + sd} stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeWidth={0.5} />
                    <ReferenceLine y={mean - sd} stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeWidth={0.5} />
                    <ReferenceLine y={mean + 2 * sd} stroke="hsl(var(--warning, 45 93% 47%))" strokeDasharray="3 3" strokeWidth={0.8} />
                    <ReferenceLine y={mean - 2 * sd} stroke="hsl(var(--warning, 45 93% 47%))" strokeDasharray="3 3" strokeWidth={0.8} />
                    <ReferenceLine y={mean + 3 * sd} stroke="hsl(var(--destructive))" strokeWidth={1} />
                    <ReferenceLine y={mean - 3 * sd} stroke="hsl(var(--destructive))" strokeWidth={1} />
                    <Scatter
                      data={chartData}
                      fill="hsl(var(--primary))"
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        const z = Math.abs(parseFloat(payload.zscore));
                        const color = z > 3 ? "hsl(var(--destructive))" : z > 2 ? "hsl(38, 92%, 50%)" : "hsl(var(--primary))";
                        return <circle cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={1} />;
                      }}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="space-y-1 mt-2">
                  {warnings.map((w, i) => (
                    <div key={i} className={cn(
                      "text-[11px] px-2.5 py-1.5 rounded flex items-center gap-1.5",
                      w.severity === "reject" ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-700"
                    )}>
                      {w.severity === "reject" ? <XCircle size={12} /> : <AlertTriangle size={12} />}
                      <span className="font-bold">{w.rule}:</span> {w.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add QC Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-card rounded-xl border border-border shadow-xl w-[400px] p-5 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Record QC Run</h3>
            <Input placeholder="Test name (e.g. Glucose)" value={newTest} onChange={e => setNewTest(e.target.value)} className="h-9 text-xs" />
            <Input placeholder="Analyzer (e.g. Roche Cobas)" value={newAnalyzer} onChange={e => setNewAnalyzer(e.target.value)} className="h-9 text-xs" />
            <Select value={newLevel} onValueChange={setNewLevel}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="L1">Level 1 (Normal)</SelectItem>
                <SelectItem value="L2">Level 2 (Abnormal)</SelectItem>
                <SelectItem value="L3">Level 3 (Pathological)</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Value" type="number" value={newValue} onChange={e => setNewValue(e.target.value)} className="h-9 text-xs" />
              <Input placeholder="Mean" type="number" value={newMean} onChange={e => setNewMean(e.target.value)} className="h-9 text-xs" />
              <Input placeholder="SD" type="number" value={newSD} onChange={e => setNewSD(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" className="flex-1 text-xs" onClick={handleAdd}>Save QC Entry</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabQCDashboard;
