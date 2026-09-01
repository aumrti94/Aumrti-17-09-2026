/**
 * WebM/Opus → 16 kHz mono WAV, for the Bhashini ASR leg.
 *
 * WHY THIS EXISTS: MediaRecorder only ever produces WebM/Opus, and Bhashini's ULCA ASR
 * does not accept WebM — it wants WAV/FLAC/MP3. bhashini-transcribe was sending
 * `audioFormat: "webm"` with browser audio, so the Bhashini path could never have
 * transcribed anything, which is part of why there was no working fallback when Sarvam
 * failed. Sarvam takes the WebM directly, so this conversion is only paid for on the
 * fallback leg.
 *
 * The encoder (`encodeWav16kMono`) is pure and unit-tested. The decode step is inherently
 * browser-dependent (it uses the platform audio decoder), so it is kept in a thin separate
 * function — that split is deliberate, so the byte-layout logic is testable in node.
 */

/** Bhashini's ASR models expect 16 kHz; the API also accepts a minimum of 8 kHz. */
export const TARGET_SAMPLE_RATE = 16000;

const BYTES_PER_SAMPLE = 2; // PCM signed 16-bit
const WAV_HEADER_BYTES = 44;

/**
 * Wrap mono float samples in a RIFF/PCM-16 container.
 *
 * Samples are clamped before scaling: `decodeAudioData` can return values slightly outside
 * [-1, 1] after resampling, and letting those wrap around the 16-bit range turns a loud
 * syllable into a burst of noise — audible as a mis-transcribed word rather than an error.
 */
export function encodeWav16kMono(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true); // RIFF chunk size
  writeAscii(8, "WAVE");

  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);            // fmt chunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate (mono)
  view.setUint16(32, BYTES_PER_SAMPLE, true);              // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);          // bits per sample

  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric scaling: 0x7fff positive, 0x8000 negative — the full range without wrap.
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += BYTES_PER_SAMPLE;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Average all channels into one. Bhashini takes mono; sending only channel 0 would drop
 *  half the signal on a stereo capture. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Decode a recorded blob and re-encode it as 16 kHz mono WAV.
 *
 * Resampling is delegated to OfflineAudioContext rather than done by hand — the browser's
 * resampler is band-limited, and naive sample dropping introduces aliasing that measurably
 * degrades ASR on sibilants.
 *
 * Throws if the platform cannot decode the input; callers treat that as "this leg is
 * unavailable" and move on rather than failing the dictation.
 */
export async function webmToWav16k(blob: Blob): Promise<Blob> {
  const AudioCtx = (window as unknown as Record<string, unknown>).AudioContext
    ?? (window as unknown as Record<string, unknown>).webkitAudioContext;
  const OfflineCtx = (window as unknown as Record<string, unknown>).OfflineAudioContext
    ?? (window as unknown as Record<string, unknown>).webkitOfflineAudioContext;
  if (!AudioCtx || !OfflineCtx) throw new Error("Web Audio API unavailable — cannot convert audio");

  const arrayBuffer = await blob.arrayBuffer();

  const decodeCtx = new (AudioCtx as new () => AudioContext)();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    // Each AudioContext holds a hardware handle; Chrome caps them at ~6 per page, so a
    // per-segment leak would silently kill the fallback partway through a long dictation.
    void decodeCtx.close();
  }

  if (decoded.length === 0) throw new Error("Recorded audio decoded to zero samples");

  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new (OfflineCtx as new (c: number, l: number, r: number) => OfflineAudioContext)(
    1, frames, TARGET_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const resampled = await offline.startRendering();

  const channels: Float32Array[] = [];
  for (let c = 0; c < resampled.numberOfChannels; c++) channels.push(resampled.getChannelData(c));

  return encodeWav16kMono(downmixToMono(channels), TARGET_SAMPLE_RATE);
}
