import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";

export type PanelState = "ready" | "recording" | "processing" | "output" | "fallback" | "transcribing";
export type SessionType = "opd_consultation" | "ward_round" | "emergency" | "nursing_note";

export interface LanguageOption {
  code: string;
  label: string;
  flag: string;
  engine: "web_speech" | "sarvam" | "bhashini";
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", label: "Auto (Multilingual)", flag: "🌐", engine: "sarvam" },
  { code: "en-IN", label: "English", flag: "🇺🇸", engine: "web_speech" },
  { code: "hi-IN", label: "Hindi", flag: "🇮🇳", engine: "sarvam" },
  { code: "te-IN", label: "Telugu", flag: "🌟", engine: "sarvam" },
  { code: "ta-IN", label: "Tamil", flag: "🌟", engine: "sarvam" },
  { code: "kn-IN", label: "Kannada", flag: "🌟", engine: "sarvam" },
  { code: "ml-IN", label: "Malayalam", flag: "🌟", engine: "sarvam" },
  { code: "mr-IN", label: "Marathi", flag: "🌟", engine: "sarvam" },
  { code: "bn-IN", label: "Bengali", flag: "🌟", engine: "sarvam" },
  { code: "gu-IN", label: "Gujarati", flag: "🌟", engine: "sarvam" },
  { code: "or-IN", label: "Odia", flag: "🌟", engine: "sarvam" },
  { code: "pa-IN", label: "Punjabi", flag: "🌟", engine: "sarvam" },
  { code: "as-IN", label: "Assamese", flag: "🌟", engine: "sarvam" },
  { code: "ur-IN", label: "Urdu", flag: "🌟", engine: "sarvam" },
  { code: "sa-IN", label: "Sanskrit", flag: "🌟", engine: "sarvam" },
  { code: "ne-IN", label: "Nepali", flag: "🌟", engine: "sarvam" },
  { code: "sd-IN", label: "Sindhi", flag: "🌟", engine: "sarvam" },
  { code: "kok-IN", label: "Konkani", flag: "🌟", engine: "sarvam" },
  { code: "doi-IN", label: "Dogri", flag: "🌟", engine: "sarvam" },
  { code: "mai-IN", label: "Maithili", flag: "🌟", engine: "sarvam" },
  { code: "mni-IN", label: "Manipuri", flag: "🌟", engine: "sarvam" },
  { code: "sat-IN", label: "Santali", flag: "🌟", engine: "sarvam" },
  { code: "bo-IN", label: "Bodo", flag: "🌟", engine: "sarvam" },
];

interface VoiceScribeContextType {
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
}

const VoiceScribeContext = createContext<VoiceScribeContextType | null>(null);

export const useVoiceScribe = () => {
  const ctx = useContext(VoiceScribeContext);
  if (!ctx) throw new Error("useVoiceScribe must be used inside VoiceScribeProvider");
  return ctx;
};

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
  const screenFillFns = useRef<Map<string, (data: Record<string, unknown>) => void>>(new Map());
  const screenExistingDataFns = useRef<Map<string, () => Record<string, unknown> | null>>(new Map());

  const setSelectedLanguage = useCallback((lang: string) => {
    setSelectedLanguageState(lang);
    localStorage.setItem("vscribe_preferred_language", lang);
  }, []);

  const detectedSessionType = detectSessionTypeFromPath(location.pathname);

  useEffect(() => {
    if (!isRecording) {
      setCurrentSessionType(detectedSessionType);
    }
  }, [detectedSessionType, isRecording]);

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
  }, []);

  return (
    <VoiceScribeContext.Provider value={{
      isRecording, isPanelOpen, panelState, rawTranscript, structuredOutput,
      currentSessionType, currentPatientId, selectedLanguage, fallbackReason, setSelectedLanguage,
      setIsRecording, setIsPanelOpen, setPanelState,
      setRawTranscript, setStructuredOutput, setCurrentSessionType, setCurrentPatientId, setFallbackReason,
      registerScreen, unregisterScreen, applyToCurrentScreen, getExistingDataForCurrentScreen, resetSession,
      detectedSessionType,
    }}>
      {children}
    </VoiceScribeContext.Provider>
  );
};
