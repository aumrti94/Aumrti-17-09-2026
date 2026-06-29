import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ReferenceArea } from "recharts";
import { Thermometer } from "lucide-react";

interface Props { hospitalId: string; onLogged: () => void; }

const ColdChainTab: React.FC<Props> = ({ hospitalId, onLogged }) => {
  const [unitName, setUnitName] = useState("Vaccine Refrigerator 1");
  const [temperature, setTemperature] = useState("");
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase.from("cold_chain_log")
      .select("*").eq("hospital_id", hospitalId)
      .gte("recorded_at", sevenDaysAgo)
      .order("recorded_at", { ascending: true });
    setLogs(data || []);
  };

  const handleLog = async () => {
    const temp = parseFloat(temperature);
    if (isNaN(temp)) { toast.error("Enter valid temperature"); return; }
    setSaving(true);
    const alertTriggered = temp < 2 || temp > 8;

    const { error } = await supabase.from("cold_chain_log").insert({
      hospital_id: hospitalId,
      unit_name: unitName,
      temperature_c: temp,
      alert_triggered: alertTriggered,
    });

    if (error) { toast.error("Failed to log"); setSaving(false); return; }

    if (alertTriggered) {
      toast.error(`🔴 ALERT: Temperature out of range: ${temp}°C — Check refrigerator immediately. Do not use vaccines until temperature is restored.`);
      // Create clinical alert
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "cold_chain_breach",
        severity: "critical",
        alert_message: `Cold chain breach: ${temp}°C in ${unitName}. Outside safe range (2-8°C).`,
      });
    } else {
      toast.success(`Temperature logged: ${temp}°C ✅`);
      logNABHEvidence(hospitalId, "FMS.8",
        `Cold chain check: ${unitName}, Temp: ${temp}°C (within 2-8°C range)`);
    }

    setTemperature("");
    loadLogs();
    onLogged();
    setSaving(false);
  };

  const chartData = logs.map((l) => ({
    time: new Date(l.recorded_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
    temp: Number(l.temperature_c),
    unit: l.unit_name,
  }));

  return (
    <div className="space-y-4 pb-4">
      <Card className="p-4 max-w-lg">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Thermometer className="h-4 w-4" /> Record Temperature
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Unit</Label>
            <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Temperature (°C)</Label>
            <Input type="number" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="e.g. 4.5" />
          </div>
          <div className="flex items-end">
            <Button onClick={handleLog} disabled={saving} className="w-full">Record</Button>
          </div>
        </div>
      </Card>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Temperature History (7 days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis domain={[-5, 15]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <ReferenceArea y1={-5} y2={2} fill="#ef4444" fillOpacity={0.08} />
              <ReferenceArea y1={8} y2={15} fill="#ef4444" fillOpacity={0.08} />
              <ReferenceArea y1={2} y2={8} fill="#10b981" fillOpacity={0.06} />
              <ReferenceLine y={2} stroke="#ef4444" strokeDasharray="3 3" label="Min 2°C" />
              <ReferenceLine y={8} stroke="#ef4444" strokeDasharray="3 3" label="Max 8°C" />
              <Line type="monotone" dataKey="temp" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Recent Logs */}
      <div className="border rounded-lg overflow-auto max-h-60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Alert</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.slice(-20).reverse().map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm">{l.unit_name}</TableCell>
                <TableCell className={`font-mono text-sm ${l.alert_triggered ? "text-destructive font-bold" : ""}`}>
                  {Number(l.temperature_c).toFixed(1)}°C
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(l.recorded_at).toLocaleString("en-IN")}
                </TableCell>
                <TableCell>
                  {l.alert_triggered && <Badge variant="destructive" className="text-[10px]">ALERT</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ColdChainTab;
