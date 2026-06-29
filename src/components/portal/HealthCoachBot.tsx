import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";

interface Props {
  patientId: string;
  hospitalId: string;
  patientName: string;
  hospitalName: string;
  hospitalPhone?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_QUESTIONS = ["My medications", "Follow-up due?", "Diet advice", "When to visit ER?"];

const HealthCoachBot: React.FC<Props> = ({ patientId, hospitalId, patientName, hospitalName, hospitalPhone }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: `Hello ${patientName.split(" ")[0]}! 👋 How can I help you today?` },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      // Get patient context
      const { data: patient } = await supabase
        .from("patients")
        .select("full_name, allergies")
        .eq("id", patientId)
        .maybeSingle();

      const { data: recentAdm } = await supabase
        .from("admissions")
        .select("admitting_diagnosis")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const history = updated.slice(-4).map(m => `${m.role}: ${m.content}`).join("\n");

      const response = await callAI({
        featureKey: "voice_scribe",
        hospitalId,
        prompt: `You are a friendly health assistant at an Indian hospital.
Patient context:
- Name: ${patient?.full_name || patientName}
- Allergies: ${Array.isArray(patient?.allergies) ? (patient.allergies as unknown as string[]).join(", ") : "None known"}
- Recent diagnosis: ${recentAdm?.admitting_diagnosis || "No recent visit"}

Conversation so far:
${history}

Patient asks: "${text}"

Reply helpfully and warmly. Do NOT diagnose conditions.
For urgent symptoms: always advise to visit hospital immediately.
Keep response to 2-3 sentences max.
Suggest hospital visit when appropriate.
Use simple, clear language.`,
        maxTokens: 200,
      });

      const reply = response.error
        ? "I'm sorry, I'm unable to assist right now. Please contact the hospital directly."
        : response.text;

      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "I'm sorry, something went wrong. Please try again." }]);
    }
    setLoading(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[72px] right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-medium"
        style={{ background: "#0E7B7B", maxWidth: 200 }}
      >
        <MessageCircle size={18} /> Ask Health Coach
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-[72px] right-2 z-50 flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
      style={{ width: 300, height: 420, border: "1px solid #E2E8F0", maxWidth: "calc(100vw - 16px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 text-white" style={{ background: "#0E7B7B" }}>
        <span className="text-sm font-bold">🏥 {hospitalName} Health Assistant</span>
        <button onClick={() => setOpen(false)}><X size={16} /></button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: "#F8FAFC" }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border border-border text-foreground"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-border rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Quick questions */}
      {messages.length <= 2 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 border-t" style={{ background: "#F8FAFC" }}>
          {QUICK_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              className="text-[10px] px-2 py-1 rounded-full border border-border hover:bg-muted transition"
              style={{ color: "#0E7B7B" }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-t">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage(input)}
          placeholder="Type a message..."
          className="h-8 text-xs"
          disabled={loading}
        />
        <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
          <Send size={14} />
        </Button>
      </div>

      {/* Disclaimer */}
      <div className="px-3 py-1 text-[9px] text-center border-t" style={{ background: "#FEF3C7", color: "#92400E" }}>
        General health assistant only. For emergencies, call {hospitalPhone || "hospital"}.
      </div>
    </div>
  );
};

export default HealthCoachBot;
