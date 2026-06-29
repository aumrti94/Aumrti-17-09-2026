import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { format, addDays, differenceInDays } from "date-fns";

interface Props {
  patientId: string;
  hospitalId: string;
  encounterId?: string | null;
  admissionId?: string | null;
}

const BISHOP_PARAMS = [
  { key: 'bishop_dilation', label: 'Dilation', values: ['Closed', '1-2cm', '3-4cm', '>4cm'], max: 3 },
  { key: 'bishop_effacement', label: 'Effacement', values: ['0-30%', '40-50%', '60-70%', '>80%'], max: 3 },
  { key: 'bishop_station', label: 'Station', values: ['-3', '-2', '-1/0', '+1/+2'], max: 3 },
  { key: 'bishop_consistency', label: 'Consistency', values: ['Firm', 'Medium', 'Soft'], max: 2 },
  { key: 'bishop_position', label: 'Position', values: ['Posterior', 'Mid', 'Anterior'], max: 2 },
] as const;

const ENGAGEMENTS = ['Free', '2/5', '3/5', '4/5', 'Engaged'];

const ObstetricSheet: React.FC<Props> = ({ patientId, hospitalId, encounterId, admissionId }) => {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [lmp, setLmp] = useState('');
  const [fundalHeight, setFundalHeight] = useState('');
  const [fetalPresentation, setFetalPresentation] = useState('');
  const [fetalEngagement, setFetalEngagement] = useState('');
  const [fhr, setFhr] = useState('');
  const [bishop, setBishop] = useState<Record<string, number | null>>({
    bishop_dilation: null, bishop_effacement: null, bishop_station: null,
    bishop_consistency: null, bishop_position: null,
  });
  const [risks, setRisks] = useState({
    risk_pre_eclampsia: false, risk_gdm: false,
    risk_oligohydramnios: false, risk_fetal_distress: false,
  });
  const [riskNotes, setRiskNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Load existing record
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('obstetric_records')
        .select('*').eq('patient_id', patientId).eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setRecordId(data.id);
        setLmp(data.lmp || '');
        setFundalHeight(data.fundal_height_cm?.toString() || '');
        setFetalPresentation(data.fetal_presentation || '');
        setFetalEngagement(data.fetal_engagement || '');
        setFhr(data.fetal_heart_rate?.toString() || '');
        setBishop({
          bishop_dilation: data.bishop_dilation,
          bishop_effacement: data.bishop_effacement,
          bishop_station: data.bishop_station,
          bishop_consistency: data.bishop_consistency,
          bishop_position: data.bishop_position,
        });
        setRisks({
          risk_pre_eclampsia: data.risk_pre_eclampsia || false,
          risk_gdm: data.risk_gdm || false,
          risk_oligohydramnios: data.risk_oligohydramnios || false,
          risk_fetal_distress: data.risk_fetal_distress || false,
        });
        setRiskNotes(data.risk_notes || '');
      }
    })();
  }, [patientId, hospitalId]);

  // GA calculations
  const lmpDate = lmp ? new Date(lmp) : null;
  const edd = lmpDate ? addDays(lmpDate, 280) : null;
  const gaDays = lmpDate ? differenceInDays(new Date(), lmpDate) : null;
  const gaWeeks = gaDays !== null ? Math.floor(gaDays / 7) : null;
  const gaRemDays = gaDays !== null ? gaDays % 7 : null;

  const bishopTotal = Object.values(bishop).reduce((s, v) => s + (v ?? 0), 0);
  const bishopInterpretation = bishopTotal < 6
    ? { text: 'Unfavourable for induction', color: 'text-red-600' }
    : bishopTotal <= 8
    ? { text: 'Induction may be considered', color: 'text-amber-600' }
    : { text: 'Favourable for induction', color: 'text-emerald-600' };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        hospital_id: hospitalId,
        patient_id: patientId,
        encounter_id: encounterId || null,
        record_type: 'anc',
        lmp: lmp || null,
        edd: edd ? format(edd, 'yyyy-MM-dd') : null,
        gestational_age_weeks: gaWeeks,
        gestational_age_days: gaRemDays,
        fundal_height_cm: fundalHeight ? parseFloat(fundalHeight) : null,
        fetal_presentation: fetalPresentation || null,
        fetal_engagement: fetalEngagement || null,
        fetal_heart_rate: fhr ? parseInt(fhr) : null,
        ...bishop,
        bishop_total: bishopTotal,
        ...risks,
        risk_notes: riskNotes || null,
      };

      if (recordId) {
        await (supabase as any).from('obstetric_records').update(payload).eq('id', recordId);
      } else {
        const { data } = await (supabase as any).from('obstetric_records').insert([payload]).select('id').maybeSingle();
        if (data) setRecordId(data.id);
      }

      // Create clinical alert if any risk flag is set
      if (Object.values(risks).some(v => v)) {
        const riskLabels = [];
        if (risks.risk_pre_eclampsia) riskLabels.push('Pre-eclampsia');
        if (risks.risk_gdm) riskLabels.push('GDM');
        if (risks.risk_oligohydramnios) riskLabels.push('Oligohydramnios');
        if (risks.risk_fetal_distress) riskLabels.push('Fetal Distress');
        await supabase.from('clinical_alerts').insert([{
          hospital_id: hospitalId,
          patient_id: patientId,
          alert_type: 'obstetric_risk',
          alert_message: `Obstetric risk flags: ${riskLabels.join(', ')}`,
          severity: risks.risk_fetal_distress ? 'critical' : 'high',
        }]);
      }

      toast.success('Obstetric record saved');
    } catch (err) {
      toast.error('Failed to save obstetric record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* GA Calculator */}
      {gaWeeks !== null && gaWeeks >= 0 && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-center">
          <span className="text-lg font-bold text-teal-700">GA: {gaWeeks} weeks {gaRemDays} days</span>
          {edd && <span className="text-sm text-teal-600 ml-3">| EDD: {format(edd, 'dd MMM yyyy')}</span>}
        </div>
      )}

      {/* LMP */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">LMP (Last Menstrual Period)</Label>
          <Input type="date" value={lmp} onChange={e => setLmp(e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">EDD (auto-calculated)</Label>
          <Input value={edd ? format(edd, 'dd/MM/yyyy') : '—'} readOnly className="h-9 text-sm bg-muted" />
        </div>
      </div>

      {/* Examination */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Examination</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Fundal Height (cm)</Label>
            <Input type="number" value={fundalHeight} onChange={e => setFundalHeight(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Fetal Presentation</Label>
            <Select value={fetalPresentation} onValueChange={setFetalPresentation}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {['Cephalic', 'Breech', 'Transverse'].map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">FHR (bpm)</Label>
            <Input type="number" value={fhr} onChange={e => setFhr(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Engagement</Label>
          <div className="flex gap-2">
            {ENGAGEMENTS.map(e => (
              <button key={e} onClick={() => setFetalEngagement(e)}
                className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                  fetalEngagement === e ? "bg-teal-600 text-white border-teal-600" : "border-border text-muted-foreground hover:bg-muted"
                )}>{e}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Bishop Score */}
      <Accordion type="single" collapsible>
        <AccordionItem value="bishop">
          <AccordionTrigger className="text-sm font-semibold">Bishop Score (for induction assessment)</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1 font-medium text-muted-foreground">Parameter</th>
                    {[0, 1, 2, 3].map(n => <th key={n} className="text-center py-1 font-medium text-muted-foreground">{n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {BISHOP_PARAMS.map(p => (
                    <tr key={p.key} className="border-b border-border/50">
                      <td className="py-1.5 font-medium">{p.label}</td>
                      {[0, 1, 2, 3].map(n => (
                        <td key={n} className="text-center py-1.5">
                          {n <= p.max ? (
                            <button
                              onClick={() => setBishop(prev => ({ ...prev, [p.key]: n }))}
                              className={cn("px-2 py-1 rounded text-[11px] transition-colors min-w-[60px]",
                                bishop[p.key] === n ? "bg-teal-600 text-white" : "bg-muted hover:bg-muted/80"
                              )}
                            >{p.values[n]}</button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-base font-bold">Total: {bishopTotal}/13</span>
                <span className={cn("text-sm font-medium", bishopInterpretation.color)}>
                  {bishopInterpretation.text}
                </span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Risk Flags */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Risk Flags</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'risk_pre_eclampsia', label: 'Pre-eclampsia risk' },
            { key: 'risk_gdm', label: 'Gestational Diabetes' },
            { key: 'risk_oligohydramnios', label: 'Oligohydramnios' },
            { key: 'risk_fetal_distress', label: 'Fetal Distress' },
          ].map(r => (
            <label key={r.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={risks[r.key as keyof typeof risks]}
                onCheckedChange={v => setRisks(prev => ({ ...prev, [r.key]: !!v }))}
              />
              {r.label}
            </label>
          ))}
        </div>
        <Input placeholder="Risk notes..." value={riskNotes} onChange={e => setRiskNotes(e.target.value)} className="h-9 text-sm" />
      </div>

      <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
        {saving ? 'Saving...' : 'Save Obstetric Record'}
      </Button>
    </div>
  );
};

export default ObstetricSheet;
