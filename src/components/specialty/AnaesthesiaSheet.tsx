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

const ASA_CLASSES = [
  { value: 1, label: 'ASA I', desc: 'Normal healthy patient' },
  { value: 2, label: 'ASA II', desc: 'Mild systemic disease' },
  { value: 3, label: 'ASA III', desc: 'Severe systemic disease' },
  { value: 4, label: 'ASA IV', desc: 'Life-threatening disease' },
  { value: 5, label: 'ASA V', desc: 'Moribund' },
  { value: 6, label: 'ASA VI', desc: 'Brain dead (organ donation)' },
];

const MALLAMPATI = [
  { value: 1, desc: 'Soft palate, fauces, uvula, pillars visible' },
  { value: 2, desc: 'Soft palate, fauces, uvula visible' },
  { value: 3, desc: 'Soft palate and base of uvula visible' },
  { value: 4, desc: 'Soft palate not visible' },
];

const TECHNIQUES = ['ga', 'spinal', 'epidural', 'regional', 'local', 'combined'] as const;
const TECHNIQUE_LABELS: Record<string, string> = {
  ga: 'GA', spinal: 'Spinal', epidural: 'Epidural', regional: 'Regional Block', local: 'Local', combined: 'Combined'
};

const ALDRETE_COMPONENTS = ['Activity', 'Respiration', 'Circulation', 'Consciousness', 'SpO2'];

