// Phase 6C — Health Coach Bot (Patient Portal)
// Post-discharge chronic disease coaching for patients: DM, HTN, cardiac, COPD, etc.
// Uses callAI (GPT-4o) with discharge summary, medications, and vitals as context.
//
// SaMD Class B — coaching content must not substitute physician advice.
// Dr. Nalini sign-off required before production rollout of symptom-specific coaching.

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { usePatientPortal } from "@/hooks/usePatientPortal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Heart, User, Bot, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { format, differenceInDays } from "date-fns";

interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface DischargeContext {
  diagnosis: string;
  discharge_date: string;
  discharge_instructions: string;
  medications: string;
  recent_vitals: string;
  days_since_discharge: number;
}

const TEAL = "#0E7B7B";
const TEAL_LIGHT = "#E6F4F4";

// Coaching tip cards for chronic conditions
const CONDITION_TIPS: Record<string, string[]> = {
  diabetes: [
    "Check your blood sugar at the same time every day",
    "Eat smaller portions and avoid sugary drinks",
    "A 20-minute walk after meals helps control blood sugar",
    "Never skip your insulin or diabetes medications",
  ],
  hypertension: [
    "Reduce salt: aim for less than 5g per day",
    "Check your BP at home twice daily and record it",
    "Avoid stress — try deep breathing for 5 minutes daily",
    "Take your BP medications at the same time every day",
  ],
  cardiac: [
    "Weigh yourself daily — gain of >1 kg in a day needs a doctor call",
    "No lifting heavy objects for 4–6 weeks post-discharge",
    "Take all heart medications as prescribed — don't stop without consulting your doctor",
    "Rest if you feel chest pain, shortness of breath, or palpitations",
  ],
  copd: [
    "Use your inhaler exactly as prescribed — correct technique matters",
    "Avoid smoky environments and strong chemical odours",
    "Practise pursed-lip breathing when you feel breathless",
    "Get your flu and pneumonia vaccines every year",
  ],
};

const detectCondition = (diagnosis: string): string | null => {
  const d = diagnosis.toLowerCase();
  if (d.includes("diabet") || d.includes("dm ") || d.includes("type 2") || d.includes("type 1")) return "diabetes";
  if (d.includes("hypertens") || d.includes("htn") || d.includes("blood pressure")) return "hypertension";
  if (d.includes("cardiac") || d.includes("heart") || d.includes("mi ") || d.includes("chf") || d.includes("coronary")) return "cardiac";
  if (d.includes("copd") || d.includes("asthma") || d.includes("pulmon")) return "copd";
  return null;
};

