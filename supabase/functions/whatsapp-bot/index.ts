// Phase 5C — WhatsApp Conversational Bot (Incoming Webhook Handler)
// Handles inbound messages from Meta Cloud API, detects intent, generates RAG responses,
// and replies via the existing send-whatsapp-meta infrastructure.
//
// SaMD Class B: Symptom triage feature requires Dr. Nalini sign-off before production.
// General intent routing (appointments, bills, reports) is Class A.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { checkAIAllowed } from "../_shared/ai-entitlement.ts";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface MetaWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      messages?: Array<{
        id: string;
        from: string;
        timestamp: string;
        type: string;
        text?: { body: string };
      }>;
    };
    field: string;
  }>;
}

type Intent =
  | "appointment_check"
  | "appointment_book"
  | "bill_query"
  | "report_status"
  | "hospital_info"
  | "symptom_query"
  | "human_handoff"
  | "greeting"
  | "unknown";

function detectIntent(message: string): Intent {
  const m = message.toLowerCase().trim();

  if (["help", "agent", "human", "speak", "call"].some(k => m.includes(k))) return "human_handoff";
  if (["hi", "hello", "helo", "namaste", "hey"].some(k => m.startsWith(k) && m.length < 20)) return "greeting";
  if (["appointment", "appt", "book", "schedule", "doctor", "consult", "slot", "token"].some(k => m.includes(k))) {
    return m.includes("book") || m.includes("schedule") || m.includes("new") ? "appointment_book" : "appointment_check";
  }
  if (["bill", "invoice", "payment", "pay", "amount", "balance", "receipt"].some(k => m.includes(k))) return "bill_query";
  if (["report", "result", "test", "lab", "x-ray", "xray", "scan", "mri", "ct"].some(k => m.includes(k))) return "report_status";
  if (["time", "timing", "hour", "open", "location", "address", "phone", "contact"].some(k => m.includes(k))) return "hospital_info";
  if (["pain", "fever", "cough", "breathe", "chest", "headache", "vomit", "bleed", "dizziness"].some(k => m.includes(k))) return "symptom_query";

  return "unknown";
}

// Match the WhatsApp sender to a patient in this hospital. Meta delivers the number in
// full international form ("919876543210"); patients rows are stored inconsistently as
// 10-digit, 91-prefixed or +91-prefixed, so try all three rather than assuming one.
// Returns null when the number matches no patient, or matches more than one — an
// ambiguous match must never be resolved to an arbitrary patient's record.
async function resolvePatientByPhone(hospitalId: string, phone: string): Promise<string | null> {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);

  const { data } = await supabaseAdmin
    .from("patients")
    .select("id")
    .eq("hospital_id", hospitalId)
    .in("phone", [last10, `91${last10}`, `+91${last10}`])
    .limit(2);

  if (!data || data.length !== 1) return null;
  return data[0].id;
}

async function getOrCreateSession(hospitalId: string, phone: string, patientId?: string) {
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_bot_sessions")
    .select("*")
    .eq("hospital_id", hospitalId)
    .eq("phone", phone)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && (Date.now() - new Date(existing.last_message_at).getTime()) < 24 * 60 * 60 * 1000) {
    return existing;
  }

  const { data: session } = await supabaseAdmin
    .from("whatsapp_bot_sessions")
    .insert({ hospital_id: hospitalId, phone, patient_id: patientId || null, context_json: {} })
    .select()
    .single();

  return session;
}

async function logMessage(sessionId: string, hospitalId: string, direction: "inbound" | "outbound", text: string, intent?: string, waMessageId?: string) {
  await supabaseAdmin.from("whatsapp_bot_messages").insert({
    session_id: sessionId,
    hospital_id: hospitalId,
    direction,
    message_text: text,
    intent: intent || null,
    wa_message_id: waMessageId || null,
  });
}

