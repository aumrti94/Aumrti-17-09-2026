import React, { useRef, useCallback, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Loader2, ChevronDown, Zap, Pause, Play } from "lucide-react";
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
import {
  buildChain, resolveNoteLanguage, transcriptIsPreTranslated,
  sarvamModeFor, transcribeRetryLeg,
  type AsrLeg, type AsrEngine, type SarvamMode,
} from "@/lib/asrEngineChain";
import { webmToWav16k } from "@/lib/audioToWav";
import { createDictationAudioChain, dictationAudioConstraints } from "@/lib/dictationAudioChain";

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

/**
 * How long the outgoing segment keeps recording after the next one has started.
 *
 * This was 200ms, which is shorter than a single word: an English word runs 300-600ms, and
 * a freshly-started Opus encoder needs priming on top of that. So a word spoken across a
 * 25s boundary was a fragment in BOTH segments and transcribed correctly in neither — a
 * silent source of "it missed some words" on any dictation over 25 seconds.
 *
 * The cost of a longer overlap is a slightly larger duplicated seam, which
 * joinTranscriptChunks already removes.
 */
const SEGMENT_OVERLAP_MS = 800;

/** One transcribed segment plus whatever confidence signal the engine gave us. */
interface ChunkResult {
  text: string;
  languageProbability: number | null;
  /** What the engine reported hearing. Sarvam detects; Bhashini echoes what it was told. */
  detectedLanguage: string | null;
}

/** A segment that was transcribed, plus which leg of the chain actually served it. */
interface ServedChunk extends ChunkResult {
  leg: AsrLeg;
}

/** Why a whole dictation produced nothing, per engine, so the panel can say something true. */
interface LegFailure {
  engine: AsrEngine;
  message: string;
  /** The code actually sent to this provider — the thing an administrator needs to see. */
  langCode?: string;
  /** Which Saaras decode was tried. Distinguishes "translate found nothing" from "neither did". */
  mode?: SarvamMode;
}

