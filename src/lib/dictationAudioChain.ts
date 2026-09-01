/**
 * Microphone conditioning for voice scribe.
 *
 * Two DIFFERENT problems are solved here, and conflating them is why "turn on noise
 * cancellation" is not by itself an answer to the complaint that started this:
 *
 *   1. STATIONARY noise — fan, AC, mains hum, corridor hiss. Removed by filtering.
 *   2. A PERSON TALKING NEARBY. Not removed by filtering, and not by the browser's
 *      `noiseSuppression` either: it is speech, in the same frequency band as the
 *      doctor's speech, and every spectral suppressor passes it straight through.
 *
 * For (2) the discriminator cannot be identity, because in an OPD consult the PATIENT is
 * a second speaker whose words are wanted — ai-clinical-voice explicitly builds the note
 * from the doctor↔patient exchange. Removing "other voices" would delete clinical content.
 *
 * The discriminator is DISTANCE. Someone 2-4m away arrives 12-20dB quieter than someone at
 * 30-50cm, and that difference is measurable in the browser. `nearFieldGate` below
 * attenuates anything that is not near-field, which rejects the conversation across the
 * room while keeping the one in front of the microphone.
 *
 * EVERYTHING HERE IS OPTIONAL. If Web Audio is unavailable, or any node fails to build,
 * `createDictationAudioChain` returns the untouched input stream. A dictation must never
 * fail because conditioning failed — the doctor is mid-consult.
 */

/** Rumble below this is mains hum, fans and desk thumps — never speech. */
const HIGHPASS_HZ = 85;
/**
 * The ASR resamples to 16kHz, so anything above ~7.5kHz cannot survive to the model
 * anyway. Removing it here keeps hiss out of the Opus bitrate budget instead.
 */
const LOWPASS_HZ = 7500;

/** How often the gate re-measures the input. 50ms is well inside a syllable. */
const TICK_MS = 50;
/** Window the background floor is estimated over. */
const FLOOR_WINDOW_MS = 5000;
const FLOOR_SAMPLES = Math.round(FLOOR_WINDOW_MS / TICK_MS);

/**
 * A tick gap longer than this means the timer was throttled — a backgrounded tab, a
 * blocked main thread. The floor estimate is meaningless across such a gap, so the gate
 * FAILS OPEN and rebuilds its estimate rather than attenuating audio it has not measured.
 */
const STALE_TICK_MS = 1000;

/** Attenuation applied when the gate is shut. Not silence — see `applyGain`. */
const GATE_CLOSED_GAIN = 0.05;

/**
 * Above this spectral flatness the frame is broadband — a keyboard click, a chair scrape,
 * a door. Speech is strongly peaked and sits far below it. Used ONLY to veto a marginal
 * frame, never to close the gate on a loud one.
 */
const NOISE_FLATNESS = 0.5;

export interface NearFieldGateOptions {
  /**
   * How far above the measured background floor a frame must sit to count as near-field,
   * in dB. 12dB is the conservative setting: it rejects a conversation across the room
   * while still passing a soft-spoken patient in the consultation chair. Raising it
   * rejects background harder AND starts dropping quiet patient replies.
   */
  thresholdDb?: number;
  /**
   * How long the gate stays open after the level drops back. Without this the tail of
   * every word is clipped, which costs the ASR its final consonants.
   */
  hangoverMs?: number;
}

export interface DictationAudioLevels {
  /** Current input level, 0-1 (RMS, not peak). */
  level: number;
  /** Estimated background floor, 0-1, on the same scale as `level`. */
  floor: number;
  /** Whether audio is currently passing the near-field gate. */
  gateOpen: boolean;
  /** True once a floor estimate exists; the meter should not judge the room before this. */
  ready: boolean;
}

export interface DictationAudioChain {
  /** Feed THIS to MediaRecorder. Identical to the input stream when conditioning is off. */
  stream: MediaStream;
  /** False when conditioning could not be built and the raw stream is being returned. */
  active: boolean;
  /** Live meter reading. Safe to poll from a render loop. */
  getLevels: () => DictationAudioLevels;
  /**
   * Release the AudioContext and timers. Does NOT stop the input stream's tracks — the
   * caller owns that stream and stops it as part of its own teardown.
   */
  dispose: () => void;
}

