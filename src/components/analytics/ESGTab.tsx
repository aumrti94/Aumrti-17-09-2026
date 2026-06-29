import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AnalyticsKPICard from "./AnalyticsKPICard";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { callAI } from "@/lib/aiProvider";
import { useHospitalId as useHospId } from "@/hooks/useHospitalId";
import { Leaf, Plus, Brain, Loader2 } from "lucide-react";

interface Metric {
  id: string; month_year: string;
  electricity_kwh: number | null; solar_kwh: number | null; diesel_litres: number | null;
  water_kl: number | null; water_recycled_kl: number | null;
  bmw_kg_red: number | null; bmw_kg_yellow: number | null; bmw_kg_blue: number | null; bmw_kg_black: number | null;
  carbon_offset_kg: number | null;
  electricity_target: number | null; water_target: number | null; bmw_target: number | null;
}

const ESGTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().substring(0, 7));

  const [form, setForm] = useState({
    electricity_kwh: "", solar_kwh: "", diesel_litres: "",
    water_kl: "", water_recycled_kl: "",
    bmw_kg_red: "", bmw_kg_yellow: "", bmw_kg_blue: "", bmw_kg_black: "",
    carbon_offset_kg: "", initiatives_text: "",
    electricity_target: "", water_target: "", bmw_target: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any).from("esg_monthly_metrics")
      .select("*").eq("hospital_id", hospitalId).eq("is_deleted", false)
      .order("month_year", { ascending: true }).limit(24);
    setMetrics(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const n = (v: string) => v ? Number(v) : null;

  const saveMetrics = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const monthDate = `${selectedMonth}-01`;
    const payload = {
      hospital_id: hospitalId,
      month_year: monthDate,
      electricity_kwh: n(form.electricity_kwh),
      solar_kwh: n(form.solar_kwh),
      diesel_litres: n(form.diesel_litres),
      water_kl: n(form.water_kl),
      water_recycled_kl: n(form.water_recycled_kl),
      bmw_kg_red: n(form.bmw_kg_red),
      bmw_kg_yellow: n(form.bmw_kg_yellow),
      bmw_kg_blue: n(form.bmw_kg_blue),
      bmw_kg_black: n(form.bmw_kg_black),
      carbon_offset_kg: n(form.carbon_offset_kg),
      electricity_target: n(form.electricity_target),
      water_target: n(form.water_target),
      bmw_target: n(form.bmw_target),
      initiatives_text: form.initiatives_text || null,
      entered_by: userData.user?.id,
    };
    const { error } = await (supabase as any).from("esg_monthly_metrics")
      .upsert(payload, { onConflict: "hospital_id,month_year" });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      await logNABHEvidence(hospitalId, "ROM.3", `ESG metrics entered for ${selectedMonth}`);
      toast({ title: "ESG metrics saved ✓" });
      setShowForm(false);
      load();
    }
    setSaving(false);
  };

  const energyData = metrics.map(m => ({
    month: m.month_year.substring(0, 7),
    electricity: m.electricity_kwh || 0,
    solar: m.solar_kwh || 0,
    target: m.electricity_target || 0,
  }));

  const waterData = metrics.map(m => ({
    month: m.month_year.substring(0, 7),
    consumed: m.water_kl || 0,
    recycled: m.water_recycled_kl || 0,
    target: m.water_target || 0,
  }));

  const bmwData = metrics.map(m => ({
    month: m.month_year.substring(0, 7),
    red: m.bmw_kg_red || 0,
    yellow: m.bmw_kg_yellow || 0,
    blue: m.bmw_kg_blue || 0,
    black: m.bmw_kg_black || 0,
  }));

  const latest = metrics[metrics.length - 1];
  const totalBMW = latest ? ((latest.bmw_kg_red || 0) + (latest.bmw_kg_yellow || 0) + (latest.bmw_kg_blue || 0) + (latest.bmw_kg_black || 0)) : 0;

  // AI ESG Recommendations
  const [aiRecs, setAiRecs] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const { hospitalId: hId } = useHospId();

  const getAIRecommendations = async () => {
    if (!latest || !hId) return;
    setAiLoading(true);
    const elecVsTarget = latest.electricity_target ? ((latest.electricity_kwh || 0) / latest.electricity_target * 100).toFixed(0) : "N/A";
    const waterVsTarget = latest.water_target ? ((latest.water_kl || 0) / latest.water_target * 100).toFixed(0) : "N/A";
    const bmwVsTarget = latest.bmw_target ? ((totalBMW) / latest.bmw_target * 100).toFixed(0) : "N/A";
    const solar = latest.solar_kwh || 0;
    const elec = latest.electricity_kwh || 0;
    const solarPct = elec > 0 ? ((solar / (elec + solar)) * 100).toFixed(1) : "0";
    const recycledWater = latest.water_recycled_kl || 0;
    const totalWater = latest.water_kl || 0;

    const response = await callAI({
      featureKey: "esg_recommendations",
      hospitalId: hId,
      prompt: `You are a hospital sustainability consultant. Analyse this hospital's ESG data and provide 5 specific, actionable recommendations.

LATEST MONTH ESG DATA:
- Electricity: ${elec.toLocaleString()} kWh (${elecVsTarget}% of target${latest.electricity_target ? `, target: ${latest.electricity_target} kWh` : ""})
- Solar energy: ${solar.toLocaleString()} kWh (${solarPct}% of total consumption)
- Diesel used: ${latest.diesel_litres || 0} litres
- Water consumed: ${totalWater.toLocaleString()} kL (${waterVsTarget}% of target)
- Water recycled: ${recycledWater.toLocaleString()} kL
- Biomedical waste: ${totalBMW.toFixed(1)} kg total (target: ${latest.bmw_target || "not set"} kg)
- Carbon offset: ${latest.carbon_offset_kg || 0} kg

Focus on the biggest gaps vs targets. Give practical hospital-specific recommendations.
Respond with exactly 5 recommendations, one per line, starting with an action verb. No numbering, no bullets. Just 5 lines.`,
      maxTokens: 400,
    });

    if (response.text && !response.error) {
      setAiRecs(response.text.trim().split("\n").filter(l => l.trim()).slice(0, 5));
    }
    setAiLoading(false);
  };

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-green-600" />
          <span className="text-sm font-semibold">ESG Sustainability Dashboard</span>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Enter Monthly Data
        </Button>
      </div>

      {latest && (
        <div className="grid grid-cols-4 gap-3">
          <AnalyticsKPICard icon="⚡" iconBg="bg-yellow-100"
            value={`${(latest.electricity_kwh || 0).toLocaleString()} kWh`} label="Electricity (latest month)"
            subtitle={latest.solar_kwh ? `Solar: ${latest.solar_kwh} kWh` : undefined} />
          <AnalyticsKPICard icon="💧" iconBg="bg-blue-100"
            value={`${(latest.water_kl || 0).toLocaleString()} KL`} label="Water Consumed"
            subtitle={latest.water_recycled_kl ? `Recycled: ${latest.water_recycled_kl} KL` : undefined} />
          <AnalyticsKPICard icon="🗑️" iconBg="bg-green-100"
            value={`${totalBMW.toLocaleString()} kg`} label="BMW Waste (latest month)" />
          <AnalyticsKPICard icon="🌿" iconBg="bg-emerald-100"
            value={`${(latest.carbon_offset_kg || 0).toLocaleString()} kg`} label="Carbon Offset" />
        </div>
      )}

      {energyData.length > 0 && (
        <div className="bg-card border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">Energy Usage (kWh)</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={energyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="electricity" stroke="#f59e0b" fill="#fef3c7" name="Electricity" />
              <Area type="monotone" dataKey="solar" stroke="#22c55e" fill="#dcfce7" name="Solar" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {bmwData.length > 0 && (
        <div className="bg-card border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">BMW Waste by Category (kg)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={bmwData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="red" stackId="a" fill="#ef4444" name="Red (infectious)" />
              <Bar dataKey="yellow" stackId="a" fill="#f59e0b" name="Yellow (cytotoxic)" />
              <Bar dataKey="blue" stackId="a" fill="#3b82f6" name="Blue (glass)" />
              <Bar dataKey="black" stackId="a" fill="#6b7280" name="Black (general)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && metrics.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No ESG data yet. Click "Enter Monthly Data" to begin.</p>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Leaf className="h-4 w-4 text-green-600" />Enter Monthly ESG Data</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Month *</label>
              <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
            </div>

            <p className="text-xs font-bold text-muted-foreground uppercase">Energy</p>
            <div className="grid grid-cols-3 gap-2">
              {[["electricity_kwh","Electricity (kWh)"],["solar_kwh","Solar (kWh)"],["diesel_litres","Diesel (L)"]].map(([k,l]) => (
                <div key={k}>
                  <label className="text-xs font-medium">{l}</label>
                  <Input type="number" placeholder="0" value={(form as any)[k]}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
            </div>

            <p className="text-xs font-bold text-muted-foreground uppercase">Water</p>
            <div className="grid grid-cols-2 gap-2">
              {[["water_kl","Consumed (KL)"],["water_recycled_kl","Recycled (KL)"]].map(([k,l]) => (
                <div key={k}>
                  <label className="text-xs font-medium">{l}</label>
                  <Input type="number" placeholder="0" value={(form as any)[k]}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
            </div>

            <p className="text-xs font-bold text-muted-foreground uppercase">BMW Waste (kg)</p>
            <div className="grid grid-cols-4 gap-2">
              {[["bmw_kg_red","Red"],["bmw_kg_yellow","Yellow"],["bmw_kg_blue","Blue"],["bmw_kg_black","Black"]].map(([k,l]) => (
                <div key={k}>
                  <label className="text-xs font-medium">{l}</label>
                  <Input type="number" placeholder="0" value={(form as any)[k]}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs font-medium">Carbon Offset (kg)</label>
              <Input type="number" placeholder="0" value={form.carbon_offset_kg}
                onChange={e => setForm(f => ({ ...f, carbon_offset_kg: e.target.value }))} />
            </div>

            <div>
              <label className="text-xs font-medium">Green Initiatives (optional)</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
                placeholder="Solar panels installed, rainwater harvesting…"
                value={form.initiatives_text} onChange={e => setForm(f => ({ ...f, initiatives_text: e.target.value }))} />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveMetrics} disabled={saving}>{saving ? "Saving…" : "Save ESG Data"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI ESG Carbon Recommendations — E7 NABH Excellence */}
      {latest && (
        <div className="border border-emerald-200 rounded-xl bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">AI Carbon Reduction Recommendations</span>
              <span className="text-[10px] border border-emerald-200 bg-emerald-100 text-emerald-700 rounded px-1.5 py-px font-medium">E7 — NABH Excellence</span>
            </div>
            <Button size="sm" variant="outline" onClick={getAIRecommendations} disabled={aiLoading}
              className="h-7 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
              {aiRecs.length > 0 ? "Refresh Recommendations" : "Get AI Recommendations"}
            </Button>
          </div>
          <div className="p-4">
            {aiLoading && (
              <div className="flex items-center gap-2 text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                <span className="text-sm">Analysing ESG data…</span>
              </div>
            )}
            {!aiLoading && aiRecs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Click "Get AI Recommendations" to receive specific carbon reduction actions based on your latest ESG metrics.
              </p>
            )}
            {!aiLoading && aiRecs.length > 0 && (
              <ul className="space-y-2">
                {aiRecs.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-foreground">{rec}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ESGTab;
