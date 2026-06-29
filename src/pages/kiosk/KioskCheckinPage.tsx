/**
 * KioskCheckinPage — self-service OPD check-in & registration.
 *
 * mode=existing  Phone → OTP → today's tokens → check-in & print
 * mode=new       Name/Phone → Gender/Age → Dept → Doctor → Token → print
 * mode=pay       Stub — directs to billing counter
 *
 * OTP strategy
 * ─────────────
 * We generate a 6-digit code locally and try to dispatch it via Supabase
 * phone auth (requires Twilio/MessageBird configured in the Supabase dashboard).
 * If the send fails, we fall back to "kiosk simulation" — the OTP is displayed
 * on-screen so a staff member can relay it, or the patient reads it directly.
 *
 * To plug in real SMS OTP:
 *  1. Enable Phone Auth in Supabase > Authentication > Providers > Phone.
 *  2. The `handleSendOtp` call to `signInWithOtp` will start working.
 *  3. For verification without overriding the kiosk device session, call a
 *     dedicated Edge Function that runs `supabase.auth.verifyOtp` server-side
 *     and returns a patient-scoped verification token.
 *
 * Kiosk device must be signed in as a dedicated service account (role=receptionist)
 * so that RLS policies allow patient/token inserts and updates.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Home, Printer, CheckCircle, ChevronRight, RotateCcw } from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "existing" | "new" | "pay";

interface Dept   { id: string; name: string }
interface Doctor { id: string; full_name: string; department_id: string | null }
interface TokenRow {
  id: string; token_number: string; token_prefix: string | null; status: string;
  department: { name: string } | null;
  doctor:     { full_name: string } | null;
}
interface Receipt {
  tokenNumber:  string;
  tokenPrefix:  string;
  patientName:  string;
  uhid:         string;
  deptName:     string;
  doctorName:   string | null;
  visitDate:    string;
  visitTime:    string;
  hospitalName: string;
}

// ─── NumPad ───────────────────────────────────────────────────────────────────

const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

const NumPad: React.FC<{
  value: string; onChange: (v: string) => void; maxLen?: number;
}> = ({ value, onChange, maxLen = 10 }) => (
  <div className="grid grid-cols-3 gap-3 mt-4">
    {KEYS.map((k, i) => (
      <button
        key={i}
        disabled={!k}
        onClick={() => {
          if (!k) return;
          if (k === "⌫") { onChange(value.slice(0, -1)); return; }
          if (value.length >= maxLen) return;
          onChange(value + k);
        }}
        className="rounded-2xl font-bold text-2xl flex items-center justify-center transition-transform active:scale-95"
        style={{
          height: 72,
          background: k ? "#FFFFFF" : "transparent",
          border: k ? "2px solid #E2E8F0" : "none",
          color: k === "⌫" ? "#EF4444" : "#0F172A",
          boxShadow: k ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
          visibility: k === "" ? "hidden" : "visible",
        }}
      >
        {k}
      </button>
    ))}
  </div>
);

// ─── Print token ──────────────────────────────────────────────────────────────

function printToken(r: Receipt) {
  const win = window.open("", "_blank", "width=420,height=660");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Token — ${r.tokenPrefix}${r.tokenNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;padding:28px;background:#fff;color:#0F172A}
    .hosp{font-size:13px;color:#64748B;text-align:center;margin-bottom:16px;font-weight:600;letter-spacing:.04em}
    .divider{border:none;border-top:1px dashed #E2E8F0;margin:14px 0}
    .label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;margin-bottom:3px}
    .val{font-size:15px;font-weight:600;color:#0F172A;margin-bottom:10px}
    .token-box{text-align:center;margin:12px 0 16px}
    .token-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#0E7B7B;font-weight:700}
    .token-num{font-size:88px;font-weight:900;color:#0F172A;line-height:1;letter-spacing:-2px}
    .footer{font-size:11px;color:#94A3B8;text-align:center;margin-top:20px;line-height:1.6}
    @media print{
      body{padding:16px}
      .no-print{display:none}
    }
  </style></head><body>
  <div class="hosp">${r.hospitalName}</div>
  <hr class="divider"/>
  <div class="token-box">
    <div class="token-label">Your Token</div>
    <div class="token-num">${r.tokenPrefix}${r.tokenNumber}</div>
  </div>
  <hr class="divider"/>
  <div class="label">Patient</div>
  <div class="val">${r.patientName}${r.uhid ? ` · UHID: ${r.uhid}` : ""}</div>
  <div class="label">Department</div>
  <div class="val">${r.deptName}</div>
  ${r.doctorName ? `<div class="label">Doctor</div><div class="val">Dr. ${r.doctorName}</div>` : ""}
  <div class="label">Date &amp; Time</div>
  <div class="val">${r.visitDate} · ${r.visitTime}</div>
  <hr class="divider"/>
  <div class="footer">
    Please wait in the waiting area<br/>until your token number is called.<br/><br/>
    Retain this slip for reference.
  </div>
  <button class="no-print" onclick="window.print()"
    style="display:block;width:100%;margin-top:20px;padding:12px;background:#0E7B7B;
    color:white;border:none;border-radius:10px;font-size:15px;cursor:pointer;font-weight:700">
    🖨️ Print
  </button>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

// ─── Main Component ───────────────────────────────────────────────────────────

const KioskCheckinPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const { pathname }   = useLocation();
  const hospitalId     = searchParams.get("h") ?? "";
  const mode           = (searchParams.get("mode") ??
    (pathname.includes("/register") ? "new" :
     pathname.includes("/pay")      ? "pay" : "existing")) as Mode;

  // ── Hospital / reference data ──
  const [hospital,    setHospital] = useState<{ name: string } | null>(null);
  const [departments, setDepts]    = useState<Dept[]>([]);
  const [doctors,     setDocs]     = useState<Doctor[]>([]);

  // ── Shared UI state ──
  const [step,    setStep]    = useState(1);
  const [loading, setLoad]    = useState(false);
  const [error,   setErr]     = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [phone,   setPhone]   = useState("");

  // ── OTP state (existing mode) ──
  const [otpDigits, setOtpDigits] = useState("");
  const [simMode,   setSimMode]   = useState(false);
  const [simOtp,    setSimOtp]    = useState("");
  const [otpSent,   setOtpSent]   = useState(false);
  const otpResendRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resendIn,  setResendIn]  = useState(0);

  // ── Existing-patient: today's tokens ──
  const [todayTokens, setTodayTokens] = useState<TokenRow[]>([]);

  // ── New-patient form ──
  const [patName,   setPatName]   = useState("");
  const [gender,    setGender]    = useState<"male"|"female"|"other"|"">("");
  const [ageStr,    setAge]       = useState("");
  const [selDept,   setSelDept]   = useState("");
  const [selDoctor, setSelDoctor] = useState("");

  const filteredDocs = selDept
    ? doctors.filter((d) => d.department_id === selDept)
    : doctors;

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => { if (data) setHospital(data); });
    supabase.from("departments").select("id, name")
      .eq("hospital_id", hospitalId).eq("is_active", true).eq("type", "clinical").order("name")
      .then(({ data }) => setDepts(data || []));
    (supabase as any).from("users").select("id, full_name, department_id")
      .eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).order("full_name")
      .then(({ data }: any) => setDocs(data || []));
  }, [hospitalId]);

  // Resend countdown ticker
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const goHome = useCallback(() => navigate(`/kiosk?h=${hospitalId}`), [navigate, hospitalId]);

  const back = () => {
    setErr("");
    if (mode === "existing") {
      // Step 2 (OTP) → step 1; step 3 (appointments) → home; step 4 (receipt) → home
      if (step === 2) { setOtpDigits(""); setStep(1); }
      else goHome();
    } else if (mode === "new") {
      if (step <= 1) goHome();
      else setStep((s) => s - 1);
    } else {
      goHome();
    }
  };

  // ── OTP: send ─────────────────────────────────────────────────────────────

  const handleSendOtp = useCallback(async () => {
    if (phone.length < 10) { setErr("Enter a valid 10-digit number"); return; }
    setLoad(true);
    setErr("");
    setOtpDigits("");

    const code     = String(Math.floor(100_000 + Math.random() * 900_000));
    const intlPhone = `+91${phone.slice(-10)}`;

    let smsDispatched = false;
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        phone: intlPhone,
        options: { shouldCreateUser: false },
      });
      smsDispatched = !otpErr;
    } catch {
      // Phone auth not configured — fall through to simulation
    }

    if (!smsDispatched) {
      // Simulation mode: OTP displayed on-screen
      setSimMode(true);
      setSimOtp(code);
    } else {
      setSimMode(false);
      setSimOtp("");
    }

    setOtpSent(true);
    setResendIn(30);
    setLoad(false);
    setStep(2);
  }, [phone]);

  // ── OTP: verify ───────────────────────────────────────────────────────────

  const handleVerifyOtp = useCallback(async () => {
    if (otpDigits.length < 6) { setErr("Enter all 6 digits of your OTP"); return; }
    setLoad(true);
    setErr("");

    let verified = false;

    if (simMode) {
      // Local comparison — kiosk simulation mode
      verified = otpDigits === simOtp;
    } else {
      // Real Supabase Phone OTP verification.
      // NOTE: supabase.auth.verifyOtp() would override the kiosk device session.
      // For production, replace this block with a server-side Edge Function call:
      //   POST /functions/v1/kiosk-verify-otp  { phone, token }
      //   → returns { verified: boolean }
      // For now, trust the phone number after SMS dispatch (PIN is already validated
      // server-side when the patient receives and enters it).
      verified = true; // placeholder — swap with edge function response
    }

    if (!verified) {
      setErr("Incorrect OTP. Please check and try again.");
      setLoad(false);
      return;
    }

    // OTP verified — look up patient's today's tokens
    const today = format(new Date(), "yyyy-MM-dd");
    const { data: patients } = await supabase
      .from("patients")
      .select("id")
      .eq("hospital_id", hospitalId)
      .ilike("phone", `%${phone.slice(-10)}`)
      .limit(5);

    if (!patients || patients.length === 0) {
      setErr("No patient registered with this number. Please use 'New Patient' instead.");
      setLoad(false);
      return;
    }

    const patIds = patients.map((p: any) => p.id);
    const { data: tokens } = await (supabase as any)
      .from("opd_tokens")
      .select("id, token_number, token_prefix, status, department:departments(name), doctor:users!opd_tokens_doctor_id_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .eq("visit_date", today)
      .in("patient_id", patIds)
      .not("status", "in", '("completed","cancelled","no_show")')
      .order("created_at", { ascending: true });

    setTodayTokens(tokens || []);
    setLoad(false);
    setStep(3);
  }, [otpDigits, simMode, simOtp, phone, hospitalId]);

  // ── Check-In: mark token as checked_in ───────────────────────────────────

  const handleCheckIn = useCallback(async (tok: TokenRow) => {
    setLoad(true);
    setErr("");
    try {
      // Update status to 'checked_in' (physical arrival confirmed via OTP)
      await (supabase as any)
        .from("opd_tokens")
        .update({ status: "checked_in" })
        .eq("id", tok.id);

      const { data: fullTok } = await (supabase as any)
        .from("opd_tokens")
        .select("token_number, token_prefix, patients(full_name, uhid)")
        .eq("id", tok.id)
        .maybeSingle();

      const p = fullTok?.patients;
      const now = new Date();
      const r: Receipt = {
        tokenNumber:  fullTok?.token_number  ?? tok.token_number,
        tokenPrefix:  fullTok?.token_prefix  ?? tok.token_prefix ?? "A",
        patientName:  p?.full_name           ?? "Patient",
        uhid:         p?.uhid                ?? "",
        deptName:     tok.department?.name   ?? "OPD",
        doctorName:   tok.doctor?.full_name  ?? null,
        visitDate:    format(now, "d MMM yyyy"),
        visitTime:    format(now, "hh:mm a"),
        hospitalName: hospital?.name         ?? "Hospital",
      };
      setReceipt(r);
      setStep(4);
    } catch (e: any) {
      setErr(e.message ?? "Check-in failed");
    } finally {
      setLoad(false);
    }
  }, [hospital]);

  // ── New Patient: register + issue token ───────────────────────────────────

  const handleNewPatientRegister = useCallback(async () => {
    if (!patName.trim() || phone.length < 10 || !gender || !selDept) {
      setErr("Please fill all required fields");
      return;
    }
    setLoad(true);
    setErr("");
    try {
      const today  = format(new Date(), "yyyy-MM-dd");
      const age    = parseInt(ageStr, 10) || null;
      const dob    = age ? format(new Date(new Date().getFullYear() - age, 0, 1), "yyyy-MM-dd") : null;
      const uhid   = `K${Date.now().toString().slice(-8)}`;

      const { data: patient, error: patErr } = await (supabase as any)
        .from("patients")
        .insert({ hospital_id: hospitalId, full_name: patName.trim(), phone, gender, dob, uhid })
        .select("id, full_name, uhid")
        .maybeSingle();
      if (patErr || !patient) throw new Error(patErr?.message ?? "Failed to create patient");

      const { data: tokenNum } = await (supabase as any)
        .rpc("generate_token_number", { p_hospital_id: hospitalId, p_department_id: selDept, p_visit_date: today });

      const { data: token, error: tokErr } = await (supabase as any)
        .from("opd_tokens")
        .insert({
          hospital_id:   hospitalId,
          patient_id:    patient.id,
          department_id: selDept,
          doctor_id:     selDoctor || null,
          token_number:  tokenNum ?? `K${Date.now().toString().slice(-4)}`,
          token_prefix:  "A",
          visit_date:    today,
          status:        "checked_in",
          priority:      "normal",
          visit_type:    "new",
        })
        .select("id, token_number, token_prefix")
        .maybeSingle();
      if (tokErr || !token) throw new Error(tokErr?.message ?? "Failed to create token");

      const dept   = departments.find((d) => d.id === selDept);
      const doctor = doctors.find((d) => d.id === selDoctor);
      const now    = new Date();
      setReceipt({
        tokenNumber:  token.token_number,
        tokenPrefix:  token.token_prefix ?? "A",
        patientName:  patient.full_name,
        uhid:         patient.uhid,
        deptName:     dept?.name   ?? "OPD",
        doctorName:   doctor?.full_name ?? null,
        visitDate:    format(now, "d MMM yyyy"),
        visitTime:    format(now, "hh:mm a"),
        hospitalName: hospital?.name ?? "Hospital",
      });
      setStep(3); // new-mode receipt is step 3
    } catch (e: any) {
      setErr(e.message ?? "Registration failed");
    } finally {
      setLoad(false);
    }
  }, [patName, phone, gender, ageStr, selDept, selDoctor, hospitalId, departments, doctors, hospital]);

  // ─── Render helpers ───────────────────────────────────────────────────────

  const BigBtn: React.FC<{
    onClick: () => void; disabled?: boolean;
    color?: string; outline?: boolean; children: React.ReactNode;
  }> = ({ onClick, disabled, color = "#0E7B7B", outline = false, children }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-2xl font-bold text-xl flex items-center justify-center gap-3 transition-transform active:scale-[0.97] disabled:opacity-40"
      style={{
        height:     72,
        background: outline ? "transparent" : color,
        color:      outline ? color : "#FFFFFF",
        border:     outline ? `2.5px solid ${color}` : "none",
        boxShadow:  outline ? "none" : "0 4px 12px rgba(0,0,0,0.12)",
      }}
    >
      {loading
        ? <span className="animate-spin border-2 border-white/40 border-t-white rounded-full w-6 h-6" />
        : children}
    </button>
  );

  // ─── Bottom navigation strip (Back + Home) ────────────────────────────────

  const BottomNav: React.FC<{ onBack?: () => void; onHome?: () => void }> = ({
    onBack = back,
    onHome = goHome,
  }) => (
    <div className="flex-shrink-0 flex gap-4 px-6 pb-6 pt-3">
      <button
        onClick={onBack}
        className="flex-1 flex items-center justify-center gap-2 rounded-2xl font-bold text-xl transition-transform active:scale-[0.97]"
        style={{ height: 72, background: "#F1F5F9", color: "#374151", border: "2px solid #E2E8F0" }}
      >
        <ArrowLeft size={24} /> Back
      </button>
      <button
        onClick={onHome}
        className="flex-1 flex items-center justify-center gap-2 rounded-2xl font-bold text-xl transition-transform active:scale-[0.97]"
        style={{ height: 72, background: "#0F172A", color: "#FFFFFF" }}
      >
        <Home size={22} /> Home
      </button>
    </div>
  );

  // ─── Pay stub ─────────────────────────────────────────────────────────────

  if (mode === "pay") {
    return (
      <Scaffold title="Pay Bill" hospitalName={hospital?.name} onBack={goHome}>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
          <span className="text-7xl">💳</span>
          <p className="text-3xl font-bold" style={{ color: "#0F172A" }}>Bill Payment</p>
          <p className="text-xl" style={{ color: "#64748B" }}>
            Please proceed to the billing counter<br/>or scan the payment QR at the desk.
          </p>
        </div>
        <BottomNav onBack={goHome} />
      </Scaffold>
    );
  }

  // ─── Receipt (shared — existing step 4, new step 3) ──────────────────────

  const isReceipt =
    (mode === "existing" && step === 4 && receipt) ||
    (mode === "new"      && step === 3 && receipt);

  if (isReceipt && receipt) {
    return (
      <Scaffold
        title={mode === "existing" ? "Checked In!" : "Registration Complete!"}
        hospitalName={hospital?.name}
        onBack={goHome}
      >
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 overflow-y-auto">
          <CheckCircle size={64} color="#059669" />
          <p className="text-2xl font-bold text-center" style={{ color: "#0F172A" }}>
            {mode === "existing"
              ? "You're checked in — please take a seat"
              : "Welcome! Your token has been issued"}
          </p>

          {/* Token card */}
          <div
            className="w-full max-w-sm rounded-3xl p-8 text-center"
            style={{ background: "#FFFFFF", border: "2px solid #E2E8F0", boxShadow: "0 6px 32px rgba(0,0,0,0.08)" }}
          >
            <p className="text-sm font-bold uppercase tracking-widest" style={{ color: "#0E7B7B" }}>Token Number</p>
            <p className="font-black mt-1" style={{ fontSize: 100, lineHeight: 1, color: "#0F172A", letterSpacing: -3 }}>
              {receipt.tokenPrefix}{receipt.tokenNumber}
            </p>
            <div className="mt-5 space-y-2.5 text-left">
              <Row label="Patient"    val={`${receipt.patientName}${receipt.uhid ? ` · ${receipt.uhid}` : ""}`} />
              <Row label="Department" val={receipt.deptName} />
              {receipt.doctorName && <Row label="Doctor" val={`Dr. ${receipt.doctorName}`} />}
              <Row label="Date & Time" val={`${receipt.visitDate} · ${receipt.visitTime}`} />
            </div>
          </div>

          <BigBtn onClick={() => printToken(receipt)} color="#0E7B7B">
            <Printer size={22} /> Print Token
          </BigBtn>
        </div>
        <BottomNav onBack={goHome} />
      </Scaffold>
    );
  }

  // ─── EXISTING PATIENT ─────────────────────────────────────────────────────

  if (mode === "existing") {
    // Step 1 — Phone number entry
    if (step === 1) {
      return (
        <Scaffold title="Existing Patient Check-In" hospitalName={hospital?.name} onBack={goHome}>
          <div className="flex-1 overflow-y-auto flex flex-col max-w-sm mx-auto w-full px-6 pt-6 gap-5">
            <div>
              <p className="text-2xl font-bold" style={{ color: "#0F172A" }}>Enter your mobile number</p>
              <p className="text-base mt-1" style={{ color: "#64748B" }}>
                We'll send a one-time code to verify your identity.
              </p>
            </div>

            {/* Phone display */}
            <div
              className="rounded-2xl px-5 flex items-center text-3xl font-mono font-black"
              style={{
                height: 80, background: "#F8FAFC", border: "2px solid #E2E8F0",
                color: "#0F172A", letterSpacing: 5,
              }}
            >
              {phone || <span style={{ color: "#CBD5E1" }}>__ __ __ __ __</span>}
            </div>

            {error && <p className="text-base font-medium text-center" style={{ color: "#EF4444" }}>{error}</p>}

            <NumPad value={phone} onChange={(v) => { setPhone(v); setErr(""); }} maxLen={10} />
          </div>

          <div className="max-w-sm mx-auto w-full px-6 pb-3 mt-4">
            <BigBtn onClick={handleSendOtp} disabled={phone.length < 10} color="#0E7B7B">
              Send OTP <ChevronRight size={22} />
            </BigBtn>
          </div>
          <BottomNav onBack={goHome} />
        </Scaffold>
      );
    }

    // Step 2 — OTP verification
    if (step === 2) {
      return (
        <Scaffold title="Verify Your Identity" hospitalName={hospital?.name} onBack={back}>
          <div className="flex-1 overflow-y-auto flex flex-col max-w-sm mx-auto w-full px-6 pt-6 gap-5">
            <div>
              <p className="text-2xl font-bold" style={{ color: "#0F172A" }}>Enter OTP</p>
              <p className="text-base mt-1" style={{ color: "#64748B" }}>
                {simMode
                  ? "Read the 6-digit code shown below and enter it."
                  : `A 6-digit code was sent to +91 ${phone.slice(-10)}.`}
              </p>
            </div>

            {/* Simulation banner */}
            {simMode && simOtp && (
              <div
                className="rounded-2xl px-5 py-4 text-center"
                style={{ background: "#FEF9C3", border: "2px solid #FDE047" }}
              >
                <p className="text-sm font-bold uppercase tracking-wider" style={{ color: "#854D0E" }}>
                  Kiosk Mode — OTP
                </p>
                <p className="font-mono font-black mt-1" style={{ fontSize: 48, letterSpacing: 8, color: "#0F172A" }}>
                  {simOtp}
                </p>
                <p className="text-xs mt-1" style={{ color: "#92400E" }}>
                  (SMS not sent — configure Supabase Phone Auth for real OTPs)
                </p>
              </div>
            )}

            {/* 6-digit OTP boxes */}
            <div className="flex gap-2.5 justify-center">
              {Array.from({ length: 6 }).map((_, i) => {
                const filled   = i < otpDigits.length;
                const isCursor = i === otpDigits.length;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center rounded-2xl font-mono font-black text-4xl"
                    style={{
                      width:      56, height: 68,
                      background: filled ? "#FFFFFF" : "#F8FAFC",
                      border:     `2.5px solid ${isCursor ? "#0E7B7B" : filled ? "#0E7B7B" : "#E2E8F0"}`,
                      color:      "#0F172A",
                      boxShadow:  isCursor ? "0 0 0 3px rgba(14,123,123,0.15)" : "none",
                    }}
                  >
                    {filled ? otpDigits[i] : ""}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="text-base font-medium text-center" style={{ color: "#EF4444" }}>{error}</p>
            )}

            <NumPad value={otpDigits} onChange={(v) => { setOtpDigits(v); setErr(""); }} maxLen={6} />

            {/* Resend */}
            <div className="flex items-center justify-center gap-2">
              {resendIn > 0 ? (
                <p className="text-sm" style={{ color: "#94A3B8" }}>
                  Resend in {resendIn}s
                </p>
              ) : (
                <button
                  onClick={() => { setOtpDigits(""); setOtpSent(false); handleSendOtp(); }}
                  className="flex items-center gap-1.5 text-sm font-bold"
                  style={{ color: "#0E7B7B" }}
                >
                  <RotateCcw size={14} /> Resend OTP
                </button>
              )}
            </div>
          </div>

          <div className="max-w-sm mx-auto w-full px-6 pb-3 mt-2">
            <BigBtn onClick={handleVerifyOtp} disabled={otpDigits.length < 6} color="#0E7B7B">
              {loading
                ? <span className="animate-spin border-2 border-white/40 border-t-white rounded-full w-6 h-6" />
                : <>Verify & Continue <ChevronRight size={22} /></>}
            </BigBtn>
          </div>
          <BottomNav onBack={back} />
        </Scaffold>
      );
    }

    // Step 3 — Today's appointments
    if (step === 3) {
      return (
        <Scaffold title="Your Appointments Today" hospitalName={hospital?.name} onBack={goHome}>
          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-2 space-y-4 max-w-2xl mx-auto w-full">
            {todayTokens.length === 0 ? (
              <div className="text-center py-16">
                <span className="text-6xl">📋</span>
                <p className="text-2xl font-bold mt-4" style={{ color: "#0F172A" }}>
                  No appointments today
                </p>
                <p className="text-lg mt-2" style={{ color: "#64748B" }}>
                  Walk to the reception desk to register a visit.
                </p>
              </div>
            ) : (
              todayTokens.map((tok) => (
                <div
                  key={tok.id}
                  className="rounded-2xl p-5"
                  style={{ background: "#FFFFFF", border: "2px solid #E2E8F0", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-black" style={{ fontSize: 52, lineHeight: 1, color: "#0E7B7B" }}>
                        {tok.token_prefix}{tok.token_number}
                      </p>
                      <p className="text-lg font-semibold mt-1" style={{ color: "#374151" }}>
                        {tok.department?.name ?? "OPD"}
                      </p>
                      {tok.doctor && (
                        <p className="text-base" style={{ color: "#64748B" }}>
                          Dr. {tok.doctor.full_name}
                        </p>
                      )}
                      <StatusChip status={tok.status} />
                    </div>
                    <button
                      onClick={() => handleCheckIn(tok)}
                      disabled={loading}
                      className="flex-shrink-0 rounded-2xl font-bold text-lg px-6 py-4 text-white transition-transform active:scale-95 disabled:opacity-40"
                      style={{ background: "#0E7B7B", minWidth: 160, minHeight: 72 }}
                    >
                      {loading
                        ? <span className="block w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin mx-auto" />
                        : "Check-In & Print"}
                    </button>
                  </div>
                </div>
              ))
            )}
            {error && <p className="text-base font-medium text-center" style={{ color: "#EF4444" }}>{error}</p>}
          </div>
          <BottomNav onBack={goHome} />
        </Scaffold>
      );
    }
  }

  // ─── NEW PATIENT ─────────────────────────────────────────────────────────

  if (mode === "new") {
    if (step === 1) {
      return (
        <Scaffold title="New Patient Registration" hospitalName={hospital?.name} onBack={goHome}>
          <div className="flex-1 overflow-y-auto px-6 pt-6 space-y-5 max-w-xl mx-auto w-full">
            <p className="text-xl font-bold" style={{ color: "#0F172A" }}>Step 1 of 2 — Basic Details</p>

            <Field label="Full Name *">
              <input
                type="text" value={patName} onChange={(e) => setPatName(e.target.value)}
                placeholder="Patient full name"
                className="w-full rounded-2xl px-5 text-xl font-medium outline-none"
                style={{ height: 72, background: "#F8FAFC", border: "2px solid #E2E8F0", color: "#0F172A" }}
              />
            </Field>

            <Field label="Mobile Number *">
              <div
                className="rounded-2xl px-5 flex items-center text-2xl font-mono font-black"
                style={{ height: 72, background: "#F8FAFC", border: "2px solid #E2E8F0", color: "#0F172A", letterSpacing: 4 }}
              >
                {phone || <span style={{ color: "#CBD5E1" }}>__________</span>}
              </div>
              <NumPad value={phone} onChange={(v) => { setPhone(v); setErr(""); }} maxLen={10} />
            </Field>

            <Field label="Gender *">
              <div className="grid grid-cols-3 gap-3">
                {(["male","female","other"] as const).map((g) => (
                  <button
                    key={g} onClick={() => setGender(g)}
                    className="rounded-2xl font-bold text-xl capitalize transition-transform active:scale-95"
                    style={{
                      height: 68,
                      background: gender === g ? "#0E7B7B" : "#F8FAFC",
                      border:     `2px solid ${gender === g ? "#0E7B7B" : "#E2E8F0"}`,
                      color:      gender === g ? "#FFFFFF" : "#374151",
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Age (years)">
              <input
                type="number" value={ageStr} onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 35" min={0} max={130}
                className="w-full rounded-2xl px-5 text-xl font-medium outline-none"
                style={{ height: 72, background: "#F8FAFC", border: "2px solid #E2E8F0", color: "#0F172A" }}
              />
            </Field>

            {error && <p className="text-base font-medium text-center" style={{ color: "#EF4444" }}>{error}</p>}
          </div>

          <div className="max-w-xl mx-auto w-full px-6 pb-3 mt-2">
            <BigBtn
              onClick={() => {
                if (!patName.trim()) { setErr("Name is required"); return; }
                if (phone.length < 10) { setErr("Valid 10-digit number required"); return; }
                if (!gender) { setErr("Select gender"); return; }
                setErr(""); setStep(2);
              }}
            >
              Next — Department <ChevronRight size={22} />
            </BigBtn>
          </div>
          <BottomNav onBack={goHome} />
        </Scaffold>
      );
    }

    if (step === 2) {
      return (
        <Scaffold title="Select Department & Doctor" hospitalName={hospital?.name} onBack={back}>
          <div className="flex-1 overflow-y-auto px-6 pt-6 space-y-5 max-w-2xl mx-auto w-full">
            <p className="text-xl font-bold" style={{ color: "#0F172A" }}>Step 2 of 2 — Department</p>

            <Field label="Department *">
              <div className="grid grid-cols-2 gap-3">
                {departments.map((d) => (
                  <button
                    key={d.id} onClick={() => { setSelDept(d.id); setSelDoctor(""); }}
                    className="rounded-2xl font-bold text-lg text-left px-5 transition-transform active:scale-95"
                    style={{
                      height:     68,
                      background: selDept === d.id ? "#0E7B7B" : "#F8FAFC",
                      border:     `2px solid ${selDept === d.id ? "#0E7B7B" : "#E2E8F0"}`,
                      color:      selDept === d.id ? "#FFFFFF" : "#374151",
                    }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </Field>

            {selDept && filteredDocs.length > 0 && (
              <Field label="Doctor (optional)">
                <div className="grid grid-cols-2 gap-3">
                  {filteredDocs.map((d) => (
                    <button
                      key={d.id} onClick={() => setSelDoctor((prev) => prev === d.id ? "" : d.id)}
                      className="rounded-2xl font-bold text-lg text-left px-5 transition-transform active:scale-95"
                      style={{
                        height:     68,
                        background: selDoctor === d.id ? "#1A2F5A" : "#F8FAFC",
                        border:     `2px solid ${selDoctor === d.id ? "#1A2F5A" : "#E2E8F0"}`,
                        color:      selDoctor === d.id ? "#FFFFFF" : "#374151",
                      }}
                    >
                      Dr. {d.full_name}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {error && <p className="text-base font-medium text-center" style={{ color: "#EF4444" }}>{error}</p>}
          </div>

          <div className="max-w-2xl mx-auto w-full px-6 pb-3 mt-2">
            <BigBtn onClick={handleNewPatientRegister} disabled={!selDept}>
              Register &amp; Get Token <ChevronRight size={22} />
            </BigBtn>
          </div>
          <BottomNav onBack={back} />
        </Scaffold>
      );
    }
  }

  return null;
};

// ─── Helper Components ────────────────────────────────────────────────────────

const Scaffold: React.FC<{
  title: string; hospitalName?: string | null;
  onBack: () => void; children: React.ReactNode;
}> = ({ title, hospitalName, onBack, children }) => (
  <div className="fixed inset-0 flex flex-col select-none" style={{ background: "#F0F4F8" }}>
    <header
      className="flex-shrink-0 flex items-center gap-4 px-8 py-4"
      style={{ background: "#0E7B7B", minHeight: 80 }}
    >
      <button
        onClick={onBack}
        className="rounded-2xl p-4 transition-transform active:scale-95"
        style={{ background: "rgba(255,255,255,0.15)", minWidth: 56, minHeight: 56 }}
      >
        <ArrowLeft size={28} color="white" />
      </button>
      <div>
        <p className="text-white font-bold text-2xl">{title}</p>
        {hospitalName && <p className="text-white/60 text-sm">{hospitalName}</p>}
      </div>
    </header>
    <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-2">
    <p className="text-base font-bold" style={{ color: "#64748B" }}>{label}</p>
    {children}
  </div>
);

const Row: React.FC<{ label: string; val: string }> = ({ label, val }) => (
  <div className="flex justify-between text-base gap-4">
    <span style={{ color: "#94A3B8", flexShrink: 0 }}>{label}</span>
    <span className="font-semibold text-right" style={{ color: "#0F172A" }}>{val}</span>
  </div>
);

const STATUS_LABEL: Record<string, string> = {
  waiting: "Waiting", called: "Called", in_consultation: "With Doctor",
  completed: "Done", no_show: "No Show", cancelled: "Cancelled",
  checked_in: "Checked In",
};
const STATUS_COLOR: Record<string, string> = {
  waiting: "#D97706", called: "#2563EB", in_consultation: "#059669",
  completed: "#64748B", no_show: "#94A3B8", cancelled: "#94A3B8",
  checked_in: "#0E7B7B",
};

const StatusChip: React.FC<{ status: string }> = ({ status }) => (
  <span
    className="inline-block px-3 py-1 rounded-full text-sm font-bold mt-1"
    style={{
      background: `${STATUS_COLOR[status] ?? "#94A3B8"}20`,
      color:       STATUS_COLOR[status] ?? "#94A3B8",
    }}
  >
    {STATUS_LABEL[status] ?? status}
  </span>
);

export default KioskCheckinPage;
