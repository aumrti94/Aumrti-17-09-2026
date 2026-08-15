import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import GlobalFieldDictation from "./GlobalFieldDictation";

/** Minimal stand-in for the browser's SpeechRecognition. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { resultIndex: number; results: unknown }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() { this.starts += 1; }
  stop() { this.stops += 1; this.onend?.(); }
  abort() { this.onend?.(); }

  say(transcript: string, isFinal = true) {
    const results = { length: 1, 0: { isFinal, 0: { transcript } } };
    this.onresult?.({ resultIndex: 0, results });
  }
}

const FIELD_RECT = {
  top: 100, left: 50, bottom: 200, right: 350,
  width: 300, height: 100, x: 50, y: 100, toJSON: () => ({}),
} as DOMRect;

const Harness: React.FC = () => {
  const [notes, setNotes] = useState("");
  return (
    <>
      <textarea aria-label="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <input aria-label="password" type="password" />
      <GlobalFieldDictation />
    </>
  );
};

const micButton = () => screen.queryByRole("button", { name: /dictate in english/i });
const stopButton = () => screen.queryByRole("button", { name: /stop dictation/i });

describe("GlobalFieldDictation", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(FIELD_RECT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });

  it("shows a mic only while an eligible field is focused", async () => {
    render(<Harness />);
    expect(micButton()).toBeNull();

    fireEvent.focusIn(screen.getByLabelText("notes"));
    await waitFor(() => expect(micButton()).not.toBeNull());

    // Password fields are not dictation targets.
    fireEvent.focusIn(screen.getByLabelText("password"));
    await waitFor(() => expect(micButton()).toBeNull());
  });

  it("dictates English into the field at the caret", async () => {
    render(<Harness />);
    const notes = screen.getByLabelText("notes") as HTMLTextAreaElement;

    fireEvent.focusIn(notes);
    await waitFor(() => expect(micButton()).not.toBeNull());
    fireEvent.click(micButton()!);

    const recognition = FakeRecognition.instances[0];
    expect(recognition.lang).toBe("en-IN");
    expect(recognition.continuous).toBe(true);
    expect(recognition.starts).toBe(1);

    act(() => recognition.say("patient has fever"));
    expect(notes.value).toBe("patient has fever");

    // A second utterance in the same session appends with a separating space.
    act(() => recognition.say("since two days"));
    expect(notes.value).toBe("patient has fever since two days");
  });

  it("stops on a second click", async () => {
    render(<Harness />);
    fireEvent.focusIn(screen.getByLabelText("notes"));
    await waitFor(() => expect(micButton()).not.toBeNull());
    fireEvent.click(micButton()!);

    await waitFor(() => expect(stopButton()).not.toBeNull());
    fireEvent.click(stopButton()!);

    const recognition = FakeRecognition.instances[0];
    expect(recognition.stops).toBe(1);
    await waitFor(() => expect(micButton()).not.toBeNull());
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("renders nothing when the browser has no speech recognition", async () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    render(<Harness />);
    fireEvent.focusIn(screen.getByLabelText("notes"));
    await waitFor(() => expect(micButton()).toBeNull());
  });
});
