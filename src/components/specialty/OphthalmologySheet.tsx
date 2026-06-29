import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  patientId: string;
  hospitalId: string;
  encounterId?: string | null;
}

const SNELLEN_VALUES = ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'CF', 'HM', 'PL', 'NPL'];
const LOGMAR_MAP: Record<string, string> = {
  '6/6': '0.00', '6/9': '0.18', '6/12': '0.30', '6/18': '0.48', '6/24': '0.60',
  '6/36': '0.78', '6/60': '1.00', 'CF': '1.30', 'HM': '1.80', 'PL': '2.30', 'NPL': '—',
};
const DR_GRADES = ['No DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'PDR'];
const IOL_FORMULAS = ['SRK-T', 'Holladay', 'Barrett', 'Haigis', 'Hoffer Q'];

const OphthalmologySheet: React.FC<Props> = ({ patientId, hospitalId, encounterId }) => {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [vaRe, setVaRe] = useState('');
  const [vaLe, setVaLe] = useState('');
  const [reSphere, setReSphere] = useState('');
  const [reCylinder, setReCylinder] = useState('');
  const [reAxis, setReAxis] = useState('');
  const [leSphere, setLeSphere] = useState('');
  const [leCylinder, setLeCylinder] = useState('');
  const [leAxis, setLeAxis] = useState('');
  const [iopRe, setIopRe] = useState('');
  const [iopLe, setIopLe] = useState('');
  const [cupDiscRe, setCupDiscRe] = useState('');
  const [cupDiscLe, setCupDiscLe] = useState('');
  const [maculaRe, setMaculaRe] = useState('Normal');
  const [maculaLe, setMaculaLe] = useState('Normal');
  const [drGrade, setDrGrade] = useState('');
  const [iolPowerRe, setIolPowerRe] = useState('');
  const [iolPowerLe, setIolPowerLe] = useState('');
  const [iolFormula, setIolFormula] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('ophthalmology_records')
        .select('*').eq('patient_id', patientId).eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setRecordId(data.id);
        setVaRe(data.va_re_snellen || '');
        setVaLe(data.va_le_snellen || '');
        setReSphere(data.re_sphere?.toString() || '');
        setReCylinder(data.re_cylinder?.toString() || '');
        setReAxis(data.re_axis?.toString() || '');
        setLeSphere(data.le_sphere?.toString() || '');
        setLeCylinder(data.le_cylinder?.toString() || '');
        setLeAxis(data.le_axis?.toString() || '');
        setIopRe(data.iop_re_mmhg?.toString() || '');
        setIopLe(data.iop_le_mmhg?.toString() || '');
        setCupDiscRe(data.cup_disc_re?.toString() || '');
        setCupDiscLe(data.cup_disc_le?.toString() || '');
        setMaculaRe(data.macula_re || 'Normal');
        setMaculaLe(data.macula_le || 'Normal');
        setDrGrade(data.dr_grade || '');
        setIolPowerRe(data.iol_power_re?.toString() || '');
        setIolPowerLe(data.iol_power_le?.toString() || '');
        setIolFormula(data.iol_formula || '');
      }
    })();
  }, [patientId, hospitalId]);

  const iopReNum = parseFloat(iopRe);
  const iopLeNum = parseFloat(iopLe);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        hospital_id: hospitalId, patient_id: patientId,
        encounter_id: encounterId || null,
        va_re_snellen: vaRe || null, va_le_snellen: vaLe || null,
        va_re_logmar: vaRe && LOGMAR_MAP[vaRe] !== '—' ? parseFloat(LOGMAR_MAP[vaRe]) : null,
        va_le_logmar: vaLe && LOGMAR_MAP[vaLe] !== '—' ? parseFloat(LOGMAR_MAP[vaLe]) : null,
        re_sphere: reSphere ? parseFloat(reSphere) : null,
        re_cylinder: reCylinder ? parseFloat(reCylinder) : null,
        re_axis: reAxis ? parseInt(reAxis) : null,
        le_sphere: leSphere ? parseFloat(leSphere) : null,
        le_cylinder: leCylinder ? parseFloat(leCylinder) : null,
        le_axis: leAxis ? parseInt(leAxis) : null,
        iop_re_mmhg: iopRe ? parseFloat(iopRe) : null,
        iop_le_mmhg: iopLe ? parseFloat(iopLe) : null,
        cup_disc_re: cupDiscRe ? parseFloat(cupDiscRe) : null,
        cup_disc_le: cupDiscLe ? parseFloat(cupDiscLe) : null,
        macula_re: maculaRe || null, macula_le: maculaLe || null,
        dr_grade: drGrade || null,
        iol_power_re: iolPowerRe ? parseFloat(iolPowerRe) : null,
        iol_power_le: iolPowerLe ? parseFloat(iolPowerLe) : null,
        iol_formula: iolFormula || null,
      };

      if (recordId) {
        await (supabase as any).from('ophthalmology_records').update(payload).eq('id', recordId);
      } else {
        const { data } = await (supabase as any).from('ophthalmology_records').insert([payload]).select('id').maybeSingle();
        if (data) setRecordId(data.id);
      }
      toast.success('Ophthalmology record saved');
    } catch (err) {
      toast.error('Failed to save ophthalmology record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Visual Acuity */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Visual Acuity</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 font-medium text-muted-foreground w-32"></th>
              <th className="text-center py-1.5 font-medium">Right Eye (RE)</th>
              <th className="text-center py-1.5 font-medium">Left Eye (LE)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/50">
              <td className="py-2 font-medium">Snellen VA</td>
              <td className="py-2 px-2">
                <Select value={vaRe} onValueChange={setVaRe}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{SNELLEN_VALUES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </td>
              <td className="py-2 px-2">
                <Select value={vaLe} onValueChange={setVaLe}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{SNELLEN_VALUES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </td>
            </tr>
            <tr className="border-b border-border/50">
              <td className="py-2 font-medium">LogMAR</td>
              <td className="py-2 text-center text-sm font-mono">{vaRe ? LOGMAR_MAP[vaRe] || '—' : '—'}</td>
              <td className="py-2 text-center text-sm font-mono">{vaLe ? LOGMAR_MAP[vaLe] || '—' : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Refraction */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Refraction</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <p className="text-xs font-bold text-center">Right Eye (RE)</p>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-[10px]">Sphere</Label><Input type="number" step="0.25" value={reSphere} onChange={e => setReSphere(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-[10px]">Cylinder</Label><Input type="number" step="0.25" value={reCylinder} onChange={e => setReCylinder(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-[10px]">Axis (°)</Label><Input type="number" min="0" max="180" value={reAxis} onChange={e => setReAxis(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            {reSphere && <p className="text-xs text-center font-mono text-muted-foreground">RE: {reSphere} / {reCylinder || '0.00'} × {reAxis || '0'}</p>}
          </div>
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <p className="text-xs font-bold text-center">Left Eye (LE)</p>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-[10px]">Sphere</Label><Input type="number" step="0.25" value={leSphere} onChange={e => setLeSphere(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-[10px]">Cylinder</Label><Input type="number" step="0.25" value={leCylinder} onChange={e => setLeCylinder(e.target.value)} className="h-8 text-xs" /></div>
              <div><Label className="text-[10px]">Axis (°)</Label><Input type="number" min="0" max="180" value={leAxis} onChange={e => setLeAxis(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            {leSphere && <p className="text-xs text-center font-mono text-muted-foreground">LE: {leSphere} / {leCylinder || '0.00'} × {leAxis || '0'}</p>}
          </div>
        </div>
      </div>

      {/* IOP */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Intraocular Pressure (IOP)</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">RE (mmHg)</Label>
            <Input type="number" value={iopRe} onChange={e => setIopRe(e.target.value)} className="h-9 text-sm" />
            {iopReNum > 30 && <p className="text-xs text-red-600 mt-1">🔴 High IOP — urgent review</p>}
            {iopReNum > 21 && iopReNum <= 30 && <p className="text-xs text-amber-600 mt-1">⚠️ IOP elevated — consider glaucoma screening</p>}
          </div>
          <div>
            <Label className="text-xs">LE (mmHg)</Label>
            <Input type="number" value={iopLe} onChange={e => setIopLe(e.target.value)} className="h-9 text-sm" />
            {iopLeNum > 30 && <p className="text-xs text-red-600 mt-1">🔴 High IOP — urgent review</p>}
            {iopLeNum > 21 && iopLeNum <= 30 && <p className="text-xs text-amber-600 mt-1">⚠️ IOP elevated — consider glaucoma screening</p>}
          </div>
        </div>
      </div>

      {/* Fundoscopy */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Fundoscopy</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <p className="text-xs font-bold text-center">Right Eye</p>
            <div><Label className="text-[10px]">Cup:Disc Ratio</Label><Input type="number" step="0.1" min="0" max="1" value={cupDiscRe} onChange={e => setCupDiscRe(e.target.value)} className="h-8 text-xs" /></div>
            <div>
              <Label className="text-[10px]">Macula</Label>
              <div className="flex gap-2">
                {['Normal', 'Abnormal'].map(v => (
                  <button key={v} onClick={() => setMaculaRe(v)}
                    className={cn("text-xs px-3 py-1 rounded border", maculaRe === v ? "bg-primary text-primary-foreground" : "border-border")}>{v}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <p className="text-xs font-bold text-center">Left Eye</p>
            <div><Label className="text-[10px]">Cup:Disc Ratio</Label><Input type="number" step="0.1" min="0" max="1" value={cupDiscLe} onChange={e => setCupDiscLe(e.target.value)} className="h-8 text-xs" /></div>
            <div>
              <Label className="text-[10px]">Macula</Label>
              <div className="flex gap-2">
                {['Normal', 'Abnormal'].map(v => (
                  <button key={v} onClick={() => setMaculaLe(v)}
                    className={cn("text-xs px-3 py-1 rounded border", maculaLe === v ? "bg-primary text-primary-foreground" : "border-border")}>{v}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div>
          <Label className="text-xs">DR Grade (Diabetic Retinopathy)</Label>
          <div className="flex gap-2 mt-1">
            {DR_GRADES.map(g => (
              <button key={g} onClick={() => setDrGrade(g)}
                className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                  drGrade === g ? "bg-teal-600 text-white border-teal-600" : "border-border text-muted-foreground hover:bg-muted"
                )}>{g}</button>
            ))}
          </div>
        </div>
      </div>

      {/* IOL Power */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">IOL Power (if indicated)</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Formula</Label>
            <Select value={iolFormula} onValueChange={setIolFormula}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select formula" /></SelectTrigger>
              <SelectContent>{IOL_FORMULAS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">RE IOL Power (D)</Label>
            <Input type="number" step="0.5" value={iolPowerRe} onChange={e => setIolPowerRe(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">LE IOL Power (D)</Label>
            <Input type="number" step="0.5" value={iolPowerLe} onChange={e => setIolPowerLe(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
        {saving ? 'Saving...' : 'Save Ophthalmology Record'}
      </Button>
    </div>
  );
};

export default OphthalmologySheet;
