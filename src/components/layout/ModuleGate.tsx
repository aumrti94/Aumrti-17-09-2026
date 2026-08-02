import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import { useProductMode } from "@/hooks/useProductMode";
import {
  useSubscriptionConfig,
  getModuleKeyForPath,
  isModuleKeyAllowed,
} from "@/hooks/useSubscriptionConfig";

/**
 * Central module gate — the single enforcer of plan-based module access.
 *
 * Resolves the current route's gateable module key from the URL and shows the
 * "Module Not Enabled" screen when the hospital's plan (subscription) or product-mode
 * config doesn't allow it. Wraps the AppShell <Outlet/>, so EVERY app route is enforced
 * automatically — including future ones — and gating can no longer be bypassed by
 * forgetting a per-route wrapper.
 */
const ModuleGate = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { isModuleEnabled, loadingMode } = useProductMode();
  const { enabledModules, isLoading: subLoading } = useSubscriptionConfig();

  const moduleKey = getModuleKeyForPath(location.pathname);
  // Non-gateable route (dashboard, schedule, settings, patients, …) → always render.
  if (!moduleKey) return <>{children}</>;

  // Avoid flashing module content before the lock decision settles.
  if (loadingMode || subLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const subAllowed = isModuleKeyAllowed(moduleKey, enabledModules);
  const modeAllowed = isModuleEnabled(moduleKey);
  if (subAllowed && modeAllowed) return <>{children}</>;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col items-center justify-center gap-4 text-center px-8">
      <Lock size={40} className="text-muted-foreground/30" />
      <p className="text-xl font-bold text-foreground">Module Not Enabled</p>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        {!subAllowed
          ? "This module is not included in your current plan. Contact Aumrti support to upgrade."
          : "This module is disabled for your deployment. Contact your admin to enable it in Settings → Product Mode."}
      </p>
    </div>
  );
};

export default ModuleGate;
