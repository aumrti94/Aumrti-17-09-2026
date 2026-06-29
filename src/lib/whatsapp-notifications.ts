/**
 * WhatsApp Notification Engine
 * Generates wa.me links with pre-filled messages for HMS events.
 * Records notifications in whatsapp_notifications table.
 */

import { supabase } from "@/integrations/supabase/client";
import { sendWhatsAppTemplate, shouldAutoSend } from "./whatsapp-send";
import { translateText } from "./translateUtils";

export interface WhatsAppParams {
  phone: string;
  hospitalName: string;
  hospitalPhone?: string;
  hospitalAddress?: string;
}

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function makeWaUrl(phone: string, message: string): string {
  return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(message)}`;
}

async function recordNotification(opts: {
  hospitalId: string;
  patientId: string;
  type: string;
  message: string;
  phone: string;
  waUrl: string;
}) {
  await supabase.from("whatsapp_notifications").insert({
    hospital_id: opts.hospitalId,
    patient_id: opts.patientId,
    notification_type: opts.type,
    message_text: opts.message,
    phone_number: opts.phone,
    whatsapp_url: opts.waUrl,
  } as any);
}

// Portal URL for links in messages
const PORTAL_URL = window.location.origin + "/portal";

// ── Appointment Confirmation ─────────────────────────────────

export async function sendAppointmentConfirmation(opts: {
  hospitalId: string;
  hospitalName: string;
  hospitalAddress?: string;
  patientId: string;
  patientName: string;
  phone: string;
  doctorName: string;
  department?: string;
  date: string;
  time?: string;
  tokenNumber?: string;
  patientLanguage?: string;
}) {
  let msg = `🏥 *${opts.hospitalName}*

✅ *Appointment Confirmed*

Patient: ${opts.patientName}
Doctor: Dr. ${opts.doctorName}
${opts.department ? `Department: ${opts.department}` : ""}
Date: ${opts.date}
${opts.time ? `Time: ${opts.time}` : ""}
${opts.tokenNumber ? `Token: ${opts.tokenNumber}` : ""}

${opts.hospitalAddress ? `📍 ${opts.hospitalAddress}` : ""}

Reply to this message for any queries.`;

  if (opts.patientLanguage && opts.patientLanguage !== "English") {
    try {
      msg = await translateText(msg, opts.patientLanguage, opts.hospitalId, {
        context: "appointment_confirmation",
        patientId: opts.patientId,
      });
    } catch { /* send English on failure */ }
  }

  const waUrl = makeWaUrl(opts.phone, msg);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "appointment_confirmation",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Appointment Reminder ─────────────────────────────────────

export async function sendAppointmentReminder(opts: {
  hospitalId: string;
  hospitalName: string;
  hospitalPhone?: string;
  patientId: string;
  patientName: string;
  phone: string;
  doctorName: string;
  department?: string;
  date: string;
  time?: string;
  tokenNumber?: string;
  patientLanguage?: string;
}) {
  let msg = `🏥 *${opts.hospitalName}*

Hello ${opts.patientName} 👋

This is a reminder for your upcoming appointment:

📅 *Date:* ${opts.date}
${opts.time ? `🕐 *Time:* ${opts.time}` : ""}
👨‍⚕️ *Doctor:* Dr. ${opts.doctorName}
${opts.department ? `🏢 *Department:* ${opts.department}` : ""}
${opts.tokenNumber ? `🎫 *Token:* ${opts.tokenNumber}` : ""}

Please arrive 15 minutes before your scheduled time.

For queries: ${opts.hospitalPhone || "Contact hospital reception"}`;

  if (opts.patientLanguage && opts.patientLanguage !== "English") {
    try {
      msg = await translateText(msg, opts.patientLanguage, opts.hospitalId, {
        context: "appointment_reminder",
        patientId: opts.patientId,
      });
    } catch { /* send English on failure */ }
  }

  const waUrl = makeWaUrl(opts.phone, msg);

  const tpl = await shouldAutoSend(opts.hospitalId, "appointment_reminder");
  if (tpl) {
    await sendWhatsAppTemplate({
      hospitalId: opts.hospitalId,
      phone: opts.phone,
      watiTemplateName: tpl.watiTemplateName,
      metaTemplateName: tpl.metaTemplateName,
      metaTemplateLang: tpl.metaTemplateLang,
      broadcastName: "Appointment Reminder",
      parameters: [
        { name: "patient_name", value: opts.patientName },
        { name: "date", value: opts.date },
        { name: "time", value: opts.time || "your scheduled time" },
        { name: "doctor_name", value: opts.doctorName }
      ]
    });
  }

  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "appointment_reminder",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Lab Result Ready ─────────────────────────────────────────

export async function sendLabResultReady(opts: {
  hospitalId: string;
  hospitalName: string;
  hospitalPhone?: string;
  patientId: string;
  patientName: string;
  phone: string;
  testCount: number;
  abnormalCount: number;
  orderDate: string;
}) {
  const msg = `🏥 *${opts.hospitalName} — Lab Report Ready*

