import { describe, it, expect } from "vitest";
import { unwrapFunctionError } from "./invokeError";

describe("unwrapFunctionError — surfaces the real edge-function error, not the generic wrapper", () => {
  it("prefers a soft-error body (2xx response with an { error } field) over anything else", async () => {
    const result = await unwrapFunctionError(new Error("Edge Function returned a non-2xx status code"), {
      error: "AI budget exceeded for this hospital",
    });
    expect(result).toBe("AI budget exceeded for this hospital");
  });

  it("stringifies a non-string soft-error body", async () => {
    const result = await unwrapFunctionError(null, { error: { code: "ENTITLEMENT_DENIED" } });
    expect(result).toBe(JSON.stringify({ code: "ENTITLEMENT_DENIED" }));
  });

  it("reports a friendly message for a network-level failure", async () => {
    const result = await unwrapFunctionError(new Error("Failed to fetch"));
    expect(result).toBe("AI service unreachable — the edge function may not be deployed.");
  });

  it("unwraps a JSON error body from error.context", async () => {
    const err = {
      message: "Edge Function returned a non-2xx status code",
      context: { text: async () => JSON.stringify({ error: "Invalid Azure deployment" }) },
    };
    const result = await unwrapFunctionError(err);
    expect(result).toBe("Invalid Azure deployment");
  });

  it("falls back to the raw context body when it isn't JSON", async () => {
    const err = {
      message: "Edge Function returned a non-2xx status code",
      context: { text: async () => "upstream 502" },
    };
    const result = await unwrapFunctionError(err);
    expect(result).toBe("upstream 502");
  });

  it("falls back to the raw error message when there is no context", async () => {
    const result = await unwrapFunctionError(new Error("boom"));
    expect(result).toBe("boom");
  });

  it("returns a generic message for a completely empty error", async () => {
    expect(await unwrapFunctionError(null)).toBe("Unknown error");
    expect(await unwrapFunctionError(undefined)).toBe("Unknown error");
  });
});
