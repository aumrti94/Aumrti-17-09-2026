import { useMemo } from "react";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasTabAccess, hasActionAccess, type TabDef } from "@/lib/tabPermissions";

/**
 * Single access surface for module tabs & buttons. Reads the (role permissions +
 * hospital/plan entitlement) blob from HospitalContext once and exposes cheap
 * predicate helpers. Every gate in the app should go through this so the plan →
 * hospital → role composition stays in one place.
 *
 *   const { tabAllowed, actionAllowed } = useModuleAccess();
 *   {actionAllowed("oncology", "book_chemo") && <Button>…</Button>}
 */
export function useModuleAccess() {
  const { permissions, role } = useHospitalContext();

  return useMemo(
    () => ({
      tabAllowed: (moduleKey: string, tabKey: string) =>
        hasTabAccess(moduleKey, tabKey, permissions, role),
      actionAllowed: (moduleKey: string, actionKey: string) =>
        hasActionAccess(moduleKey, actionKey, permissions, role),
    }),
    [permissions, role],
  );
}

/**
 * Pick a tab to show when the currently-selected one may be hidden by
 * entitlement. Returns `current` if it is still allowed, otherwise the first
 * allowed tab from `tabDefs`, otherwise `current` (nothing allowed — page
 * decides what to render). Keep it stable-friendly: callers typically feed the
 * result into a controlled <Tabs value=…>.
 */
export function useDefaultVisibleTab(
  moduleKey: string,
  tabDefs: TabDef[] | undefined,
  current: string,
): string {
  const { tabAllowed } = useModuleAccess();
  return useMemo(() => {
    if (!tabDefs?.length) return current;
    if (tabAllowed(moduleKey, current)) return current;
    const firstAllowed = tabDefs.find((t) => tabAllowed(moduleKey, t.key));
    return firstAllowed ? firstAllowed.key : current;
  }, [moduleKey, current, tabDefs, tabAllowed]);
}
