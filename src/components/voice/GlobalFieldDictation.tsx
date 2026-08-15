import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide speech-to-text. Mounted once (App.tsx); whenever any text field is
 * focused a mic button floats at its edge, and dictated words are inserted at
 * the caret. Uses the browser's free Web Speech API in English only — no server
 * call, no paid transcription.
 *
 * A field opts out by carrying (or sitting inside an element carrying)
 * data-no-dictation — used where a field already has its own mic.
 */

const DICTATION_LANG = "en-IN";
const OPT_OUT_SELECTOR = "[data-no-dictation]";
/** Input types worth dictating into — password/number/date/file etc. are excluded. */
const ELIGIBLE_INPUT_TYPES = new Set(["text", "search", "tel", "url", "email", ""]);
/** Below this width a single-line input is too small to sit a mic against. */
const MIN_INPUT_WIDTH = 90;
/** Guards against a permanent restart loop when recognition keeps failing. */
const MAX_SILENT_RESTARTS = 20;

type Field = HTMLInputElement | HTMLTextAreaElement;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface Anchor {
  top: number;
  left: number;
  size: number;
  /** Interim chip is placed above a textarea, beside a single-line input. */
  multiline: boolean;
}

const getRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  return (SR as (new () => SpeechRecognitionLike) | undefined) ?? null;
};

const isEligible = (el: EventTarget | null): el is Field => {
  const isArea = el instanceof HTMLTextAreaElement;
  if (!isArea && !(el instanceof HTMLInputElement)) return false;
  const field = el as Field;
  if (field.disabled || field.readOnly) return false;
  if (!isArea && !ELIGIBLE_INPUT_TYPES.has((field as HTMLInputElement).type)) return false;
  if (field.closest(OPT_OUT_SELECTOR)) return false;
  if (!isArea && field.getBoundingClientRect().width < MIN_INPUT_WIDTH) return false;
  return true;
};

const computeAnchor = (el: Field): Anchor | null => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  // Scrolled out of its container / off screen — hide rather than float loose.
  if (r.bottom < 8 || r.top > window.innerHeight - 8) return null;
  if (r.right < 8 || r.left > window.innerWidth - 8) return null;

  const multiline = el instanceof HTMLTextAreaElement;
  if (multiline) {
    const size = 32;
    return { top: r.bottom - size - 10, left: r.right - size - 10, size, multiline };
  }

  const size = 24;
  const outside = r.right + 6;
  const fitsOutside = outside + size + 4 <= window.innerWidth;
  return {
    top: r.top + (r.height - size) / 2,
    left: fitsOutside ? outside : r.right - size - 4,
    size,
    multiline,
  };
};

const sameAnchor = (a: Anchor | null, b: Anchor | null) => {
  if (!a || !b) return a === b;
  return Math.round(a.top) === Math.round(b.top)
    && Math.round(a.left) === Math.round(b.left)
    && a.size === b.size;
};

/**
 * Writes through the native value setter so React's controlled inputs see the
 * change — assigning el.value directly is swallowed by React's value tracker.
 */
const insertAtCaret = (el: Field, text: string) => {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  const value = el.value;
  // selectionStart throws on input types that don't support selection (email, url).
  let start = value.length;
  let end = value.length;
  try {
    start = el.selectionStart ?? value.length;
    end = el.selectionEnd ?? value.length;
  } catch {
    /* append instead */
  }

  const before = value.slice(0, start);
  const after = value.slice(end);
  const chunk = (before && !/\s$/.test(before) ? " " : "") + text;
  const next = before + chunk + after;

  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new Event("input", { bubbles: true }));

  const caret = before.length + chunk.length;
  const restoreCaret = () => {
    try { el.setSelectionRange(caret, caret); } catch { /* unsupported type */ }
  };
  restoreCaret();
  // React re-renders after the input event and can push the caret to the end.
  requestAnimationFrame(restoreCaret);
};

