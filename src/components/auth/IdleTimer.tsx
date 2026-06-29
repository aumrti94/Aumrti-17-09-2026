import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createPortal } from "react-dom";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_MS = 60 * 1000;

const IdleTimer: React.FC = () => {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref so resetTimer doesn't change identity when warning shows (avoids effect re-run clearing timers)
  const warningActiveRef = useRef(false);
  const navigate = useNavigate();

  const clearAllTimers = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const logout = useCallback(async () => {
    clearAllTimers();
    warningActiveRef.current = false;
    await supabase.auth.signOut();
    navigate("/login", { state: { message: "Session expired due to inactivity" }, replace: true });
  }, [navigate, clearAllTimers]);

  const startWarning = useCallback(() => {
    warningActiveRef.current = true;
    setShowWarning(true);
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    warningRef.current = setTimeout(() => logout(), WARNING_MS);
  }, [logout]);

  const resetTimer = useCallback(() => {
    if (warningActiveRef.current) return;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(startWarning, IDLE_TIMEOUT_MS);
  }, [startWarning]);

  const handleContinue = useCallback(() => {
    clearAllTimers();
    warningActiveRef.current = false;
    setShowWarning(false);
    setCountdown(60);
    idleRef.current = setTimeout(startWarning, IDLE_TIMEOUT_MS);
  }, [clearAllTimers, startWarning]);

  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    const handler = () => resetTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      clearAllTimers();
    };
  }, [resetTimer, clearAllTimers]);

  if (!showWarning) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="bg-background rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Session Timeout</h2>
        <p className="text-muted-foreground mb-6">
          Your session will expire in <span className="font-bold text-destructive">{countdown}s</span>.
          <br />Click Continue to stay logged in.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleContinue}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Continue Working
          </button>
          <button
            onClick={logout}
            className="px-6 py-2.5 bg-destructive text-destructive-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Logout Now
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default IdleTimer;
