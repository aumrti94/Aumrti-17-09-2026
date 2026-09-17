// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limiter: max 5 registrations per IP per hour
const ipRateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRateMap.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// Tightened email check: single @, a dotted domain, no consecutive dots, sane length.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HAS_NUMBER_RE = /\d/;
const HAS_LETTER_RE = /[A-Za-z]/;
const PINCODE_RE = /^\d{6}$/;
const GSTIN_RE = /^[0-9A-Z]{15}$/;
// "basic" is a legacy alias the wizard used to send for the Starter plan.
const PLAN_SLUG_ALIASES: Record<string, string> = { basic: "starter" };

// Bump TERMS_VERSION whenever Terms of Service / Privacy Policy materially change,
// so each consent row records which version the admin agreed to.
const TERMS_VERSION = "2026-06-01";
const CONSENT_PURPOSE =
  "Creation and operation of the hospital's Aumrti HMS account (account setup, billing, and service delivery).";

function sanitizeHospitalName(name: string): string {
  return name.replace(/<[^>]*>/g, "").trim().slice(0, 100);
}

// Normalise an Indian mobile to bare 10 digits (drops +91 / 0 prefixes / spaces).
// Returns null if it is not a valid 10-digit Indian mobile (must start 6-9).
function normalizeIndianMobile(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Rate limiting by IP
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(
      JSON.stringify({ error: "Too many registration attempts. Please try again later." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { hospital, admin, consent, phoneOtpToken } = await req.json();

    // Validate required fields
    if (!hospital?.name || !admin?.email || !admin?.password || !admin?.full_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DPDP Act 2023 — both consents are mandatory before any data is processed.
    if (!consent?.terms_accepted || !consent?.dpdp_consent) {
      return new Response(
        JSON.stringify({ error: "Terms acceptance and DPDP consent are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Email format validation
    if (!EMAIL_RE.test(admin.email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email address format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Password strength: min 8 chars + at least one letter AND one digit
    if (
      admin.password.length < 8 ||
      !HAS_NUMBER_RE.test(admin.password) ||
      !HAS_LETTER_RE.test(admin.password)
    ) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters and include a letter and a number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Sanitize hospital name (strip HTML, enforce max length)
    hospital.name = sanitizeHospitalName(hospital.name);
    if (!hospital.name) {
      return new Response(
        JSON.stringify({ error: "Invalid hospital name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Server-side parity with the client wizard — never trust client-only gating.
    const normalizedMobile = normalizeIndianMobile(admin.phone || "");
    if (!normalizedMobile) {
      return new Response(
        JSON.stringify({ error: "A valid 10-digit Indian mobile number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    admin.phone = normalizedMobile;

    // Server-side phone-verification gate — enforced ONLY when the platform admin has
    // turned the signup OTP toggle ON (Platform → Settings). When OFF, registration
    // proceeds without any phone verification.
    const { data: platformSettings } = await supabaseAdmin
      .from("platform_settings")
      .select("signup_otp_enabled")
      .limit(1)
      .maybeSingle();
    const otpRequired = platformSettings?.signup_otp_enabled === true;

    if (otpRequired) {
      // The signup wizard must present a valid, unconsumed verification token issued by
      // verify-signup-otp for THIS phone. This makes the client-side phoneVerified flag
      // unforgeable. Fail-closed: missing/invalid/expired token blocks registration.
      if (!phoneOtpToken || typeof phoneOtpToken !== "string") {
        return new Response(
          JSON.stringify({ error: "Phone number is not verified. Please verify your mobile number first." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: otpRow } = await supabaseAdmin
        .from("signup_otp_verifications")
        .select("id, token_expires_at, token_consumed")
        .eq("verification_token", phoneOtpToken)
        .eq("phone", normalizedMobile)
        .eq("verified", true)
        .eq("token_consumed", false)
        .maybeSingle();
      if (!otpRow || (otpRow.token_expires_at && new Date(otpRow.token_expires_at).getTime() < Date.now())) {
        return new Response(
          JSON.stringify({ error: "Phone verification has expired. Please verify your mobile number again." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Consume the token so it cannot be replayed for another registration.
      await supabaseAdmin
        .from("signup_otp_verifications")
        .update({ token_consumed: true })
        .eq("id", otpRow.id);
    }

    if (hospital.pincode && !PINCODE_RE.test(String(hospital.pincode))) {
      return new Response(
        JSON.stringify({ error: "Pincode must be 6 digits" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (hospital.gstin && !GSTIN_RE.test(String(hospital.gstin).toUpperCase())) {
      return new Response(
        JSON.stringify({ error: "GSTIN must be 15 alphanumeric characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (hospital.gstin) hospital.gstin = String(hospital.gstin).toUpperCase();

    // Resolve + validate the chosen plan against the ACTIVE plans in the DB, so any plan an admin
    // creates in Plans Manager (e.g. "clinics") works without editing this function. Missing plan
    // defaults to "starter" (matches the wizard's trial default).
    const requestedSlug = (() => {
      const raw = hospital.plan || "starter";
      return PLAN_SLUG_ALIASES[raw] ?? raw;
    })();
    const { data: planRow } = await supabaseAdmin
      .from("subscription_plans")
      .select("id, trial_days")
      .eq("slug", requestedSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (!planRow) {
      return new Response(
        JSON.stringify({ error: "Unknown subscription plan" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: admin.email,
      password: admin.password,
      // Do NOT auto-confirm — the admin must verify their email before they can sign in.
      // The hospital + users rows are still created (keeps consent/attribution capture);
      // Supabase's "Confirm email" gate blocks signInWithPassword until the link is clicked.
      // The /register flow triggers the confirmation email via supabase.auth.resend().
      email_confirm: false,
    });

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // Map bed count string to number
    const bedMap: Record<string, number> = {
      "under_30": 25,
      "30_50": 40,
      "51_100": 75,
      "101_200": 150,
      "201_500": 350,
      "500_plus": 600,
    };

    // Map hospital type to enum
    const typeMap: Record<string, string> = {
      "Private Hospital": "general",
      "Government Hospital": "general",
      "Trust / NGO Hospital": "general",
      "Corporate Hospital": "general",
      "Nursing Home": "nursing_home",
      "Clinic": "clinic",
      "Specialty Center": "specialty",
      "Dental Clinic": "clinic",
      "AYUSH Center": "clinic",
      "Other": "general",
    };

    // Two distinct identifiers are intentionally in play here:
    //   1. hospitals.subscription_tier — a legacy ENUM (basic | professional | enterprise).
    //   2. subscription_plans.slug      — the real plan key (starter | professional | enterprise).
    // The UI sends the plan slug (data.plan). planMap converts slug -> tier enum for the
    // hospitals row; the actual plan row was already resolved from subscription_plans above
    // (planRow), so new plan slugs like "clinics" need no change here — they fall back to the
    // "basic" tier for this coarse legacy column.
    const planMap: Record<string, string> = {
      starter: "basic",
      professional: "professional",
      enterprise: "enterprise",
    };

    // 2. Insert hospital
    const { data: hospitalData, error: hospitalError } = await supabaseAdmin
      .from("hospitals")
      .insert({
        name: hospital.name,
        type: typeMap[hospital.type] || "general",
        hospital_category: hospital.type || null,
        state: hospital.state || null,
        beds_count: bedMap[hospital.bedCount] || 0,
        address: [hospital.address1, hospital.address2].filter(Boolean).join(", ") || null,
        city: hospital.city || null,
        pincode: hospital.pincode || null,
        gstin: hospital.gstin || null,
        nabh_number: hospital.nabhNumber || null,
        website: hospital.website || null,
        referral_code: hospital.referralCode ? String(hospital.referralCode).toUpperCase().trim().slice(0, 32) : null,
        phone: admin.phone || null,
        email: admin.email || null,
        subscription_tier: planMap[hospital.plan] || "basic",
        country: "India",
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (hospitalError || !hospitalData) {
      // Cleanup: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: hospitalError?.message ?? "Failed to create hospital record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Seed default role permissions for the new hospital — must happen
    // before the user insert below, since users.role now has a foreign key
    // into role_permissions(hospital_id, role_name).
    await supabaseAdmin.rpc("seed_default_roles_for_hospital", {
      p_hospital_id: hospitalData.id,
    });

    // 4. Insert user record
    // `users.id` has no DEFAULT in the schema — it must be generated explicitly, and must be
    // a DIFFERENT value from `auth_user_id` (public.users.id and auth.users.id are deliberately
    // separate identifiers, diverged since migration 20260322111223 — see CLAUDE.md). Omitting
    // it meant this insert has ALWAYS failed with a NOT NULL violation on `id`, for every
    // single hospital self-service signup, ever — the entire /register flow has never
    // successfully created a hospital. The surrounding rollback (delete hospital + auth user
    // on userError) correctly fired every time, so no orphaned data was ever left behind — but
    // no hospital has ever actually been created through this endpoint. Found via Phase 6
    // Priority-4 (tenant lifecycle) edge-function testing, reproduced with a real live call.
    const { error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        id: crypto.randomUUID(),
        auth_user_id: userId,
        hospital_id: hospitalData.id,
        full_name: admin.full_name,
        email: admin.email,
        phone: admin.phone || null,
        designation: admin.designation || null,
        role: "super_admin",
        is_active: true,
        can_login: true,
      });

    if (userError) {
      // Cleanup
      await supabaseAdmin.from("hospitals").delete().eq("id", hospitalData.id);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: userError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3b. Record DPDP / Terms consent for audit (non-fatal — never block signup on this).
    try {
      await supabaseAdmin.from("hospital_signup_consents").insert({
        hospital_id:    hospitalData.id,
        admin_email:    admin.email,
        terms_accepted: !!consent.terms_accepted,
        dpdp_consent:   !!consent.dpdp_consent,
        terms_version:  TERMS_VERSION,
        purpose:        CONSENT_PURPOSE,
        consent_ip:     clientIp,
      });
    } catch (e) { console.error("register-hospital: consent record insert failed:", e); }

    // 3c. Resolve referral code — non-fatal attribution + referee perk. An invalid/expired code
    //     never blocks signup (the free-text hospitals.referral_code is still saved for tracking).
    let refCode: any = null;
    if (hospital.referralCode) {
      try {
        const codeStr = String(hospital.referralCode).toUpperCase().trim();
        const { data: rc } = await supabaseAdmin
          .from("referral_codes")
          .select("id, code, owner_type, hospital_id, referee_discount_pct, referee_trial_extra_days, is_active, valid_until, max_uses, used_count")
          .ilike("code", codeStr)
          .eq("is_active", true)
          .maybeSingle();
        if (
          rc &&
          (!rc.valid_until || new Date(rc.valid_until) >= new Date()) &&
          (rc.max_uses == null || rc.used_count < rc.max_uses) &&
          !(rc.owner_type === "hospital" && rc.hospital_id === hospitalData.id) // no self-referral
        ) {
          refCode = rc;
        }
      } catch (e) { console.error("register-hospital: referral lookup failed:", e); }
    }

    // 4. Create a trial subscription row for the resolved plan (validated above).
    if (planRow) {
      // Referee perk: extra trial days from the referral code (immediate, concrete).
      const trialDays = (planRow.trial_days ?? 30) + (refCode?.referee_trial_extra_days ?? 0);
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

      const { error: subErr } = await supabaseAdmin.from("hospital_subscriptions").upsert({
        hospital_id: hospitalData.id,
        plan_id:     planRow.id,
        status:      "trial",
        trial_ends_at: trialEndsAt,
        // Persisted separately from trial_ends_at so a later plan change can rebase the
        // trial (created_at + new plan's trial_days + bonus) without dropping the perk.
        trial_bonus_days: refCode?.referee_trial_extra_days ?? 0,
        // Referee discount perk: stored so the first paid invoice/checkout can honour it.
        ...(refCode && Number(refCode.referee_discount_pct) > 0 ? {
          discount_code_applied: refCode.code,
          discount_pct:          refCode.referee_discount_pct,
        } : {}),
      }, { onConflict: "hospital_id" });
      if (subErr) console.error("register-hospital: failed to create trial subscription:", subErr);

      // Log the trial_started event
      try {
        await supabaseAdmin.from("subscription_events").insert({
          hospital_id: hospitalData.id,
          event_type:  "trial_started",
          new_status:  "trial",
          new_plan_id: planRow.id,
          metadata:    { trial_days: trialDays, trial_ends_at: trialEndsAt },
        });
      } catch (_) { /* non-fatal */ }
    }

    // 4b. Record referral attribution + redemption (non-fatal). The trial->active conversion later
    //     grants the referrer reward via the apply_referral_conversion DB trigger.
    if (refCode) {
      try {
        await supabaseAdmin.from("hospitals")
          .update({ referred_by_code_id: refCode.id })
          .eq("id", hospitalData.id);
        await supabaseAdmin.from("referral_redemptions").insert({
          code_id:              refCode.id,
          code_text:            refCode.code,
          referred_hospital_id: hospitalData.id,
          status:               "signed_up",
          referee_discount_pct: refCode.referee_discount_pct ?? 0,
        });
        await supabaseAdmin.from("referral_codes")
          .update({ used_count: (refCode.used_count ?? 0) + 1 })
          .eq("id", refCode.id);
      } catch (e) { console.error("register-hospital: referral redemption failed:", e); }
    }

    // 5a. Seed chart of accounts, posting rules, and lab catalog (defence in depth —
    //     the DB trigger also fires on INSERT, but edge fn call catches any trigger edge cases)
    try {
      await supabaseAdmin.rpc("seed_hospital_defaults", {
        p_hospital_id: hospitalData.id,
      });
    } catch (_) { /* non-fatal */ }

    // 5. Seed product_modes with null enabled_modules (resolves from plan_features at runtime)
    try {
      await supabaseAdmin.from("product_modes").upsert({
        hospital_id:     hospitalData.id,
        mode:            "hospital",
        enabled_modules: null,
      }, { onConflict: "hospital_id" });
    } catch (_) { /* non-fatal */ }

    // 6. Fire-and-forget welcome notification (non-fatal)
    supabaseAdmin.functions.invoke("send-subscription-notification", {
      body: {
        event:       "welcome",
        hospital_id: hospitalData.id,
        email:       admin.email,
        full_name:   admin.full_name,
        hospital_name: hospital.name,
        plan_name:   requestedSlug.charAt(0).toUpperCase() + requestedSlug.slice(1),
      },
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, hospitalId: hospitalData.id, userId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
