import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Mic } from "lucide-react";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface Props {
  /** IETF code from useVoiceScribeLanguages; "auto" lets the browser pick. */
  lang: string;
  /** Recognised text for a single utterance — the caller decides how to merge it. */
  onTranscript: (text: string) => void;
  className?: string;
  title?: string;
}

/**
 * Single-field dictation, same behaviour as the Chief Complaint mic: one utterance
 * per click, straight into the field. This is deliberately NOT the full voice scribe
 * (VoiceDictationButton) — there is nothing to structure in a single free-text box.
 */
const FieldDictationButton: React.FC<Props> = ({ lang, onTranscript, className, title = "Click and speak" }) => {
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const isSupported = typeof window !== "undefined" && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

  const handleClick = () => {
    if (recording) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setRecording(false);
      return;
    }

    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new (SR as new () => SpeechRecognitionLike)();
    recognition.lang = (!lang || lang === "auto") ? "" : lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      onTranscript(e.results[0][0].transcript);
      setRecording(false);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0",
        recording ? "bg-red-500 animate-pulse" : "bg-[#1A2F5A] hover:bg-[#152647]",
        className
      )}
    >
      <Mic className="h-3.5 w-3.5 text-white" />
    </button>
  );
};

export default FieldDictationButton;
