// @ts-nocheck
// verify-signup-otp — Verifies the signup OTP server-side and issues a single-use
// verification token. The token is later validated by register-hospital so the
// phone-verified gate cannot be forged from the browser.
//
// Matches against the most recent unexpired, unverified code for the phone. After 5
// failed attempts the code is locked and the user must request a new one.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeIndianMobile(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_ATTEMPTS = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { phone, code } = await req.json();
    const phone10 = normalizeIndianMobile(phone || "");
    if (!phone10) return json({ error: "Invalid phone number." }, 400);
    if (!/^\d{6}$/.test(String(code || ""))) return json({ error: "Enter the 6-digit code." }, 400);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Most recent code for this phone that is not yet verified.
    const { data: row } = await svc
      .from("signup_otp_verifications")
      .select("id, otp_hash, attempts, expires_at, verified")
      .eq("phone", phone10)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return json({ error: "No active code found. Please request a new one." }, 400);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: "This code has expired. Please request a new one." }, 400);
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return json({ error: "Too many incorrect attempts. Please request a new code." }, 429);
    }

    const incomingHash = await sha256(String(code));
    if (incomingHash !== row.otp_hash) {
      await svc
        .from("signup_otp_verifications")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id);
      const remaining = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
      return json({ error: `Incorrect code.${remaining ? ` ${remaining} attempts left.` : " Please request a new code."}` }, 400);
    }

    // Success — issue a single-use token valid for 15 minutes.
    const token = crypto.randomUUID();
    const { error: updErr } = await svc
      .from("signup_otp_verifications")
      .update({
        verified: true,
        verification_token: token,
        token_consumed: false,
        token_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .eq("id", row.id);
    if (updErr) {
      console.error("verify-signup-otp: update failed", updErr);
      return json({ error: "Verification failed. Please try again." }, 500);
    }

    return json({ success: true, verificationToken: token });
  } catch (err) {
    console.error("verify-signup-otp error:", err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});