Dear ${opts.patientName},

Your lab results are ready.

📋 *Tests:* ${opts.testCount} test(s)
${opts.abnormalCount > 0 ? `⚠️ ${opts.abnormalCount} value(s) need attention` : "✅ All values normal"}

📅 Date: ${opts.orderDate}

🔗 View & Download: ${PORTAL_URL}

Please consult your doctor for interpretation.

For queries: ${opts.hospitalPhone || "Contact hospital lab"}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  
  const tpl = await shouldAutoSend(opts.hospitalId, "lab_result_ready");
  if (tpl) {
    await sendWhatsAppTemplate({
      hospitalId: opts.hospitalId,
      phone: opts.phone,
      watiTemplateName: tpl.watiTemplateName,
      metaTemplateName: tpl.metaTemplateName,
      metaTemplateLang: tpl.metaTemplateLang,
      broadcastName: "Lab Result",
      parameters: [
        { name: "patient_name", value: opts.patientName },
        { name: "test_count", value: String(opts.testCount) },
        { name: "portal_url", value: PORTAL_URL }
      ]
    });
  }

  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "lab_result_ready",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Bill Generated ───────────────────────────────────────────

export async function sendBillGenerated(opts: {
  hospitalId: string;
  hospitalName: string;
  hospitalPhone?: string;
  patientId: string;
  patientName: string;
  phone: string;
  billNumber: string;
  billDate: string;
  totalAmount: number;
  insuranceAmount?: number;
  patientPayable: number;
}) {
  const msg = `🏥 *${opts.hospitalName}*

🧾 *Bill Generated*

Patient: ${opts.patientName}
Bill No: ${opts.billNumber}
Date: ${opts.billDate}

💰 *Total Amount: ₹${opts.totalAmount.toLocaleString("en-IN")}*
${opts.insuranceAmount && opts.insuranceAmount > 0 ? `🏥 Insurance covers: ₹${opts.insuranceAmount.toLocaleString("en-IN")}` : ""}
💳 *Patient Payable: ₹${opts.patientPayable.toLocaleString("en-IN")}*

Pay online: ${PORTAL_URL}/bills

Or visit billing counter.

For queries: ${opts.hospitalPhone || "Contact billing counter"}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "bill_generated",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Payment Received ─────────────────────────────────────────

export async function sendPaymentReceived(opts: {
  hospitalId: string;
  hospitalName: string;
  patientId: string;
  patientName: string;
  phone: string;
  billNumber: string;
  amountPaid: number;
  paymentMode: string;
  balanceDue: number;
}) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const msg = `🏥 *${opts.hospitalName}*

✅ *Payment Received*

Patient: ${opts.patientName}
Bill No: ${opts.billNumber}
Amount Paid: ₹${opts.amountPaid.toLocaleString("en-IN")}
Mode: ${opts.paymentMode.toUpperCase()}
Date: ${dateStr} ${timeStr}

${opts.balanceDue > 0 ? `⚠️ Balance remaining: ₹${opts.balanceDue.toLocaleString("en-IN")}` : "✅ Bill fully paid"}

Thank you! 🙏
${opts.hospitalName}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "payment_received",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Discharge Summary ────────────────────────────────────────

export async function sendDischargeSummaryNotif(opts: {
  hospitalId: string;
  hospitalName: string;
  hospitalPhone?: string;
  patientId: string;
  patientName: string;
  phone: string;
  admittedAt: string;
  wardName: string;
  doctorName: string;
  followUp?: string;
}) {
  const now = new Date();
  const msg = `🏥 *${opts.hospitalName}*

🏠 *Discharge Summary Ready*

Dear ${opts.patientName},

You have been discharged successfully.

📅 Admitted: ${opts.admittedAt}
📅 Discharged: ${now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
🏥 Ward: ${opts.wardName}
👨‍⚕️ Doctor: Dr. ${opts.doctorName}

📋 Follow-up: ${opts.followUp || "As advised by doctor"}

🔗 Download summary: ${PORTAL_URL}/timeline

Take your medications as prescribed.
Get well soon! 💪

For emergencies: ${opts.hospitalPhone || "Contact hospital"}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  
  const tpl = await shouldAutoSend(opts.hospitalId, "discharge_summary");
  if (tpl) {
    await sendWhatsAppTemplate({
      hospitalId: opts.hospitalId,
      phone: opts.phone,
      watiTemplateName: tpl.watiTemplateName,
      metaTemplateName: tpl.metaTemplateName,
      metaTemplateLang: tpl.metaTemplateLang,
      broadcastName: "Discharge Summary",
      parameters: [
        { name: "patient_name", value: opts.patientName },
        { name: "hospital_name", value: opts.hospitalName },
        { name: "portal_url", value: PORTAL_URL }
      ]
    });
  }

  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "discharge_summary",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Prescription Ready ───────────────────────────────────────

export async function sendPrescriptionReady(opts: {
  hospitalId: string;
  hospitalName: string;
  patientId: string;
  patientName: string;
  phone: string;
  doctorName: string;
  drugCount: number;
}) {
  const msg = `🏥 *${opts.hospitalName}*

💊 *Prescription Ready*

Dear ${opts.patientName},

Dr. ${opts.doctorName} has issued a prescription with ${opts.drugCount} medication(s).

🔗 View & download: ${PORTAL_URL}/prescriptions

Please take your medications as prescribed.`;

  const waUrl = makeWaUrl(opts.phone, msg);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "prescription_ready",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Feedback Request ─────────────────────────────────────────

export async function sendFeedbackRequest(opts: {
  hospitalId: string;
  hospitalName: string;
  patientId: string;
  patientName: string;
  phone: string;
}) {
  const msg = `🏥 *${opts.hospitalName}*

Dear ${opts.patientName},

We hope you are doing well! 🙏

We'd love to hear about your experience at ${opts.hospitalName}.

⭐ Share your feedback: ${PORTAL_URL}/feedback

Your feedback helps us improve care for everyone.

Thank you!
${opts.hospitalName}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "feedback_request",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── PROM/PREM Survey (F6: PRE.7.b NABH) ─────────────────────

export async function sendPROMSurvey(opts: {
  hospitalId: string;
  patientId: string;
  patientName: string;
  phone: string;
  surveyToken: string;
  hospitalName: string;
}) {
  const link = `${window.location.origin}/prom/${opts.surveyToken}`;
  const msg = `🏥 *${opts.hospitalName}*

Dear ${opts.patientName},

We hope you are recovering well! 🙏

Your feedback on your recent hospital stay helps us improve care for everyone.

⏱️ Takes just 2 minutes.
📋 Share your experience: ${link}

Thank you for your time!
${opts.hospitalName}`;

  const waUrl = makeWaUrl(opts.phone, msg);
  const tpl = await shouldAutoSend(opts.hospitalId, "prom_survey");
  if (tpl) {
    await sendWhatsAppTemplate({
      hospitalId: opts.hospitalId,
      phone: opts.phone,
      watiTemplateName: tpl.watiTemplateName,
      metaTemplateName: tpl.metaTemplateName,
      metaTemplateLang: tpl.metaTemplateLang,
      broadcastName: "PROM Survey",
      parameters: [
        { name: "patient_name", value: opts.patientName },
        { name: "survey_link", value: link },
      ],
    });
  }
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "prom_survey",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Staffing Alert (F4: COP.6.c NABH) ───────────────────────

export async function sendStaffingAlert(opts: {
  hospitalId: string;
  patientId?: string;
  phone: string;
  wardName: string;
  required: number;
  onDuty: number;
  hospitalName?: string;
}) {
  const msg = `⚠️ STAFFING ALERT — ${opts.wardName}

Required nurses: ${opts.required}
Currently on duty: ${opts.onDuty}

Acuity-based ratio breach detected. Immediate staffing review required.

— Aumrti HMS (${opts.hospitalName || "Hospital"})`;

  const waUrl = makeWaUrl(opts.phone, msg);
  const tpl = await shouldAutoSend(opts.hospitalId, "staffing_alert");
  if (tpl) {
    await sendWhatsAppTemplate({
      hospitalId: opts.hospitalId,
      phone: opts.phone,
      watiTemplateName: tpl.watiTemplateName,
      metaTemplateName: tpl.metaTemplateName,
      metaTemplateLang: tpl.metaTemplateLang,
      broadcastName: "Staffing Alert",
      parameters: [
        { name: "ward_name", value: opts.wardName },
        { name: "required", value: String(opts.required) },
        { name: "on_duty", value: String(opts.onDuty) },
      ],
    });
  }
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId || "",
    type: "staffing_alert",
    message: msg,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl, message: msg };
}

// ── Generic custom ───────────────────────────────────────────

export function openWhatsApp(phone: string, message: string) {
  const url = makeWaUrl(phone, message);
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function sendCustomWhatsApp(opts: {
  hospitalId: string;
  patientId: string;
  phone: string;
  message: string;
}) {
  const waUrl = makeWaUrl(opts.phone, opts.message);
  await recordNotification({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    type: "custom",
    message: opts.message,
    phone: opts.phone,
    waUrl,
  });
  return { waUrl };
}
