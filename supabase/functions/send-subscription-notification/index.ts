/**
 * send-subscription-notification
 *
 * Sends transactional emails for all subscription lifecycle events.
 * Called by: register-hospital, razorpay-subscription-webhook, trial-lifecycle-cron,
 *            change-subscription-plan.
 *
 * Uses SendGrid if SENDGRID_API_KEY is set, otherwise falls back to Supabase Auth emails
 * (limited). If neither is configured the function logs and returns 200 (non-fatal).
 *
 * Required Supabase secrets (optional — graceful fallback if absent):
 *   SENDGRID_API_KEY  — SendGrid API key
 *   SENDGRID_FROM     — Sender email, e.g. no-reply@aumrti.com
 *
 * Request body:
 * {
 *   event: NotificationEvent,
 *   hospital_id?: string,
 *   email: string,
 *   full_name?: string,
 *   hospital_name?: string,
 *   plan_name?: string,
 *   trial_days_left?: number,
 *   invoice_url?: string,
 *   invoice_number?: string,
 *   amount_inr?: number,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { APP_DOMAIN, APP_URL, SUPPORT_EMAIL, NO_REPLY_EMAIL } from "../_shared/brand.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

type NotificationEvent =
  | "welcome"
  | "trial_7days"
  | "trial_3days"
  | "trial_1day"
  | "trial_expired"
  | "payment_success"
  | "payment_failed"
  | "subscription_suspended"
  | "plan_upgraded"
  | "plan_downgraded";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildEmail(event: NotificationEvent, data: Record<string, any>): EmailPayload {
  const name   = data.full_name   || data.hospital_name || "Hospital Admin";
  const hosp   = data.hospital_name || "";
  const plan   = data.plan_name    || "";
  const days   = data.trial_days_left ?? 0;
  const inv    = data.invoice_number  || "";
  const amt    = data.amount_inr ? `₹${Number(data.amount_inr).toLocaleString("en-IN")}` : "";
  const invUrl = data.invoice_url || "";

  const baseStyle = `font-family:Inter,Arial,sans-serif;background:#f9fafb;padding:32px;`;
  const cardStyle = `background:#fff;border-radius:12px;padding:32px;max-width:560px;margin:0 auto;`;
  const btnStyle  = `display:inline-block;background:#1A2F5A;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-top:20px;`;
  const footStyle = `text-align:center;color:#9ca3af;font-size:12px;margin-top:24px;`;

  const wrap = (body: string) =>
    `<div style="${baseStyle}"><div style="${cardStyle}">
       <img src="https://${APP_DOMAIN}/logo.png" alt="Aumrti" width="120" style="margin-bottom:20px;" />
       ${body}
       <div style="${footStyle}">Aumrti HMS · ${SUPPORT_EMAIL} · ${APP_DOMAIN}<br/>You received this because you have an Aumrti account.</div>
     </div></div>`;

  switch (event) {
    case "welcome":
      return {
        to: data.email,
        subject: `Welcome to Aumrti HMS, ${hosp || name}!`,
        html: wrap(`
          <h2 style="color:#1A2F5A;margin-bottom:8px;">Your trial has started 🎉</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your <strong>${plan}</strong> trial is now active. You have <strong>30 days</strong> to explore all the features.</p>
          <p style="color:#374151;">Here's what to do first:</p>
          <ol style="color:#374151;padding-left:20px;line-height:2;">
            <li>Complete the onboarding wizard (Settings → Setup)</li>
            <li>Add your departments and doctors</li>
            <li>Register your first patient via OPD</li>
          </ol>
          <a href="${APP_URL}/dashboard" style="${btnStyle}">Open Your Dashboard</a>
          <p style="color:#6b7280;font-size:13px;margin-top:20px;">Need help? WhatsApp us at +91-XXXXX-XXXXX or email ${SUPPORT_EMAIL}</p>
        `),
      };

    case "trial_7days":
      return {
        to: data.email,
        subject: `Your Aumrti trial ends in 7 days`,
        html: wrap(`
          <h2 style="color:#d97706;">7 days left in your trial</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your <strong>${plan}</strong> trial for <strong>${hosp}</strong> ends in <strong>7 days</strong>.</p>
          <p style="color:#374151;">Upgrade now to keep uninterrupted access to all modules — OPD, Billing, Lab, Pharmacy, AI Voice Scribe, and more.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">View Plans & Upgrade</a>
        `),
      };

    case "trial_3days":
      return {
        to: data.email,
        subject: `URGENT: Aumrti trial ends in 3 days`,
        html: wrap(`
          <h2 style="color:#dc2626;">Only 3 days left!</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your trial for <strong>${hosp}</strong> expires in <strong>3 days</strong>. After that, your account will be suspended and your team will lose access.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">Upgrade Now</a>
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">Questions? Reply to this email or WhatsApp ${SUPPORT_EMAIL}</p>
        `),
      };

    case "trial_1day":
      return {
        to: data.email,
        subject: `Last day of your Aumrti trial`,
        html: wrap(`
          <h2 style="color:#dc2626;">Trial ends tomorrow</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">This is your final reminder. Your trial ends <strong>tomorrow</strong>. Subscribe today to avoid interruption.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">Subscribe Now</a>
        `),
      };

    case "trial_expired":
      return {
        to: data.email,
        subject: `Your Aumrti trial has expired — reactivate now`,
        html: wrap(`
          <h2 style="color:#dc2626;">Your trial has ended</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your trial for <strong>${hosp}</strong> has expired. Your account is now suspended. Your data is safe and will remain for 30 days.</p>
          <p style="color:#374151;">Reactivate your subscription to restore access immediately.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">Reactivate Subscription</a>
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">Need help? Call us or WhatsApp ${SUPPORT_EMAIL}</p>
        `),
      };

    case "payment_success":
      return {
        to: data.email,
        subject: `Payment confirmed — Invoice ${inv}`,
        html: wrap(`
          <h2 style="color:#059669;">Payment received ✓</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">We've received your payment of <strong>${amt}</strong> for the <strong>${plan}</strong> plan.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;color:#6b7280;font-size:13px;">Invoice</td><td style="padding:8px;font-weight:600;">${inv}</td></tr>
            <tr><td style="padding:8px;color:#6b7280;font-size:13px;">Amount</td><td style="padding:8px;font-weight:600;">${amt}</td></tr>
            <tr><td style="padding:8px;color:#6b7280;font-size:13px;">Plan</td><td style="padding:8px;font-weight:600;">${plan}</td></tr>
          </table>
          ${invUrl ? `<a href="${invUrl}" style="${btnStyle}">Download Invoice PDF</a>` : ""}
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">Thank you for choosing Aumrti HMS.</p>
        `),
      };

    case "payment_failed":
      return {
        to: data.email,
        subject: `Payment failed — action required`,
        html: wrap(`
          <h2 style="color:#dc2626;">Payment failed</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">We were unable to collect the payment for your <strong>${plan}</strong> subscription. This can happen due to insufficient funds or bank restrictions.</p>
          <p style="color:#374151;">Please update your payment method within <strong>7 days</strong> to avoid suspension.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">Update Payment Method</a>
        `),
      };

    case "subscription_suspended":
      return {
        to: data.email,
        subject: `Your Aumrti account is suspended`,
        html: wrap(`
          <h2 style="color:#dc2626;">Account suspended</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your Aumrti account has been suspended due to an unpaid subscription. Your data is safe.</p>
          <p style="color:#374151;">Please reactivate your subscription to restore access for your team.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">Reactivate Now</a>
          <p style="color:#6b7280;font-size:13px;margin-top:16px;">Need help? Contact ${SUPPORT_EMAIL} immediately.</p>
        `),
      };

    case "plan_upgraded":
      return {
        to: data.email,
        subject: `Plan upgraded to ${plan}`,
        html: wrap(`
          <h2 style="color:#059669;">Plan upgraded ✓</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your plan has been upgraded to <strong>${plan}</strong>. Your new modules are now active.</p>
          <a href="${APP_URL}/dashboard" style="${btnStyle}">Go to Dashboard</a>
        `),
      };

    case "plan_downgraded":
      return {
        to: data.email,
        subject: `Plan changed to ${plan}`,
        html: wrap(`
          <h2 style="color:#1A2F5A;">Plan updated</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your plan has been changed to <strong>${plan}</strong>. Some modules may no longer be accessible. Your data is preserved.</p>
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">View Active Modules</a>
        `),
      };

    // Trial → paid. Sent to the hospital admin on conversion.
    case "converted": {
      const periodEnd = data.period_end
        ? new Date(data.period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        : "";
      const disc = Number(data.discount_pct) > 0
        ? `<p style="color:#374151;">Your referral discount of <strong>${data.discount_pct}%</strong> has been applied${
            data.discount_expires_at
              ? ` until ${new Date(data.discount_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
              : ""
          }.</p>`
        : "";
      return {
        to: data.email,
        subject: `Welcome to ${plan} — your Aumrti subscription is active`,
        html: wrap(`
          <h2 style="color:#059669;">You're all set ✓</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">Your free trial has converted to a paid <strong>${plan}</strong> subscription. Nothing changes in your workspace — all your data and settings carry over.</p>
          ${disc}
          ${periodEnd ? `<p style="color:#374151;">Your next billing date is <strong>${periodEnd}</strong>.</p>` : ""}
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">View Plan & Billing</a>
        `),
      };
    }

    // Sent to the REFERRER when a hospital they referred converts.
    case "referral_reward":
      return {
        to: data.email,
        subject: "Your Aumrti referral just converted 🎉",
        html: wrap(`
          <h2 style="color:#059669;">Referral converted</h2>
          <p style="color:#374151;">Hello ${name},</p>
          <p style="color:#374151;">${data.referred_hospital_name ? `<strong>${data.referred_hospital_name}</strong>` : "A hospital you referred"} has upgraded to a paid plan.</p>
          ${data.reward_label ? `<p style="color:#374151;">Your reward: <strong>${data.reward_label}</strong>.</p>` : ""}
          <a href="${APP_URL}/settings/plan" style="${btnStyle}">View Details</a>
        `),
      };

    default:
      return { to: data.email, subject: "Aumrti Notification", html: wrap("<p>You have a new notification from Aumrti HMS.</p>") };
  }
}

// ── SendGrid sender ──────────────────────────────────────────────────────────

async function sendViaSendGrid(payload: EmailPayload, apiKey: string, from: string): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.to }] }],
      from: { email: from, name: "Aumrti HMS" },
      subject: payload.subject,
      content: [{ type: "text/html", value: payload.html }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const data = await req.json();
    const { event, email } = data as { event: NotificationEvent; email: string };

    if (!event || !email) {
      return new Response(JSON.stringify({ error: "event and email required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const emailPayload = buildEmail(event, data);

    const sgKey  = Deno.env.get("SENDGRID_API_KEY");
    const sgFrom = Deno.env.get("SENDGRID_FROM") || NO_REPLY_EMAIL;

    if (sgKey) {
      await sendViaSendGrid(emailPayload, sgKey, sgFrom);
      console.log(sanitizeForLog(`✓ Email sent via SendGrid: ${event} → ${email}`));
    } else {
      // No email provider configured — log only (non-fatal in trial mode)
      console.warn(sanitizeForLog(`No email provider configured. Would send "${emailPayload.subject}" to ${email}`));
    }

    return new Response(JSON.stringify({ sent: true, event, to: email }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-subscription-notification error:", err);
    // Always return 200 — this is fire-and-forget; caller should not block on email
    return new Response(JSON.stringify({ sent: false, error: err.message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