const GlobalFieldDictation: React.FC = () => {
  const [field, setField] = useState<Field | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [denied, setDenied] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<Field | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const manualStopRef = useRef(false);
  const restartsRef = useRef(0);
  const anchorRef = useRef<Anchor | null>(null);

  const supported = getRecognitionCtor() !== null;

  fieldRef.current = field;
  anchorRef.current = anchor;

  const stop = useCallback(() => {
    manualStopRef.current = true;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setInterim("");
    setRecording(false);
    if (recognition) {
      try { recognition.stop(); } catch { /* already stopped */ }
    }
  }, []);

  const start = useCallback(() => {
    const target = fieldRef.current;
    const Recognition = getRecognitionCtor();
    if (!target || !Recognition) return;

    manualStopRef.current = false;
    restartsRef.current = 0;

    const recognition = new Recognition();
    recognition.lang = DICTATION_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const finalText = transcript.trim();
          if (finalText) {
            restartsRef.current = 0;
            insertAtCaret(target, finalText);
          }
        } else {
          pending += transcript;
        }
      }
      setInterim(pending.trim());
    };

    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setDenied(true);
        manualStopRef.current = true;
      }
      if (e.error === "audio-capture" || e.error === "network") {
        manualStopRef.current = true;
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      const canRestart = !manualStopRef.current
        && document.contains(target)
        && restartsRef.current < MAX_SILENT_RESTARTS;

      if (canRestart) {
        // Chrome ends the session on every pause; restart so one click dictates
        // a whole paragraph.
        restartsRef.current += 1;
        setTimeout(() => {
          if (recognitionRef.current !== recognition || manualStopRef.current) return;
          try {
            recognition.start();
          } catch {
            recognitionRef.current = null;
            setRecording(false);
            setInterim("");
          }
        }, 250);
        return;
      }

      recognitionRef.current = null;
      setRecording(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setDenied(false);
      setRecording(true);
    } catch {
      recognitionRef.current = null;
    }
  }, []);

  // Track the focused field.
  useEffect(() => {
    if (!supported) return;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (isEligible(target)) {
        setField((prev) => (prev === target ? prev : target));
      } else if (!(buttonRef.current && target instanceof Node && buttonRef.current.contains(target))) {
        setField(null);
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && buttonRef.current?.contains(next)) return;
      if (isEligible(next)) return; // focusin for the new field follows
      setField(null);
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [supported]);

  // Dictation belongs to the field it started on — leaving that field ends it.
  useEffect(() => () => {
    if (recognitionRef.current) stop();
  }, [field, stop]);

  // Follow the field through scrolling, resizing and layout changes.
  useEffect(() => {
    if (!field) {
      setAnchor(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const next = document.contains(field) ? computeAnchor(field) : null;
      if (!sameAnchor(anchorRef.current, next)) setAnchor(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [field]);

  // The button lives in a body portal, so Radix dialogs/popovers would treat a
  // click on it as "outside" and dismiss themselves. Stopping pointerdown at
  // the document capture phase keeps the layer open; click still reaches us.
  useEffect(() => {
    const onPointerDown = (e: Event) => {
      const button = buttonRef.current;
      if (button && e.target instanceof Node && button.contains(e.target)) {
        e.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  // Escape stops dictation without disturbing the field.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stop();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [recording, stop]);

  useEffect(() => () => {
    manualStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
  }, []);

  if (!supported || !anchor || typeof document === "undefined") return null;

  const label = denied
    ? "Microphone blocked — allow it in the browser address bar"
    : recording
      ? "Stop dictation (Esc)"
      : "Dictate in English";

  return createPortal(
    <>
      {recording && (
        <div
          style={{
            position: "fixed",
            top: anchor.multiline ? anchor.top - 26 : anchor.top - 28,
            left: anchor.multiline ? undefined : Math.max(8, anchor.left - 120),
            right: anchor.multiline ? Math.max(8, window.innerWidth - anchor.left - anchor.size) : undefined,
            zIndex: 9998,
          }}
          className="pointer-events-none max-w-[280px] truncate rounded-full bg-slate-900/90 px-2.5 py-1 text-[11px] text-white shadow-lg"
        >
          {interim || "Listening…"}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        tabIndex={-1}
        aria-label={label}
        title={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (recording ? stop() : start())}
        style={{
          position: "fixed",
          top: anchor.top,
          left: anchor.left,
          width: anchor.size,
          height: anchor.size,
          zIndex: 9999,
        }}
        className={cn(
          "flex items-center justify-center rounded-full shadow-md transition-colors",
          recording ? "bg-red-500 animate-pulse" : "bg-[#1A2F5A] hover:bg-[#152647]",
          denied && !recording && "bg-slate-400"
        )}
      >
        {recording
          ? <Square className={anchor.multiline ? "h-3 w-3 fill-white text-white" : "h-2.5 w-2.5 fill-white text-white"} />
          : <Mic className={anchor.multiline ? "h-3.5 w-3.5 text-white" : "h-3 w-3 text-white"} />}
      </button>
    </>,
    document.body
  );
};

export default GlobalFieldDictation;