export interface DictationAudioChainOptions {
  /** Highpass/lowpass/compressor. Default true. */
  cleanup?: boolean;
  /** Near-field gate. Default true. Set false to keep filtering but pass all speech. */
  gate?: boolean;
  gateOptions?: NearFieldGateOptions;
}

/** Percentile of a numeric array, without mutating the caller's copy. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** RMS of a time-domain frame, 0-1. */
function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Spectral flatness (Wiener entropy): geometric mean / arithmetic mean of the magnitude
 * spectrum. ~0 for a strongly peaked signal like voiced speech, ~1 for white noise.
 *
 * Computed in the log domain because the geometric mean of 1024 small magnitudes
 * underflows to zero in float64 if multiplied directly.
 */
function spectralFlatness(magnitudes: Float32Array): number {
  let logSum = 0;
  let arithSum = 0;
  let n = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const m = magnitudes[i];
    if (m <= 0) continue;
    logSum += Math.log(m);
    arithSum += m;
    n++;
  }
  if (n === 0 || arithSum <= 0) return 1;
  const geo = Math.exp(logSum / n);
  const arith = arithSum / n;
  return arith > 0 ? geo / arith : 1;
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.AudioContext ?? w.webkitAudioContext ?? null) as (new () => AudioContext) | null;
}

/**
 * Build the conditioning graph in front of MediaRecorder.
 *
 *   source → highpass → lowpass → compressor → gate gain → destination
 *                                      └→ analyser (measurement tap, not in the path)
 *
 * The analyser is tapped off the compressor rather than the gate output, so the gate
 * measures what is ARRIVING and never sees its own attenuation — a gate reading its own
 * output latches shut the moment it closes.
 */
