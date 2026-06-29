import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from "recharts";

const StimulationTab = () => {
  const [cycles, setCycles] = useState<any[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [scans, setScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Form
  const [scanDate, setScanDate] = useState(new Date().toISOString().split("T")[0]);
  const [scanDay, setScanDay] = useState("");
  const [rightFollicles, setRightFollicles] = useState<number[]>([]);
  const [leftFollicles, setLeftFollicles] = useState<number[]>([]);
  const [endoMm, setEndoMm] = useState("");
  const [endoPattern, setEndoPattern] = useState("");
  const [e2, setE2] = useState("");
  const [lh, setLh] = useState("");
  const [p4, setP4] = useState("");
  const [currentDose, setCurrentDose] = useState("");
  const [doseAdj, setDoseAdj] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [newFollicle, setNewFollicle] = useState("");
  const [newLeftFollicle, setNewLeftFollicle] = useState("");

  useEffect(() => {
    supabase.from("ivf_cycles").select("id, couple_id, cycle_type, start_date, status")
      .not("status", "in", '("positive","negative","cancelled")')
      .then(({ data }) => setCycles(data || []));
  }, []);

  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    supabase.from("stimulation_monitoring").select("*")
      .eq("cycle_id", selectedCycleId).order("scan_day")
      .then(({ data, error }) => {
        if (error) console.error(error);
        setScans(data || []);
        setLoading(false);
      });
  }, [selectedCycleId]);

  const triggerMet = () => {
    const large = [...rightFollicles, ...leftFollicles].filter((f) => f >= 18).length;
    return large >= 3;
  };

  const addFollicle = (side: "right" | "left") => {
    const val = side === "right" ? newFollicle : newLeftFollicle;
    const num = parseFloat(val);
    if (!num || num <= 0) return;
    if (side === "right") { setRightFollicles([...rightFollicles, num]); setNewFollicle(""); }
    else { setLeftFollicles([...leftFollicles, num]); setNewLeftFollicle(""); }
  };

  const handleSave = async () => {
    if (!selectedCycleId || !scanDay) { toast.error("Cycle and scan day required"); return; }
    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    const { error } = await supabase.from("stimulation_monitoring").insert({
      hospital_id: userData?.hospital_id,
      cycle_id: selectedCycleId,
      scan_date: scanDate,
      scan_day: parseInt(scanDay),
      right_follicles: rightFollicles,
      left_follicles: leftFollicles,
      endometrium_mm: endoMm ? parseFloat(endoMm) : null,
      endometrium_pattern: endoPattern || null,
      e2_level: e2 ? parseFloat(e2) : null,
      lh_level: lh ? parseFloat(lh) : null,
      p4_level: p4 ? parseFloat(p4) : null,
      current_dose: currentDose || null,
      dose_adjustment: doseAdj || null,
      trigger_criteria_met: triggerMet(),
      notes: notes || null,
      recorded_by: userData?.id,
    });
    if (error) { console.error(error); toast.error("Failed to save scan"); }
    else {
      toast.success("Scan recorded");
      setRightFollicles([]); setLeftFollicles([]);
      setEndoMm(""); setE2(""); setLh(""); setP4("");
      setCurrentDose(""); setDoseAdj(""); setNotes(""); setScanDay("");
      // Reload
      const { data } = await supabase.from("stimulation_monitoring").select("*")
        .eq("cycle_id", selectedCycleId).order("scan_day");
      setScans(data || []);
    }
    setSaving(false);
  };

  // Chart data
  const chartData = scans.map((s) => ({
    day: `Day ${s.scan_day}`,
    endo: s.endometrium_mm,
    rightMax: Math.max(...((s.right_follicles as number[]) || [0])),
    leftMax: Math.max(...((s.left_follicles as number[]) || [0])),
    e2: s.e2_level,
  }));

  return (
    <div className="grid grid-cols-2 gap-4" style={{ height: "calc(100vh - 240px)" }}>
      {/* Left: Chart + History */}
      <div className="space-y-4 overflow-auto">
        <div>
          <Label>Select Active Cycle</Label>
          <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
            <SelectTrigger><SelectValue placeholder="Choose cycle" /></SelectTrigger>
            <SelectContent>
              {cycles.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  Cycle {c.cycle_type.toUpperCase()} — {c.start_date}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCycleId && chartData.length > 0 && (
          <Card className="p-3">
            <h3 className="text-sm font-semibold mb-2">Follicle Growth & Endometrium</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="rightMax" stroke="#3B82F6" name="Right Max (mm)" strokeWidth={2} />
                <Line type="monotone" dataKey="leftMax" stroke="#10B981" name="Left Max (mm)" strokeWidth={2} />
                <Line type="monotone" dataKey="endo" stroke="#EF4444" name="Endo (mm)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Scan history */}
        <div className="space-y-2">
          {scans.map((s) => (
            <Card key={s.id} className="p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Day {s.scan_day} — {s.scan_date}</span>
                {s.trigger_criteria_met && <Badge className="bg-green-600 text-[10px]">🎯 Trigger Met</Badge>}
              </div>
              <div className="text-muted-foreground">
                R: {(s.right_follicles as number[])?.join(", ") || "—"} | L: {(s.left_follicles as number[])?.join(", ") || "—"} | Endo: {s.endometrium_mm ?? "—"}mm
              </div>
              {s.dose_adjustment && <div className="text-muted-foreground">Dose: {s.dose_adjustment}</div>}
            </Card>
          ))}
        </div>
      </div>

      {/* Right: Entry Form */}
      <div className="overflow-auto space-y-3">
        <h3 className="text-sm font-semibold">New Scan Entry</h3>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Scan Date</Label><Input type="date" value={scanDate} onChange={(e) => setScanDate(e.target.value)} /></div>
          <div><Label className="text-xs">Stim Day</Label><Input type="number" value={scanDay} onChange={(e) => setScanDay(e.target.value)} placeholder="e.g. 8" /></div>
        </div>

        {/* Right follicles */}
        <Card className="p-2 space-y-1">
          <Label className="text-xs">Right Ovary Follicles (mm)</Label>
          <div className="flex flex-wrap gap-1">
            {rightFollicles.map((f, i) => (
              <Badge key={i} variant="outline" className={`font-mono ${f >= 18 ? "bg-green-100 border-green-400" : ""}`}>
                {f}mm
                <button className="ml-1 text-destructive" onClick={() => setRightFollicles(rightFollicles.filter((_, j) => j !== i))}>×</button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input type="number" placeholder="mm" value={newFollicle} onChange={(e) => setNewFollicle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFollicle("right")} className="w-20 h-7 text-xs" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addFollicle("right")}>+ Add</Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Right: {rightFollicles.length} follicles (≥14mm: {rightFollicles.filter((f) => f >= 14).length})
          </div>
        </Card>

        {/* Left follicles */}
        <Card className="p-2 space-y-1">
          <Label className="text-xs">Left Ovary Follicles (mm)</Label>
          <div className="flex flex-wrap gap-1">
            {leftFollicles.map((f, i) => (
              <Badge key={i} variant="outline" className={`font-mono ${f >= 18 ? "bg-green-100 border-green-400" : ""}`}>
                {f}mm
                <button className="ml-1 text-destructive" onClick={() => setLeftFollicles(leftFollicles.filter((_, j) => j !== i))}>×</button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input type="number" placeholder="mm" value={newLeftFollicle} onChange={(e) => setNewLeftFollicle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFollicle("left")} className="w-20 h-7 text-xs" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addFollicle("left")}>+ Add</Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Left: {leftFollicles.length} follicles (≥14mm: {leftFollicles.filter((f) => f >= 14).length})
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Endometrium (mm)</Label><Input type="number" step="0.1" value={endoMm} onChange={(e) => setEndoMm(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Pattern</Label>
            <Select value={endoPattern} onValueChange={setEndoPattern}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pattern" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Trilaminar">Trilaminar</SelectItem>
                <SelectItem value="Homogeneous">Homogeneous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">E2 (pg/mL)</Label><Input type="number" value={e2} onChange={(e) => setE2(e.target.value)} /></div>
          <div><Label className="text-xs">LH</Label><Input type="number" value={lh} onChange={(e) => setLh(e.target.value)} /></div>
          <div><Label className="text-xs">P4</Label><Input type="number" value={p4} onChange={(e) => setP4(e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Current Dose</Label><Input value={currentDose} onChange={(e) => setCurrentDose(e.target.value)} placeholder="Gonal-F 225IU" /></div>
          <div><Label className="text-xs">Dose Adjustment</Label><Input value={doseAdj} onChange={(e) => setDoseAdj(e.target.value)} placeholder="Continue same" /></div>
        </div>

        <div><Label className="text-xs">Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>

        {triggerMet() && (
          <Card className="p-2 border-green-400 bg-green-50">
            <p className="text-xs font-semibold text-green-800">🎯 Trigger criteria met — ≥3 follicles ≥18mm. Consider trigger today.</p>
          </Card>
        )}

        <Button onClick={handleSave} disabled={saving || !selectedCycleId} className="w-full">
          {saving ? "Saving…" : "Save Scan Record"}
        </Button>
      </div>
    </div>
  );
};

export default StimulationTab;
