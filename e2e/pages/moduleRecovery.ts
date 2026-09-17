/**
 * Recovers from a transient lazy-route chunk-load failure, the same way a real user would.
 *
 * Every route in `src/App.tsx` is lazy-loaded and wrapped in `ModuleErrorBoundary` — confirmed
 * by reading it directly. Under a long-lived local Vite dev server (this whole Phase 7 session
 * restarted it dozens of times across many consecutive Playwright runs), a dynamic import
 * occasionally fails outright (`Failed to fetch dynamically imported module: .../LabPage.tsx` —
 * caught live, reproducibly, while building J12) and the boundary renders "Error in {module} /
 * Try Again" instead of the page. `ModuleErrorBoundary.handleRetry()` just clears its error
 * state and re-renders `children`, which re-attempts the same dynamic import — clicking its
 * "Try Again" button is a real, designed recovery path, not a test-side workaround.
 *
 * Call this immediately after every `page.goto()` to a lazy-loaded route. It is a no-op (one
 * short existence check, no wait) on the normal path where the module loaded fine.
 */
import type { Page } from "@playwright/test";

export async function recoverFromModuleLoadError(page: Page): Promise<void> {
  const retry = page.getByRole("button", { name: "Try Again" });
  if (await retry.isVisible({ timeout: 500 }).catch(() => false)) {
    await retry.click();
  }
}
