import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UserCheck, UserPlus, CreditCard } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────
const IDLE_MS = 60_000;
const TIP_MS  =  7_000;

const TIPS = [
  { emoji: "💧", text: "Drink 8 glasses of water every day" },
  { emoji: "🚶", text: "30 minutes of walking boosts heart health" },
  { emoji: "🩺", text: "Annual checkups catch problems early" },
  { emoji: "😴", text: "7–8 hours of sleep strengthens immunity" },
  { emoji: "🥦", text: "Eat 5 servings of fruits & vegetables daily" },
  { emoji: "🧴", text: "Wash hands for 20 seconds to prevent infection" },
];

// ── Three kiosk actions ───────────────────────────────────────────────────
const ACTIONS = (hospitalId: string) => [
  {
    icon:      UserCheck,
    label:     "Existing Patient",
    sub:       "Check-In",
    gradient:  "linear-gradient(160deg, #0E7B7B 0%, #085f5f 100%)",
    shadow:    "0 12px 40px rgba(14,123,123,0.45)",
    path:      `/kiosk/checkin?h=${hospitalId}`,
    aria:      "Existing Patient Check-In",
  },
  {
    icon:      UserPlus,
    label:     "New Patient",
    sub:       "Registration",
    gradient:  "linear-gradient(160deg, #2563EB 0%, #1740c4 100%)",
    shadow:    "0 12px 40px rgba(37,99,235,0.45)",
    path:      `/kiosk/register?h=${hospitalId}`,
    aria:      "New Patient Registration",
  },
  {
    icon:      CreditCard,
    label:     "Pay Bill",
    sub:       "Settle Dues",
    gradient:  "linear-gradient(160deg, #7C3AED 0%, #5721c4 100%)",
    shadow:    "0 12px 40px rgba(124,58,237,0.45)",
    path:      `/kiosk/pay?h=${hospitalId}`,
    aria:      "Pay Bill",
  },
];

// ── Component ─────────────────────────────────────────────────────────────
const KioskLandingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const hospitalId     = searchParams.get("h") ?? "";

  const [hospital, setHospital] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [now,      setNow]      = useState(new Date());
  const [tipIdx,   setTipIdx]   = useState(0);
  const [tipFade,  setTipFade]  = useState(true);
  const [idle,     setIdle]     = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live clock — tick every second
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Health tip carousel
  useEffect(() => {
    const t = setInterval(() => {
      setTipFade(false);
      setTimeout(() => {
        setTipIdx((i) => (i + 1) % TIPS.length);
        setTipFade(true);
      }, 380);
    }, TIP_MS);
    return () => clearInterval(t);
  }, []);

  // Hospital branding
  useEffect(() => {
    if (!hospitalId) return;
    supabase
      .from("hospitals")
      .select("name, logo_url")
      .eq("id", hospitalId)
      .maybeSingle()
      .then(({ data }) => { if (data) setHospital(data); });
  }, [hospitalId]);

  // Idle detection
  const resetIdle = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };

  useEffect(() => {
    resetIdle();
    window.addEventListener("pointerdown", resetIdle);
    window.addEventListener("touchstart",  resetIdle, { passive: true });
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      window.removeEventListener("pointerdown", resetIdle);
      window.removeEventListener("touchstart",  resetIdle);
    };
  }, []);

  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const tip     = TIPS[tipIdx];
  const actions = ACTIONS(hospitalId);

  return (
    <div
      className="fixed inset-0 flex flex-col select-none overflow-hidden"
      style={{ background: "#0F172A", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* ── Screensaver overlay ─────────────────────────────────────────── */}
      {idle && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center cursor-pointer"
          style={{ background: "rgba(7,12,22,0.97)" }}
          onClick={resetIdle}
          onTouchStart={resetIdle}
        >
          {hospital?.logo_url && (
            <img src={hospital.logo_url} alt="" className="h-20 mb-6 brightness-0 invert opacity-70" />
          )}
          <p className="font-mono font-black text-white" style={{ fontSize: 88, lineHeight: 1, letterSpacing: -2 }}>
            {timeStr}
          </p>
          <p className="text-white/50 mt-3 text-xl">{dateStr}</p>
          <p className="mt-16 text-white/80 font-bold text-3xl tracking-wide animate-pulse">
            Touch to Begin
          </p>
          <p className="mt-2 text-white/30 text-base">Self-Service Check-in Kiosk</p>
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-10 py-4"
        style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Hospital identity */}
        <div className="flex items-center gap-3">
          {hospital?.logo_url ? (
            <img
              src={hospital.logo_url}
              alt=""
              className="h-10 rounded-lg object-contain"
              style={{ background: "rgba(255,255,255,0.1)", padding: 4 }}
            />
          ) : (
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-xl"
              style={{ background: "#0E7B7B", color: "#FFFFFF" }}
            >
              +
            </div>
          )}
          <div>
            <p className="font-bold text-lg leading-tight" style={{ color: "#FFFFFF" }}>
              {hospital?.name ?? "Hospital Kiosk"}
            </p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              Self-Service
            </p>
          </div>
        </div>

        {/* Clock */}
        <div className="text-right">
          <p className="font-mono font-bold text-3xl" style={{ color: "#FFFFFF" }}>{timeStr}</p>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>{dateStr}</p>
        </div>
      </div>

      {/* ── Welcome text ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 text-center pt-8 pb-6 px-4">
        <p className="font-bold" style={{ fontSize: 36, color: "#FFFFFF" }}>
          Welcome
        </p>
        <p style={{ fontSize: 18, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
          How can we help you today? Tap a button below to get started.
        </p>
      </div>

      {/* ── Three action buttons ─────────────────────────────────────────── */}
      <div className="flex-1 flex gap-5 px-10 pb-6 min-h-0">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              aria-label={a.aria}
              onClick={() => navigate(a.path)}
              className="flex-1 flex flex-col items-center justify-center rounded-3xl gap-6 active:scale-[0.97] transition-transform duration-150"
              style={{
                background:  a.gradient,
                boxShadow:   a.shadow,
                minHeight:   240,
                // Minimum 48 px touch target guaranteed by the full flex-1 height
              }}
            >
              {/* Icon circle */}
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width:      112,
                  height:     112,
                  background: "rgba(255,255,255,0.18)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Icon size={60} color="#FFFFFF" strokeWidth={1.5} />
              </div>

              {/* Text */}
              <div className="text-center px-4">
                <p style={{ fontSize: 34, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.1 }}>
                  {a.label}
                </p>
                <p style={{ fontSize: 18, color: "rgba(255,255,255,0.7)", marginTop: 6, fontWeight: 500 }}>
                  {a.sub}
                </p>
              </div>

              {/* Tap hint */}
              <div
                className="flex items-center gap-1.5 rounded-full px-4 py-1.5"
                style={{ background: "rgba(255,255,255,0.15)" }}
              >
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>
                  TAP TO START
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Health tip footer ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-center gap-4 py-3.5 px-8"
        style={{ background: "rgba(255,255,255,0.05)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="flex items-center gap-3 transition-opacity duration-300"
          style={{ opacity: tipFade ? 1 : 0 }}
        >
          <span style={{ fontSize: 26 }}>{tip.emoji}</span>
          <span style={{ fontSize: 16, color: "rgba(255,255,255,0.55)" }}>
            <span style={{ color: "#0E7B7B", fontWeight: 700 }}>Health Tip: </span>
            {tip.text}
          </span>
        </div>
      </div>
    </div>
  );
};

export default KioskLandingPage;