export function createDictationAudioChain(
  input: MediaStream,
  { cleanup = true, gate = true, gateOptions = {} }: DictationAudioChainOptions = {},
): DictationAudioChain {
  const passthrough = (): DictationAudioChain => ({
    stream: input,
    active: false,
    getLevels: () => ({ level: 0, floor: 0, gateOpen: true, ready: false }),
    dispose: () => { /* nothing was built */ },
  });

  if (!cleanup && !gate) return passthrough();

  const AudioCtx = getAudioContextCtor();
  if (!AudioCtx) return passthrough();

  const { thresholdDb = 12, hangoverMs = 300 } = gateOptions;

  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  try {
    ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(input);
    const destination = ctx.createMediaStreamDestination();

    let node: AudioNode = source;

    if (cleanup) {
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = HIGHPASS_HZ;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = LOWPASS_HZ;

      // Gentle. A doctor leaning back from the mic should not vanish, but hard
      // compression pumps the room tone up between words, which the ASR reads as speech.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.15;

      node.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      node = compressor;
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = 1;
    node.connect(gainNode);
    gainNode.connect(destination);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    node.connect(analyser);

    const timeData = new Float32Array(analyser.fftSize);
    const freqData = new Float32Array(analyser.frequencyBinCount);
    const magnitudes = new Float32Array(analyser.frequencyBinCount);

    const floorSamples: number[] = [];
    let lastTick = Date.now();
    let openUntil = 0;
    let levels: DictationAudioLevels = { level: 0, floor: 0, gateOpen: true, ready: false };

    /**
     * Ramp rather than switch. A hard gain step produces a click, and a click is a
     * broadband transient that the ASR is entirely happy to transcribe as a consonant.
     */
    const applyGain = (target: number, timeConstant: number) => {
      if (!ctx) return;
      try {
        gainNode.gain.setTargetAtTime(target, ctx.currentTime, timeConstant);
      } catch {
        gainNode.gain.value = target;
      }
    };

    if (gate) {
      timer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastTick;
        lastTick = now;

        // Throttled timer: the floor estimate spans an unknown gap and cannot be trusted.
        // Open up and start again rather than attenuate on a stale measurement.
        if (elapsed > STALE_TICK_MS) {
          floorSamples.length = 0;
          openUntil = now + hangoverMs;
          applyGain(1, 0.02);
          levels = { ...levels, gateOpen: true, ready: false };
          return;
        }

        analyser.getFloatTimeDomainData(timeData);
        const level = rms(timeData);

        floorSamples.push(level);
        if (floorSamples.length > FLOOR_SAMPLES) floorSamples.shift();

        // The 10th percentile, not the strict minimum: one anomalously silent frame
        // would otherwise drag the floor to zero and hold the gate open on everything.
        const floor = percentile(floorSamples, 0.1);
        const ready = floorSamples.length >= FLOOR_SAMPLES / 2;

        // Until a floor exists we have measured nothing, so we attenuate nothing.
        if (!ready) {
          applyGain(1, 0.02);
          levels = { level, floor, gateOpen: true, ready: false };
          return;
        }

        const threshold = floor * Math.pow(10, thresholdDb / 20);
        let isNearField = level > threshold;

        // Veto ONLY the marginal case. A frame that is loud and broadband is far more
        // likely to be a chair scrape than speech; a frame that is loud and peaked is
        // speech and is never vetoed here.
        if (isNearField && level < threshold * 2) {
          analyser.getFloatFrequencyData(freqData);
          for (let i = 0; i < freqData.length; i++) {
            magnitudes[i] = Math.pow(10, freqData[i] / 20);
          }
          if (spectralFlatness(magnitudes) > NOISE_FLATNESS) isNearField = false;
        }

        if (isNearField) openUntil = now + hangoverMs;
        const gateOpen = now < openUntil;

        // Open fast so no onset is clipped; close slowly so word tails survive.
        applyGain(gateOpen ? 1 : GATE_CLOSED_GAIN, gateOpen ? 0.015 : 0.08);
        levels = { level, floor, gateOpen, ready: true };
      }, TICK_MS);
    } else {
      // No gate, but the meter still needs readings so the doctor can see mic level.
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(timeData);
        const level = rms(timeData);
        floorSamples.push(level);
        if (floorSamples.length > FLOOR_SAMPLES) floorSamples.shift();
        levels = {
          level,
          floor: percentile(floorSamples, 0.1),
          gateOpen: true,
          ready: floorSamples.length >= FLOOR_SAMPLES / 2,
        };
      }, TICK_MS);
    }

    return {
      stream: destination.stream,
      active: true,
      getLevels: () => levels,
      dispose: () => {
        if (timer) clearInterval(timer);
        timer = null;
        // Each AudioContext holds a hardware handle and Chrome caps them at ~6 per page,
        // so a leak here silently kills dictation a few consults later.
        try { void ctx?.close(); } catch { /* already closed */ }
        ctx = null;
      },
    };
  } catch (err) {
    console.warn("Dictation audio conditioning unavailable — using the raw microphone:", err);
    if (timer) clearInterval(timer);
    try { void ctx?.close(); } catch { /* nothing to close */ }
    return passthrough();
  }
}

/**
 * getUserMedia constraints for dictation.
 *
 * Every value is `ideal`, never `exact`: a device that cannot honour one should still
 * grant the stream. `exact` here would turn an unusual microphone into an
 * OverconstrainedError and no dictation at all.
 *
 * The three booleans are what most browsers already default to — stating them buys
 * consistency across browsers rather than a large quality jump. `channelCount` and
 * `sampleRate` are the useful part: they match what the ASR consumes, so the audio is not
 * downmixed and resampled twice.
 */
export function dictationAudioConstraints(deviceId?: string | null): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 16000 },
  };
  if (deviceId) audio.deviceId = { ideal: deviceId };
  return { audio };
}

export interface MicrophoneOption {
  deviceId: string;
  label: string;
}

/**
 * Microphones the browser will name.
 *
 * Labels are empty until permission has been granted at least once, so this is worth
 * calling AFTER the first successful getUserMedia. Returns [] rather than throwing on a
 * browser that refuses enumeration — the picker simply does not appear.
 *
 * This matters more than any DSP in this file: a headset or lapel microphone at 5cm
 * rejects someone across the room by 20dB or more, which is better than the gate above can
 * do and costs nothing at runtime. Until now getUserMedia silently took the OS default,
 * usually a laptop's built-in array mic, with no way for the doctor to change it.
 */
export async function listMicrophones(): Promise<MicrophoneOption[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === "audioinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
  } catch {
    return [];
  }
}
