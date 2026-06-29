import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  patientId: string;
  hospitalId: string;
  encounterId?: string | null;
  admissionId?: string | null;
}

const APGAR_COMPONENTS = [
  { label: 'Colour', scores: ['Blue/Pale', 'Body pink, extremities blue', 'Completely pink'] },
  { label: 'Tone', scores: ['Limp', 'Some flexion', 'Active motion'] },
  { label: 'Reflex', scores: ['No response', 'Grimace', 'Cry/Cough'] },
  { label: 'Respiratory', scores: ['Absent', 'Slow/Irregular', 'Good/Crying'] },
  { label: 'Heart Rate', scores: ['Absent', '<100', '≥100'] },
];

// Simplified WHO z-score thresholds for term newborns (weight in grams)
const weightZScore = (g: number): number => {
  // Approximate using mean=3300g, SD=500g
  return (g - 3300) / 500;
};

const lengthZScore = (cm: number): number => {
  // Approximate using mean=50cm, SD=2cm
  return (cm - 50) / 2;
};

const hcZScore = (cm: number): number => {
  // Approximate using mean=34cm, SD=1.5cm
  return (cm - 34) / 1.5;
};

const zScoreDisplay = (z: number) => {
  if (z > -2) return { text: `${z.toFixed(1)} SD (Normal range)`, color: 'text-emerald-600' };
  if (z > -3) return { text: `${z.toFixed(1)} SD (Mild Undernutrition)`, color: 'text-amber-600' };
  return { text: `${z.toFixed(1)} SD (Severe Undernutrition)`, color: 'text-red-600' };
};

// Simplified Bhutani nomogram thresholds (age_hours → mg/dL thresholds)
const getBilirubinZone = (ageHours: number, value: number): 'low' | 'intermediate' | 'high' => {
  // Simplified thresholds
  const highThreshold = ageHours < 24 ? 8 : ageHours < 48 ? 12 : ageHours < 72 ? 15 : 17;
  const intThreshold = ageHours < 24 ? 5 : ageHours < 48 ? 9 : ageHours < 72 ? 12 : 14;
  if (value >= highThreshold) return 'high';
  if (value >= intThreshold) return 'intermediate';
  return 'low';
};

