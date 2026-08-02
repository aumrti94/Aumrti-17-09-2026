import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";

interface QI {
  id: string;
  indicator_code: string;
  indicator_name: string;
  category: string;
  value: number | null;
  unit: string;
  target: number | null;
}

interface HHAudit {
  id: string;
  date: string;
  ward: string;
  compliance: number;
  observations: number;
  auditor: string;
}

interface HAIReport {
  id: string;
  date: string;
  infection_type: string;
  organism: string;
  ward: string;
  status: string;
}

// Must match the infection_type CHECK on ipc_infection_events.
const infectionTypes = ["CAUTI", "CLABSI", "VAP", "SSI", "BSI", "CDI", "MDRO", "other"] as const;

const InfectionControlTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [indicators, setIndicators] = useState<QI[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Hand hygiene audit state
  const [hhModalOpen, setHhModalOpen] = useState(false);
  const [hhForm, setHhForm] = useState({ ward: "", date: new Date().toISOString().split("T")[0], observations: "", compliant: "" });
  const [hhAudits, setHhAudits] = useState<HHAudit[]>([]);

  // HAI report state
  const [haiModalOpen, setHaiModalOpen] = useState(false);
  const [haiForm, setHaiForm] = useState({ infection_type: "CAUTI", organism: "", date: new Date().toISOString().split("T")[0], procedure: "", treatment: "yes" });
  const [haiReports, setHaiReports] = useState<HAIReport[]>([]);

  useEffect(() => {
    if (hospitalId) loadData();
  }, [hospitalId]);

  const loadData = async () => {
    if (!hospitalId) return;
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartISO = monthStart.toISOString().slice(0, 10);

    // Real tables, not simulated state. The audits and HAI events entered here
    // are the same rows the indicator engine aggregates.
    const [qiRes, hhRes, haiRes] = await Promise.all([
      (supabase as any).from("quality_indicators_current")
        .select("id, indicator_code, indicator_name, category, value, unit, target")
        .eq("hospital_id", hospitalId).eq("category", "infection_control"),
      (supabase as any).from("hand_hygiene_audits")
        .select("id, audit_date, area_name, total_compliant, total_opportunities")
        .eq("hospital_id", hospitalId).order("audit_date", { ascending: false }).limit(20),
      (supabase as any).from("ipc_infection_events")
        .select("id, onset_date, infection_type, organism, outcome")
        .eq("hospital_id", hospitalId).gte("onset_date", monthStartISO)
        .order("onset_date", { ascending: false }).limit(20),
    ]);

    setIndicators((qiRes.data as QI[]) || []);
    setHhAudits(((hhRes.data as any[]) || []).map((a) => ({
      id: a.id,
      date: a.audit_date,
      ward: a.area_name || "General",
      compliance: a.total_opportunities ? Math.round((a.total_compliant / a.total_opportunities) * 100) : 0,
      observations: a.total_opportunities || 0,
      auditor: "—",
    })));
    setHaiReports(((haiRes.data as any[]) || []).map((h) => ({
      id: h.id,
      date: h.onset_date,
      infection_type: h.infection_type,
      organism: h.organism || "—",
      ward: "General",
      status: h.outcome || "ongoing",
    })));
    setLoading(false);
  };

  const indicatorByCode = (code: string) => indicators.find((i) => i.indicator_code === code);
  const handHygieneQI = indicatorByCode("hic.hand_hygiene_pct");
  const haiQI = indicatorByCode("hic.hai_per1000");

  const saveHHAudit = async () => {
    const obs = parseInt(hhForm.observations);
    const comp = parseInt(hhForm.compliant);
    if (!obs || !comp) { toast({ title: "Enter observations and compliant count", variant: "destructive" }); return; }
    if (comp > obs) { toast({ title: "Compliant count cannot exceed observations", variant: "destructive" }); return; }
    if (!hospitalId) return;

    setSaving(true);
    // Write the audit itself and let the engine derive hic.hand_hygiene_pct from
    // it. Previously this overwrote the indicator's value directly, which the
    // next collection run would simply discard.
    const { error } = await (supabase as any).from("hand_hygiene_audits").insert({
      hospital_id: hospitalId,
      audit_date: hhForm.date,
      area_name: hhForm.ward || "General",
      total_opportunities: obs,
      total_compliant: comp,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not save audit", description: error.message, variant: "destructive" });
      return;
    }

    const pct = Math.round((comp / obs) * 100);
    toast({
      title: `Hand hygiene audit saved: ${pct}% compliance`,
      description: "Included in the next indicator recalculation",
    });
    setHhModalOpen(false);
    setHhForm({ ward: "", date: new Date().toISOString().split("T")[0], observations: "", compliant: "" });
    loadData();
  };

  const saveHAI = async () => {
    if (!haiForm.organism.trim()) { toast({ title: "Organism is required", variant: "destructive" }); return; }
    if (!hospitalId) return;

    setSaving(true);
    // Persist the surveillance event. This is the row CLABSI/CAUTI/VAP/SSI rates
    // are computed from; it used to live only in React state and vanish on reload.
    const { error } = await (supabase as any).from("ipc_infection_events").insert({
      hospital_id: hospitalId,
      infection_type: haiForm.infection_type,
      onset_date: haiForm.date,
      organism: haiForm.organism.trim(),
      is_device_related: ["CLABSI", "CAUTI", "VAP"].includes(haiForm.infection_type),
      outcome: "ongoing",
      notes: haiForm.procedure ? `Procedure: ${haiForm.procedure}` : null,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not report HAI", description: error.message, variant: "destructive" });
      return;
    }

    // A clinical alert notifies the IPC team. It is deliberately NOT a metric
    // source: the SSI rate now reads ipc_infection_events directly, because
    // counting alerts of type 'infection' counted every HAI type as an SSI.
    try {
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "infection",
        severity: "high",
        alert_message: `HAI reported: ${haiForm.infection_type} — ${haiForm.organism}`,
      });
    } catch { /* notification only — never block the surveillance record */ }

    toast({ title: "HAI reported", description: `${haiForm.infection_type} — ${haiForm.organism}` });
    setHaiModalOpen(false);
    setHaiForm({ infection_type: "CAUTI", organism: "", date: new Date().toISOString().split("T")[0], procedure: "", treatment: "yes" });
    loadData();
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  // Null means "not measured yet", which must not render as 0 — a 0% hand-hygiene
  // figure reads as catastrophic compliance rather than an absent audit.
  const hhValue = handHygieneQI?.value == null ? null : Number(handHygieneQI.value);
  const haiValue = haiQI?.value == null ? null : Number(haiQI.value);
  const haiTarget = haiQI?.target ? Number(haiQI.target) : 5;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* TOP: KPI Cards */}
      <div className="grid grid-cols-3 gap-3 p-4 flex-shrink-0">
        {/* Hand Hygiene */}
        <Card className="border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hand Hygiene Compliance</p>
                <p className={`text-2xl font-bold mt-1 ${
                  hhValue === null ? "text-muted-foreground"
                    : hhValue >= 80 ? "text-green-600 dark:text-green-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}>
                  {hhValue === null ? "—" : `${hhValue.toFixed(0)}%`}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {hhValue === null ? "No audits recorded yet" : "Target: 80%"}
                </p>
              </div>
              <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => setHhModalOpen(true)}>
                + Record Audit
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* HAI Rate */}
        <Card className="border">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">HAI Rate</p>
                <p className={`text-2xl font-bold mt-1 ${
                  haiValue === null ? "text-muted-foreground"
                    : haiValue <= haiTarget ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {haiValue === null ? "—" : haiValue.toFixed(1)}
                </p>
                <p className="text-[10px] text-muted-foreground">per 1000 patient days • Target: &lt; {haiTarget}</p>
                <div className="flex gap-2 mt-1.5 text-[9px] text-muted-foreground">
                  {infectionTypes.slice(0, 4).map((t) => (
                    <span key={t}>{t}: {haiReports.filter((r) => r.infection_type === t).length}</span>
                  ))}
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => setHaiModalOpen(true)}>
                + Report HAI
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Antibiotic Consumption */}
        <Card className="border">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Antibiotic Consumption</p>
            <p className="text-2xl font-bold mt-1 text-foreground">—</p>
            <p className="text-[10px] text-muted-foreground">DDD per 100 bed days</p>
            <p className="text-[9px] text-muted-foreground mt-1">Data source: pharmacy module</p>
          </CardContent>
        </Card>
      </div>

      {/* HAI alert */}
      {haiValue !== null && haiValue > haiTarget && (
        <div className="mx-4 mb-2 bg-destructive/5 border border-destructive/20 border-l-[3px] border-l-destructive rounded-lg p-3 flex items-center justify-between">
          <div className="text-xs">
            <span className="font-semibold text-destructive">⚠️ HAI rate ({haiValue.toFixed(1)}) exceeds target ({haiTarget})</span>
            <p className="text-muted-foreground mt-0.5">Consider activating outbreak investigation protocol</p>
          </div>
          <Button size="sm" variant="outline" className="text-[10px] h-7 text-destructive border-destructive/30">Raise CAPA</Button>
        </div>
      )}

      {/* BOTTOM: Two panels */}
      <div className="flex-1 flex gap-0 overflow-hidden border-t border-border">
        {/* Left: Hand Hygiene Audit Log */}
        <div className="flex-1 border-r border-border flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hand Hygiene Audit Log</h3>
            <Button size="sm" variant="ghost" className="text-[10px] h-6" onClick={() => setHhModalOpen(true)}>+ Record</Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Date</th>
                  <th className="text-left px-3 py-1.5 font-medium">Ward</th>
                  <th className="text-left px-3 py-1.5 font-medium">Compliance</th>
                  <th className="text-left px-3 py-1.5 font-medium">Observations</th>
                </tr>
              </thead>
              <tbody>
                {hhAudits.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(a.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{a.ward}</td>
                    <td className="px-3 py-2">
                      <span className={a.compliance >= 80 ? "text-green-600 font-medium" : "text-amber-600 font-medium"}>
                        {a.compliance}%
                      </span>
                    </td>
                    <td className="px-3 py-2">{a.observations}</td>
                  </tr>
                ))}
                {hhAudits.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No audits recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: HAI Surveillance */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">HAI Surveillance</h3>
            <Button size="sm" variant="ghost" className="text-[10px] h-6" onClick={() => setHaiModalOpen(true)}>+ Report</Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Date</th>
                  <th className="text-left px-3 py-1.5 font-medium">Type</th>
                  <th className="text-left px-3 py-1.5 font-medium">Organism</th>
                  <th className="text-left px-3 py-1.5 font-medium">Ward</th>
                  <th className="text-left px-3 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {haiReports.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><Badge variant="secondary" className="text-[8px]">{r.infection_type}</Badge></td>
                    <td className="px-3 py-2 font-medium">{r.organism}</td>
                    <td className="px-3 py-2">{r.ward}</td>
                    <td className="px-3 py-2"><Badge variant="secondary" className="text-[8px]">{r.status}</Badge></td>
                  </tr>
                ))}
                {haiReports.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No HAIs reported</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Hand Hygiene Audit Modal */}
      <Dialog open={hhModalOpen} onOpenChange={setHhModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Record Hand Hygiene Audit</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Ward</Label>
                <Input value={hhForm.ward} onChange={(e) => setHhForm({ ...hhForm, ward: e.target.value })} className="mt-1" placeholder="e.g. ICU" />
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={hhForm.date} onChange={(e) => setHhForm({ ...hhForm, date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="border border-border rounded-lg p-3">
              <p className="text-xs font-semibold mb-2">WHO 5 Moments — Totals</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Total Observations</Label>
                  <Input type="number" value={hhForm.observations} onChange={(e) => setHhForm({ ...hhForm, observations: e.target.value })} className="mt-0.5" />
                </div>
                <div>
                  <Label className="text-[10px]">Compliant</Label>
                  <Input type="number" value={hhForm.compliant} onChange={(e) => setHhForm({ ...hhForm, compliant: e.target.value })} className="mt-0.5" />
                </div>
              </div>
              {hhForm.observations && hhForm.compliant && (
                <p className="text-xs font-semibold text-primary mt-2">
                  Compliance: {Math.round((parseInt(hhForm.compliant) / parseInt(hhForm.observations)) * 100)}%
                </p>
              )}
            </div>
            <Button onClick={saveHHAudit} className="w-full" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save Audit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* HAI Report Modal */}
      <Dialog open={haiModalOpen} onOpenChange={setHaiModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Report Hospital-Acquired Infection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Infection Type</Label>
              <Select value={haiForm.infection_type} onValueChange={(v) => setHaiForm({ ...haiForm, infection_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {infectionTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Organism</Label>
              <Input value={haiForm.organism} onChange={(e) => setHaiForm({ ...haiForm, organism: e.target.value })} className="mt-1" placeholder="e.g. E.coli, MRSA, Klebsiella" />
            </div>
            <div>
              <Label className="text-xs">Date Identified</Label>
              <Input type="date" value={haiForm.date} onChange={(e) => setHaiForm({ ...haiForm, date: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Associated Procedure (if device-related)</Label>
              <Input value={haiForm.procedure} onChange={(e) => setHaiForm({ ...haiForm, procedure: e.target.value })} className="mt-1" placeholder="Optional" />
            </div>
            <div>
              <Label className="text-xs">Treatment Initiated?</Label>
              <Select value={haiForm.treatment} onValueChange={(v) => setHaiForm({ ...haiForm, treatment: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveHAI} className="w-full" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save HAI Report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InfectionControlTab;
