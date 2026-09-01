/**
 * TrialBanner — the fixed-overlay click-interception lock.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The banner is `fixed top-14`, i.e. y = 56–88px. `AppShell` offsets `<main>` by `mt-14`
 * (56px), which clears the HEADER and nothing else — so the first ~32px of every module's
 * content renders *underneath* this banner. On `/lab` that is the module tab bar, whose buttons
 * centre around y = 76, squarely inside the banner's box.
 *
 * With an opaque, hit-testable wrapper the banner therefore swallowed the click on every lab
 * tab. A Playwright run reported it as `subtree intercepts pointer events`; a nurse reports it
 * as "the Collection tab does nothing". It is not a test-only problem — the tabs are genuinely
 * unclickable for a real user whenever this banner is showing, which is exactly when the
 * hospital is already unhappy.
 *
 * `CredentialExpiryBanner` and the `AppShell` toast region both sit at the same coordinates and
 * both use the `pointer-events-none` wrapper + `pointer-events-auto` content pattern. This test
 * holds `TrialBanner` to it, because the failure is invisible in review: the markup looks
 * completely reasonable and the bug only appears when something is rendered beneath it.
 *
 * The banner is rendered in its NON-dismissable read-only state, which is the state that
 * appears on every route and therefore over every module's tab bar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockConfig = vi.hoisted(() => ({
  value: {
    status: "trial",
    trialDaysLeft: 0,
    isExpired: true,
    isSuspended: false,
    isLoading: false,
    accessBlocked: true,
    graceEndsAt: null as Date | null,
    inGrace: false,
  },
}));

vi.mock("@/hooks/useSubscriptionConfig", () => ({
  useSubscriptionConfig: () => mockConfig.value,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/lab" }),
}));

vi.mock("@/lib/brand", () => ({ SUPPORT_EMAIL: "support@example.test" }));

import TrialBanner from "./TrialBanner";

/** The outermost element the component renders. */
function bannerRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild as HTMLElement | null;
  expect(root, "TrialBanner rendered nothing").not.toBeNull();
  return root!;
}

describe("TrialBanner — must never intercept clicks on the content beneath it", () => {
  beforeEach(() => {
    mockConfig.value = {
      status: "trial",
      trialDaysLeft: 0,
      isExpired: true,
      isSuspended: false,
      isLoading: false,
      accessBlocked: true,
      graceEndsAt: null,
      inGrace: false,
    };
    localStorage.clear();
  });

  it("renders the read-only message when access is blocked", () => {
    render(<TrialBanner />);
    expect(
      screen.getByText(/subscription is inactive/i),
      "The read-only state must be visible on every route — staff should never discover it as a failed save mid-consultation.",
    ).toBeTruthy();
  });

  it("puts pointer-events-none on the fixed wrapper", () => {
    const { container } = render(<TrialBanner />);
    const root = bannerRoot(container);

    expect(
      root.className,
      "The banner is still positioned fixed over the page content — that part is intended.",
    ).toContain("fixed");

    expect(
      root.className,
      "REGRESSION LOCK. The fixed wrapper must carry `pointer-events-none`, or it swallows " +
        "clicks on whatever renders beneath it — which, because AppShell only offsets <main> by " +
        "the header height, is the module tab bar of every screen. Same pattern as " +
        "CredentialExpiryBanner.tsx and the AppShell toast region.",
    ).toContain("pointer-events-none");
  });

  it("restores pointer-events-auto on the content, so its own buttons still work", () => {
    const { container } = render(<TrialBanner />);
    const root = bannerRoot(container);
    const content = root.firstElementChild as HTMLElement | null;

    expect(content, "The banner must wrap its content in an inner element.").not.toBeNull();
    expect(
      content!.className,
      "`pointer-events-none` on the wrapper disables the CTA too unless the inner content " +
        "restores `pointer-events-auto`. Without this the fix trades a dead tab bar for a dead " +
        "Contact Support link.",
    ).toContain("pointer-events-auto");
  });

  it("keeps its call-to-action clickable", () => {
    render(<TrialBanner />);
    const cta = screen.getByRole("button", { name: /contact support/i });

    // Walk up from the button; the first ancestor that sets a pointer-events class must be
    // the `auto` one, never the `none` wrapper.
    let node: HTMLElement | null = cta;
    let decided = "";
    while (node && !decided) {
      if (node.className?.includes?.("pointer-events-auto")) decided = "auto";
      else if (node.className?.includes?.("pointer-events-none")) decided = "none";
      node = node.parentElement;
    }

    expect(
      decided,
      "The nearest pointer-events ancestor of the CTA resolved to `none`, so the one action " +
        "this banner offers cannot be clicked.",
    ).toBe("auto");
  });

  it("renders nothing at all for an active subscription", () => {
    mockConfig.value = {
      status: "active",
      trialDaysLeft: null as never,
      isExpired: false,
      isSuspended: false,
      isLoading: false,
      accessBlocked: false,
      graceEndsAt: null,
      inGrace: false,
    };
    const { container } = render(<TrialBanner />);

    expect(
      container.firstElementChild,
      "A paying hospital must see no banner. This also guards the demotion bug fixed in " +
        "create-razorpay-subscription: an active hospital that starts a re-subscribe was being " +
        "written back to `trial` with a `trial_ends_at` already in the past, which flipped the " +
        "whole tenant read-only.",
    ).toBeNull();
  });
});
