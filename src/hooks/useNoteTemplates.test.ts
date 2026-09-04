import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { useNoteTemplates, type NoteTemplate } from "./useNoteTemplates";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "order", "limit", "is", "not", "in", "maybeSingle", "single"]) {
    p[m] = self;
  }
  return p;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

const rows: NoteTemplate[] = [
  { id: "t1", name: "Normal round", note_type: "ward_round", body: { s: "" }, is_shared: false, created_by: "u1" },
  { id: "t2", name: "Team default", note_type: "ward_round", body: { s: "" }, is_shared: true, created_by: "u2" },
  { id: "t3", name: "Other private", note_type: "ward_round", body: { s: "" }, is_shared: false, created_by: "u2" },
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

describe("useNoteTemplates", () => {
  it("splits templates into mine (any visibility) vs. shared-by-others, hiding others' private ones", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1" } });
      if (table === "clinical_note_templates") return { select: () => makeChain({ data: rows }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useNoteTemplates("ward_round"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.mine.map((t) => t.id)).toEqual(["t1"]);
    expect(result.current.shared.map((t) => t.id)).toEqual(["t2"]);
  });

  it("saveTemplate inserts with the resolved identity and note type", async () => {
    const insertSpy = vi.fn(() => makeChain({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1" } });
      if (table === "clinical_note_templates") return { select: () => makeChain({ data: [] }), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useNoteTemplates("nursing"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.saveTemplate({ name: "Shift note", body: { text: "" }, isShared: true });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", created_by: "u1", note_type: "nursing", name: "Shift note", is_shared: true }),
    );
  });

  it("saveTemplate defaults is_shared to false when not specified", async () => {
    const insertSpy = vi.fn(() => makeChain({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1" } });
      if (table === "clinical_note_templates") return { select: () => makeChain({ data: [] }), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useNoteTemplates("nursing"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.saveTemplate({ name: "Shift note", body: { text: "" } });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ is_shared: false }));
  });

  it("deleteTemplate removes the row by id", async () => {
    const deleteEqSpy = vi.fn(() => makeChain({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1" } });
      if (table === "clinical_note_templates") return { select: () => makeChain({ data: rows }), delete: () => ({ eq: deleteEqSpy }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useNoteTemplates("ward_round"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.deleteTemplate("t1");
    expect(deleteEqSpy).toHaveBeenCalledWith("id", "t1");
  });
});
