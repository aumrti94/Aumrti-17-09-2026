import React, { useRef, useCallback, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Loader2, ChevronDown, Zap } from "lucide-react";
import { SessionType } from "@/contexts/VoiceScribeContext";
import { SUPPORTED_LANGUAGES } from "@/lib/voiceScribeLanguages";
import { useVoiceScribe } from "@/hooks/useVoiceScribe";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/invokeError";
import { joinTranscriptChunks, collapseRepetitionLoops } from "@/lib/transcriptMerge";
import {
  computeScribeConfidence, populatedSections, LOW_CONFIDENCE_THRESHOLD,
} from "@/lib/scribeConfidence";
import { structureWithStreaming } from "@/lib/voiceScribeStream";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVoiceScribeLanguages } from "@/hooks/useVoiceScribeLanguages";
import { useAIFeature } from "@/hooks/useAIFeature";

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

interface Props {
  sessionType: SessionType;
  patientId?: string | null;
  className?: string;
  size?: "sm" | "md";
}

const SARVAM_CHUNK_SECONDS = 25;

/** One transcribed segment plus whatever confidence signal the engine gave us. */
interface ChunkResult {
  text: string;
  languageProbability: number | null;
}

const VoiceDictationButton: React.FC<Props> = ({ sessionType, patientId, className, size = "md" }) => {
  const {
    isRecording, setIsRecording,
    setIsPanelOpen, setPanelState,
    setRawTranscript, setStructuredOutput,
    setCurrentSessionType, setCurrentPatientId, selectedLanguage, setSelectedLanguage,
    setFallbackReason, getExistingDataForCurrentScreen,
    setScribeSignals, setNativeTranscript, segmentBlobsRef, setRescueState,
  } = useVoiceScribe();

  // Keep the panel's notion of "current patient" in sync with whichever
  // screen this button is mounted on, so ai-clinical-voice can fetch that
  // patient's known allergies/medications for the safety-guard check.
  useEffect(() => {
    setCurrentPatientId(patientId ?? null);
  }, [patientId, setCurrentPatientId]);
  const { toast } = useToast();
  const voiceScribeAllowed = useAIFeature("voice_scribe");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Parallel recorder during Web Speech so we can fall back to Sarvam if the browser hears nothing.
  const webSpeechRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fullTranscriptRef = useRef("");
  const chunkTranscriptsRef = useRef<string[]>([]);
  // Per-segment ASR signal (Sarvam's language_probability + segment length), collected
  // so confidence can be MEASURED. Previously the engine returned this and the edge
  // function discarded it, leaving the badge as the LLM's opinion of itself.
  // `text` is kept alongside so a rescued segment can be spliced back into the
  // transcript in place, rather than restructuring from that segment alone.
  const segmentSignalsRef = useRef<{ languageProbability: number | null; words: number; text: string }[]>([]);
  // One rescue round per dictation, to bound cost.
  const rescueAttemptedRef = useRef(false);
  // Lets processTranscript re-enter itself after a rescue without a circular useCallback
  // dependency (the rescue path calls back into structuring exactly once).
  const processTranscriptRef = useRef<((t: string, allowRescue?: boolean) => Promise<void>) | null>(null);
  // Gapless-capture queue: audio segments transcribed sequentially in recording order.
  const segmentQueueRef = useRef<Blob[]>([]);
  const queueProcessingRef = useRef(false);
  const pendingFinalRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStoppingRef = useRef(false);
  const activeEngineRef = useRef<"web_speech" | "sarvam" | "bhashini">("sarvam");
  const [langOpen, setLangOpen] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const secondsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [adminEngine, setAdminEngine] = useState<string | null>(null);

  // Restore per-user language preference; fall back to hospital default
  const { hospitalDefaultLang, doctorId } = useVoiceScribeLanguages();
  useEffect(() => {
    if (!doctorId) return;
    const stored = localStorage.getItem(`vscribe_lang_${doctorId}`);
    if (stored) {
      if (stored !== selectedLanguage) setSelectedLanguage(stored);
    } else if (hospitalDefaultLang && hospitalDefaultLang !== selectedLanguage) {
      setSelectedLanguage(hospitalDefaultLang);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, hospitalDefaultLang]);

  const isWebSpeechSupported = typeof window !== "undefined" && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

  // Fetch the GLOBAL (platform-controlled) voice engine preference
  useEffect(() => {
    supabase.from("platform_ai_keys")
      .select("config")
      .eq("service_key", "voice_asr_engine")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.config) {
          setAdminEngine((data.config as Record<string, string>).engine || null);
        }
      });
  }, []);

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage) || SUPPORTED_LANGUAGES[0];

  // Engine priority:
  // "auto" or "en-IN" → browser Web Speech API (free, no API key required)
  // Specific Indian language + bhashini admin pref → Bhashini
  // Specific Indian language + web_speech admin pref → Web Speech
  // Specific Indian language (default) → Sarvam
  const resolveEngine = (): "web_speech" | "sarvam" | "bhashini" => {
    // Platform admin can force a global engine for every language.
    if (adminEngine === "bhashini") return "bhashini";
    if (adminEngine === "web_speech" && isWebSpeechSupported) return "web_speech";
    // Explicit English → free, instant browser Web Speech (auto-falls back to Sarvam if it hears nothing).
    if (selectedLanguage === "en-IN") return isWebSpeechSupported ? "web_speech" : "sarvam";
    // "auto" (multilingual, auto-detect) + every Indian language → Sarvam medical ASR.
    return "sarvam";
  };

  const activeEngine = resolveEngine();
  const useSarvamOrBhashini = activeEngine === "sarvam" || activeEngine === "bhashini";

  const visibleLanguages = SUPPORTED_LANGUAGES;

  useEffect(() => {
    return () => {
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      if (secondsTimerRef.current) clearInterval(secondsTimerRef.current);
    };
  }, []);

  // Declared above rescueWorstSegment and the chunk senders, which both use it.
  const blobToBase64 = useCallback(async (audioBlob: Blob): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });
  }, []);

  /**
   * Re-hear the single worst-scoring segment with a multimodal model and splice the
   * correction back into the transcript.
   *
   * Only worth doing when the cheap path clearly struggled: if the ASR turned a drug
   * name into phonetic mush, no text-only model can recover it, because the information
   * is no longer in the transcript. Restricted to one segment and one round so the
   * expensive tier stays a small minority of calls and the cheap path keeps its saving.
   *
   * Returns the improved transcript, or null when rescue was unavailable or unhelpful —
   * in which case the caller keeps the original result and the doctor is never blocked.
   */
  const rescueWorstSegment = useCallback(async (): Promise<string | null> => {
    const signals = segmentSignalsRef.current;
    const blobs = segmentBlobsRef.current;
    if (signals.length === 0 || blobs.length !== signals.length) return null;

    // Worst = lowest language probability; when the engine reported none, fall back to
    // the longest segment, which carries the most at risk.
    let worst = 0;
    const anyProb = signals.some(s => s.languageProbability !== null);
    for (let i = 1; i < signals.length; i++) {
      if (anyProb) {
        const a = signals[i].languageProbability ?? 1;
        const b = signals[worst].languageProbability ?? 1;
        if (a < b) worst = i;
      } else if (signals[i].words > signals[worst].words) {
        worst = i;
      }
    }

    const blob = blobs[worst];
    if (!blob || blob.size === 0) return null;

    try {
      const base64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke("ai-clinical-voice", {
        body: {
          rescue_only: true,
          rescue_audio_base64: base64,
          rescue_media_type: blob.type || "audio/webm",
          rescue_prior_text: signals[worst].text,
        },
      });
      if (error || data?.error) return null;
      const corrected: string | null = data?.corrected_text ?? null;
      if (!corrected?.trim()) return null;

      // Splice in place so the rest of the dictation is preserved verbatim.
      const rebuilt = signals.map((s, i) => (i === worst ? corrected.trim() : s.text)).filter(Boolean);
      signals[worst] = { ...signals[worst], text: corrected.trim() };
      return joinTranscriptChunks(rebuilt);
    } catch (err) {
      console.warn("Audio rescue failed (non-fatal):", err);
      return null;
    }
  }, [blobToBase64, segmentBlobsRef]);

  const processTranscript = useCallback(async (rawText: string, allowRescue = true) => {
    if (!rawText.trim()) return;
    setPanelState("processing");
    setIsPanelOpen(true);

    try {
      // Send whatever the form already holds so a repeat recording adds to it
      // (e.g. the doctor forgot to mention fever the first time) instead of
      // overwriting the earlier note.
      const existingData = getExistingDataForCurrentScreen();

      // Fold runaway ASR loops before spending tokens on them. A stuck recogniser can
      // emit the same phrase a dozen times; sending that verbatim both wastes input
      // budget and actively misleads the model about what was emphasised.
      const loop = collapseRepetitionLoops(rawText);
      const cleanedTranscript = loop.text;
      if (loop.removedWords > 0) {
        setRawTranscript(cleanedTranscript);
        fullTranscriptRef.current = cleanedTranscript;
      }

      const requestBody = {
        transcript: cleanedTranscript,
        context_type: sessionType,
        language_code: selectedLanguage,
        existing_data: existingData ?? undefined,
        patient_id: patientId ?? undefined,
        // Saaras already returned English, so the edge function must NOT pay for a
        // second per-character translation of text that is already translated.
        pre_translated_by: activeEngineRef.current === "sarvam" ? "sarvam_saaras" : undefined,
      };

      // Try streaming first so the note fills field by field instead of appearing all at
      // once after 10-20 s. ANY failure falls back to the buffered call — a partial note
      // is never presented as final.
      let data: Record<string, any> | null = null;
      try {
        data = await structureWithStreaming(requestBody, {
          onPartial: (fields) => {
            // Show the panel filling in as the model writes. `fields` is the complete set of
            // finished fields so far (extractCompleteFields rescans the whole buffer), so
            // this replaces rather than merges — no stale key can survive a correction.
            setStructuredOutput(fields);
            setPanelState("output");
          },
        });
      } catch (streamErr) {
        console.warn("Streaming unavailable, falling back to buffered:", streamErr);
        setStructuredOutput(null);
        setPanelState("processing");
        const { data: buffered, error } = await supabase.functions.invoke("ai-clinical-voice", {
          body: requestBody,
        });
        if (error || buffered?.error) throw new Error(await unwrapFunctionError(error, buffered));
        data = buffered;
      }
      if (!data?.structured) throw new Error("No structured note returned");

      const signals = {
        segments: segmentSignalsRef.current,
        repetition: { repetitionRatio: loop.repetitionRatio, maxRepeats: loop.maxRepeats },
        lexiconHitRate: typeof data.lexicon_hit_rate === "number" ? data.lexicon_hit_rate : null,
        repairs: Array.isArray(data.repairs) ? data.repairs : [],
        englishTranscript: typeof data.transcript_used === "string"
          ? data.transcript_used
          : cleanedTranscript,
        preTranslated: Boolean(data.pre_translated),
        safetyCheck: data.safety_check ?? null,
      };

      // Escalate ONLY when the cheap path measurably struggled. Everything above the
      // threshold — the great majority of dictations — is finished here, which is what
      // keeps the expensive audio tier from eating the token saving.
      const measured = computeScribeConfidence({
        segments: signals.segments,
        repetition: signals.repetition,
        lexiconHitRate: signals.lexiconHitRate,
        fieldConfidence: (data.structured?.field_confidence as Record<string, number | null>) ?? null,
        populatedSections: populatedSections(data.structured),
      });

      const shouldRescue =
        allowRescue &&
        !rescueAttemptedRef.current &&
        activeEngineRef.current === "sarvam" &&
        measured.overall !== null &&
        measured.overall < LOW_CONFIDENCE_THRESHOLD;

      // Show the note NOW. The rescue used to be awaited here, which meant a low-confidence
      // dictation ran the whole edge chain three times behind a single spinner with no sign
      // that a second round had even started — the doctor just waited longer. The result is
      // usable immediately; the rescue is an optional improvement that arrives after.
      setStructuredOutput(data.structured);
      setScribeSignals(signals);
      setPanelState("output");

      if (shouldRescue) {
        rescueAttemptedRef.current = true;
        setRescueState("running");
        void (async () => {
          try {
            const improved = await rescueWorstSegment();
            if (!improved || improved === cleanedTranscript) { setRescueState("idle"); return; }
            setRawTranscript(improved);
            fullTranscriptRef.current = improved;
            chunkTranscriptsRef.current = segmentSignalsRef.current.map(s => s.text).filter(Boolean);
            // Restructure once on the corrected text. `false` prevents a rescue loop.
            // The panel already shows a usable note, so this quietly replaces it.
            await processTranscriptRef.current?.(improved, false);
            setRescueState("improved");
          } catch {
            setRescueState("idle");
          }
        })();
      }
    } catch (err) {
      console.error("AI structuring failed:", err);
      const reason = err instanceof Error ? err.message : "AI structuring failed";
      setFallbackReason(reason);
      setPanelState("fallback");
    }
  }, [sessionType, patientId, selectedLanguage, getExistingDataForCurrentScreen, setPanelState, setIsPanelOpen, setStructuredOutput, setFallbackReason, setRawTranscript, setScribeSignals, rescueWorstSegment, setRescueState]);

  // Keep the self-reference current so the rescue path always calls the latest closure.
  useEffect(() => { processTranscriptRef.current = processTranscript; }, [processTranscript]);


  const sendChunkToSarvam = useCallback(async (audioBlob: Blob): Promise<ChunkResult> => {
    const base64 = await blobToBase64(audioBlob);

    const { data, error } = await supabase.functions.invoke("sarvam-transcribe", {
      body: {
        audio_base64: base64,
        language_code: selectedLanguage,
        model: "saaras:v3",
        // THE core fix. Saaras v3 defaults to mode="transcribe", which returns NATIVE
        // SCRIPT — which is why the transcript box showed raw Telugu and the structuring
        // LLM was being asked to translate AND structure inside one 1200-token budget.
        // "translate" returns English from the same call at the same cost, and Indic
        // script costs several times more LLM tokens per word than English does.
        mode: "translate",
      },
    });

    if (error || data?.error) throw new Error(data?.error || error?.message);
    return {
      text: data.transcript || "",
      languageProbability: typeof data.language_probability === "number"
        ? data.language_probability
        : null,
    };
  }, [selectedLanguage, blobToBase64]);

  const sendChunkToBhashini = useCallback(async (audioBlob: Blob): Promise<ChunkResult> => {
    const base64 = await blobToBase64(audioBlob);

    const { data, error } = await supabase.functions.invoke("bhashini-transcribe", {
      body: {
        audio_base64: base64,
        language_code: selectedLanguage,
      },
    });

    if (error || data?.error) throw new Error(data?.error || error?.message);
    // Bhashini's ULCA pipeline exposes no confidence field at all.
    return { text: data.transcript || "", languageProbability: null };
  }, [selectedLanguage, blobToBase64]);

  const sendChunk = useCallback(async (audioBlob: Blob): Promise<ChunkResult> => {
    if (activeEngineRef.current === "bhashini") {
      return sendChunkToBhashini(audioBlob);
    }
    return sendChunkToSarvam(audioBlob);
  }, [sendChunkToSarvam, sendChunkToBhashini]);

  // Transcribe queued audio segments sequentially (recording order preserved), then
  // finalize once the user has stopped and every segment has been transcribed.
  const drainQueue = useCallback(async () => {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    while (segmentQueueRef.current.length > 0) {
      const blob = segmentQueueRef.current.shift()!;
      try {
        const { text, languageProbability } = await sendChunk(blob);
        // Retain the audio IN MEMORY for the session. It powers the native-language
        // transcript view and the low-confidence audio rescue, both of which would
        // otherwise need the doctor to dictate again. Never persisted — this is PHI.
        segmentBlobsRef.current.push(blob);
        segmentSignalsRef.current.push({
          languageProbability,
          words: text.trim() ? text.trim().split(/\s+/).length : 0,
          text: text.trim(),
        });
        if (text.trim()) {
          chunkTranscriptsRef.current.push(text.trim());
          // Segments overlap by ~200ms on purpose (gapless), so the seam is transcribed twice —
          // stitch it instead of naively join(" ")-ing, which duplicated words every 25s and
          // corrupted the transcript the structuring AI reads.
          const combined = joinTranscriptChunks(chunkTranscriptsRef.current);
          setRawTranscript(combined);
          fullTranscriptRef.current = combined;
        }
      } catch (err) {
        console.error("Segment transcription failed:", err);
      }
    }
    queueProcessingRef.current = false;

    if (pendingFinalRef.current && segmentQueueRef.current.length === 0) {
      pendingFinalRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const finalTranscript = joinTranscriptChunks(chunkTranscriptsRef.current);
      setRawTranscript(finalTranscript);
      fullTranscriptRef.current = finalTranscript;
      if (finalTranscript) {
        await processTranscript(finalTranscript);
      } else {
        const engineName = activeEngineRef.current === "sarvam" ? "Sarvam" : activeEngineRef.current === "bhashini" ? "Bhashini" : null;
        toast({
          title: engineName ? "No transcript returned" : "No speech detected",
          description: engineName ? `${engineName} couldn't transcribe the audio. Please try again.` : "Try speaking louder or closer to the mic.",
          variant: "destructive",
        });
        setPanelState("ready");
      }
    }
  }, [sendChunk, processTranscript, setRawTranscript, setPanelState, toast, segmentBlobsRef]);

  // --- MediaRecorder flow (Sarvam/Bhashini) with OVERLAPPING segments (gapless) ---
  // Sarvam caps a request at 30s, so long dictation is split. To avoid dropping audio
  // at boundaries, the next segment starts BEFORE the previous one stops (small overlap),
  // and each self-contained segment is queued for in-order transcription.
  const startMediaRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunkTranscriptsRef.current = [];
      fullTranscriptRef.current = "";
      segmentQueueRef.current = [];
      segmentSignalsRef.current = [];
      rescueAttemptedRef.current = false;
      // Drop the previous session's retained audio and its native-language view.
      segmentBlobsRef.current = [];
      setNativeTranscript(null);
      setScribeSignals(null);
      queueProcessingRef.current = false;
      pendingFinalRef.current = false;
      isStoppingRef.current = false;
      activeEngineRef.current = activeEngine;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";

      const makeSegment = (): MediaRecorder => {
        const rec = new MediaRecorder(stream, { mimeType });
        const localChunks: Blob[] = [];
        rec.ondataavailable = (e) => { if (e.data.size > 0) localChunks.push(e.data); };
        rec.onstop = () => {
          const isFinal = isStoppingRef.current;
          const blob = new Blob(localChunks, { type: "audio/webm" });
          localChunks.length = 0;
          if (blob.size > 0) segmentQueueRef.current.push(blob);
          if (isFinal) pendingFinalRef.current = true;
          drainQueue();
        };
        return rec;
      };

      const first = makeSegment();
      first.start(1000);
      mediaRecorderRef.current = first;

      chunkTimerRef.current = setInterval(() => {
        if (isStoppingRef.current) return;
        const prev = mediaRecorderRef.current;
        if (!prev || prev.state !== "recording") return;
        const next = makeSegment();
        try { next.start(1000); } catch { return; }
        mediaRecorderRef.current = next;
        // Keep `prev` running ~200ms past the new segment's start → guaranteed overlap, no gap.
        setTimeout(() => { try { if (prev.state === "recording") prev.stop(); } catch { /* already stopped */ } }, 200);
      }, SARVAM_CHUNK_SECONDS * 1000);

      setRecordingSeconds(0);
      secondsTimerRef.current = setInterval(() => { setRecordingSeconds(s => s + 1); }, 1000);

      setCurrentSessionType(sessionType);
      setIsRecording(true);
      setIsPanelOpen(true);
      setPanelState("recording");
      setRawTranscript("");
    } catch (err) {
      console.error("Microphone access failed:", err);
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }, [sessionType, activeEngine, drainQueue, setIsRecording, setIsPanelOpen, setPanelState, setRawTranscript, setCurrentSessionType, toast, segmentBlobsRef, setNativeTranscript, setScribeSignals]);

  // --- Web Speech API flow (English) with automatic Sarvam fallback ---
  const startWebSpeechRecording = useCallback(async () => {
    if (!isWebSpeechSupported) {
      toast({ title: "Voice not supported", description: "Use Chrome or Edge", variant: "destructive" });
      return;
    }

    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    const recognition = new (SR as new () => SpeechRecognitionLike)();
    recognition.lang = (selectedLanguage === "auto" || !selectedLanguage) ? "" : selectedLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;

    fullTranscriptRef.current = "";
    setRawTranscript("");
    setCurrentSessionType(sessionType);

    setRecordingSeconds(0);
    secondsTimerRef.current = setInterval(() => {
      setRecordingSeconds(s => s + 1);
    }, 1000);

    // Capture audio in parallel so that if Web Speech hears nothing we can still
    // transcribe via Sarvam (the browser recognizer can silently return empty).
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
      });
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        // Web Speech already produced text → handled in recognition.onend.
        if (fullTranscriptRef.current.trim()) return;
        // Browser heard nothing → fall back to Sarvam on the recorded audio.
        if (audioChunksRef.current.length === 0) {
          toast({ title: "No speech detected", description: "Please try again or pick a language.", variant: "destructive" });
          setPanelState("ready");
          return;
        }
        setPanelState("transcribing");
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        try {
          const { text, languageProbability } = await sendChunkToSarvam(blob);
          if (text.trim()) {
            // The Sarvam fallback owns the whole recording, so its signal and audio
            // replace anything the (silent) Web Speech attempt left behind.
            segmentBlobsRef.current = [blob];
            segmentSignalsRef.current = [{
              languageProbability, words: text.trim().split(/\s+/).length, text: text.trim(),
            }];
            activeEngineRef.current = "sarvam";
            setRawTranscript(text.trim());
            await processTranscript(text.trim());
            return;
          }
        } catch (err) {
          console.error("Sarvam fallback failed:", err);
        }
        toast({ title: "No speech detected", description: "Couldn't capture your dictation. Please try again.", variant: "destructive" });
        setPanelState("ready");
      };
      rec.start(1000);
      webSpeechRecorderRef.current = rec;
    } catch {
      // Mic capture for the fallback is unavailable — Web Speech may still work on its own.
    }

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
      setRawTranscript(final + interim);
    };

    recognition.onerror = (e) => {
      if (e.error !== "aborted") {
        toast({ title: `Speech error: ${e.error}`, variant: "destructive" });
      }
      setIsRecording(false);
      if (secondsTimerRef.current) { clearInterval(secondsTimerRef.current); secondsTimerRef.current = null; }
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (secondsTimerRef.current) { clearInterval(secondsTimerRef.current); secondsTimerRef.current = null; }
      // Stop the parallel recorder — its onstop runs the Sarvam fallback when the transcript is empty.
      try { webSpeechRecorderRef.current?.stop(); } catch { /* not recording */ }
      webSpeechRecorderRef.current = null;
      if (fullTranscriptRef.current.trim()) {
        processTranscript(fullTranscriptRef.current.trim());
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setIsPanelOpen(true);
    setPanelState("recording");
  }, [isWebSpeechSupported, selectedLanguage, sessionType, processTranscript, sendChunkToSarvam, setIsRecording, setIsPanelOpen, setPanelState, setRawTranscript, setCurrentSessionType, toast, segmentBlobsRef]);

  const startRecording = useCallback(() => {
    if (useSarvamOrBhashini) {
      startMediaRecording();
    } else {
      startWebSpeechRecording();
    }
  }, [useSarvamOrBhashini, startMediaRecording, startWebSpeechRecording]);

  const stopRecording = useCallback(() => {
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (secondsTimerRef.current) { clearInterval(secondsTimerRef.current); secondsTimerRef.current = null; }

    if (useSarvamOrBhashini && mediaRecorderRef.current) {
      isStoppingRef.current = true;
      setPanelState("transcribing");
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
    } else {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    }
  }, [useSarvamOrBhashini, setIsRecording, setPanelState]);

  if (!voiceScribeAllowed) return null; // AI master or voice-scribe feature disabled
  if (!isWebSpeechSupported && !useSarvamOrBhashini) return null;

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = size === "sm" ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs";

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const getEngineBadge = (lang: typeof SUPPORTED_LANGUAGES[0]) => {
    if (lang.code === "auto") {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
          ✨ Recommended
        </span>
      );
    }
    if (lang.code === "en-IN") {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          <Zap className="h-2.5 w-2.5" /> instant
        </span>
      );
    }
    return null;
  };

  return (
    <div className={cn("relative inline-flex items-center gap-1", className)}>
      {/* Language selector */}
      <Popover open={langOpen} onOpenChange={setLangOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "rounded-md font-medium flex items-center gap-1 transition-all border border-border bg-background text-foreground hover:bg-muted",
              size === "sm" ? "h-7 px-1.5 text-[11px]" : "h-8 px-2 text-xs"
            )}
            disabled={isRecording}
          >
            <span>{currentLang.flag}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1.5 max-h-[320px] overflow-y-auto" align="start" sideOffset={6}>
          <div className="space-y-0.5">
            {visibleLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setSelectedLanguage(lang.code);
                  if (doctorId) localStorage.setItem(`vscribe_lang_${doctorId}`, lang.code);
                  setLangOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors",
                  lang.code === selectedLanguage
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <span className="text-sm">{lang.flag}</span>
                <span className="flex-1 text-left">{lang.label}</span>
                {getEngineBadge(lang)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Mic button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className={cn(
          "rounded-full font-semibold flex items-center justify-center transition-all active:scale-[0.90]",
          isRecording
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse h-14 w-auto px-5 gap-2 shadow-[0_0_24px_-2px_rgba(239,68,68,0.6)]"
            : "bg-gradient-to-br from-blue-500 via-indigo-500 to-cyan-400 text-white hover:from-blue-600 hover:via-indigo-600 hover:to-cyan-500 h-14 w-14 shadow-[0_0_28px_-4px_rgba(59,130,246,0.65)] hover:shadow-[0_0_36px_-2px_rgba(59,130,246,0.8)]"
        )}
      >
        {isRecording ? (
          <><MicOff className="h-6 w-6" /> Stop {formatTime(recordingSeconds)}</>
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </button>
    </div>
  );
};

export default VoiceDictationButton;