const AnaesthesiaSheet: React.FC<Props> = ({ patientId, hospitalId, encounterId, admissionId }) => {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [asaClass, setAsaClass] = useState<number | null>(null);
  const [mallampati, setMallampati] = useState<number | null>(null);
  const [mouthOpening, setMouthOpening] = useState('');
  const [neckMobility, setNeckMobility] = useState('');
  const [thyromental, setThyromental] = useState('');
  const [technique, setTechnique] = useState('ga');
  const [drugs, setDrugs] = useState<any[]>([]);
  const [vitals, setVitals] = useState<any[]>([]);
  const [fluidIn, setFluidIn] = useState('0');
  const [urineOut, setUrineOut] = useState('');
  const [bloodLoss, setBloodLoss] = useState('');
  const [aldreteScores, setAldreteScores] = useState<any[]>([]);
  const [complications, setComplications] = useState('');
  const [saving, setSaving] = useState(false);

  // New entries
  const [newDrug, setNewDrug] = useState({ drug_name: '', dose: '', route: 'IV', time: '' });
  const [newVital, setNewVital] = useState({ time: '', bp_s: '', bp_d: '', hr: '', spo2: '', etco2: '' });
  const [newAldrete, setNewAldrete] = useState<(number | null)[]>([null, null, null, null, null]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('anaesthesia_records')
        .select('*').eq('patient_id', patientId).eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setRecordId(data.id);
        setAsaClass(data.asa_class);
        setMallampati(data.mallampati_score);
        setMouthOpening(data.airway_mouth_opening || '');
        setNeckMobility(data.neck_mobility || '');
        setThyromental(data.thyromental_distance || '');
        setTechnique(data.technique || 'ga');
        setDrugs(data.induction_agents || []);
        setVitals(data.intraop_vitals || []);
        setFluidIn(data.fluid_in_ml?.toString() || '0');
        setUrineOut(data.urine_out_ml?.toString() || '');
        setBloodLoss(data.blood_loss_ml?.toString() || '');
        setAldreteScores(data.aldrete_scores || []);
        setComplications(data.complications || '');
      }
    })();
  }, [patientId, hospitalId]);

  const addDrug = () => {
    if (!newDrug.drug_name) return;
    setDrugs(prev => [...prev, { ...newDrug, time: newDrug.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }]);
    setNewDrug({ drug_name: '', dose: '', route: 'IV', time: '' });
  };

  const addVital = () => {
    setVitals(prev => [...prev, { ...newVital, time: newVital.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }]);
    setNewVital({ time: '', bp_s: '', bp_d: '', hr: '', spo2: '', etco2: '' });
  };

  const addAldreteScore = () => {
    const total = newAldrete.reduce((s, v) => s + (v ?? 0), 0);
    setAldreteScores(prev => [...prev, {
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      scores: [...newAldrete], total,
    }]);
    setNewAldrete([null, null, null, null, null]);
  };

  const latestAldrete = aldreteScores.length > 0 ? aldreteScores[aldreteScores.length - 1] : null;
  const fluidBalance = (parseInt(fluidIn) || 0) - (parseInt(urineOut) || 0) - (parseInt(bloodLoss) || 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        hospital_id: hospitalId, patient_id: patientId,
        asa_class: asaClass, mallampati_score: mallampati,
        airway_mouth_opening: mouthOpening || null,
        neck_mobility: neckMobility || null,
        thyromental_distance: thyromental || null,
        technique,
        induction_agents: drugs,
        maintenance_agents: [],
        intraop_vitals: vitals,
        fluid_in_ml: parseInt(fluidIn) || 0,
        urine_out_ml: urineOut ? parseInt(urineOut) : null,
        blood_loss_ml: bloodLoss ? parseInt(bloodLoss) : null,
        aldrete_scores: aldreteScores,
        complications: complications || null,
      };

      if (recordId) {
        await (supabase as any).from('anaesthesia_records').update(payload).eq('id', recordId);
      } else {
        const { data } = await (supabase as any).from('anaesthesia_records').insert([payload]).select('id').maybeSingle();
        if (data) setRecordId(data.id);
      }
      toast.success('Anaesthesia record saved');
    } catch (err) {
      toast.error('Failed to save anaesthesia record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* ASA Classification */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">ASA Classification</h3>
        <div className="grid grid-cols-3 gap-2">
          {ASA_CLASSES.map(a => (
            <button key={a.value} onClick={() => setAsaClass(a.value)}
              className={cn("text-left p-2 rounded-lg border text-xs transition-colors",
                asaClass === a.value ? "border-teal-500 bg-teal-50 text-teal-800" : "border-border hover:bg-muted"
              )}>
              <span className="font-bold">{a.label}</span>
              <span className="text-muted-foreground ml-1">— {a.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Airway Assessment */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Airway Assessment</h3>
        <div>
          <Label className="text-xs mb-1 block">Mallampati Score</Label>
          <div className="flex gap-2">
            {MALLAMPATI.map(m => (
              <button key={m.value} onClick={() => setMallampati(m.value)}
                className={cn("flex-1 p-2 rounded-lg border text-center text-xs transition-colors",
                  mallampati === m.value ? "border-teal-500 bg-teal-50" : "border-border hover:bg-muted"
                )}>
                {/* Simple SVG mouth illustration */}
                <svg viewBox="0 0 40 30" className="w-10 h-8 mx-auto mb-1">
                  <ellipse cx="20" cy="15" rx="15" ry="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  {m.value <= 3 && <ellipse cx="20" cy="10" rx="4" ry={m.value <= 2 ? 3 : 1.5} fill="currentColor" opacity="0.3" />}
                  {m.value <= 2 && <line x1="16" y1="18" x2="24" y2="18" stroke="currentColor" strokeWidth="1" />}
                  {m.value <= 1 && <><line x1="13" y1="15" x2="13" y2="21" stroke="currentColor" strokeWidth="1" /><line x1="27" y1="15" x2="27" y2="21" stroke="currentColor" strokeWidth="1" /></>}
                </svg>
                <span className="font-bold">Class {m.value}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs mb-1 block">Mouth Opening</Label>
            <div className="flex gap-1">
              {['>3 fingers', '2-3 fingers', '<2 fingers'].map(v => (
                <button key={v} onClick={() => setMouthOpening(v)}
                  className={cn("text-[11px] px-2 py-1 rounded border", mouthOpening === v ? "bg-primary text-primary-foreground" : "border-border")}>{v}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Neck Mobility</Label>
            <div className="flex gap-1">
              {['Good', 'Moderate', 'Restricted'].map(v => (
                <button key={v} onClick={() => setNeckMobility(v)}
                  className={cn("text-[11px] px-2 py-1 rounded border", neckMobility === v ? "bg-primary text-primary-foreground" : "border-border")}>{v}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Thyromental Distance</Label>
            <div className="flex gap-1">
              {['>6.5cm', '<6.5cm'].map(v => (
                <button key={v} onClick={() => setThyromental(v)}
                  className={cn("text-[11px] px-2 py-1 rounded border", thyromental === v ? "bg-primary text-primary-foreground" : "border-border")}>{v}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Technique */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Technique</h3>
        <div className="flex gap-2 flex-wrap">
          {TECHNIQUES.map(t => (
            <button key={t} onClick={() => setTechnique(t)}
              className={cn("text-xs px-4 py-1.5 rounded-full border transition-colors",
                technique === t ? "bg-teal-600 text-white border-teal-600" : "border-border text-muted-foreground hover:bg-muted"
              )}>{TECHNIQUE_LABELS[t]}</button>
          ))}
        </div>
      </div>

      {/* Drug Log */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Drug Log</h3>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input placeholder="Drug name" value={newDrug.drug_name} onChange={e => setNewDrug(p => ({ ...p, drug_name: e.target.value }))} className="h-8 text-xs" />
          </div>
          <Input placeholder="Dose (mg)" value={newDrug.dose} onChange={e => setNewDrug(p => ({ ...p, dose: e.target.value }))} className="h-8 text-xs w-24" />
          <Input placeholder="Route" value={newDrug.route} onChange={e => setNewDrug(p => ({ ...p, route: e.target.value }))} className="h-8 text-xs w-20" />
          <Button size="sm" variant="outline" onClick={addDrug} className="h-8 text-xs">+ Add</Button>
        </div>
        {drugs.length > 0 && (
          <div className="text-xs space-y-1">
            {drugs.map((d: any, i: number) => (
              <div key={i} className="bg-muted rounded px-3 py-1.5 flex justify-between">
                <span className="font-medium">{d.drug_name} — {d.dose} — {d.route}</span>
                <span className="text-muted-foreground">{d.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Intraop Vitals */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Intraoperative Vitals</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <Input placeholder="Time" value={newVital.time} onChange={e => setNewVital(p => ({ ...p, time: e.target.value }))} className="h-8 text-xs w-20" />
          <Input placeholder="BP Sys" value={newVital.bp_s} onChange={e => setNewVital(p => ({ ...p, bp_s: e.target.value }))} className="h-8 text-xs w-20" />
          <Input placeholder="BP Dia" value={newVital.bp_d} onChange={e => setNewVital(p => ({ ...p, bp_d: e.target.value }))} className="h-8 text-xs w-20" />
          <Input placeholder="HR" value={newVital.hr} onChange={e => setNewVital(p => ({ ...p, hr: e.target.value }))} className="h-8 text-xs w-16" />
          <Input placeholder="SpO2" value={newVital.spo2} onChange={e => setNewVital(p => ({ ...p, spo2: e.target.value }))} className="h-8 text-xs w-16" />
          <Input placeholder="EtCO2" value={newVital.etco2} onChange={e => setNewVital(p => ({ ...p, etco2: e.target.value }))} className="h-8 text-xs w-16" />
          <Button size="sm" variant="outline" onClick={addVital} className="h-8 text-xs">+ Add</Button>
        </div>
        {vitals.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="border-b text-muted-foreground">
              <th className="text-left py-1">Time</th><th>BP</th><th>HR</th><th>SpO2</th><th>EtCO2</th>
            </tr></thead>
            <tbody>
              {vitals.map((v: any, i: number) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1">{v.time}</td>
                  <td className="text-center">{v.bp_s}/{v.bp_d}</td>
                  <td className="text-center">{v.hr}</td>
                  <td className="text-center">{v.spo2}</td>
                  <td className="text-center">{v.etco2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fluid Balance */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Fluid Balance</h3>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">IV In (mL)</Label>
            <Input type="number" value={fluidIn} onChange={e => setFluidIn(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Urine Out (mL)</Label>
            <Input type="number" value={urineOut} onChange={e => setUrineOut(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Blood Loss (mL)</Label>
            <Input type="number" value={bloodLoss} onChange={e => setBloodLoss(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Net Balance</Label>
            <div className={cn("h-8 flex items-center text-sm font-bold px-2 rounded bg-muted",
              fluidBalance >= 0 ? 'text-emerald-600' : 'text-red-600'
            )}>{fluidBalance > 0 ? '+' : ''}{fluidBalance} mL</div>
          </div>
        </div>
      </div>

      {/* PACU / Aldrete */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">PACU Recovery — Aldrete Score</h3>
        <div className="space-y-2">
          {ALDRETE_COMPONENTS.map((comp, ci) => (
            <div key={comp} className="flex items-center gap-2">
              <span className="text-xs w-28 font-medium">{comp}</span>
              {[0, 1, 2].map(s => (
                <button key={s} onClick={() => setNewAldrete(prev => { const n = [...prev]; n[ci] = s; return n; })}
                  className={cn("text-xs w-8 h-8 rounded border",
                    newAldrete[ci] === s ? "bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                  )}>{s}</button>
              ))}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addAldreteScore} className="text-xs">Add Aldrete Score</Button>
        </div>
        {aldreteScores.length > 0 && (
          <div className="space-y-1">
            {aldreteScores.map((a: any, i: number) => (
              <div key={i} className="text-xs bg-muted rounded px-3 py-1.5 flex justify-between">
                <span>{a.time} — Total: {a.total}/10</span>
                <span className={cn("font-medium", a.total >= 9 ? 'text-emerald-600' : 'text-amber-600')}>
                  {a.total >= 9 ? '✓ Discharge criteria met' : 'Discharge criteria not met'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
        {saving ? 'Saving...' : 'Save Anaesthesia Record'}
      </Button>
    </div>
  );
};

export default AnaesthesiaSheet;
