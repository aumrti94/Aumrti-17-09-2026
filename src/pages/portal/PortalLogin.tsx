import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendWhatsApp } from "@/lib/whatsapp-send";

interface PortalLoginProps {
  hospitalId: string | null;
  onLogin: (session: PortalSession) => void;
}

export interface PortalSession {
  patientId: string;
  hospitalId: string;
  fullName: string;
  uhid: string;
  phone: string;
  hospitalName: string;
  hospitalLogo: string | null;
  bloodGroup: string | null;
}

const PortalLogin: React.FC<PortalLoginProps> = ({ hospitalId, onLogin }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [hospitalBrand, setHospitalBrand] = useState<{ name: string; logo_url: string | null }>({ name: "Hospital", logo_url: null });
  const [sessionId, setSessionId] = useState("");
  const [foundPatients, setFoundPatients] = useState<any[]>([]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Load hospital branding
  useEffect(() => {
    if (!hospitalId) return;
    supabase
      .from("hospitals")
      .select("name, logo_url")
      .eq("id", hospitalId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setHospitalBrand(data);
      });
  }, [hospitalId]);

  // Resend timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const handleSendOTP = async () => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10) { setError("Enter a valid 10-digit number"); return; }
    setLoading(true);
    setError("");

    // Find patients for this phone (may be multiple family members)
    const query = supabase
      .from("patients")
      .select("id, full_name, uhid, phone, hospital_id, blood_group, dob, gender")
      .ilike("phone", `%${clean.slice(-10)}`);

    if (hospitalId) query.eq("hospital_id", hospitalId);

    const { data: patients } = await query.limit(10);

    if (!patients || patients.length === 0) {
      setError("This number is not registered. Please contact reception.");
      setLoading(false);
      return;
    }

    setFoundPatients(patients);
    const patient = patients[0]; // use first for session creation

    // Generate OTP
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(otpCode);

    // Store in DB
    const { data: sess } = await supabase
      .from("patient_portal_sessions")
      .insert({
        patient_id: patient.id,
        hospital_id: patient.hospital_id,
        phone: clean,
        otp_code: otpCode,
        otp_expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      } as any)
      .select("id")
      .maybeSingle();

    if (sess) setSessionId((sess as any).id);

    // Deliver the OTP via the hospital's configured WhatsApp provider (Meta/WATI),
    // falling back to a wa.me deep link if no provider is set up. Uses the matched
    // patient's hospital so it works even on the multi-hospital portal entry.
    const hospitalName = hospitalBrand.name || "Hospital";
    const waMsg = `Your ${hospitalName} OTP: ${otpCode}. Valid for 10 minutes. Do not share.`;
    await sendWhatsApp({ hospitalId: patient.hospital_id, phone: clean.slice(-10), message: waMsg });

    setStep(2);
    setResendTimer(30);
    setLoading(false);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all filled
    if (newOtp.every((d) => d) && newOtp.join("").length === 6) {
      verifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const completeLogin = async (patient: any) => {
    setLoading(true);
    const token = crypto.randomUUID();

    if (sessionId) {
      // Update the existing portal session for this patient
      await (supabase as any)
        .from("patient_portal_sessions")
        .update({ otp_verified: true, session_token: token, patient_id: patient.id } as any)
        .eq("id", sessionId);
    }

    localStorage.setItem("portal_session_token", token);
    localStorage.setItem("portal_patient_id", patient.id);

    const { data: hospital } = await supabase
      .from("hospitals")
      .select("name, logo_url")
      .eq("id", patient.hospital_id)
      .maybeSingle();

    onLogin({
      patientId: patient.id,
      hospitalId: patient.hospital_id,
      fullName: patient.full_name,
      uhid: patient.uhid,
      phone: patient.phone || phone,
      hospitalName: hospital?.name || "Hospital",
      hospitalLogo: hospital?.logo_url || null,
      bloodGroup: patient.blood_group || null,
    });
    setLoading(false);
  };

  const verifyOtp = async (code: string) => {
    setLoading(true);
    setError("");

    if (code !== generatedOtp) {
      setError("Incorrect code. Try again.");
      const container = document.getElementById("otp-container");
      container?.classList.add("animate-shake");
      setTimeout(() => container?.classList.remove("animate-shake"), 500);
      setLoading(false);
      return;
    }

    // If multiple patients share this phone, show family selector
    if (foundPatients.length > 1) {
      setLoading(false);
      setStep(3);
      return;
    }

    await completeLogin(foundPatients[0]);
  };

  const handleResend = () => {
    if (resendTimer > 0) return;
    setOtp(["", "", "", "", "", ""]);
    setStep(1);
    handleSendOTP();
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ background: "#F8FAFC" }}>
      {/* Hospital Branding */}
      <div className="w-full flex flex-col items-center pt-16 pb-8" style={{ background: "linear-gradient(180deg, #0E7B7B 0%, #0A6363 100%)" }}>
        {hospitalBrand.logo_url ? (
          <img src={hospitalBrand.logo_url} alt="" className="h-20 w-20 rounded-2xl object-contain bg-white/10 p-2 mb-3" />
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

      {/* Login Card */}
      <div className="w-full max-w-[400px] px-5 -mt-4">
        <div className="bg-white rounded-2xl p-7 shadow-lg" style={{ border: "1px solid #E2E8F0" }}>
          <h2 className="text-[17px] font-bold text-center" style={{ color: "#0F172A" }}>
            Login to Your Health Records
          </h2>
          <p className="text-[13px] text-center mt-1" style={{ color: "#64748B" }}>
            {step === 1
              ? "We'll send a verification code to your phone"
              : step === 2
              ? `Enter the 6-digit code sent to +91 ${phone.slice(-10)}`
              : "Select your profile to continue"}
          </p>

          {step === 3 ? (
            <div className="mt-6 space-y-3">
              {foundPatients.map((p) => {
                const age = p.dob
                  ? Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86400000))
                  : null;
                const ini = p.full_name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <button
                    key={p.id}
                    onClick={() => completeLogin(p)}
                    disabled={loading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] transition-transform disabled:opacity-50"
                    style={{ border: "1.5px solid #E2E8F0", background: "#FAFAFA" }}
                  >
                    <div
                      className="flex items-center justify-center rounded-full text-white text-sm font-bold shrink-0"
                      style={{ width: 40, height: 40, background: "#0E7B7B" }}
                    >
                      {ini}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold truncate" style={{ color: "#0F172A" }}>{p.full_name}</p>
                      <p className="text-[11px]" style={{ color: "#64748B" }}>
                        UHID: {p.uhid}
                        {age !== null ? ` · ${age} yrs` : ""}
                        {p.gender ? ` · ${p.gender}` : ""}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
              {loading && (
                <p className="text-[13px] text-center" style={{ color: "#94A3B8" }}>Logging in…</p>
              )}
            </div>
          ) : step === 1 ? (
            <div className="mt-6 space-y-4">
              <div>
                <label className="text-[13px] font-bold" style={{ color: "#0F172A" }}>Mobile Number</label>
                <div
                  className="mt-1.5 flex items-center overflow-hidden"
                  style={{ border: "1.5px solid #E2E8F0", borderRadius: 10, height: 52 }}
                >
                  <span
                    className="px-3 flex items-center h-full text-[13px] font-medium shrink-0"
                    style={{ background: "#F1F5F9", borderRight: "1px solid #E2E8F0", color: "#64748B" }}
                  >
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
                    placeholder="Enter 10-digit number"
                    maxLength={10}
                    className="flex-1 h-full px-3 text-base outline-none"
                    style={{ color: "#0F172A" }}
                  />
                </div>
              </div>

              {error && (
                <p className="text-[12px] px-3 py-2 rounded-lg" style={{ color: "#DC2626", background: "#FEF2F2" }}>
                  {error}
                </p>
              )}

              <button
                onClick={handleSendOTP}
                disabled={loading || phone.replace(/\D/g, "").length < 10}
                className="w-full font-bold text-[15px] text-white rounded-xl disabled:opacity-40 active:scale-[0.97] transition-transform"
                style={{ height: 52, background: "#0E7B7B" }}
              >
                {loading ? "Checking..." : "Send OTP"}
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div id="otp-container" className="flex justify-center gap-2">
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
                    className="text-center text-2xl font-bold outline-none transition-colors"
                    style={{
                      width: 44,
                      height: 52,
                      borderRadius: 10,
                      border: `2px solid ${digit ? "#0E7B7B" : "#E2E8F0"}`,
                      background: digit ? "#EEF9F9" : "#FFFFFF",
                      color: "#0F172A",
                    }}
                  />
                ))}
              </div>

              {error && (
                <p className="text-[12px] px-3 py-2 rounded-lg text-center" style={{ color: "#DC2626", background: "#FEF2F2" }}>
                  {error}
                </p>
              )}

              <div className="text-center">
                {resendTimer > 0 ? (
                  <p className="text-[13px]" style={{ color: "#94A3B8" }}>
                    Resend in {resendTimer}s
                  </p>
                ) : (
                  <button onClick={handleResend} className="text-[13px] font-semibold" style={{ color: "#0E7B7B" }}>
                    Resend OTP
                  </button>
                )}
              </div>

              <button
                onClick={() => { setStep(1); setOtp(["", "", "", "", "", ""]); setError(""); }}
                className="w-full text-[13px] text-center" style={{ color: "#64748B" }}
              >
                ← Change phone number
              </button>
            </div>
          ) }
        </div>
      </div>
    </div>
  );
};

export default PortalLogin;
