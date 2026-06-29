/**
 * Patient portal login using Supabase Auth email OTP.
 * Requires "Enable email OTP" to be ON in the Supabase Auth dashboard
 * (Authentication → Providers → Email → "OTP" mode).
 *
 * Flow:
 *  1. Email entry  → signInWithOtp()
 *  2. OTP verify   → verifyOtp()
 *  3a. 1 match     → activate + redirect
 *  3b. >1 matches  → SelectProfile screen
 *  3c. 0 matches   → CreateProfile form → insert patient → activate
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, UserPlus, Users, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  usePatientPortal,
  PatientSummary,
  PortalHospital,
} from "@/contexts/PatientPortalContext";

interface Props {
  hospitalId: string | null;
}

type Step = "email" | "otp" | "select" | "create";

const TEAL = "#0E7B7B";
const TEAL_LIGHT = "#EEF9F9";
const BORDER = "#E2E8F0";

// ── helpers ──────────────────────────────────────────────────────────────────

function calcAge(dob: string | null): number | null {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function genUhid() {
  return `PAT-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ── sub-components ───────────────────────────────────────────────────────────

const TealBtn: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full font-bold text-[15px] text-white rounded-xl disabled:opacity-40 active:scale-[0.97] transition-transform"
    style={{ height: 52, background: TEAL }}
  >
    {children}
  </button>
);

const ErrorBox: React.FC<{ msg: string }> = ({ msg }) =>
  msg ? (
    <p
      className="text-[12px] px-3 py-2 rounded-lg"
      style={{ color: "#DC2626", background: "#FEF2F2" }}
    >
      {msg}
    </p>
  ) : null;

const BackBtn: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 text-[13px] w-full text-center justify-center mt-1"
    style={{ color: "#64748B" }}
  >
    <ArrowLeft size={13} /> {label}
  </button>
);

// ── main component ────────────────────────────────────────────────────────────

const PatientPortalLogin: React.FC<Props> = ({ hospitalId }) => {
  const navigate = useNavigate();
  const { activate } = usePatientPortal();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(true); // true initially for session check
  const [error, setError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [foundPatients, setFoundPatients] = useState<any[]>([]);
  const [hospitalBrand, setHospitalBrand] = useState<{ name: string; logo_url: string | null }>({
    name: "Hospital",
    logo_url: null,
  });

  // Create-profile form
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formDob, setFormDob] = useState("");
  const [formGender, setFormGender] = useState("");

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load hospital branding
  useEffect(() => {
    if (!hospitalId) return;
    supabase
      .from("hospitals")
      .select("name, logo_url")
      .eq("id", hospitalId)
      .maybeSingle()
      .then(({ data }) => { if (data) setHospitalBrand(data); });
  }, [hospitalId]);

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  // ── session check on mount ──────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        // Already authenticated — skip email/OTP and go straight to patient lookup
        setEmail(session.user.email);
        findPatients(session.user.email, session.user.phone ?? null);
      } else {
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── fetchHospital + activate ────────────────────────────────────────────
  const completeLogin = useCallback(
    async (p: any) => {
      setLoading(true);
      const { data: hosp } = await supabase
        .from("hospitals")
        .select("id, name, logo_url")
        .eq("id", p.hospital_id)
        .maybeSingle();

      const patient: PatientSummary = {
        id: p.id,
        fullName: p.full_name,
        uhid: p.uhid,
        phone: p.phone ?? null,
        email: p.email ?? null,
        dob: p.dob ?? null,
        gender: p.gender ?? null,
        bloodGroup: p.blood_group ?? null,
        hospitalId: p.hospital_id,
      };

      const hospital: PortalHospital = {
        id: hosp?.id ?? p.hospital_id,
        name: hosp?.name ?? "Hospital",
        logoUrl: hosp?.logo_url ?? null,
      };

      activate(patient, hospital);
      navigate("/portal/dashboard", { replace: true });
    },
    [activate, navigate]
  );

  // ── patient lookup ──────────────────────────────────────────────────────
  const findPatients = useCallback(
    async (authEmail: string, authPhone: string | null) => {
      setLoading(true);
      setError("");

      let query = (supabase as any)
        .from("patients")
        .select("id, full_name, uhid, phone, email, dob, gender, blood_group, hospital_id");

      if (hospitalId) query = query.eq("hospital_id", hospitalId);

      const last10 = authPhone?.replace(/\D/g, "").slice(-10) ?? null;
      if (last10) {
        query = query.or(`email.eq.${authEmail},phone.ilike.%${last10}`);
      } else {
        query = query.ilike("email", authEmail);
      }

      const { data: patients, error: qErr } = await query.limit(10);

      if (qErr) {
        setError(qErr.message);
        setLoading(false);
        return;
      }

      if (!patients || patients.length === 0) {
        setLoading(false);
        setStep("create");
        return;
      }

      if (patients.length === 1) {
        // Back-fill email on the patient record if missing
        if (!patients[0].email) {
          await (supabase as any)
            .from("patients")
            .update({ email: authEmail })
            .eq("id", patients[0].id);
          patients[0].email = authEmail;
        }
        await completeLogin(patients[0]);
        return;
      }

      setFoundPatients(patients);
      setLoading(false);
      setStep("select");
    },
    [hospitalId, completeLogin]
  );

  // ── step 1: send OTP ────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@") || !e.includes(".")) {
      setError("Enter a valid email address");
      return;
    }
    setLoading(true);
    setError("");

    const { error: authErr } = await supabase.auth.signInWithOtp({
      email: e,
      options: { shouldCreateUser: true },
    });

    if (authErr) {
      setError(authErr.message);
      setLoading(false);
      return;
    }

    setEmail(e);
    setStep("otp");
    setOtp(["", "", "", "", "", ""]);
    setResendTimer(30);
    setLoading(false);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  };

  // ── step 2: verify OTP ──────────────────────────────────────────────────
  const handleVerifyOtp = async (code: string) => {
    setLoading(true);
    setError("");

    const { data, error: vErr } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    if (vErr || !data.user) {
      setError("Invalid or expired code. Try again.");
      const el = document.getElementById("ppl-otp");
      el?.classList.add("animate-shake");
      setTimeout(() => el?.classList.remove("animate-shake"), 500);
      setLoading(false);
      return;
    }

    await findPatients(data.user.email!, data.user.phone ?? null);
  };

  // OTP box helpers
  const handleOtpChange = (i: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[i] = value.slice(-1);
    setOtp(next);
    if (value && i < 5) otpRefs.current[i + 1]?.focus();
    if (next.every(Boolean)) handleVerifyOtp(next.join(""));
  };

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };

  // ── step 4: create patient profile ─────────────────────────────────────
  const handleCreateProfile = async () => {
    if (!formName.trim()) { setError("Full name is required"); return; }
    if (!hospitalId) { setError("No hospital ID in URL — append ?h=<hospital_id>"); return; }
    setLoading(true);
    setError("");

    const { data: newPt, error: insErr } = await (supabase as any)
      .from("patients")
      .insert({
        hospital_id: hospitalId,
        full_name: formName.trim(),
        email: email || null,
        phone: formPhone.replace(/\D/g, "").slice(-10) || null,
        dob: formDob || null,
        gender: formGender || null,
        uhid: genUhid(),
      })
      .select()
      .maybeSingle();

    if (insErr || !newPt) {
      setError(insErr?.message ?? "Could not create profile. Please try again.");
      setLoading(false);
      return;
    }

    await completeLogin(newPt);
  };

  // ── shared header UI ────────────────────────────────────────────────────
  const header = (
    <div
      className="w-full flex flex-col items-center pt-14 pb-8"
      style={{ background: "linear-gradient(180deg, #0E7B7B 0%, #0A6363 100%)" }}
    >
      {hospitalBrand.logo_url ? (
        <img
          src={hospitalBrand.logo_url}
          alt=""
          className="h-20 w-20 rounded-2xl object-contain bg-white/10 p-2 mb-3"
        />
      ) : (
        <div className="h-20 w-20 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
          </svg>
        </div>
      )}
      <h1 className="text-xl font-bold text-white">{hospitalBrand.name}</h1>
      <p className="text-sm text-white/60 mt-1">Patient Portal</p>
    </div>
  );

  const card = (title: string, subtitle: string, content: React.ReactNode) => (
    <div className="w-full max-w-[400px] px-5 -mt-4 pb-10 mx-auto">
      <div className="bg-white rounded-2xl p-7 shadow-lg" style={{ border: `1px solid ${BORDER}` }}>
        <h2 className="text-[17px] font-bold text-center" style={{ color: "#0F172A" }}>{title}</h2>
        <p className="text-[13px] text-center mt-1" style={{ color: "#64748B" }}>{subtitle}</p>
        {content}
      </div>
    </div>
  );

  // ── loading spinner (initial session check) ─────────────────────────────
  if (loading && step === "email") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <div
          className="w-8 h-8 border-[3px] rounded-full animate-spin"
          style={{ borderColor: BORDER, borderTopColor: TEAL }}
        />
      </div>
    );
  }

  // ── step renders ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center" style={{ background: "#F8FAFC" }}>
      {header}

      {/* ── Email entry ───────────────────────────────────────────────── */}
      {step === "email" &&
        card(
          "Login to Your Health Records",
          "We'll send a verification code to your email",
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                Email Address
              </label>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                placeholder="you@example.com"
                autoComplete="email"
                className="mt-1.5 w-full px-4 text-base outline-none rounded-[10px]"
                style={{
                  height: 52,
                  border: `1.5px solid ${BORDER}`,
                  color: "#0F172A",
                  background: "#FAFAFA",
                }}
              />
            </div>
            <ErrorBox msg={error} />
            <TealBtn onClick={handleSendOtp} disabled={loading || !email.includes("@")}>
              {loading ? "Sending…" : "Send Verification Code"}
            </TealBtn>
          </div>
        )}

      {/* ── OTP entry ────────────────────────────────────────────────── */}
      {step === "otp" &&
        card(
          "Check Your Email",
          `Enter the 6-digit code sent to ${email}`,
          <div className="mt-6 space-y-4">
            <div id="ppl-otp" className="flex justify-center gap-2">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  disabled={loading}
                  className="text-center text-2xl font-bold outline-none transition-colors"
                  style={{
                    width: 44,
                    height: 52,
                    borderRadius: 10,
                    border: `2px solid ${digit ? TEAL : BORDER}`,
                    background: digit ? TEAL_LIGHT : "#FFFFFF",
                    color: "#0F172A",
                  }}
                />
              ))}
            </div>

            {loading && (
              <p className="text-[13px] text-center" style={{ color: "#94A3B8" }}>
                Verifying…
              </p>
            )}
            <ErrorBox msg={error} />

            <div className="text-center">
              {resendTimer > 0 ? (
                <p className="text-[13px]" style={{ color: "#94A3B8" }}>Resend in {resendTimer}s</p>
              ) : (
                <button
                  onClick={() => { setStep("email"); setOtp(["", "", "", "", "", ""]); setError(""); }}
                  className="text-[13px] font-semibold"
                  style={{ color: TEAL }}
                >
                  Resend code
                </button>
              )}
            </div>
            <BackBtn onClick={() => { setStep("email"); setError(""); }} label="Change email address" />
          </div>
        )}

      {/* ── Select profile ────────────────────────────────────────────── */}
      {step === "select" &&
        card(
          "Select Your Profile",
          "Multiple records are linked to this account",
          <div className="mt-5 space-y-2.5">
            <div className="flex items-center gap-2 mb-1" style={{ color: "#64748B" }}>
              <Users size={14} />
              <span className="text-xs font-medium">{foundPatients.length} profiles found</span>
            </div>

            {foundPatients.map((p) => {
              const age = calcAge(p.dob);
              return (
                <button
                  key={p.id}
                  onClick={() => completeLogin(p)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] transition-transform disabled:opacity-50"
                  style={{ border: `1.5px solid ${BORDER}`, background: "#FAFAFA" }}
                >
                  <div
                    className="flex items-center justify-center rounded-full text-white text-sm font-bold shrink-0"
                    style={{ width: 40, height: 40, background: TEAL }}
                  >
                    {initials(p.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold truncate" style={{ color: "#0F172A" }}>
                      {p.full_name}
                    </p>
                    <p className="text-[11px]" style={{ color: "#64748B" }}>
                      UHID: {p.uhid}
                      {age !== null ? ` · ${age} yrs` : ""}
                      {p.gender ? ` · ${p.gender}` : ""}
                    </p>
                  </div>
                  <ChevronRight size={16} color="#94A3B8" />
                </button>
              );
            })}

            {loading && (
              <p className="text-[13px] text-center" style={{ color: "#94A3B8" }}>Logging in…</p>
            )}
            <ErrorBox msg={error} />
          </div>
        )}

      {/* ── Create profile ────────────────────────────────────────────── */}
      {step === "create" &&
        card(
          "Create Your Profile",
          "No existing record found — let's set up your profile",
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
              <UserPlus size={14} style={{ color: "#16A34A" }} />
              <span className="text-[12px]" style={{ color: "#15803D" }}>
                Logged in as <strong>{email}</strong>
              </span>
            </div>

            {/* Full name */}
            <div>
              <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                Full Name <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="As on your ID"
                className="mt-1.5 w-full px-4 text-[14px] outline-none rounded-[10px]"
                style={{ height: 46, border: `1.5px solid ${BORDER}`, color: "#0F172A", background: "#FAFAFA" }}
              />
            </div>

            {/* Gender */}
            <div>
              <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>Gender</label>
              <div className="mt-1.5 flex gap-2">
                {["Male", "Female", "Other"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFormGender(g.toLowerCase())}
                    className="flex-1 h-10 rounded-lg text-[13px] font-medium transition-colors"
                    style={{
                      border: `1.5px solid ${formGender === g.toLowerCase() ? TEAL : BORDER}`,
                      background: formGender === g.toLowerCase() ? TEAL_LIGHT : "#FAFAFA",
                      color: formGender === g.toLowerCase() ? TEAL : "#64748B",
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Date of birth */}
            <div>
              <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>Date of Birth</label>
              <input
                type="date"
                value={formDob}
                onChange={(e) => setFormDob(e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                className="mt-1.5 w-full px-4 text-[14px] outline-none rounded-[10px]"
                style={{ height: 46, border: `1.5px solid ${BORDER}`, color: "#0F172A", background: "#FAFAFA" }}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
                Mobile Number <span className="font-normal" style={{ color: "#94A3B8" }}>(optional)</span>
              </label>
              <div
                className="mt-1.5 flex items-center overflow-hidden"
                style={{ border: `1.5px solid ${BORDER}`, borderRadius: 10, height: 46 }}
              >
                <span
                  className="px-3 flex items-center h-full text-[13px] font-medium shrink-0"
                  style={{ background: "#F1F5F9", borderRight: `1px solid ${BORDER}`, color: "#64748B" }}
                >
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number"
                  maxLength={10}
                  className="flex-1 h-full px-3 text-[14px] outline-none"
                  style={{ color: "#0F172A" }}
                />
              </div>
            </div>

            <ErrorBox msg={error} />

            <TealBtn onClick={handleCreateProfile} disabled={loading || !formName.trim()}>
              {loading ? "Creating profile…" : "Create Profile & Continue"}
            </TealBtn>

            <p className="text-[11px] text-center" style={{ color: "#94A3B8" }}>
              A new patient record will be created at {hospitalBrand.name}
            </p>
          </div>
        )}
    </div>
  );
};

export default PatientPortalLogin;
