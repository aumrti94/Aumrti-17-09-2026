import { describe, it, expect } from "vitest";
import { encodeWav16kMono, downmixToMono, TARGET_SAMPLE_RATE } from "./audioToWav";

/**
 * Byte-layout tests for the WAV writer. Bhashini rejects the whole request on a malformed
 * header, and the failure surfaces as an unhelpful ULCA 502 — so the header is asserted
 * field by field here rather than trusted to a round-trip in the browser.
 */

async function headerOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

const ascii = (v: DataView, offset: number, len: number) =>
  Array.from({ length: len }, (_, i) => String.fromCharCode(v.getUint8(offset + i))).join("");

describe("encodeWav16kMono", () => {
  it("writes a valid RIFF/WAVE header for 16 kHz mono PCM-16", async () => {
    const v = await headerOf(encodeWav16kMono(new Float32Array(100)));

    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(ascii(v, 36, 4)).toBe("data");

    expect(v.getUint32(16, true)).toBe(16);   // fmt chunk size
    expect(v.getUint16(20, true)).toBe(1);    // PCM
    expect(v.getUint16(22, true)).toBe(1);    // mono
    expect(v.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(v.getUint32(28, true)).toBe(TARGET_SAMPLE_RATE * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(2);    // block align
    expect(v.getUint16(34, true)).toBe(16);   // bits per sample
  });

  it("declares chunk sizes consistent with the actual byte length", async () => {
    const blob = encodeWav16kMono(new Float32Array(256));
    const v = await headerOf(blob);

    expect(blob.size).toBe(44 + 256 * 2);
    expect(v.getUint32(4, true)).toBe(blob.size - 8); // RIFF size excludes its own 8 bytes
    expect(v.getUint32(40, true)).toBe(256 * 2);      // data size
  });

  it("clamps out-of-range samples instead of letting them wrap", async () => {
    // decodeAudioData can overshoot [-1,1] after resampling. Wrapping would turn a loud
    // syllable into noise, which reads downstream as a mis-transcribed word, not an error.
    const v = await headerOf(encodeWav16kMono(new Float32Array([2.5, -2.5, 1, -1])));

    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(32767);
    expect(v.getInt16(50, true)).toBe(-32768);
  });

  it("round-trips silence and mid-scale samples", async () => {
    const v = await headerOf(encodeWav16kMono(new Float32Array([0, 0.5, -0.5])));

    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(v.getInt16(48, true)).toBe(-0x4000);
  });

  it("honours a non-default sample rate", async () => {
    const v = await headerOf(encodeWav16kMono(new Float32Array(8), 8000));
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(28, true)).toBe(16000);
  });

  it("produces a header-only file for empty input rather than throwing", async () => {
    // A zero-length segment is possible at a recording boundary; it must not crash the leg.
    const blob = encodeWav16kMono(new Float32Array(0));
    expect(blob.size).toBe(44);
    expect((await headerOf(blob)).getUint32(40, true)).toBe(0);
  });
});

describe("downmixToMono", () => {
  it("returns the single channel untouched", () => {
    const mono = new Float32Array([0.1, 0.2]);
    expect(downmixToMono([mono])).toBe(mono);
  });

  it("averages channels rather than dropping one", () => {
    // Taking only channel 0 would silently halve the signal on a stereo capture.
    const out = downmixToMono([
      new Float32Array([1, 0, -1]),
      new Float32Array([0, 1, 1]),
    ]);
    expect(Array.from(out)).toEqual([0.5, 0.5, 0]);
  });
});
