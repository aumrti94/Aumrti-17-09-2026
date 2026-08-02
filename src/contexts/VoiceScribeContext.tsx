import React, { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { VoiceScribeContext } from "@/hooks/useVoiceScribe";
import type { LanguageOption } from "@/lib/voiceScribeLanguages";

// Type-only re-export: existing importers keep working, and a type export does
// not trip react-refresh/only-export-components the way a value export does.
export type { LanguageOption };

export type PanelState = "ready" | "recording" | "processing" | "output" | "fallback" | "transcribing";
// "ipd_workspace" was always passed by IPDWorkspace.tsx but was missing from this union,
// so it type-checked as a bare string and fell through to the OPD prompt server-side.
export type SessionType =
  | "opd_consultation" | "ward_round" | "emergency" | "nursing_note" | "ipd_workspace";

/** Per-segment ASR signal, kept so confidence can be measured rather than guessed. */
export interface ScribeSegmentSignal {
  /** Sarvam `language_probability`, or null when the engine reported none. */
  languageProbability: number | null;
  words: number;
}

/** A term the deterministic lexicon pass rewrote, shown to the doctor for review. */
export interface ScribeRepair {
  from: string;
  to: string;
  score: number;
  source: string;
}

/**
 * Everything measured about a dictation, as opposed to what the LLM claimed about it.
 * Feeds src/lib/scribeConfidence.ts.
 */
export interface ScribeSignals {
  segments: ScribeSegmentSignal[];
  repetition: { repetitionRatio: number; maxRepeats: number } | null;
  lexiconHitRate: number | null;
  repairs: ScribeRepair[];
  /** The English text the structuring model actually read. */
  englishTranscript: string;
  preTranslated: boolean;
  safetyCheck: { safe: boolean; flags: unknown[] } | null;
}



export interface VoiceScribeContextType {
  isRecording: boolean;
  isPanelOpen: boolean;
  panelState: PanelState;
  rawTranscript: string;
  structuredOutput: Record<string, unknown> | null;
  currentSessionType: SessionType;
  currentPatientId: string | null;
  selectedLanguage: string;
  fallbackReason: string;
  setSelectedLanguage: (v: string) => void;
  setIsRecording: (v: boolean) => void;
  setIsPanelOpen: (v: boolean) => void;
  setPanelState: (v: PanelState) => void;
  setRawTranscript: (v: string) => void;
  setStructuredOutput: (v: Record<string, unknown> | null) => void;
  setCurrentSessionType: (v: SessionType) => void;
  setCurrentPatientId: (v: string | null) => void;
  setFallbackReason: (v: string) => void;
  registerScreen: (
    screenId: string,
    fillFn: (data: Record<string, unknown>) => void,
    getExistingData?: () => Record<string, unknown> | null,
  ) => void;
  unregisterScreen: (screenId: string) => void;
  applyToCurrentScreen: () => void;
  // Snapshot of what the active screen already has in its form, mapped to the
  // AI's field schema — sent as `existing_data` so a follow-up recording MERGES
  // with (rather than overwrites) the current note. Null when nothing is filled.
  getExistingDataForCurrentScreen: () => Record<string, unknown> | null;
  resetSession: () => void;
  detectedSessionType: SessionType;
  /** Measured signals for this dictation — null until structuring completes. */
  scribeSignals: ScribeSignals | null;
  setScribeSignals: (v: ScribeSignals | null) => void;
  /**
   * The dictation in its ORIGINAL language, fetched lazily only if the doctor asks to
   * see it. Sarvam now returns English in one call; re-transcribing for the native view
   * is a second billable call, so it is paid for only when actually used.
   */
  nativeTranscript: string | null;
  setNativeTranscript: (v: string | null) => void;
  /**
   * Background audio-rescue status. The note is shown as soon as it is ready; when a
   * dictation scored badly a second pass re-listens to the worst segment and quietly
   * replaces the note. "running" lets the panel say so instead of looking frozen.
   */
  rescueState: "idle" | "running" | "improved";
  setRescueState: (v: "idle" | "running" | "improved") => void;
  /**
   * Recorded audio segments, retained IN MEMORY ONLY for the life of the session.
   * Powers both the native-transcript view and the low-confidence audio rescue.
   * This is PHI — it is never written to disk or Storage, and is dropped by
   * resetSession(). Deliberately a ref: the panel reads it without re-rendering
   * on every segment.
   */
  segmentBlobsRef: React.MutableRefObject<Blob[]>;
}

function detectSessionTypeFromPath(pathname: string): SessionType {
  if (pathname.startsWith("/opd")) return "opd_consultation";
  if (pathname.startsWith("/ipd")) return "ward_round";
  if (pathname.startsWith("/emergency")) return "emergency";
  if (pathname.startsWith("/nursing")) return "nursing_note";
  return "opd_consultation";
}

export const VoiceScribeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [isRecording, setIsRecording] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>("ready");
  const [rawTranscript, setRawTranscript] = useState("");
  const [structuredOutput, setStructuredOutput] = useState<Record<string, unknown> | null>(null);
  const [currentSessionType, setCurrentSessionType] = useState<SessionType>("opd_consultation");
  // Which patient the panel is currently scribing for — set by whichever
  // screen's VoiceDictationButton starts a recording, so ai-clinical-voice
  // can pull that patient's known allergies/medications for safety checks.
  const [currentPatientId, setCurrentPatientId] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState("");
  const [selectedLanguage, setSelectedLanguageState] = useState<string>(
    () => localStorage.getItem("vscribe_preferred_language") || "auto"
  );
  const [scribeSignals, setScribeSignals] = useState<ScribeSignals | null>(null);
  const [nativeTranscript, setNativeTranscript] = useState<string | null>(null);
  const [rescueState, setRescueState] = useState<"idle" | "running" | "improved">("idle");
  const segmentBlobsRef = useRef<Blob[]>([]);
  const screenFillFns = useRef<Map<string, (data: Record<string, unknown>) => void>>(new Map());
  const screenExistingDataFns = useRef<Map<string, () => Record<string, unknown> | null>>(new Map());

  const setSelectedLanguage = useCallback((lang: string) => {
    setSelectedLanguageState(lang);
    localStorage.setItem("vscribe_preferred_language", lang);
  }, []);

  const detectedSessionType = detectSessionTypeFromPath(location.pathname);

  useEffect(() => {
    // Only fall back to route detection when there is NO live session. A mounted
    // VoiceDictationButton sets the session type explicitly from its own prop, and
    // that must survive until the panel closes.
    //
    // This is why IPD dictation never worked: IPDWorkspace sets "ipd_workspace", but
    // the moment recording stopped this effect rewrote it to "ward_round" (every /ipd
    // route detects as ward_round), so the panel rendered ward-round fields for an
    // order dictation. The other screens never showed the bug because their explicit
    // type and their detected type happen to be identical.
    if (!isRecording && !isPanelOpen) {
      setCurrentSessionType(detectedSessionType);
    }
  }, [detectedSessionType, isRecording, isPanelOpen]);

  const registerScreen = useCallback((
    screenId: string,
    fillFn: (data: Record<string, unknown>) => void,
    getExistingData?: () => Record<string, unknown> | null,
  ) => {
    screenFillFns.current.set(screenId, fillFn);
    if (getExistingData) screenExistingDataFns.current.set(screenId, getExistingData);
    else screenExistingDataFns.current.delete(screenId);
  }, []);

  const unregisterScreen = useCallback((screenId: string) => {
    screenFillFns.current.delete(screenId);
    screenExistingDataFns.current.delete(screenId);
  }, []);

  const applyToCurrentScreen = useCallback(() => {
    if (!structuredOutput) return;
    screenFillFns.current.forEach((fn) => fn(structuredOutput));
  }, [structuredOutput]);

  const getExistingDataForCurrentScreen = useCallback((): Record<string, unknown> | null => {
    let merged: Record<string, unknown> | null = null;
    screenExistingDataFns.current.forEach((fn) => {
      const d = fn();
      if (d && Object.keys(d).length > 0) merged = { ...(merged || {}), ...d };
    });
    return merged;
  }, []);

  const resetSession = useCallback(() => {
    setIsRecording(false);
    setPanelState("ready");
    setRawTranscript("");
    setStructuredOutput(null);
    setFallbackReason("");
    setScribeSignals(null);
    setNativeTranscript(null);
    // Drop the retained PHI audio as soon as the session ends.
    segmentBlobsRef.current = [];
  }, []);

  return (
    <VoiceScribeContext.Provider value={{
      isRecording, isPanelOpen, panelState, rawTranscript, structuredOutput,
      currentSessionType, currentPatientId, selectedLanguage, fallbackReason, setSelectedLanguage,
      setIsRecording, setIsPanelOpen, setPanelState,
      setRawTranscript, setStructuredOutput, setCurrentSessionType, setCurrentPatientId, setFallbackReason,
      registerScreen, unregisterScreen, applyToCurrentScreen, getExistingDataForCurrentScreen, resetSession,
      detectedSessionType,
      scribeSignals, setScribeSignals, nativeTranscript, setNativeTranscript, segmentBlobsRef,
      rescueState, setRescueState,
    }}>
      {children}
    </VoiceScribeContext.Provider>
  );
};
