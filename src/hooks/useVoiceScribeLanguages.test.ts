import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { useVoiceScribeLanguages } from "./useVoiceScribeLanguages";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = self;
  return p;
}

function mockIdentityAndSetting(userRow: any, settingRow: any) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return makeChain({ data: userRow });
    if (table === "ai_language_settings") return makeChain({ data: settingRow });
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  localStorage.clear();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

describe("useVoiceScribeLanguages", () => {
  it("resolves the hospital's enabled language setting as the default", async () => {
    mockIdentityAndSetting({ id: "doc1", hospital_id: "h1" }, { language_code: "hi", enabled: true });

    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalDefaultLang).toBe("hi-IN");
    expect(result.current.voiceLang).toBe("hi-IN");
    expect(result.current.doctorId).toBe("doc1");
  });

  it("falls back to en-IN with a console warning for an unrecognised language code", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockIdentityAndSetting({ id: "doc1", hospital_id: "h1" }, { language_code: "xx-ZZ", enabled: true });

    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalDefaultLang).toBe("en-IN");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("defaults to en-IN when the hospital has no enabled voice_scribe setting", async () => {
    mockIdentityAndSetting({ id: "doc1", hospital_id: "h1" }, null);

    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalDefaultLang).toBe("en-IN");
  });

  it("a doctor's stored localStorage override wins over the hospital default", async () => {
    localStorage.setItem("vscribe_lang_doc1", "ta-IN");
    mockIdentityAndSetting({ id: "doc1", hospital_id: "h1" }, { language_code: "hi", enabled: true });

    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.voiceLang).toBe("ta-IN");
    expect(result.current.hospitalDefaultLang).toBe("hi-IN");
  });

  it("setVoiceLang updates state and persists the choice under the doctor's own key", async () => {
    mockIdentityAndSetting({ id: "doc1", hospital_id: "h1" }, { language_code: "hi", enabled: true });

    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setVoiceLang("kn-IN"));

    expect(result.current.voiceLang).toBe("kn-IN");
    expect(localStorage.getItem("vscribe_lang_doc1")).toBe("kn-IN");
  });

  it("stays on defaults with no doctorId when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useVoiceScribeLanguages());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.doctorId).toBeNull();
    expect(result.current.voiceLang).toBe("en-IN");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
