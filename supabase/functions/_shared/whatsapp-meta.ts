// Shared Meta WhatsApp Cloud API helpers — used by send-whatsapp-meta (production sends)
// and send-whatsapp-test (Settings → Integrations test message).

export type WhatsAppSendResult = {
  success: boolean;
  provider: string;
  messageId?: string | null;
  error?: string;
};

/** Normalize raw phone input to E.164. Returns null on invalid input. */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-(). ]/g, "");
  if (!/^\+?\d{10,13}$/.test(cleaned)) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (/^0\d{10}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  return null;
}

/** Strip control characters (keep printable + \n \r \t), cap at 500 chars. */
export function sanitizeMessage(raw: string): string {
  return raw
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .slice(0, 500);
}

/** Free-form session message via Meta Cloud API. Only valid within the 24h customer-service window. */
export async function sendMetaSession(
  phoneNumberId: string,
  accessToken: string,
  phone: string,
  message: string,
): Promise<WhatsAppSendResult> {
  const dest = phone.replace(/^\+/, "");
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: dest, type: "text", text: { body: message } }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    provider: "Meta Cloud API",
    messageId: (body as any)?.messages?.[0]?.id ?? null,
    error: res.ok ? "" : String((body as any)?.error?.message ?? `HTTP ${res.status}`),
  };
}

/** Pre-approved template message via Meta Cloud API — required for business-initiated sends outside the 24h window. */
export async function sendMetaTemplate(
  phoneNumberId: string,
  accessToken: string,
  phone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
): Promise<WhatsAppSendResult> {
  const dest = phone.replace(/^\+/, "");
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: dest,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
          : [],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    provider: "Meta Cloud API",
    messageId: (body as any)?.messages?.[0]?.id ?? null,
    error: res.ok ? "" : String((body as any)?.error?.message ?? `HTTP ${res.status}`),
  };
}
