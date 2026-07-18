import * as React from "react";
import { TabsTrigger } from "@/components/ui/tabs";
import { useModuleAccess } from "./useModuleAccess";

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsTrigger>;

interface GatedTabsTriggerProps extends TabsTriggerProps {
  /** Canonical module key (e.g. "oncology"), matches MODULE_TABS keys. */
  module: string;
  /** Tab key within the module. Defaults to `value` when omitted. */
  tab?: string;
}

/**
 * Drop-in replacement for shadcn <TabsTrigger>. Renders nothing when the tab is
 * withheld by the hospital/plan entitlement or the user's role. `value` is the
 * Radix tab id and doubles as the entitlement tab key unless `tab` is given.
 *
 *   <GatedTabsTrigger module="oncology" value="protocols">Protocols</GatedTabsTrigger>
 */
export const GatedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsTrigger>,
  GatedTabsTriggerProps
>(({ module, tab, value, ...props }, ref) => {
  const { tabAllowed } = useModuleAccess();
  const tabKey = tab ?? (value as string);
  if (!tabAllowed(module, tabKey)) return null;
  return <TabsTrigger ref={ref} value={value} {...props} />;
});
GatedTabsTrigger.displayName = "GatedTabsTrigger";

interface GatedActionProps {
  module: string;
  action: string;
  children: React.ReactNode;
  /** Optional fallback rendered when the action is withheld (default: nothing). */
  fallback?: React.ReactNode;
}

/**
 * Renders `children` only when the module action/button is allowed. Use for
 * primary action buttons whose module+action are catalogued in MODULE_ACTIONS.
 *
 *   <GatedAction module="oncology" action="book_chemo"><Button>…</Button></GatedAction>
 */
export function GatedAction({ module, action, children, fallback = null }: GatedActionProps) {
  const { actionAllowed } = useModuleAccess();
  return <>{actionAllowed(module, action) ? children : fallback}</>;
}
