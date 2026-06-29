import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import AnalyticsKPICard from "./AnalyticsKPICard";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { sendPROMSurvey } from "@/lib/whatsapp-notifications";
import { MessageSquare, Send } from "lucide-react";

const PREM_DIMS = [
  { key: "prem_communication", label: "Communication" },
  { key: "prem_cleanliness", label: "Cleanliness" },
  { key: "prem_responsiveness", label: "Responsiveness" },
  { key: "prem_dignity", label: "Dignity" },
  { key: "prem_discharge_info", label: "Discharge Info" },
  { key: "prem_overall", label: "Overall" },
];

interface Survey {
  id: string; status: string; responded_at: string | null; comments: string | null;
  prem_communication: number | null; prem_cleanliness: number | null;
  prem_responsiveness: number | null; prem_dignity: number | null;
  prem_discharge_info: number | null; prem_overall: number | null;
  prom_pain_score: number | null; prom_readmitted: boolean | null;
}

const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "—";

const PROMAnalyticsTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("prom_prem_surveys")
      .select("id,status,responded_at,comments,prem_communication,prem_cleanliness,prem_responsiveness,prem_dignity,prem_discharge_info,prem_overall,prom_pain_score,prom_readmitted")
      .eq("hospital_id", hospitalId).eq("is_deleted", false)
      .order("responded_at", { ascending: false }).limit(200);
    setSurveys(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const responded = surveys.filter(s => s.status === "responded");
  const responseRate = surveys.length ? ((responded.length / surveys.length) * 100).toFixed(0) : "0";

  const avgPREM = avg(responded.map(s => s.prem_overall ?? 0).filter(Boolean));
  const avgPain = avg(responded.map(s => s.prom_pain_score ?? 0).filter(v => v !== null));
  const readmitRate = responded.length
    ? ((responded.filter(s => s.prom_readmitted).length / responded.length) * 100).toFixed(0)
    : "0";

  const premChartData = PREM_DIMS.map(d => ({
    name: d.label,
    score: Number(avg(responded.map(s => (s as any)[d.key] ?? 0).filter(Boolean))) || 0,
  }));

  const sendBatch = async () => {
    if (!hospitalId) return;
    setSending(true);
    const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
    const { data: discharges } = await (supabase as any)
      .from("admissions")
      .select("id, patient_id, patients!admissions_patient_id_fkey(full_name, phone)")
      .eq("hospital_id", hospitalId).eq("status", "discharged")
      .gte("discharge_date", new Date(Date.now() - 72 * 3600000).toISOString().split("T")[0])
      .lte("discharge_date", new Date(Date.now() - 48 * 3600000).toISOString().split("T")[0])
      .limit(50);

    if (!discharges?.length) { toast({ title: "No eligible discharges for 48h window" }); setSending(false); return; }

    const token = () => Math.random().toString(36).substring(2) + Date.now().toString(36);
    let sent = 0;

    for (const d of discharges) {
      const surveyToken = token();
      const { error } = await (supabase as any).from("prom_prem_surveys").insert({
        hospital_id: hospitalId, patient_id: d.patient_id, admission_id: d.id,
        survey_type: "combined", response_token: surveyToken, status: "pending",
      });
      if (!error && d.patients?.phone) {
        const { data: hosp } = await (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
        await sendPROMSurvey({
          hospitalId, patientId: d.patient_id,
          patientName: d.patients.full_name || "Patient",
          phone: d.patients.phone,
          surveyToken,
          hospitalName: hosp?.name || "Hospital",
        });
        sent++;
      }
    }
    toast({ title: `${sent} PROM surveys sent` });
    setSending(false);
    load();
  };

  const recentComments = responded.filter(s => s.comments).slice(0, 8);

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">PROM / PREM Analytics</span>
        </div>
        <Button size="sm" onClick={sendBatch} disabled={sending}>
          <Send className="h-3.5 w-3.5 mr-1" />
          {sending ? "Sending…" : "Send Surveys (48h discharged)"}
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <AnalyticsKPICard icon="📋" iconBg="bg-blue-100" value={`${responseRate}%`} label="Response Rate"
          subtitle={`${responded.length} of ${surveys.length} responded`} />
        <AnalyticsKPICard icon="⭐" iconBg="bg-amber-100" value={`${avgPREM}/5`} label="Avg Overall PREM"
          valueColor={Number(avgPREM) >= 4 ? "text-green-600" : "text-amber-600"} />
        <AnalyticsKPICard icon="💊" iconBg="bg-red-100" value={`${avgPain}/10`} label="Avg Pain Score (post-discharge)"
          valueColor={Number(avgPain) >= 6 ? "text-red-600" : "text-green-600"} />
        <AnalyticsKPICard icon="🏥" iconBg="bg-purple-100" value={`${readmitRate}%`} label="Readmission Rate"
          valueColor={Number(readmitRate) >= 10 ? "text-red-600" : "text-green-600"} />
      </div>

      {responded.length > 0 && (
        <div className="bg-card border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">PREM Scores by Dimension (avg out of 5)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={premChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => v.toFixed(2)} />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {premChartData.map((_, i) => (
                  <Cell key={i} fill={_.score >= 4 ? "#22c55e" : _.score >= 3 ? "#f59e0b" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {recentComments.length > 0 && (
        <div className="bg-card border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">Recent Patient Comments</p>
          <div className="space-y-2">
            {recentComments.map(s => (
              <div key={s.id} className="text-xs p-2 border rounded bg-muted/30">
                <span className="text-muted-foreground">{s.responded_at ? new Date(s.responded_at).toLocaleDateString() : "—"} — </span>
                {s.comments}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && surveys.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No PROM/PREM surveys yet. Click "Send Surveys" to begin.</p>
      )}
    </div>
  );
};

export default PROMAnalyticsTab;
