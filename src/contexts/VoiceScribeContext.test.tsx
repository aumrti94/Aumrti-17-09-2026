import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VoiceScribeProvider } from "./VoiceScribeContext";
import { useVoiceScribe } from "@/hooks/useVoiceScribe";

function wrapperFor(path: string) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Routes, null, React.createElement(Route, { path: "*", element: React.createElement(VoiceScribeProvider, null, children) })),
    );
}

beforeEach(() => {
  localStorage.clear();
});

describe("VoiceScribeProvider", () => {
  it("detects the session type from the current route when nothing is recording", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/ipd/ward-1") });
    // /ipd routes detect as ward_round per detectSessionTypeFromPath.
    expect(result.current.detectedSessionType).toBe("ward_round");
    expect(result.current.currentSessionType).toBe("ward_round");
  });

  it("defaults to opd_consultation for an unmatched route", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/some-other-page") });
    expect(result.current.detectedSessionType).toBe("opd_consultation");
  });

  it("does not overwrite an explicitly-set session type while a panel is open", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/ipd/ward-1") });
    act(() => {
      result.current.setIsPanelOpen(true);
      result.current.setCurrentSessionType("ipd_workspace");
    });
    expect(result.current.currentSessionType).toBe("ipd_workspace");
  });

  it("setSelectedLanguage updates state and persists to localStorage", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    act(() => result.current.setSelectedLanguage("hi-IN"));
    expect(result.current.selectedLanguage).toBe("hi-IN");
    expect(localStorage.getItem("vscribe_preferred_language")).toBe("hi-IN");
  });

  it("setSelectedMicId removes the localStorage key entirely when cleared, rather than storing an empty string", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    act(() => result.current.setSelectedMicId("mic-1"));
    expect(localStorage.getItem("vscribe_mic_id")).toBe("mic-1");
    act(() => result.current.setSelectedMicId(null));
    expect(localStorage.getItem("vscribe_mic_id")).toBeNull();
  });

  it("registerScreen + applyToCurrentScreen fills every registered screen with the structured output", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    const fillA = vi.fn();
    const fillB = vi.fn();
    act(() => {
      result.current.registerScreen("screenA", fillA);
      result.current.registerScreen("screenB", fillB);
      result.current.setStructuredOutput({ chief_complaint: "Fever" });
    });
    act(() => result.current.applyToCurrentScreen());

    expect(fillA).toHaveBeenCalledWith({ chief_complaint: "Fever" });
    expect(fillB).toHaveBeenCalledWith({ chief_complaint: "Fever" });
  });

  it("unregisterScreen stops that screen from receiving future applies", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    const fillA = vi.fn();
    act(() => {
      result.current.registerScreen("screenA", fillA);
      result.current.unregisterScreen("screenA");
      result.current.setStructuredOutput({ x: 1 });
    });
    act(() => result.current.applyToCurrentScreen());
    expect(fillA).not.toHaveBeenCalled();
  });

  it("getExistingDataForCurrentScreen merges data from every registered screen, skipping empty objects", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    act(() => {
      result.current.registerScreen("a", vi.fn(), () => ({ complaint: "Fever" }));
      result.current.registerScreen("b", vi.fn(), () => ({}));
      result.current.registerScreen("c", vi.fn(), () => ({ diagnosis: "Flu" }));
    });
    expect(result.current.getExistingDataForCurrentScreen()).toEqual({ complaint: "Fever", diagnosis: "Flu" });
  });

  it("resetSession clears recording state, transcript, structured output, and retained audio blobs", () => {
    const { result } = renderHook(() => useVoiceScribe(), { wrapper: wrapperFor("/opd") });
    act(() => {
      result.current.setIsRecording(true);
      result.current.setIsPaused(true);
      result.current.setRawTranscript("some text");
      result.current.setStructuredOutput({ a: 1 });
      result.current.segmentBlobsRef.current.push(new Blob(["x"]));
    });
    act(() => result.current.resetSession());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.rawTranscript).toBe("");
    expect(result.current.structuredOutput).toBeNull();
    expect(result.current.segmentBlobsRef.current).toEqual([]);
  });
});
