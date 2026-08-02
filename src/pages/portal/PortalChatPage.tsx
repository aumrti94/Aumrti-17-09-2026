// Phase 6C — Patient Chatbot (Portal)
// RAG-based 24/7 AI assistant for patients: answers questions about their own appointments,
// prescriptions, lab results, and bills using their actual health records as context.
// SaMD Class A — no diagnosis or treatment recommendation.

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { usePatientPortal } from "@/hooks/usePatientPortal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const TEAL = "#0E7B7B";

const PortalChatPage: React.FC = () => {
  const { patientId, hospitalId, patient, hospital } = usePatientPortal();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load conversation history
  useEffect(() => {
    if (!patientId) return;
    (async () => {
      setHistoryLoading(true);
      const { data } = await supabase
        .from("portal_chat_messages")
        .select("id, role, content, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (data) setMessages(data as Message[]);
      setHistoryLoading(false);
    })();
  }, [patientId]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildPatientContext = async (): Promise<string> => {
    if (!patientId || !hospitalId) return "";

    const [apptRes, rxRes, labRes, billRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("appointment_date, slot_time, status, users(full_name), departments(name)")
        .eq("patient_id", patientId)
        .order("appointment_date", { ascending: false })
        .limit(5),
      (supabase as any)
        .from("prescriptions")
        .select("prescribed_date, drug_name, dosage, frequency, duration_days, route")
        .eq("patient_id", patientId)
        .order("prescribed_date", { ascending: false })
        .limit(10),
      (supabase as any)
        .from("lab_orders")
        .select("ordered_at, test_name, result_value, result_unit, reference_range, flag, status")
        .eq("patient_id", patientId)
        .order("ordered_at", { ascending: false })
        .limit(10),
      supabase
        .from("bills")
        .select("bill_date, bill_number, bill_type, total_amount, payment_status, balance_due")
        .eq("patient_id", patientId)
        .order("bill_date", { ascending: false })
        .limit(5),
    ]);

    const parts: string[] = [];

    if (apptRes.data?.length) {
      parts.push("RECENT APPOINTMENTS:");
      apptRes.data.forEach((a: any) => {
        parts.push(`• ${a.appointment_date} at ${a.slot_time || "TBD"} — Dr. ${(a.users as any)?.full_name || "N/A"} (${(a.departments as any)?.name || "N/A"}) — ${a.status}`);
      });
    }

    if (rxRes.data?.length) {
      parts.push("\nCURRENT MEDICATIONS:");
      rxRes.data.forEach((rx: any) => {
        parts.push(`• ${rx.drug_name} ${rx.dosage} ${rx.route} — ${rx.frequency} for ${rx.duration_days || "?"} days (from ${rx.prescribed_date})`);
      });
    }

    if (labRes.data?.length) {
      const resulted = labRes.data.filter((l: any) => l.status === "resulted");
      if (resulted.length) {
        parts.push("\nRECENT LAB RESULTS:");
        resulted.forEach((l: any) => {
          const flag = l.flag && l.flag !== "normal" ? ` [${l.flag.toUpperCase()}]` : "";
          parts.push(`• ${l.test_name}: ${l.result_value ?? "pending"} ${l.result_unit || ""} (ref: ${l.reference_range || "N/A"})${flag} — ${format(new Date(l.ordered_at), "dd/MM/yy")}`);
        });
      }
    }

    if (billRes.data?.length) {
      parts.push("\nBILLS:");
      billRes.data.forEach((b: any) => {
        parts.push(`• Bill ${b.bill_number} (${b.bill_type}) — ₹${b.total_amount?.toLocaleString("en-IN")} — ${b.payment_status}${b.balance_due > 0 ? ` (₹${b.balance_due?.toLocaleString("en-IN")} pending)` : ""}`);
      });
    }

    return parts.join("\n") || "No health records available yet.";
  };

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    if (!patientId || !hospitalId) return;
    const { data } = await supabase
      .from("portal_chat_messages")
      .insert({ patient_id: patientId, hospital_id: hospitalId, role, content })
      .select("id, role, content, created_at")
      .maybeSingle();
    if (data) setMessages((prev) => [...prev, data as Message]);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !patientId || !hospitalId) return;

    setInput("");
    setLoading(true);

    // Optimistically show user message
    const tempId = `tmp-${Date.now()}`;
    const tempUser: Message = { id: tempId, role: "user", content: text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempUser]);

    try {
      // Build context and recent conversation for the prompt
      const [context, promptRow] = await Promise.all([
        buildPatientContext(),
        supabase
          .from("prompt_registry")
          .select("system_prompt")
          .eq("feature_key", "patient_chatbot")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const systemPrompt = (promptRow.data?.system_prompt || "")
        .replace("{{hospital_name}}", hospital?.name || "the hospital")
        .replace("{{patient_name}}", patient?.fullName || "the patient")
        .replace("{{uhid}}", patient?.uhid || "N/A")
        .replace("{{patient_context}}", context);

      // Include last 6 exchanges as conversation history
      const historyText = messages
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Patient" : "Assistant"}: ${m.content}`)
        .join("\n");

      const prompt = historyText
        ? `${historyText}\nPatient: ${text}`
        : text;

      const response = await callAI({
        featureKey: "patient_chatbot",
        hospitalId,
        prompt,
        maxTokens: 400,
      });

      const reply = response.text || "I'm sorry, I couldn't generate a response right now. Please try again.";

      // Replace temp user message then save both
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      await saveMessage("user", text);
      await saveMessage("assistant", reply);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      await saveMessage("user", text);
      const fallback: Message = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "I'm unable to respond right now. Please try again later or call the hospital directly.",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, fallback]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!patientId) return;
    await supabase.from("portal_chat_messages").delete().eq("patient_id", patientId);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid #E2E8F0", background: "#fff" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: TEAL }}
          >
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">AI Health Assistant</p>
            <p className="text-[10px] text-slate-500">{hospital?.name}</p>
          </div>
          <Badge
            className="ml-2 text-[9px] px-1.5 py-0"
            style={{ background: "#E6F4F4", color: TEAL, border: "none" }}
          >
            Class A — No diagnosis
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-400 hover:text-slate-600 text-xs h-7"
          onClick={clearHistory}
        >
          <RefreshCw size={12} className="mr-1" /> Clear
        </Button>
      </div>

      {/* Chat area */}
      <ScrollArea className="flex-1 px-4 py-4">
        {historyLoading && (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        )}

        {!historyLoading && messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: "#E6F4F4" }}
            >
              <Bot size={24} style={{ color: TEAL }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Hi, {patient?.fullName?.split(" ")[0]}!</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                I can help you check your appointments, lab results, prescriptions, and bills. What would you like to know?
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "When is my next appointment?",
                "What medications am I on?",
                "Show me my recent lab results",
                "Do I have any pending bills?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
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
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  background: msg.role === "user" ? "#1A2F5A" : TEAL,
                }}
              >
                {msg.role === "user"
                  ? <User size={13} className="text-white" />
                  : <Bot size={13} className="text-white" />}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm text-white"
                    : "rounded-tl-sm text-slate-800 border border-slate-100"
                }`}
                style={{
                  background: msg.role === "user" ? "#1A2F5A" : "#F8FAFC",
                }}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p
                  className={`text-[9px] mt-1 ${msg.role === "user" ? "text-slate-300" : "text-slate-400"}`}
                >
                  {format(new Date(msg.created_at), "HH:mm")}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: TEAL }}
              >
                <Bot size={13} className="text-white" />
              </div>
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-3 border border-slate-100"
                style={{ background: "#F8FAFC" }}
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ background: TEAL, animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input area */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderTop: "1px solid #E2E8F0", background: "#fff" }}
      >
        <p className="text-[9px] text-slate-400 mb-2 text-center">
          This assistant provides information from your health records only — not medical advice. For clinical concerns, consult your doctor.
        </p>
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            placeholder="Ask about your appointments, reports, or bills…"
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

export default PortalChatPage;