async function generateResponse(intent: Intent, inboundMessage: string, hospitalId: string, session: any): Promise<string> {
  const { data: hospital } = await supabaseAdmin
    .from("hospitals")
    .select("name, phone, address")
    .eq("id", hospitalId)
    .maybeSingle();

  const hospitalName = hospital?.name || "our hospital";

  switch (intent) {
    case "greeting":
      return `👋 Welcome to ${hospitalName}! I can help you with:
• Appointments (check/book)
• Bills & payments
• Lab/report status
• Hospital information

What do you need help with today? Reply HELP to speak with our staff.`;

    case "human_handoff":
      return `Connecting you with our team at ${hospitalName}. A staff member will reach out to you shortly during working hours (9am–6pm). For emergencies, please call 112 or visit our emergency department directly. Reply HELP to speak with our staff.`;

    case "symptom_query": {
      const m = inboundMessage.toLowerCase();
      const isEmergency = ["chest pain", "difficulty breathing", "breathless", "severe bleeding", "unconscious", "stroke"].some(k => m.includes(k));
      if (isEmergency) {
        return `⚠️ EMERGENCY: Please CALL 112 or go to the Emergency Department at ${hospitalName} immediately. Do not wait. Reply HELP to speak with our staff.`;
      }
      return `For your symptoms, we recommend consulting a doctor at ${hospitalName}. Please book an appointment or visit us. I cannot provide medical advice or diagnosis. For any worsening symptoms, please go to our emergency department. Reply HELP to speak with our staff.`;
    }

    case "appointment_check": {
      const contextPhone = session.context_json?.verified_phone;
      if (!contextPhone) {
        return `To check your appointments, please share your UHID (patient ID) and date of birth (DD/MM/YYYY) for verification. Reply HELP to speak with our staff.`;
      }

      // Scope to THIS patient. The query below previously filtered on hospital_id alone,
      // so it returned the next three appointments belonging to anyone in the hospital.
      // It was unreachable in practice only because nothing in the codebase ever sets
      // context_json.verified_phone — the moment a verification step did, every sender
      // would have received other patients' names, dates and doctors. Requiring a
      // resolved patient_id here means that can no longer happen by accident.
      const patientId = session.patient_id || await resolvePatientByPhone(hospitalId, session.phone);
      if (!patientId) {
        return `We could not match this number to a patient record at ${hospitalName}. Please share your UHID (patient ID) for verification, or reply HELP to speak with our staff.`;
      }

      const { data: appointments } = await supabaseAdmin
        .from("appointments")
        .select("appointment_date, slot_time, status, users(full_name)")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId)
        .gte("appointment_date", new Date().toISOString().split("T")[0])
        .eq("status", "scheduled")
        .limit(3);

      if (!appointments || appointments.length === 0) {
        return `No upcoming appointments found for your account at ${hospitalName}. Would you like to book one? Reply HELP to speak with our staff.`;
      }
      const lines = appointments.map((a: any) =>
        `• ${a.appointment_date} ${a.slot_time || ""} with ${(a.users as any)?.full_name || "Doctor"} (${a.status})`
      ).join("\n");
      return `Your upcoming appointments at ${hospitalName}:\n${lines}\n\nReply HELP to speak with our staff.`;
    }

    case "appointment_book":
      return `To book an appointment at ${hospitalName}, please visit our website or call ${hospital?.phone || "the front desk"}. Online booking is available 24/7. Reply HELP to speak with our staff.`;

    case "bill_query": {
      return `To check your bill status at ${hospitalName}, please share your UHID (patient ID) and date of birth for identity verification, or call our billing counter. Reply HELP to speak with our staff.`;
    }

    case "report_status": {
      return `Lab and radiology reports at ${hospitalName} are typically available within 24–48 hours of sample collection. For urgent reports, please contact the lab directly or ask at the nursing station. Reply HELP to speak with our staff.`;
    }

    case "hospital_info":
      return `${hospitalName}
📍 ${hospital?.address || "Please contact us for location"}
📞 ${hospital?.phone || "Please contact the front desk"}
🕐 OPD: Mon–Sat 9am–6pm | Emergency: 24×7

Reply HELP to speak with our staff.`;

    default: {
      const { data: promptRow } = await supabaseAdmin
        .from("prompt_registry")
        .select("system_prompt")
        .eq("feature_key", "whatsapp_bot_intent")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const systemPrompt = (promptRow?.system_prompt || "").replace("{{hospital_name}}", hospitalName);
      const canned = `I'm not sure I understood that. You can ask me about appointments, bills, reports, or hospital information. Reply HELP to speak with our staff.`;
      // AI entitlement floor — if this hospital's "AI Features" switch is off, skip the
      // AI generation and fall back to the canned reply (never a hard error: a patient is
      // waiting on WhatsApp). Gated on the whatsapp_bot_intent feature key.
      const gate = await checkAIAllowed(supabaseAdmin, hospitalId, "whatsapp_bot_intent");
      if (!gate.allowed) return canned;

      // Use the platform-configured provider/model for the whatsapp_bot_intent feature
      // (Azure/Gemini/OpenRouter/etc.) instead of a hardcoded OpenAI key. Fail-safe to the
      // canned reply on any resolution/call error — a patient is waiting on WhatsApp.
      try {
        const cfg = await resolveAiConfig(hospitalId, "whatsapp_bot_intent", 200);
        if (!cfg) return canned;
        const reply = await callAiChat(
          cfg,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Intent: unknown\nMessage: ${inboundMessage}` },
          ],
          200,
          0.3,
        );
        return reply?.trim() || canned;
      } catch (_err) {
        return canned;
      }
    }
  }
}

async function sendReply(hospitalId: string, phone: string, message: string) {
  const { data: hospital } = await supabaseAdmin
    .from("hospitals")
    .select("meta_phone_number_id, meta_access_token, whatsapp_provider")
    .eq("id", hospitalId)
    .maybeSingle();

  if (!hospital?.meta_phone_number_id || !hospital?.meta_access_token || hospital?.whatsapp_provider !== "meta_cloud") {
    console.warn(`[whatsapp-bot] Hospital ${hospitalId} not configured for Meta Cloud API`);
    return null;
  }

  const resp = await fetch(
    `https://graph.facebook.com/v18.0/${hospital.meta_phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hospital.meta_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace(/\D/g, ""),
        type: "text",
        text: { body: message.slice(0, 4096) },
      }),
    }
  );

  const result = await resp.json();
  return result?.messages?.[0]?.id || null;
}

