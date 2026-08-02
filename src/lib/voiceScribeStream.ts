// Streaming client for the ai-clinical-voice structuring call.
//
// Called with raw fetch, NOT supabase.functions.invoke, because invoke buffers the whole
// response — the same reason deleteHospitalStream.ts exists. Buffering is exactly what made
// the doctor stare at one spinner for the full 10-20 s the model spent generating.
//
// FALLBACK IS THE POINT. Streaming is an optimisation layered over a path that must keep
// working: if the provider cannot stream, the connection dies mid-note, or the partial JSON
// never completes, the caller falls back to the buffered invoke and the doctor gets the same
// note a little later. A half-parsed note is never presented as final.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL || "";
const ANON_KEY = (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY || "";

export interface ScribeStreamCallbacks {
  /**
   * Fired as top-level fields of the note become readable, so the form can fill in
   * progressively. Values are provisional until `done` — see extractCompleteFields.
   */
  onPartial?: (fields: Record<string, string>) => void;
}

export interface ScribeStreamResult {
  structured: Record<string, unknown>;
  context_type?: string;
  safety_check?: { safe: boolean; flags: unknown[] } | null;
  repairs?: { from: string; to: string; score: number; source: string }[];
  lexicon_hit_rate?: number | null;
  transcript_used?: string;
  pre_translated?: boolean;
}

/**
 * Pull the string fields that have FINISHED streaming out of a partial JSON document.
 *
 * Only complete `"key": "value"` pairs are returned — a value whose closing quote has not
 * arrived is skipped entirely rather than shown half-written, which would flicker
 * mid-sentence text into a clinical field. Escaped quotes are respected so a value
 * containing \" is not mistaken for a terminator.
 */
export function extractCompleteFields(partial: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(partial)) !== null) {
    const [, key, rawValue] = m;
    try {
      out[key] = JSON.parse(`"${rawValue}"`);
    } catch {
      // Malformed escape mid-stream — skip until it completes.
    }
  }
  return out;
}

/**
 * Structure a transcript, streaming partial fields as they arrive.
 *
 * Throws on any failure (including an unsupported provider), so the caller can fall back to
 * the buffered path. It never returns a partial note.
 */
export async function structureWithStreaming(
  body: Record<string, unknown>,
  callbacks: ScribeStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<ScribeStreamResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-clinical-voice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`Structuring failed (${res.status})`);

  // The server falls back to plain JSON when the provider cannot stream. Honour that
  // rather than trying to parse it as SSE.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const json = await res.json();
    if (json?.error) throw new Error(json.error);
    return json as ScribeStreamResult;
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let result: ScribeStreamResult | null = null;
  let lastEmitted = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // An SSE frame can straddle two network chunks; consume only complete frames.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        let evt: Record<string, unknown>;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt.type === "delta" && typeof evt.text === "string") {
          accumulated += evt.text;
          if (callbacks.onPartial) {
            const fields = extractCompleteFields(accumulated);
            // Only notify when something actually changed, so React isn't re-rendered
            // once per token.
            const sig = JSON.stringify(fields);
            if (sig !== lastEmitted) { lastEmitted = sig; callbacks.onPartial(fields); }
          }
        } else if (evt.type === "done") {
          const { type, ...rest } = evt as Record<string, unknown> & { type: string };
          result = rest as unknown as ScribeStreamResult;
        } else if (evt.type === "error") {
          throw new Error(String(evt.error ?? "Streaming failed"));
        }
      }
    }
  }

  // Stream ended without a `done` event — treat as a failure so the caller retries
  // buffered rather than presenting whatever happened to arrive.
  if (!result?.structured) throw new Error("Stream ended before the note was complete");
  return result;
}
