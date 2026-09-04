import { describe, it, expect } from "vitest";
import { getErrorMessage, getInvokeError } from "./errorMessage";

describe("getErrorMessage — surfaces the exact DB/PostgREST error instead of a generic fallback", () => {
  it("returns the generic fallback for a null/undefined error", () => {
    expect(getErrorMessage(null)).toBe("Something went wrong. Please try again.");
    expect(getErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });

  it("returns a plain string error trimmed", () => {
    expect(getErrorMessage("  duplicate row  ")).toBe("duplicate row");
  });

  it("falls back to generic for a blank string", () => {
    expect(getErrorMessage("   ")).toBe("Something went wrong. Please try again.");
  });

  it("prefixes a known Postgres error code's friendly hint before the raw message", () => {
    expect(
      getErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" }),
    ).toBe("This record already exists — duplicate key value violates unique constraint");
  });

  it("does not duplicate the message when it's identical to the code hint text", () => {
    // P0001 (RAISE EXCEPTION) has an empty hint by design — the message stands alone.
    expect(getErrorMessage({ code: "P0001", message: "Cannot discharge with an unpaid balance" })).toBe(
      "Cannot discharge with an unpaid balance",
    );
  });

  it("uses the code hint alone when there is no message, only a code", () => {
    expect(getErrorMessage({ code: "PGRST116" })).toBe("No matching record was found");
  });

  it("appends a hint in parentheses when present", () => {
    expect(getErrorMessage({ hint: "Perhaps you meant the users table" })).toBe(
      "(Perhaps you meant the users table)",
    );
  });

  it("falls back to details when there is no message", () => {
    expect(
      getErrorMessage({ code: "23505", details: "Key (email)=(x@y.com) already exists." }),
    ).toBe("This record already exists — Key (email)=(x@y.com) already exists.");
  });

  it("reads a plain { error } field when there is no PostgREST shape", () => {
    expect(getErrorMessage({ error: "AI budget exceeded" })).toBe("AI budget exceeded");
  });

  it("reads a native Error's message", () => {
    expect(getErrorMessage(new Error("network timeout"))).toBe("network timeout");
  });
});

describe("getInvokeError — unwraps a supabase.functions.invoke() result", () => {
  it("returns null when there is no error at all", async () => {
    expect(await getInvokeError({ error: null, data: { ok: true } })).toBeNull();
  });

  it("prefers the soft-error field on the response body", async () => {
    const result = await getInvokeError({ error: null, data: { error: "AI budget exceeded" } });
    expect(result).toBe("AI budget exceeded");
  });

  it("reads the JSON body inside error.context when present", async () => {
    const res = {
      error: { context: { json: async () => ({ error: "Invalid Azure deployment" }) } },
      data: null,
    };
    expect(await getInvokeError(res)).toBe("Invalid Azure deployment");
  });

  it("falls back to getErrorMessage(error) when there is no usable context body", async () => {
    const res = { error: { message: "plain function failure" }, data: null };
    expect(await getInvokeError(res)).toBe("plain function failure");
  });

  it("does not throw when the context body isn't valid JSON", async () => {
    const res = {
      error: { message: "boom", context: { json: async () => { throw new Error("not json"); } } },
      data: null,
    };
    await expect(getInvokeError(res)).resolves.toBe("boom");
  });
});