async function resolveHospitalFromPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("hospitals")
    .select("id")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle();
  return data?.id || null;
}

serve(async (req) => {
  const url = new URL(req.url);

  // Meta webhook verification challenge
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── X-Hub-Signature-256 verification ─────────────────────────────────────
  // The GET challenge above only proves whoever REGISTERED the webhook knew the verify
  // token — it says nothing about who is POSTing to this (public) URL afterwards. Without
  // this check, anyone who finds the function URL can forge "incoming WhatsApp message"
  // payloads and trigger AI-cost-incurring bot replies / DB writes attributed to any phone
  // number. Fails CLOSED: an unconfigured app secret rejects every POST rather than skipping
  // the check, matching Meta's own webhook security requirement.
  const rawBody = await req.text();
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret) {
    console.error("[whatsapp-bot] META_APP_SECRET not set — rejecting request");
    return new Response("Webhook not configured", { status: 500 });
  }
  const signatureHeader = req.headers.get("x-hub-signature-256");
  if (!signatureHeader?.startsWith("sha256=")) {
    return new Response("Missing signature", { status: 401 });
  }
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed !== signatureHeader.slice("sha256=".length)) {
    console.error("[whatsapp-bot] Signature mismatch — possible forgery attempt");
    return new Response("Invalid signature", { status: 401 });
  }

  let body: { object?: string; entry?: MetaWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (body.object !== "whatsapp_business_account") {
    return new Response("OK", { status: 200 });
  }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value;

      for (const msg of value.messages || []) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        const fromPhone = msg.from;
        const inboundText = msg.text.body.trim();
        const phoneNumberId = value.metadata.phone_number_id;

        const hospitalId = await resolveHospitalFromPhoneNumberId(phoneNumberId);
        if (!hospitalId) {
          console.warn(`[whatsapp-bot] No hospital found for phone_number_id=${phoneNumberId}`);
          continue;
        }

        // Resolve the sender to a patient up front so the session carries it. Previously
        // getOrCreateSession was always called without a patientId, so patient_id stayed
        // null on every session row and nothing downstream could scope to a patient.
        // A null result is fine — it just means the bot answers only non-PHI intents.
        const matchedPatientId = await resolvePatientByPhone(hospitalId, fromPhone);

        const session = await getOrCreateSession(hospitalId, fromPhone, matchedPatientId || undefined);
        if (!session) continue;

        const intent = detectIntent(inboundText);

        await logMessage(session.id, hospitalId, "inbound", inboundText, intent, msg.id);

        await supabaseAdmin
          .from("whatsapp_bot_sessions")
          .update({ current_intent: intent, last_message_at: new Date().toISOString() })
          .eq("id", session.id);

        const replyText = await generateResponse(intent, inboundText, hospitalId, session);

        const outboundMsgId = await sendReply(hospitalId, fromPhone, replyText);

        await logMessage(session.id, hospitalId, "outbound", replyText, intent, outboundMsgId || undefined);
      }
    }
  }

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
