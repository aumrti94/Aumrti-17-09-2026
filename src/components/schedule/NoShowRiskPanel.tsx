import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, TrendingDown, AlertTriangle, CheckCircle2, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { sendWhatsApp } from "@/lib/whatsapp-send";

interface Appointment {
  id: string;
  patient_id: string;
  appointment_date: string;
  slot_time: string;
  visit_type: string;
  chief_complaint: string | null;
  status: string;
  patient_name?: string;
  patient_phone?: string | null;
  doctor_name?: string;
  specialty?: string | null;
}

interface RiskScore {
  level: "low" | "medium" | "high";
  pct: number;
  reason: string;
}

const RISK_CONFIG = {
  low:    { label: "Low",    color: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700 border-amber-200",   dot: "bg-amber-500"   },
  high:   { label: "High",   color: "bg-red-100 text-red-700 border-red-200",         dot: "bg-red-500"     },
};

interface Props {
  hospitalId: string;
  date: string; // yyyy-MM-dd
  appointments: Appointment[];
}

const NoShowRiskPanel: React.FC<Props> = ({ hospitalId, date, appointments }) => {
  const { toast } = useToast();
  const [scores, setScores] = useState<Record<string, RiskScore>>({});
  const [loading, setLoading] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  const runPrediction = useCallback(async () => {
    if (!appointments.length) return;
    setLoading(true);

    const upcoming = appointments.filter(a => a.status === "booked" || a.status === "confirmed");
    if (!upcoming.length) { setLoading(false); return; }

    // Fetch prior no-show history for these patients in batch
    const patientIds = [...new Set(upcoming.map(a => a.patient_id))];
    const { data: history } = await supabase
      .from("appointments")
      .select("patient_id, status")
      .eq("hospital_id", hospitalId)
      .in("patient_id", patientIds)
      .in("status", ["no_show", "cancelled", "completed"])
      .limit(500) as any;

    const noShowMap: Record<string, { total: number; noShows: number }> = {};
    (history || []).forEach((h: any) => {
      if (!noShowMap[h.patient_id]) noShowMap[h.patient_id] = { total: 0, noShows: 0 };
      noShowMap[h.patient_id].total++;
      if (h.status === "no_show") noShowMap[h.patient_id].noShows++;
    });

    // Score each appointment using AI in a single batched call
    const apptSummaries = upcoming.map(a => {
      const hist = noShowMap[a.patient_id];
      const priorRate = hist && hist.total > 0 ? Math.round((hist.noShows / hist.total) * 100) : 0;
      const hour = parseInt(a.slot_time?.split(":")[0] || "10");
      const isEarlyMorning = hour < 9;
      const isLunchTime = hour >= 12 && hour <= 14;
      return `ID:${a.id} | Time:${a.slot_time} | Type:${a.visit_type} | Complaint:${a.chief_complaint || "none"} | PriorNoShowRate:${priorRate}% | EarlyMorning:${isEarlyMorning} | LunchSlot:${isLunchTime}`;
    });

    const prompt = `You are a hospital appointment analytics AI. Predict no-show risk for each appointment.

DATE: ${date}
APPOINTMENTS:
${apptSummaries.join("\n")}

For each appointment ID, assess 30-day no-show risk based on:
- Prior no-show rate (most important factor)
- Time of day (early morning and lunch slots have higher no-show rates)
- Visit type (follow-up has higher no-show than new patient)
- Chief complaint urgency

Respond ONLY with JSON array:
[{"id": "uuid", "level": "low"|"medium"|"high", "pct": 0-100, "reason": "brief reason"}, ...]

low = <25%, medium = 25-55%, high = >55%`;

    const response = await callAI({
      featureKey: "no_show_predictor",
      hospitalId,
      prompt,
      maxTokens: 600,
    });

    if (response.text && !response.error) {
      try {
        const match = response.text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed: Array<{ id: string; level: string; pct: number; reason: string }> = JSON.parse(match[0]);
          const newScores: Record<string, RiskScore> = {};
          for (const p of parsed) {
            if (["low", "medium", "high"].includes(p.level)) {
              newScores[p.id] = { level: p.level as RiskScore["level"], pct: p.pct, reason: p.reason };
            }
          }
          setScores(newScores);
        }
      } catch {
        toast({ title: "Could not parse AI predictions", variant: "destructive" });
      }
    }
    setLoading(false);
  }, [appointments, hospitalId, date]);

  const sendReminder = async (appt: Appointment) => {
    if (!appt.patient_phone) {
      toast({ title: "No phone number for this patient", variant: "destructive" });
      return;
    }
    setSendingReminder(appt.id);
    await sendWhatsApp(hospitalId, appt.patient_phone,
      `Reminder: You have an appointment scheduled for ${format(parseISO(appt.appointment_date), "dd MMM yyyy")} at ${appt.slot_time}${appt.doctor_name ? ` with Dr. ${appt.doctor_name}` : ""}. Please confirm or reschedule if needed. Reply CONFIRM or CANCEL.`
    );
    toast({ title: `Reminder sent to ${appt.patient_name}` });
    setSendingReminder(null);
  };

  const upcoming = appointments.filter(a => a.status === "booked" || a.status === "confirmed");
  const highRisk = Object.values(scores).filter(s => s.level === "high").length;
  const hasScores = Object.keys(scores).length > 0;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">No-Show Risk Predictor</span>
          <Badge variant="outline" className="text-[10px]">Tier 2 — NABH Excellence</Badge>
          {highRisk > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{highRisk} High Risk
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={runPrediction} disabled={loading || !upcoming.length}
          className="h-7 text-xs gap-1.5">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
          {hasScores ? "Re-predict" : "Predict No-Shows (AI)"}
        </Button>
      </div>

      {!upcoming.length ? (
        <p className="text-xs text-muted-foreground text-center py-6">No upcoming appointments to analyse.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Analysing {upcoming.length} appointments…</span>
        </div>
      ) : !hasScores ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          Click "Predict No-Shows (AI)" to score {upcoming.length} appointment{upcoming.length !== 1 ? "s" : ""} for today.
        </p>
      ) : (
        <div className="divide-y divide-border/50">
          {upcoming.map(appt => {
            const score = scores[appt.id];
            if (!score) return null;
            const cfg = RISK_CONFIG[score.level];
            return (
              <div key={appt.id} className={cn("px-4 py-3 flex items-center gap-3",
                score.level === "high" ? "bg-red-50/20 dark:bg-red-950/10" :
                score.level === "medium" ? "bg-amber-50/20" : ""
              )}>
                <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", cfg.dot)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{appt.patient_name || "Unknown"}</span>
                    <span className="text-[10px] text-muted-foreground">{appt.slot_time}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{appt.visit_type}</span>
                    <Badge className={cn("text-[10px] px-1.5 py-0 font-bold", cfg.color)}>
                      {cfg.label} Risk — {score.pct}%
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{score.reason}</p>
                </div>
                {score.level !== "low" && appt.patient_phone && (
                  <Button size="sm" variant="outline"
                    onClick={() => sendReminder(appt)}
                    disabled={sendingReminder === appt.id}
                    className="h-7 text-xs gap-1 shrink-0 border-blue-200 text-blue-700 hover:bg-blue-50">
                    {sendingReminder === appt.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Bell className="h-3 w-3" />}
                    Remind
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NoShowRiskPanel;