const VoiceDictationButton: React.FC<Props> = ({ sessionType, patientId, className, size = "md" }) => {
  const {
    isRecording, setIsRecording,
    setIsPanelOpen, setPanelState,
    setRawTranscript, setStructuredOutput,
    setCurrentSessionType, setCurrentPatientId, selectedLanguage, setSelectedLanguage,
    setFallbackReason, getExistingDataForCurrentScreen,
    setScribeSignals, setNativeTranscript, segmentBlobsRef, setRescueState,
    selectedMicId, noiseCleanupEnabled, nearFieldGateEnabled, isPaused, setIsPaused,
    audioChainRef,
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
  /**
   * Paused, readable from inside the 25s rotation interval.
   *
   * The interval closure is created once at record time and would capture the initial
   * `isPaused` state forever, so it cannot read the React value — and rotating recorders
   * while paused would hand over to a fresh recorder in the `recording` state, silently
   * un-pausing the dictation.
   */
  const isPausedRef = useRef(false);
  /**
   * Which leg served each transcribed segment.
   *
   * Deliberately NOT a single "active engine": with failover a dictation can be served by
   * more than one provider, and the difference matters downstream. Sarvam runs
   * mode=translate and returns ENGLISH; Bhashini returns NATIVE SCRIPT. `pre_translated_by`
   * is derived from all of these together, because claiming a mixed transcript is already
   * English makes ai-clinical-voice skip translation and the note comes out half in
   * Devanagari.
   */
  const legsUsedRef = useRef<AsrLeg[]>([]);
  /** Per-leg failure reasons for a dictation that produced nothing, so the panel can say why. */
  const legFailuresRef = useRef<LegFailure[]>([]);
  /**
   * Segments no engine could transcribe. These are real gaps in the note — words were spoken
   * and never reached the structuring model — so the count is surfaced to the doctor rather
   * than absorbed. An empty transcript used to be recorded as a successful segment, which is
   * how a dictation could quietly lose 25 s of speech.
   */
  const droppedSegmentsRef = useRef(0);
  /**
   * The language Sarvam reported hearing. Needed for two things "auto" could not do before:
   * giving Bhashini a `sourceLanguage` for its fallback leg, and telling ai-clinical-voice
   * a real language instead of the literal "auto".
   */
  const detectedLangRef = useRef<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const secondsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [adminEngine, setAdminEngine] = useState<string | null>(null);

  // Restore per-user language preference; fall back to hospital default.
  // `languages` is the catalogue the hook resolved — read it rather than SUPPORTED_LANGUAGES
  // directly, so there is one notion of "what this hospital can pick" instead of three.
  const { hospitalDefaultLang, doctorId, languages: availableLanguages } = useVoiceScribeLanguages();
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

  /**
   * The ordered engines to try for this dictation — see src/lib/asrEngineChain.ts.
   *
   * This used to be a single engine per language, so a Sarvam failure ended the dictation
   * and read to the doctor as "this language does not work". Now every language has a
   * second provider behind it, and a language is unavailable only when both decline it.
   *
   * `detectedLangRef` is threaded in because Bhashini cannot auto-detect: for "auto", the
   * language Sarvam already reported hearing is what makes its fallback leg possible.
   */
  const buildChainNow = useCallback((): AsrLeg[] => buildChain({
    selected: selectedLanguage,
    detected: detectedLangRef.current,
    hospitalDefault: hospitalDefaultLang,
    webSpeechSupported: isWebSpeechSupported,
    adminEngine,
  }), [selectedLanguage, hospitalDefaultLang, isWebSpeechSupported, adminEngine]);

  // Only the FIRST leg decides how recording is captured: Web Speech streams from the
  // browser recogniser, everything else records audio for upload. The remaining legs are
  // server-side and operate on that same recorded audio either way.
  const firstLeg = buildChainNow()[0];
  const activeEngine: AsrEngine = firstLeg?.engine ?? "sarvam";
  const useSarvamOrBhashini = activeEngine === "sarvam" || activeEngine === "bhashini";

  const visibleLanguages = availableLanguages;

  useEffect(() => {
    return () => {
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      if (secondsTimerRef.current) clearInterval(secondsTimerRef.current);
      // Unmounting mid-dictation (a route change, a closed workspace) must not strand the
      // AudioContext — those are capped per page and a leak kills dictation later.
      audioChainRef.current?.dispose();
      audioChainRef.current = null;
    };
  }, [audioChainRef]);

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
      // Send WAV rather than the raw WebM. The rescue asks a multimodal model to re-listen,
      // and the OpenAI audio input accepts only wav/mp3 — so on an OpenAI-configured
      // hospital this whole tier answered "unsupported" and the low-confidence safety net
      // never actually ran. Gemini accepts either, so this costs the Gemini path nothing.
      // (Claude has no audio input at all; that remains a genuine no-op.)
      let payload = blob;
      let mediaType = blob.type || "audio/webm";
      try {
        payload = await webmToWav16k(blob);
        mediaType = "audio/wav";
      } catch {
        // Platform cannot decode/resample here — fall back to the original blob rather
        // than skipping the rescue, since Gemini can still use it.
      }

      const base64 = await blobToBase64(payload);
      const { data, error } = await supabase.functions.invoke("ai-clinical-voice", {
        body: {
          rescue_only: true,
          rescue_audio_base64: base64,
          rescue_media_type: mediaType,
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

      // NEVER send the literal "auto": it is not a language, and it used to be forwarded all
      // the way to Sarvam's translate endpoint as a source language, where it was rejected.
      // Prefer what the engine actually reported hearing.
      const noteLanguage = resolveNoteLanguage({
        selected: selectedLanguage,
        detected: detectedLangRef.current,
        hospitalDefault: hospitalDefaultLang,
      });

      const requestBody = {
        transcript: cleanedTranscript,
        context_type: sessionType,
        language_code: noteLanguage,
        existing_data: existingData ?? undefined,
        patient_id: patientId ?? undefined,
        // Saaras already returned English, so the edge function must NOT pay for a
        // second per-character translation of text that is already translated.
        //
        // Only claimable when EVERY segment came from a translating engine. With failover a
        // dictation can be part Sarvam (English) and part Bhashini (native script); asserting
        // pre-translation over that mix makes ai-clinical-voice skip translation entirely and
        // the note comes out half in Devanagari.
        pre_translated_by: transcriptIsPreTranslated(legsUsedRef.current)
          ? "sarvam_saaras"
          : undefined,
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
        detectedLanguage: detectedLangRef.current,
        enginesUsed: [...new Set(legsUsedRef.current.map(l => l.engine))],
        droppedSegments: droppedSegmentsRef.current,
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

      // Rescue re-listens with a multimodal model, so it is only worth spending on a
      // dictation that went through a server-side engine at all (Web Speech transcripts have
      // no retained audio path worth re-hearing).
      const shouldRescue =
        allowRescue &&
        !rescueAttemptedRef.current &&
        legsUsedRef.current.some(l => l.engine === "sarvam" || l.engine === "bhashini") &&
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
  }, [sessionType, patientId, selectedLanguage, hospitalDefaultLang, getExistingDataForCurrentScreen, setPanelState, setIsPanelOpen, setStructuredOutput, setFallbackReason, setRawTranscript, setScribeSignals, rescueWorstSegment, setRescueState]);

  // Keep the self-reference current so the rescue path always calls the latest closure.
  useEffect(() => { processTranscriptRef.current = processTranscript; }, [processTranscript]);


  const sendChunkToSarvam = useCallback(async (
    audioBlob: Blob,
    langCode: string,
    mode: SarvamMode,
  ): Promise<ChunkResult> => {
    const base64 = await blobToBase64(audioBlob);

    const { data, error } = await supabase.functions.invoke("sarvam-transcribe", {
      body: {
        audio_base64: base64,
        language_code: langCode,
        model: "saaras:v3",
        // The mode now comes from the LEG rather than being hardcoded to "translate".
        //
        // "translate" is right for Indic audio: Saaras returns English from the same call
        // at the same cost, and Indic script costs several times more LLM tokens per word.
        // It was WRONG as a blanket default. Sarvam's own default is "transcribe", and
        // "translate" runs a generative speech-TRANSLATION decoder — it renders meaning,
        // not words. Pointed at English it paraphrases: that is how a dictated "neck pain"
        // came back as "headache" with clauses missing. See asrEngineChain.sarvamLeg.
        mode,
      },
    });

    // unwrapFunctionError reads the response BODY of a FunctionsHttpError. Without it the
    // edge function's message — the bad key, the exhausted quota, the rejected language —
    // was replaced by a generic "non-2xx status code" and the real reason was lost here.
    if (error || data?.error) throw new Error(await unwrapFunctionError(error, data));
    return {
      text: data.transcript || "",
      languageProbability: typeof data.language_probability === "number"
        ? data.language_probability
        : null,
      detectedLanguage: typeof data.detected_language_code === "string"
        ? data.detected_language_code
        : null,
    };
  }, [blobToBase64]);

  const sendChunkToBhashini = useCallback(async (audioBlob: Blob, langCode: string): Promise<ChunkResult> => {
    // Bhashini does not accept WebM, which is all MediaRecorder produces — so this leg
    // could never have worked while it sent the raw recording. Converting here rather than
    // at capture keeps the cost on the fallback: the Sarvam happy path never pays for it.
    const wav = await webmToWav16k(audioBlob);
    const base64 = await blobToBase64(wav);

    const { data, error } = await supabase.functions.invoke("bhashini-transcribe", {
      body: {
        audio_base64: base64,
        language_code: langCode,
        audio_format: "wav",
        sampling_rate: 16000,
      },
    });

    if (error || data?.error) throw new Error(await unwrapFunctionError(error, data));
    // Bhashini's ULCA pipeline exposes no confidence field at all.
    return {
      text: data.transcript || "",
      languageProbability: null,
      detectedLanguage: typeof data.detected_language_code === "string"
        ? data.detected_language_code
        : null,
    };
  }, [blobToBase64]);

  /**
   * Transcribe one segment by walking the failover chain.
   *
   * The first leg returning actual words wins. A leg that errors OR returns an empty
   * transcript advances to the next — an engine that answers 200 with nothing has not
   * transcribed the audio, and treating that as success is what silently truncated notes.
   *
   * Every leg's failure reason is kept, so a total failure can report what each provider
   * said instead of only the last one.
   */
  const sendChunk = useCallback(async (audioBlob: Blob): Promise<ServedChunk | null> => {
    const chain = buildChainNow().filter(l => l.engine !== "web_speech");

    if (chain.length === 0) {
      legFailuresRef.current = [{
        engine: "sarvam",
        message: `No speech provider supports "${selectedLanguage}".`,
      }];
      return null;
    }

    const failures: LegFailure[] = [];

    /**
     * Every leg to try for this segment, in order.
     *
     * A Sarvam leg running in `translate` mode gets a SECOND attempt at the same audio in
     * `transcribe` mode before the chain moves on to Bhashini. That retry is what makes
     * the low-resource languages work at all: Saaras translates the ten major Indian
     * languages well, but on Santali, Bodo, Dogri, Kashmiri, Sindhi, Konkani, Sanskrit and
     * Manipuri its translation head frequently returns NOTHING. The app never retried, so
     * those languages produced no text and read to the doctor as "voice not detected".
     *
     * Order matters: translate is still attempted first, exactly as before, so nothing that
     * works today changes. The retry only ever runs where the old code had already given up.
     */
    const attempts: AsrLeg[] = [];
    for (const leg of chain) {
      const resolved: AsrLeg = leg.engine === "sarvam"
        ? { ...leg, mode: sarvamModeFor(leg, { selected: selectedLanguage, detected: detectedLangRef.current }) }
        : leg;
      attempts.push(resolved);
      const retry = transcribeRetryLeg(resolved);
      if (retry) attempts.push(retry);
    }

    for (const leg of attempts) {
      try {
        const result = leg.engine === "bhashini"
          ? await sendChunkToBhashini(audioBlob, leg.langCode)
          : await sendChunkToSarvam(audioBlob, leg.langCode, leg.mode ?? "translate");

        // Remember what was heard even on an empty result — a later segment's fallback leg
        // and the structuring call both need a real language rather than "auto".
        if (result.detectedLanguage && !detectedLangRef.current) {
          detectedLangRef.current = result.detectedLanguage;
        }

        if (result.text.trim()) return { ...result, leg };

        // 200 with no words is NOT success — it means this engine did not transcribe the
        // audio, so the chain must keep going rather than accept a silent gap.
        failures.push({
          engine: leg.engine,
          message: "returned an empty transcript",
          langCode: leg.langCode,
          mode: leg.mode,
        });
      } catch (err) {
        failures.push({
          engine: leg.engine,
          message: err instanceof Error ? err.message : String(err),
          langCode: leg.langCode,
          mode: leg.mode,
        });
      }
    }

    // Every leg declined this segment, so its audio is lost from the note.
    droppedSegmentsRef.current += 1;
    // Keep the most informative attempt: a run where every engine explained itself beats
    // one where a single leg existed.
    if (failures.length >= legFailuresRef.current.length) legFailuresRef.current = failures;
    return null;
  }, [buildChainNow, selectedLanguage, sendChunkToSarvam, sendChunkToBhashini]);

  const engineLabel = (e: AsrEngine) =>
    e === "sarvam" ? "Sarvam" : e === "bhashini" ? "Bhashini" : "Browser speech";

  /**
   * Explain a dictation that produced no words at all.
   *
   * This is the fix for the reason nobody could tell WHY only two languages worked: every
   * cause — a bad key, an exhausted quota, a language the provider rejects, a genuinely
   * silent microphone — used to render as the same fixed sentence, with the provider's own
   * message discarded into console.error.
   *
   * The reasons go to `fallbackReason`, which the panel already renders, so they survive the
   * toast disappearing and can be read (or screenshotted) after the fact.
   */
  const reportTotalFailure = useCallback(() => {
    const failures = legFailuresRef.current;

    if (failures.length === 0) {
      // Nothing was even attempted: no audio reached an engine.
      toast({
        title: "No speech detected",
        description: "Try speaking louder or closer to the mic.",
        variant: "destructive",
      });
      setFallbackReason("No audio was captured — the microphone produced nothing to transcribe.");
      setPanelState("fallback");
      return;
    }

    // Name the language and the decode that was tried. Without these, "Sarvam returned an
    // empty transcript" is the same sentence whether Saaras cannot serve this language at
    // all or the doctor simply did not speak — and only one of those is worth reporting to
    // an administrator. This is the client-side half of the per-language visibility work;
    // the durable half is the language recorded in ai_usage_logs by the edge functions.
    const detail = failures
      .map((f) => {
        const where = [f.langCode, f.mode].filter(Boolean).join(", ");
        return `${engineLabel(f.engine)}${where ? ` (${where})` : ""}: ${f.message}`;
      })
      .join("\n");
    // An engine that answered but heard nothing is a different problem from one that
    // refused the request, and the doctor's next action differs — speak up, versus tell
    // an administrator the key or the language is wrong.
    const allEmpty = failures.every(f => f.message === "returned an empty transcript");

    toast({
      title: allEmpty ? "Nothing was transcribed" : "Transcription failed",
      description: allEmpty
        ? `${failures.map(f => engineLabel(f.engine)).join(" and ")} heard no speech in the recording.`
        : failures[0].message.slice(0, 180),
      variant: "destructive",
    });
    setFallbackReason(
      allEmpty
        ? `Every engine answered but returned no words:\n${detail}`
        : `No engine could transcribe this dictation:\n${detail}`,
    );
    setPanelState("fallback");
  }, [toast, setFallbackReason, setPanelState]);

  // Transcribe queued audio segments sequentially (recording order preserved), then
  // finalize once the user has stopped and every segment has been transcribed.
  const drainQueue = useCallback(async () => {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    while (segmentQueueRef.current.length > 0) {
      const blob = segmentQueueRef.current.shift()!;
      // sendChunk walks the whole chain and returns null only when every engine declined,
      // recording each one's reason. It does not throw for a provider failure.
      const served = await sendChunk(blob);
      if (!served) continue;

      // Retain the audio IN MEMORY for the session. It powers the native-language
      // transcript view and the low-confidence audio rescue, both of which would
      // otherwise need the doctor to dictate again. Never persisted — this is PHI.
      segmentBlobsRef.current.push(blob);
      legsUsedRef.current.push(served.leg);
      const text = served.text.trim();
      segmentSignalsRef.current.push({
        languageProbability: served.languageProbability,
        words: text ? text.split(/\s+/).length : 0,
        text,
      });
      chunkTranscriptsRef.current.push(text);
      // Segments overlap by SEGMENT_OVERLAP_MS on purpose (gapless), so the seam is
      // transcribed twice — stitch it instead of naively join(" ")-ing, which duplicated
      // words every 25s and corrupted the transcript the structuring AI reads.
      const combined = joinTranscriptChunks(chunkTranscriptsRef.current);
      setRawTranscript(combined);
      fullTranscriptRef.current = combined;
    }
    queueProcessingRef.current = false;

    if (pendingFinalRef.current && segmentQueueRef.current.length === 0) {
      pendingFinalRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      audioChainRef.current?.dispose();
      audioChainRef.current = null;
      const finalTranscript = joinTranscriptChunks(chunkTranscriptsRef.current);
      setRawTranscript(finalTranscript);
      fullTranscriptRef.current = finalTranscript;
      if (finalTranscript) {
        await processTranscript(finalTranscript);
      } else {
        reportTotalFailure();
      }
    }
  }, [sendChunk, processTranscript, reportTotalFailure, setRawTranscript, segmentBlobsRef, audioChainRef]);

  // --- MediaRecorder flow (Sarvam/Bhashini) with OVERLAPPING segments (gapless) ---
  // Sarvam caps a request at 30s, so long dictation is split. To avoid dropping audio
  // at boundaries, the next segment starts BEFORE the previous one stops (small overlap),
  // and each self-contained segment is queued for in-order transcription.
  const startMediaRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        dictationAudioConstraints(selectedMicId),
      );
      streamRef.current = stream;
      // Condition the microphone before the recorder sees it: filters for stationary noise
      // (fan, AC, hum) and a near-field gate for the conversation happening across the
      // room. `stream` above is still the raw device — it is what gets stopped on teardown;
      // `recordStream` is the conditioned one the recorder consumes. If Web Audio is
      // unavailable the chain hands back the raw stream unchanged and recording proceeds.
      audioChainRef.current?.dispose();
      const chain = createDictationAudioChain(stream, {
        cleanup: noiseCleanupEnabled,
        gate: nearFieldGateEnabled,
      });
      audioChainRef.current = chain;
      const recordStream = chain.stream;
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
      // Per-dictation failover state. Stale values here would mislabel the transcript's
      // language or claim a translation that did not happen.
      legsUsedRef.current = [];
      legFailuresRef.current = [];
      droppedSegmentsRef.current = 0;
      detectedLangRef.current = null;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";

      const makeSegment = (): MediaRecorder => {
        const rec = new MediaRecorder(recordStream, { mimeType });
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
        // Do not rotate while paused: the replacement recorder would start in the
        // `recording` state and quietly resume capture the doctor deliberately stopped.
        // The current segment simply runs longer, which the 30s cap tolerates because a
        // paused recorder is not accumulating audio.
        if (isPausedRef.current) return;
        const prev = mediaRecorderRef.current;
        if (!prev || prev.state !== "recording") return;
        const next = makeSegment();
        try { next.start(1000); } catch { return; }
        mediaRecorderRef.current = next;
        // Keep `prev` running past the new segment's start → guaranteed overlap, no gap.
        // Must exceed one spoken word (see SEGMENT_OVERLAP_MS), or a word landing on the
        // boundary is a fragment in both segments and transcribed correctly in neither.
        setTimeout(() => { try { if (prev.state === "recording") prev.stop(); } catch { /* already stopped */ } }, SEGMENT_OVERLAP_MS);
      }, SARVAM_CHUNK_SECONDS * 1000);

      setRecordingSeconds(0);
      secondsTimerRef.current = setInterval(() => { setRecordingSeconds(s => s + 1); }, 1000);

      setCurrentSessionType(sessionType);
      setIsRecording(true);
      isPausedRef.current = false;
      setIsPaused(false);
      setIsPanelOpen(true);
      setPanelState("recording");
      setRawTranscript("");
    } catch (err) {
      console.error("Microphone access failed:", err);
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }, [sessionType, drainQueue, setIsRecording, setIsPanelOpen, setPanelState, setRawTranscript, setCurrentSessionType, toast, segmentBlobsRef, setNativeTranscript, setScribeSignals, selectedMicId, noiseCleanupEnabled, nearFieldGateEnabled, setIsPaused, audioChainRef]);

  /**
   * Pause and resume mid-dictation.
   *
   * For the case the near-field gate cannot fully solve: an unrelated conversation starting
   * in the room. A deliberate pause is the only 100%-reliable rejection there is, because it
   * is a decision rather than an inference from signal level.
   *
   * MediaRecorder's own pause()/resume() is used rather than tearing the stream down, so the
   * microphone permission indicator stays on, the AudioContext keeps its floor estimate, and
   * the segment queue is untouched — the recorder simply emits no data while paused, and the
   * resulting segment is shorter. Nothing downstream needs to know a pause happened.
   */
  const togglePause = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    try {
      if (rec.state === "recording") {
        rec.pause();
        isPausedRef.current = true;
        setIsPaused(true);
        // Stop the clock so the displayed duration reflects audio actually captured rather
        // than wall time. The 25s rotation interval keeps running but no-ops while paused.
        if (secondsTimerRef.current) { clearInterval(secondsTimerRef.current); secondsTimerRef.current = null; }
      } else if (rec.state === "paused") {
        rec.resume();
        isPausedRef.current = false;
        setIsPaused(false);
        if (!secondsTimerRef.current) {
          secondsTimerRef.current = setInterval(() => { setRecordingSeconds(s => s + 1); }, 1000);
        }
      }
    } catch (err) {
      // A browser that cannot pause must not lose the dictation over it.
      console.warn("Pause/resume unavailable:", err);
    }
  }, [setIsPaused]);

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
      const stream = await navigator.mediaDevices.getUserMedia(
        dictationAudioConstraints(selectedMicId),
      );
      streamRef.current = stream;
      // Same conditioning as the Sarvam path. Web Speech itself consumes the RAW device
      // stream (the browser recogniser is given the microphone, not a Web Audio graph), so
      // this cleans up only the parallel recording that becomes the Sarvam fallback.
      audioChainRef.current?.dispose();
      const chain = createDictationAudioChain(stream, {
        cleanup: noiseCleanupEnabled,
        gate: nearFieldGateEnabled,
      });
      audioChainRef.current = chain;
      const rec = new MediaRecorder(chain.stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
      });
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        audioChainRef.current?.dispose();
        audioChainRef.current = null;
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
        // Walk the remaining chain (Sarvam, then Bhashini) rather than Sarvam alone, so a
        // browser that hears nothing AND a Sarvam outage still leaves a working path.
        legsUsedRef.current = [];
        legFailuresRef.current = [];
        const served = await sendChunk(blob);
        if (served?.text.trim()) {
          // The server-side fallback owns the whole recording, so its signal and audio
          // replace anything the (silent) Web Speech attempt left behind.
          segmentBlobsRef.current = [blob];
          segmentSignalsRef.current = [{
            languageProbability: served.languageProbability,
            words: served.text.trim().split(/\s+/).length,
            text: served.text.trim(),
          }];
          legsUsedRef.current = [served.leg];
          setRawTranscript(served.text.trim());
          await processTranscript(served.text.trim());
          return;
        }
        // Same honest reporting as the media path — name what each engine said.
        reportTotalFailure();
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
  }, [isWebSpeechSupported, selectedLanguage, sessionType, processTranscript, sendChunk, reportTotalFailure, setIsRecording, setIsPanelOpen, setPanelState, setRawTranscript, setCurrentSessionType, toast, segmentBlobsRef, selectedMicId, noiseCleanupEnabled, nearFieldGateEnabled, audioChainRef]);

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
      // "paused" as well as "recording": stopping a paused recorder still fires onstop with
      // everything captured before the pause. Checking only for "recording" would leave a
      // dictation the doctor paused and then ended stuck with no final segment queued, and
      // the note would silently lose its last stretch of speech.
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsRecording(false);
    } else {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    }
  }, [useSarvamOrBhashini, setIsRecording, setPanelState, setIsPaused]);

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

      {/*
        Pause. Only for the recorded-audio path — the Web Speech recogniser has no
        equivalent, and offering a button that silently does nothing on English dictation
        would be worse than not offering one.

        This is the reliable answer to a conversation starting nearby: the near-field gate
        infers from signal level and can be wrong either way, whereas a pause is the
        doctor's own decision and cannot be.
      */}
      {isRecording && useSarvamOrBhashini && (
        <button
          onClick={togglePause}
          title={isPaused ? "Resume recording" : "Pause while someone else is talking"}
          className={cn(
            "rounded-full flex items-center justify-center transition-all active:scale-[0.90] h-14 w-14",
            isPaused
              ? "bg-amber-500 text-white hover:bg-amber-600 shadow-[0_0_24px_-4px_rgba(245,158,11,0.6)]"
              : "border border-border bg-background text-foreground hover:bg-muted"
          )}
        >
          {isPaused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}
        </button>
      )}

      {/* Mic button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className={cn(
          "rounded-full font-semibold flex items-center justify-center transition-all active:scale-[0.90]",
          isRecording
            ? cn(
                "text-white h-14 w-auto px-5 gap-2",
                // A paused dictation must not keep pulsing red — that reads as "still
                // recording", which is exactly the thing the doctor just stopped.
                isPaused
                  ? "bg-slate-500 hover:bg-slate-600"
                  : "bg-red-500 hover:bg-red-600 animate-pulse shadow-[0_0_24px_-2px_rgba(239,68,68,0.6)]"
              )
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