const NeonatalSheet: React.FC<Props> = ({ patientId, hospitalId, encounterId, admissionId }) => {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [dob, setDob] = useState('');
  const [birthWeight, setBirthWeight] = useState('');
  const [length, setLength] = useState('');
  const [hc, setHc] = useState('');
  const [apgar1, setApgar1] = useState<(number | null)[]>([null, null, null, null, null]);
  const [apgar5, setApgar5] = useState<(number | null)[]>([null, null, null, null, null]);
  const [bilirubinReadings, setBilirubinReadings] = useState<any[]>([]);
  const [phototherapy, setPhototherapy] = useState(false);
  const [tshDone, setTshDone] = useState(false);
  const [tshResult, setTshResult] = useState('');
  const [g6pdDone, setG6pdDone] = useState(false);
  const [g6pdResult, setG6pdResult] = useState('');
  const [hearingScreen, setHearingScreen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // New bilirubin entry state
  const [newBiliDay, setNewBiliDay] = useState('');
  const [newBiliValue, setNewBiliValue] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('neonatal_records')
        .select('*').eq('patient_id', patientId).eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setRecordId(data.id);
        setDob(data.date_of_birth ? new Date(data.date_of_birth).toISOString().slice(0, 16) : '');
        setBirthWeight(data.birth_weight_g?.toString() || '');
        setLength(data.length_cm?.toString() || '');
        setHc(data.head_circumference_cm?.toString() || '');
        setBilirubinReadings(data.bilirubin_readings || []);
        setPhototherapy(data.phototherapy_started || false);
        setTshDone(data.tsh_done || false);
        setTshResult(data.tsh_result || '');
        setG6pdDone(data.g6pd_done || false);
        setG6pdResult(data.g6pd_result || '');
        setHearingScreen(data.hearing_screen);
        // Reconstruct APGAR
        if (data.apgar_1min != null) {
          // We only store total — component-level isn't persisted
        }
      }
    })();
  }, [patientId, hospitalId]);

  const apgar1Total = apgar1.reduce((s, v) => s + (v ?? 0), 0);
  const apgar5Total = apgar5.reduce((s, v) => s + (v ?? 0), 0);
  const apgarColor = (total: number) => total >= 7 ? 'text-emerald-600' : total >= 4 ? 'text-amber-600' : 'text-red-600';
  const apgarLabel = (total: number) => total >= 7 ? 'Normal' : total >= 4 ? 'Moderate depression' : 'Severe depression — resuscitation needed';

  const wz = birthWeight ? weightZScore(parseInt(birthWeight)) : null;
  const lz = length ? lengthZScore(parseFloat(length)) : null;
  const hz = hc ? hcZScore(parseFloat(hc)) : null;

  const addBilirubinReading = () => {
    if (!newBiliDay || !newBiliValue) return;
    const dayNum = parseInt(newBiliDay);
    const val = parseFloat(newBiliValue);
    const ageHours = dayNum * 24;
    const zone = getBilirubinZone(ageHours, val);
    setBilirubinReadings(prev => [...prev, { day: dayNum, value_mg_dl: val, zone }]);
    setNewBiliDay('');
    setNewBiliValue('');

    if (zone === 'high') {
      supabase.from('clinical_alerts').insert([{
        hospital_id: hospitalId, patient_id: patientId,
        alert_type: 'neonatal_jaundice', severity: 'critical',
        alert_message: `High bilirubin zone — Day ${dayNum}: ${val} mg/dL. Consider phototherapy.`,
      }]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        hospital_id: hospitalId, patient_id: patientId,
        admission_id: admissionId || null,
        date_of_birth: dob ? new Date(dob).toISOString() : new Date().toISOString(),
        birth_weight_g: birthWeight ? parseInt(birthWeight) : null,
        length_cm: length ? parseFloat(length) : null,
        head_circumference_cm: hc ? parseFloat(hc) : null,
        weight_zscore: wz ? parseFloat(wz.toFixed(2)) : null,
        length_zscore: lz ? parseFloat(lz.toFixed(2)) : null,
        hc_zscore: hz ? parseFloat(hz.toFixed(2)) : null,
        apgar_1min: apgar1Total || null,
        apgar_5min: apgar5Total || null,
        bilirubin_readings: bilirubinReadings,
        phototherapy_started: phototherapy,
        tsh_done: tshDone, tsh_result: tshResult || null,
        g6pd_done: g6pdDone, g6pd_result: g6pdResult || null,
        hearing_screen: hearingScreen,
      };

      if (recordId) {
        await (supabase as any).from('neonatal_records').update(payload).eq('id', recordId);
      } else {
        const { data } = await (supabase as any).from('neonatal_records').insert([payload]).select('id').maybeSingle();
        if (data) setRecordId(data.id);
      }
      toast.success('Neonatal record saved');
    } catch (err) {
      toast.error('Failed to save neonatal record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Birth Details */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Birth Details</h3>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Date/Time of Birth</Label>
            <Input type="datetime-local" value={dob} onChange={e => setDob(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Birth Weight (g)</Label>
            <Input type="number" value={birthWeight} onChange={e => setBirthWeight(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Length (cm)</Label>
            <Input type="number" step="0.1" value={length} onChange={e => setLength(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Head Circumference (cm)</Label>
            <Input type="number" step="0.1" value={hc} onChange={e => setHc(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>

        {/* Z-scores */}
        {(wz !== null || lz !== null || hz !== null) && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">WHO Z-Scores</p>
            {wz !== null && <p className={cn("text-sm font-medium", zScoreDisplay(wz).color)}>Weight: {zScoreDisplay(wz).text}</p>}
            {lz !== null && <p className={cn("text-sm font-medium", zScoreDisplay(lz).color)}>Length: {zScoreDisplay(lz).text}</p>}
            {hz !== null && <p className={cn("text-sm font-medium", zScoreDisplay(hz).color)}>HC: {zScoreDisplay(hz).text}</p>}
          </div>
        )}
      </div>

      {/* APGAR Score */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">APGAR Score</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 font-medium text-muted-foreground">Component</th>
              <th className="text-center py-1.5 font-medium text-muted-foreground" colSpan={3}>1 Minute</th>
              <th className="text-center py-1.5 font-medium text-muted-foreground" colSpan={3}>5 Minutes</th>
            </tr>
          </thead>
          <tbody>
            {APGAR_COMPONENTS.map((comp, ci) => (
              <tr key={comp.label} className="border-b border-border/50">
                <td className="py-1.5 font-medium">{comp.label}</td>
                {[0, 1, 2].map(s => (
                  <td key={`1-${s}`} className="text-center py-1">
                    <button onClick={() => setApgar1(prev => { const n = [...prev]; n[ci] = s; return n; })}
                      className={cn("px-1.5 py-0.5 rounded text-[10px] min-w-[40px]",
                        apgar1[ci] === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                      )}>{s}</button>
                  </td>
                ))}
                {[0, 1, 2].map(s => (
                  <td key={`5-${s}`} className="text-center py-1">
                    <button onClick={() => setApgar5(prev => { const n = [...prev]; n[ci] = s; return n; })}
                      className={cn("px-1.5 py-0.5 rounded text-[10px] min-w-[40px]",
                        apgar5[ci] === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                      )}>{s}</button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-6">
          <div>
            <span className="text-sm font-bold">1 min: {apgar1Total}/10</span>
            <span className={cn("text-xs ml-2", apgarColor(apgar1Total))}>{apgarLabel(apgar1Total)}</span>
          </div>
          <div>
            <span className="text-sm font-bold">5 min: {apgar5Total}/10</span>
            <span className={cn("text-xs ml-2", apgarColor(apgar5Total))}>{apgarLabel(apgar5Total)}</span>
          </div>
        </div>
      </div>

      {/* Bilirubin Tracker */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Bilirubin Tracker</h3>
        <div className="flex gap-2 items-end">
          <div>
            <Label className="text-xs">Day of Life</Label>
            <Input type="number" min="1" value={newBiliDay} onChange={e => setNewBiliDay(e.target.value)} className="h-9 text-sm w-24" />
          </div>
          <div>
            <Label className="text-xs">Total Bilirubin (mg/dL)</Label>
            <Input type="number" step="0.1" value={newBiliValue} onChange={e => setNewBiliValue(e.target.value)} className="h-9 text-sm w-32" />
          </div>
          <Button size="sm" variant="outline" onClick={addBilirubinReading} className="h-9">+ Add</Button>
        </div>
        {bilirubinReadings.length > 0 && (
          <div className="space-y-1">
            {bilirubinReadings.map((r: any, i: number) => (
              <div key={i} className={cn("text-xs rounded px-3 py-1.5 flex justify-between",
                r.zone === 'high' ? 'bg-red-50 text-red-700' :
                r.zone === 'intermediate' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
              )}>
                <span>Day {r.day}: {r.value_mg_dl} mg/dL</span>
                <span className="font-medium capitalize">
                  {r.zone === 'high' ? '⚠️ High Zone — Consider phototherapy' : r.zone === 'intermediate' ? 'Intermediate Risk' : 'Low Risk'}
                </span>
              </div>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={phototherapy} onChange={e => setPhototherapy(e.target.checked)} className="rounded" />
          Phototherapy started
        </label>
      </div>

      {/* Newborn Screening */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Newborn Screening</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">TSH</Label>
            <div className="flex gap-2">
              {['Done', 'Pending'].map(v => (
                <button key={v} onClick={() => setTshDone(v === 'Done')}
                  className={cn("text-xs px-3 py-1 rounded-full border",
                    (tshDone && v === 'Done') || (!tshDone && v === 'Pending')
                      ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                  )}>{v === 'Done' ? '✓ Done' : 'Pending'}</button>
              ))}
            </div>
            {tshDone && <Input placeholder="TSH result" value={tshResult} onChange={e => setTshResult(e.target.value)} className="h-8 text-xs" />}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">G6PD</Label>
            <div className="flex gap-2">
              {['Done', 'Pending'].map(v => (
                <button key={v} onClick={() => setG6pdDone(v === 'Done')}
                  className={cn("text-xs px-3 py-1 rounded-full border",
                    (g6pdDone && v === 'Done') || (!g6pdDone && v === 'Pending')
                      ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                  )}>{v === 'Done' ? '✓ Done' : 'Pending'}</button>
              ))}
            </div>
            {g6pdDone && <Input placeholder="G6PD result" value={g6pdResult} onChange={e => setG6pdResult(e.target.value)} className="h-8 text-xs" />}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hearing Screen</Label>
            <div className="flex gap-2">
              {['pass', 'refer', 'not_done'].map(v => (
                <button key={v} onClick={() => setHearingScreen(v)}
                  className={cn("text-xs px-3 py-1 rounded-full border capitalize",
                    hearingScreen === v ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                  )}>{v === 'not_done' ? 'Not Done' : v === 'pass' ? 'Pass' : 'Refer'}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
        {saving ? 'Saving...' : 'Save Neonatal Record'}
      </Button>
    </div>
  );
};

export default NeonatalSheet;
