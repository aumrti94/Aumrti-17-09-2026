import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDictationAudioChain, dictationAudioConstraints, listMicrophones,
} from "./dictationAudioChain";

/**
 * The behaviour these tests protect is FAIL-OPEN.
 *
 * Every path in this module sits between the doctor's microphone and the recorder, so a
 * fault here silently costs a consultation its audio. The module is therefore only allowed
 * to fail in one direction: hand back the untouched stream and let the dictation proceed.
 */

const fakeStream = () => ({ id: "raw-mic" }) as unknown as MediaStream;

/** Minimal Web Audio doubles — enough to build the graph, not to render sound. */
function installAudioContext(overrides: Record<string, unknown> = {}) {
  const gainParam = { value: 1, setTargetAtTime: vi.fn() };
  const node = () => ({ connect: vi.fn() });
  const ctx = {
    currentTime: 0,
    createMediaStreamSource: vi.fn(node),
    createMediaStreamDestination: vi.fn(() => ({
      ...node(),
      stream: { id: "conditioned" } as unknown as MediaStream,
    })),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: "", frequency: { value: 0 } })),
    createDynamicsCompressor: vi.fn(() => ({
      ...node(),
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 },
    })),
    createGain: vi.fn(() => ({ ...node(), gain: gainParam })),
    createAnalyser: vi.fn(() => ({
      ...node(),
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn(),
      getFloatFrequencyData: vi.fn(),
    })),
    close: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  (window as unknown as Record<string, unknown>).AudioContext = vi.fn(() => ctx);
  return ctx;
}

describe("createDictationAudioChain — fail-open guarantees", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the ORIGINAL stream when Web Audio is unavailable", () => {
    const raw = fakeStream();
    const chain = createDictationAudioChain(raw);
    expect(chain.stream).toBe(raw);
    expect(chain.active).toBe(false);
  });

  it("returns the original stream when building the graph throws", () => {
    installAudioContext({
      createMediaStreamSource: vi.fn(() => { throw new Error("no source node"); }),
    });
    const raw = fakeStream();
    const chain = createDictationAudioChain(raw);
    expect(chain.stream).toBe(raw);
    expect(chain.active).toBe(false);
  });

  it("closes the AudioContext when construction fails partway", () => {
    // AudioContexts are hardware handles capped at ~6 per page; leaking one on the error
    // path would kill dictation a few consultations later, far from the actual cause.
    const ctx = installAudioContext({
      createGain: vi.fn(() => { throw new Error("boom"); }),
    });
    createDictationAudioChain(fakeStream());
    expect(ctx.close).toHaveBeenCalled();
  });

  it("passes the raw stream straight through when both stages are off", () => {
    installAudioContext();
    const raw = fakeStream();
    expect(createDictationAudioChain(raw, { cleanup: false, gate: false }).stream).toBe(raw);
  });

  it("reports the gate as OPEN before any measurement exists", () => {
    // A meter that claims "closed" before it has a floor estimate would tell the doctor
    // their microphone is being muted when nothing has been measured yet.
    const chain = createDictationAudioChain(fakeStream());
    expect(chain.getLevels().gateOpen).toBe(true);
    expect(chain.getLevels().ready).toBe(false);
  });

  it("hands the conditioned stream to the recorder when the graph builds", () => {
    installAudioContext();
    const chain = createDictationAudioChain(fakeStream());
    expect(chain.active).toBe(true);
    expect(chain.stream.id).toBe("conditioned");
    chain.dispose();
  });

  it("dispose() is safe to call on a passthrough chain", () => {
    expect(() => createDictationAudioChain(fakeStream()).dispose()).not.toThrow();
  });
});

describe("dictationAudioConstraints", () => {
  it("requests noise handling and the sample format the ASR consumes", () => {
    const audio = dictationAudioConstraints().audio as MediaTrackConstraints;
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.echoCancellation).toBe(true);
    expect(audio.autoGainControl).toBe(true);
    expect(audio.channelCount).toEqual({ ideal: 1 });
    expect(audio.sampleRate).toEqual({ ideal: 16000 });
  });

  it("uses `ideal` rather than `exact` for every constraint", () => {
    // `exact` turns an unusual microphone into an OverconstrainedError, which reads to the
    // doctor as "the mic is broken" rather than "this device cannot do 16kHz mono".
    const audio = dictationAudioConstraints("device-1") as unknown as
      { audio: Record<string, unknown> };
    const json = JSON.stringify(audio);
    expect(json).not.toContain("exact");
  });

  it("omits deviceId entirely when no microphone was chosen", () => {
    // An empty deviceId is a request for a device named "", not a request for the default.
    const audio = dictationAudioConstraints(null).audio as MediaTrackConstraints;
    expect("deviceId" in audio).toBe(false);
  });

  it("asks for the chosen microphone when one was picked", () => {
    const audio = dictationAudioConstraints("headset-42").audio as MediaTrackConstraints;
    expect(audio.deviceId).toEqual({ ideal: "headset-42" });
  });
});

describe("listMicrophones", () => {
  it("returns [] rather than throwing when enumeration is unavailable", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    return expect(listMicrophones()).resolves.toEqual([]);
  });

  it("keeps only audio inputs and names the unlabelled ones", () => {
    // Labels are empty until mic permission has been granted at least once, and a dropdown
    // of blank entries is unusable.
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: () => Promise.resolve([
          { kind: "audioinput", deviceId: "a", label: "" },
          { kind: "videoinput", deviceId: "v", label: "Camera" },
          { kind: "audioinput", deviceId: "b", label: "Headset" },
        ]),
      },
      configurable: true,
    });
    return expect(listMicrophones()).resolves.toEqual([
      { deviceId: "a", label: "Microphone 1" },
      { deviceId: "b", label: "Headset" },
    ]);
  });
});