const PortalHealthCoachPage: React.FC = () => {
  const { patientId, hospitalId, patient, hospital } = usePatientPortal();
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [dischargeCtx, setDischargeCtx] = useState<DischargeContext | null>(null);
  const [tipsExpanded, setTipsExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!patientId || !hospitalId) return;
    loadContext();
    loadMessages();
  }, [patientId, hospitalId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadContext = async () => {
    setContextLoading(true);
    try {
      // Get most recent completed admission (discharge)
      const { data: admission } = await (supabase as any)
        .from("admissions")
        .select("id, diagnosis, discharge_date, discharge_notes, discharge_instructions")
        .eq("patient_id", patientId)
        .eq("status", "discharged")
        .order("discharge_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!admission) { setContextLoading(false); return; }

      // Get current medications
      const { data: meds } = await (supabase as any)
        .from("prescriptions")
        .select("drug_name, dosage, frequency, route, duration_days")
        .eq("patient_id", patientId)
        .order("prescribed_date", { ascending: false })
        .limit(8);

      const medList = (meds || [])
        .map((m: any) => `${m.drug_name} ${m.dosage} ${m.route} — ${m.frequency}`)
        .join("; ") || "None recorded";

      // Get recent vitals
      const { data: vitals } = await (supabase as any)
        .from("patient_vitals")
        .select("recorded_at, systolic_bp, diastolic_bp, pulse_rate, temperature, spo2, blood_glucose")
        .eq("patient_id", patientId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const vitalStr = vitals
        ? [
            vitals.systolic_bp ? `BP: ${vitals.systolic_bp}/${vitals.diastolic_bp} mmHg` : null,
            vitals.pulse_rate ? `Pulse: ${vitals.pulse_rate} bpm` : null,
            vitals.spo2 ? `SpO2: ${vitals.spo2}%` : null,
            vitals.temperature ? `Temp: ${vitals.temperature}°C` : null,
            vitals.blood_glucose ? `Glucose: ${vitals.blood_glucose} mg/dL` : null,
          ].filter(Boolean).join(", ")
        : "Not recorded";

      const dischargeDate = admission.discharge_date || admission.discharge_notes?.substring(0, 10) || "";
      const daysSince = dischargeDate ? differenceInDays(new Date(), new Date(dischargeDate)) : 0;

      setDischargeCtx({
        diagnosis: admission.diagnosis || "General",
        discharge_date: dischargeDate ? format(new Date(dischargeDate), "dd/MM/yyyy") : "N/A",
        discharge_instructions: admission.discharge_instructions || admission.discharge_notes || "Refer to your discharge summary.",
        medications: medList,
        recent_vitals: vitalStr,
        days_since_discharge: daysSince,
      });
    } finally {
      setContextLoading(false);
    }
  };

  const loadMessages = async () => {
    const { data } = await supabase
      .from("health_coach_sessions")
      .select("id, role, content, created_at")
      .eq("patient_id", patientId!)
      .eq("hospital_id", hospitalId!)
      .order("created_at", { ascending: true })
      .limit(50);
    if (data) setMessages(data as CoachMessage[]);
  };

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    if (!patientId || !hospitalId) return;
    const { data } = await supabase
      .from("health_coach_sessions")
      .insert({ patient_id: patientId, hospital_id: hospitalId, role, content })
      .select("id, role, content, created_at")
      .maybeSingle();
    if (data) setMessages((prev) => [...prev, data as CoachMessage]);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !patientId || !hospitalId || !dischargeCtx) return;

    setInput("");
    setLoading(true);

    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: text, created_at: new Date().toISOString() }]);

    try {
      const { data: promptRow } = await supabase
        .from("prompt_registry")
        .select("system_prompt")
        .eq("feature_key", "health_coach_bot")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const age = patient?.dob
        ? differenceInDays(new Date(), new Date(patient.dob)) / 365 | 0
        : "Unknown";

      const systemPrompt = (promptRow?.system_prompt || "")
        .replace("{{hospital_name}}", hospital?.name || "the hospital")
        .replace("{{patient_name}}", patient?.fullName || "Patient")
        .replace("{{age}}", String(age))
        .replace("{{gender}}", patient?.gender || "N/A")
        .replace("{{diagnosis}}", dischargeCtx.diagnosis)
        .replace("{{discharge_date}}", dischargeCtx.discharge_date)
        .replace("{{discharge_instructions}}", dischargeCtx.discharge_instructions)
        .replace("{{medications}}", dischargeCtx.medications)
        .replace("{{recent_vitals}}", dischargeCtx.recent_vitals)
        .replace("{{days_since_discharge}}", String(dischargeCtx.days_since_discharge));

      const historyText = messages
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Patient" : "Coach"}: ${m.content}`)
        .join("\n");

      const fullPrompt = [systemPrompt, historyText, `Patient: ${text}`].filter(Boolean).join("\n\n");

      const response = await callAI({
        featureKey: "health_coach_bot",
        hospitalId,
        prompt: fullPrompt,
        maxTokens: 350,
      });

      const reply = response.text || "I'm here for you. Please try asking again or contact your care team.";

      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      await saveMessage("user", text);
      await saveMessage("assistant", reply);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      await saveMessage("user", text);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "I couldn't respond right now. Please try again or contact your hospital care team directly.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const conditionKey = dischargeCtx ? detectCondition(dischargeCtx.diagnosis) : null;
  const tips = conditionKey ? CONDITION_TIPS[conditionKey] : null;

  if (contextLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin" style={{ color: TEAL }} />
      </div>
    );
  }

  if (!dischargeCtx) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 px-6 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: TEAL_LIGHT }}>
          <Heart size={24} style={{ color: TEAL }} />
        </div>
        <p className="text-sm font-semibold text-slate-700">Health Coach</p>
        <p className="text-xs text-slate-500 max-w-xs">
          Your personalised health coaching will appear here after your discharge from the hospital. Please check back after your next admission.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid #E2E8F0", background: "#fff" }}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: TEAL }}>
          <Heart size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Health Coach</p>
          <p className="text-[10px] text-slate-500 truncate">
            {dischargeCtx.diagnosis} · {dischargeCtx.days_since_discharge} days since discharge
          </p>
        </div>
        <Badge
          className="text-[9px] px-1.5 py-0 shrink-0"
          style={{ background: "#FEF3C7", color: "#92400E", border: "none" }}
        >
          Class B · Not a doctor
        </Badge>
      </div>

      {/* Condition tips card */}
      {tips && (
        <div
          className="mx-4 mt-3 mb-1 rounded-xl overflow-hidden shrink-0"
          style={{ border: "1px solid #D1FAE5" }}
        >
          <button
            onClick={() => setTipsExpanded((p) => !p)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold"
            style={{ background: "#ECFDF5", color: "#065F46" }}
          >
            <span>💡 {conditionKey ? conditionKey.charAt(0).toUpperCase() + conditionKey.slice(1) : ""} Self-Care Tips</span>
            {tipsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {tipsExpanded && (
            <ul className="px-3 py-2 space-y-1.5" style={{ background: "#F0FDF4" }}>
              {tips.map((tip, i) => (
                <li key={i} className="text-xs text-slate-700 flex gap-2">
                  <span className="text-green-500 shrink-0">✓</span>
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Chat */}
      <ScrollArea className="flex-1 px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-xs text-slate-500 max-w-xs">
              Hi {patient?.fullName?.split(" ")[0]}! I'm your recovery coach for <strong>{dischargeCtx.diagnosis}</strong>.
              Ask me about your medications, diet, exercises, or any symptoms you're experiencing.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "How should I manage my diet?",
                "When should I take my medications?",
                "What warning signs should I watch for?",
                "When is my follow-up appointment?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700 transition-colors bg-white"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: msg.role === "user" ? "#1A2F5A" : TEAL }}
              >
                {msg.role === "user"
                  ? <User size={13} className="text-white" />
                  : <Heart size={13} className="text-white" />}
              </div>
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user" ? "rounded-tr-sm text-white" : "rounded-tl-sm text-slate-800 border border-slate-100"
                }`}
                style={{ background: msg.role === "user" ? "#1A2F5A" : "#F8FAFC" }}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p className={`text-[9px] mt-1 ${msg.role === "user" ? "text-slate-300" : "text-slate-400"}`}>
                  {format(new Date(msg.created_at), "HH:mm")}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: TEAL }}>
                <Heart size={13} className="text-white" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3 border border-slate-100" style={{ background: "#F8FAFC" }}>
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: TEAL, animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 px-4 py-3" style={{ borderTop: "1px solid #E2E8F0", background: "#fff" }}>
        <p className="text-[9px] text-slate-400 mb-2 text-center">
          This coaching is based on your discharge records — not a substitute for your doctor's advice.
        </p>
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask your health coach…"
            className="flex-1 resize-none text-sm"
            rows={2}
          />
          <Button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            size="sm"
            className="h-[52px] w-10 p-0 shrink-0"
            style={{ background: TEAL }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PortalHealthCoachPage;
