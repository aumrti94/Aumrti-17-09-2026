import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type VoiceContextType = "complaint" | "examination" | "prescription" | "ward_round" | "notes";

interface UseVoiceDictationOptions {
  contextType: VoiceContextType;
  existingData?: Record<string, unknown>;
  onStructuredResult?: (data: Record<string, unknown>) => void;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function useVoiceDictation({ contextType, existingData, onStructuredResult }: UseVoiceDictationOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fullTranscriptRef = useRef("");
  const { toast } = useToast();

  const isSupported = typeof window !== "undefined" && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

  const processTranscript = useCallback(async (rawTranscript: string) => {
    if (!rawTranscript.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-clinical-voice", {
        body: {
          transcript: rawTranscript,
          context_type: contextType,
          existing_data: existingData,
        },
      });

      if (fnError) throw new Error(fnError.message || "AI processing failed");
      if (data?.error) throw new Error(data.error);

      if (data?.structured && onStructuredResult) {
        onStructuredResult(data.structured);
        toast({ title: "✨ Voice notes processed", description: "Fields auto-filled from your dictation" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to process voice";
      setError(msg);
      toast({ title: "Voice processing failed", description: msg, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [contextType, existingData, onStructuredResult, toast]);

  const startRecording = useCallback(() => {
    if (!isSupported) {
      toast({ title: "Voice not supported", description: "Use Chrome or Edge for voice dictation", variant: "destructive" });
      return;
    }

    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    const recognition = new (SR as new () => SpeechRecognitionLike)();
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;

    fullTranscriptRef.current = "";
    setTranscript("");
    setError(null);

    recognition.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          final += r[0].transcript + " ";
        } else {
          interim += r[0].transcript;
        }
      }
      fullTranscriptRef.current = final;
      setTranscript(final + interim);
    };

    recognition.onerror = (e) => {
      if (e.error !== "aborted") {
        setError(`Speech error: ${e.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      // Auto-process when recording ends
      if (fullTranscriptRef.current.trim()) {
        processTranscript(fullTranscriptRef.current.trim());
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isSupported, processTranscript, toast]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  return {
    isRecording,
    isProcessing,
    transcript,
    error,
    isSupported,
    startRecording,
    stopRecording,
    processTranscript, // for manual re-process
  };
}
