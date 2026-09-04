import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn — className merge helper", () => {
  it("joins plain string classes", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (conditional classes)", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("resolves conflicting Tailwind utilities to the last one (tailwind-merge)", () => {
    // Plain string concatenation would keep both and let CSS specificity/order decide;
    // cn() is expected to dedupe so the last utility wins deterministically.
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("merges object and array class inputs (clsx passthrough)", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });
});
