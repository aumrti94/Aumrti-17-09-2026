import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockToast, mockInvoke } = vi.hoisted(() => ({ mockToast: vi.fn(), mockInvoke: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mockInvoke } } }));

import { useVoiceDictation } from "./useVoiceDictation";

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

let lastInstance: FakeRecognition | null = null;

beforeEach(() => {
  mockToast.mockReset();
  mockInvoke.mockReset();
  lastInstance = null;
  (window as any).SpeechRecognition = vi.fn().mockImplementation(() => {
    lastInstance = new FakeRecognition();
    return lastInstance;
  });
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
});

describe("useVoiceDictation", () => {
  it("reports supported when SpeechRecognition exists on window", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint" }));
    expect(result.current.isSupported).toBe(true);
  });

  it("reports unsupported and toasts instead of starting when neither API exists", () => {
    delete (window as any).SpeechRecognition;
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint" }));
    expect(result.current.isSupported).toBe(false);

    act(() => result.current.startRecording());
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Voice not supported" }));
    expect(result.current.isRecording).toBe(false);
  });

  it("startRecording configures and starts recognition in continuous, interim mode", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "prescription" }));
    act(() => result.current.startRecording());

    expect(lastInstance!.lang).toBe("en-IN");
    expect(lastInstance!.continuous).toBe(true);
    expect(lastInstance!.interimResults).toBe(true);
    expect(lastInstance!.start).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);
  });

  it("accumulates final results and appends interim text to the live transcript", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "notes" }));
    act(() => result.current.startRecording());

    act(() => {
      lastInstance!.onresult!({
        results: [
          { isFinal: true, 0: { transcript: "Patient reports fever." }, length: 1 },
          { isFinal: false, 0: { transcript: "and cough" }, length: 1 },
        ] as any,
      });
    });

    expect(result.current.transcript).toBe("Patient reports fever. and cough");
  });

  it("onerror sets an error message and stops recording, but swallows an 'aborted' error", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "notes" }));
    act(() => result.current.startRecording());
    act(() => lastInstance!.onerror!({ error: "network" }));
    expect(result.current.error).toBe("Speech error: network");
    expect(result.current.isRecording).toBe(false);
  });

  it("onerror with 'aborted' stops recording without setting an error", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "notes" }));
    act(() => result.current.startRecording());
    act(() => lastInstance!.onerror!({ error: "aborted" }));
    expect(result.current.error).toBeNull();
    expect(result.current.isRecording).toBe(false);
  });

  it("onend auto-processes the accumulated final transcript through the AI function", async () => {
    mockInvoke.mockResolvedValue({ data: { structured: { chief_complaint: "Fever" } }, error: null });
    const onStructuredResult = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint", onStructuredResult }));

    act(() => result.current.startRecording());
    act(() => {
      lastInstance!.onresult!({ results: [{ isFinal: true, 0: { transcript: "Fever for 3 days" }, length: 1 }] as any });
    });
    await act(async () => {
      lastInstance!.onend!();
    });

    expect(mockInvoke).toHaveBeenCalledWith("ai-clinical-voice", {
      body: { transcript: "Fever for 3 days", context_type: "complaint", existing_data: undefined },
    });
    expect(onStructuredResult).toHaveBeenCalledWith({ chief_complaint: "Fever" });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "✨ Voice notes processed" }));
  });

  it("onend does not call the AI function when nothing was transcribed", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint" }));
    act(() => result.current.startRecording());
    act(() => lastInstance!.onend!());
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it("processTranscript surfaces an edge-function error via toast and error state", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "quota exceeded" } });
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint" }));

    await act(async () => {
      await result.current.processTranscript("Some dictation");
    });

    expect(result.current.error).toBe("quota exceeded");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Voice processing failed", variant: "destructive" }));
  });

  it("stopRecording calls stop() on the active recognition instance", () => {
    const { result } = renderHook(() => useVoiceDictation({ contextType: "complaint" }));
    act(() => result.current.startRecording());
    const instance = lastInstance!;
    act(() => result.current.stopRecording());
    expect(instance.stop).toHaveBeenCalled();
  });
});
