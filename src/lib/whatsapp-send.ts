/**
 * WhatsApp Send Engine — WATI or direct Meta Cloud API, with wa.me fallback.
 *
 * Meta Cloud API sends are dispatched server-side via the send-whatsapp-meta edge
 * function — the access token lives only in the hospitals table and is read there
 * with the service-role key, never fetched to this client.
 *
 * Usage:
 *   import { sendWhatsApp } from "@/lib/whatsapp-send";
 *   await sendWhatsApp({ hospitalId, phone, message, notificationId });
 */

import { supabase } from "@/integrations/supabase/client";

interface SendOpts {
  hospitalId: string;
  phone: string;
  message: string;
  notificationId?: string;
}

type SendMethod = "wati" | "meta" | "wame";

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

async function markSent(notificationId?: string) {
  if (!notificationId) return;
  await supabase
    .from("whatsapp_notifications")
    .update({ sent_at: new Date().toISOString() } as any)
    .eq("id", notificationId);
}

function openWaMeFallback(phone: string, message: string): { method: "wame"; success: boolean } {
  const waUrl = `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank", "noopener,noreferrer");
  return { method: "wame", success: true };
}

/**
 * Sends a free-form session message (used for two-way reply within an existing conversation,
 * e.g. Inbox). Attempts the hospital's configured provider, falls back to a wa.me deeplink.
 */
export async function sendWhatsApp(opts: SendOpts): Promise<{ method: SendMethod; success: boolean }> {
  const cleanedPhone = cleanPhone(opts.phone);

  const { data: hospital } = await supabase
    .from("hospitals")
    .select("wati_api_url, wati_api_key, whatsapp_enabled, whatsapp_provider")
    .eq("id", opts.hospitalId)
    .maybeSingle();

  const h = hospital as any;
  const provider = h?.whatsapp_provider || "wati";

  if (h?.whatsapp_enabled && provider === "meta_cloud") {
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-meta", {
        body: { phone: cleanedPhone, type: "session", message: opts.message, notificationId: opts.notificationId },
      });
      if (!error && (data as any)?.success) {
        return { method: "meta", success: true };
      }
      console.warn("Meta session send failed, falling back to wa.me", error, data);
    } catch (err) {
      console.warn("Meta session error, falling back to wa.me", err);
    }
  } else if (h?.whatsapp_enabled && h?.wati_api_url) {
    try {
      const response = await fetch(
        `${h.wati_api_url}/api/v1/sendSessionMessage/${cleanedPhone}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(h.wati_api_key ? { "Authorization": `Bearer ${h.wati_api_key}` } : {}),
          },
          body: JSON.stringify({ messageText: opts.message }),
        }
      );

      if (response.ok) {
        await markSent(opts.notificationId);
        return { method: "wati", success: true };
      }
      console.warn("WATI send failed, falling back to wa.me", response.status);
    } catch (err) {
      console.warn("WATI error, falling back to wa.me", err);
    }
  }

  return openWaMeFallback(opts.phone, opts.message);
}

/**
 * Sends a pre-approved template message (used for business-initiated automated notifications:
 * reminders, lab results, discharge, PROM, staffing alerts). Attempts the hospital's configured
 * provider, falls back to a wa.me deeplink with a generic message if templates aren't set up.
 */
export async function sendWhatsAppTemplate(opts: {
  hospitalId: string;
  phone: string;
  watiTemplateName: string;
  metaTemplateName?: string;
  metaTemplateLang?: string;
  broadcastName: string;
  parameters: { name: string; value: string }[];
}): Promise<{ method: SendMethod; success: boolean }> {
  const cleanedPhone = cleanPhone(opts.phone);

  const { data: hospital } = await supabase
    .from("hospitals")
    .select("wati_api_url, wati_api_key, whatsapp_enabled, whatsapp_provider")
    .eq("id", opts.hospitalId)
    .maybeSingle();

  const h = hospital as any;
  const provider = h?.whatsapp_provider || "wati";

  if (h?.whatsapp_enabled && provider === "meta_cloud") {
    if (!opts.metaTemplateName) {
      console.warn(`Meta Cloud API selected but no meta_template_name configured for "${opts.broadcastName}" — falling back to wa.me`);
    } else {
      try {
        const { data, error } = await supabase.functions.invoke("send-whatsapp-meta", {
          body: {
            phone: cleanedPhone,
            type: "template",
            metaTemplateName: opts.metaTemplateName,
            languageCode: opts.metaTemplateLang || "en",
            parameters: opts.parameters,
          },
        });
        if (!error && (data as any)?.success) {
          return { method: "meta", success: true };
        }
        console.warn("Meta template send failed, falling back to wa.me", error, data);
      } catch (err) {
        console.warn("Meta template error, falling back to wa.me", err);
      }
    }
  } else if (h?.whatsapp_enabled && h?.wati_api_url) {
    try {
      const response = await fetch(
        `${h.wati_api_url}/api/v1/sendTemplateMessage/${cleanedPhone}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(h.wati_api_key ? { "Authorization": `Bearer ${h.wati_api_key}` } : {}),
          },
          body: JSON.stringify({
            template_name: opts.watiTemplateName,
            broadcast_name: opts.broadcastName,
            parameters: opts.parameters,
          }),
        }
      );

      if (response.ok) return { method: "wati", success: true };
      console.warn("WATI template send failed, falling back to wa.me", response.status);
    } catch (err) {
      console.warn("WATI template error, falling back to wa.me", err);
    }
  }

  // Fallback: construct a generic message since we can't send a templated payload via wa.me directly
  const fallbackMessage = `Hello! This is a message from the hospital regarding ${opts.broadcastName.replace(/_/g, " ")}. Please check your portal for details.`;
  return openWaMeFallback(opts.phone, fallbackMessage);
}

/**
 * Check if a hospital has auto-send enabled for a trigger event.
 * Returns the resolved template names for whichever provider is active, or false.
 */
export async function shouldAutoSend(hospitalId: string, triggerEvent: string): Promise<{
  watiTemplateName: string;
  metaTemplateName?: string;
  metaTemplateLang: string;
} | false> {
  const { data: hospital } = await supabase
    .from("hospitals")
    .select("wati_api_url, whatsapp_enabled, whatsapp_provider")
    .eq("id", hospitalId)
    .maybeSingle();

  const h = hospital as any;
  if (!h?.whatsapp_enabled) return false;
  if ((h.whatsapp_provider || "wati") === "wati" && !h.wati_api_url) return false;

  const { data: template } = await supabase
    .from("whatsapp_templates")
    .select("auto_send, is_active, wati_template_name, meta_template_name, meta_template_lang")
    .eq("hospital_id", hospitalId)
    .eq("trigger_event", triggerEvent)
    .maybeSingle();

  const t = template as any;
  if (t?.is_active && t?.auto_send) {
    return {
      watiTemplateName: t.wati_template_name || triggerEvent,
      metaTemplateName: t.meta_template_name || undefined,
      metaTemplateLang: t.meta_template_lang || "en",
    };
  }
  return false;
}
