import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { reducer, useToast, toast } from "./use-toast";

describe("use-toast reducer", () => {
  it("ADD_TOAST prepends and caps the list at the 1-toast limit", () => {
    const state = { toasts: [{ id: "a", open: true }] } as any;
    const next = reducer(state, { type: "ADD_TOAST", toast: { id: "b", open: true } as any });
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].id).toBe("b");
  });

  it("UPDATE_TOAST merges fields into the matching toast only", () => {
    const state = { toasts: [{ id: "a", title: "old" }, { id: "b", title: "keep" }] } as any;
    const next = reducer(state, { type: "UPDATE_TOAST", toast: { id: "a", title: "new" } });
    expect(next.toasts.find((t: any) => t.id === "a")!.title).toBe("new");
    expect(next.toasts.find((t: any) => t.id === "b")!.title).toBe("keep");
  });

  it("DISMISS_TOAST with an id closes only that toast", () => {
    const state = { toasts: [{ id: "a", open: true }, { id: "b", open: true }] } as any;
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "a" });
    expect(next.toasts.find((t: any) => t.id === "a")!.open).toBe(false);
    expect(next.toasts.find((t: any) => t.id === "b")!.open).toBe(true);
  });

  it("DISMISS_TOAST with no id closes every toast", () => {
    const state = { toasts: [{ id: "a", open: true }, { id: "b", open: true }] } as any;
    const next = reducer(state, { type: "DISMISS_TOAST" });
    expect(next.toasts.every((t: any) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST with an id removes only that toast", () => {
    const state = { toasts: [{ id: "a" }, { id: "b" }] } as any;
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: "a" });
    expect(next.toasts.map((t: any) => t.id)).toEqual(["b"]);
  });

  it("REMOVE_TOAST with no id clears every toast", () => {
    const state = { toasts: [{ id: "a" }, { id: "b" }] } as any;
    const next = reducer(state, { type: "REMOVE_TOAST" });
    expect(next.toasts).toEqual([]);
  });
});

describe("useToast / toast()", () => {
  it("toast() adds a toast that the hook observes, capped at one visible toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "First" });
    });
    act(() => {
      toast({ title: "Second" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss() on the returned handle closes that toast (open:false)", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "Closable" });
    });
    act(() => {
      handle.dismiss();
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("update() on the returned handle patches the same toast by id", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "Original" });
    });
    act(() => {
      handle.update({ id: handle.id, title: "Patched" } as any);
    });
    expect(result.current.toasts[0].title).toBe("Patched");
  });
});
