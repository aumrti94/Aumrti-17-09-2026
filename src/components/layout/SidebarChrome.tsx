import React from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { X, LogOut } from "lucide-react";

/**
 * Presentational sidebar shell shared by the HMS `AppSidebar` and the Platform
 * admin `PlatformSidebar`. It owns layout, spacing, the grouped-section chrome
 * (10px uppercase group labels, active/hover item styling, collapse transition)
 * and the bottom user block — nothing else.
 *
 * All routing, data-fetching, and active-state logic stays with the caller:
 * each nav item already carries its resolved `active` boolean and `onClick`
 * handler, so this component never needs to know about `useLocation` or how a
 * given surface decides what counts as "current".
 */

export interface SidebarNavItem {
  /** Unique key, typically the route path. */
  key: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  /** Small numeric badge (e.g. expiring credentials, pending consents). */
  badge?: number;
  /** Outlined-when-inactive treatment, used by HMS for "All Modules". */
  emphasize?: boolean;
}

export interface SidebarNavGroup {
  key: string;
  /** Omit for an unlabeled group (e.g. the top-level items above the scroll area). */
  label?: string;
  items: SidebarNavItem[];
}

export interface SidebarChromeUser {
  name: string;
  initials: string;
  /** e.g. role label for HMS, email for Platform admins. */
  subtitle?: string;
}

export interface SidebarChromeProps {
  /** Non-scrolling group(s) pinned to the top, rendered without a scrollbar. */
  topGroups: SidebarNavGroup[];
  /** Scrollable middle group(s), each with its own uppercase label. */
  scrollGroups: SidebarNavGroup[];
  /** Non-scrolling group(s) pinned above the user block. */
  bottomGroups: SidebarNavGroup[];
  collapsed: boolean;
  isMobileOverlay?: boolean;
  onClose?: () => void;
  mobileTitle?: string;
  user: SidebarChromeUser;
  onSignOut: () => void;
}

const NavGroupBlock: React.FC<{ group: SidebarNavGroup; collapsed: boolean; showLabelSpacingTop?: boolean }> = ({
  group,
  collapsed,
  showLabelSpacingTop,
}) => {
  if (group.items.length === 0) return null;
  return (
    <React.Fragment>
      {group.label && (
        <div className={cn("px-4 pb-1", showLabelSpacingTop ? "pt-5" : "pt-4")}>
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40">
              {group.label}
            </span>
          )}
        </div>
      )}
      <nav className="flex flex-col gap-1 px-2">
        {group.items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={item.onClick}
              className={cn(
                "flex items-center gap-3 min-h-[44px] w-full rounded-lg px-3 text-sm font-medium transition-colors text-left",
                item.active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white",
                item.emphasize && !item.active && "border border-sidebar-foreground/20"
              )}
            >
              <div className="relative shrink-0">
                <Icon size={18} />
                {!!item.badge && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </div>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </React.Fragment>
  );
};

export const SidebarChrome: React.FC<SidebarChromeProps> = ({
  topGroups,
  scrollGroups,
  bottomGroups,
  collapsed,
  isMobileOverlay,
  onClose,
  mobileTitle = "Menu",
  user,
  onSignOut,
}) => {
  const isCollapsed = isMobileOverlay ? false : collapsed;

  return (
    <div
      className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground",
        isMobileOverlay ? "w-full h-full" : "fixed left-0 top-[56px] bottom-0 z-40 transition-[width] duration-200",
        !isMobileOverlay && (isCollapsed ? "w-16" : "w-56")
      )}
    >
      {/* Mobile close button */}
      {isMobileOverlay && (
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <span className="text-sm font-bold text-sidebar-foreground">{mobileTitle}</span>
          <button
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-sidebar-accent/50 text-sidebar-foreground"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* No brand block here — the logo sits in the header directly above this
          column, so repeating it only costs vertical space in the nav. */}

      {/* Top group(s) */}
      {topGroups.length > 0 && (
        <div className="flex-shrink-0 flex flex-col gap-1 pt-3">
          {topGroups.map((group) => (
            <NavGroupBlock key={group.key} group={group} collapsed={isCollapsed} />
          ))}
        </div>
      )}

      {/* Scrollable middle */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-sidebar-border [&::-webkit-scrollbar-thumb]:rounded-full">
        {scrollGroups.map((group, i) => (
          <NavGroupBlock key={group.key} group={group} collapsed={isCollapsed} showLabelSpacingTop={i === 0} />
        ))}
      </div>

      {/* Bottom group(s) */}
      {bottomGroups.length > 0 && (
        <nav className="flex-shrink-0 flex flex-col gap-1 px-2 py-4 border-t border-sidebar-border">
          {bottomGroups.flatMap((group) => group.items).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={item.onClick}
                className={cn(
                  "flex items-center gap-3 min-h-[44px] w-full rounded-lg px-3 text-sm font-medium transition-colors text-left",
                  item.active
                    ? "bg-sidebar-accent text-white"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white"
                )}
              >
                <div className="relative shrink-0">
                  <Icon size={18} />
                  {!!item.badge && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </div>
                {!isCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {/* User section */}
      <div className="flex-shrink-0 border-t border-sidebar-border px-3 py-3 flex items-center gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-sidebar-accent text-white text-xs font-semibold">
            {user.initials}
          </AvatarFallback>
        </Avatar>
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
            {user.subtitle && (
              <p className="text-[11px] text-sidebar-foreground/60 truncate">{user.subtitle}</p>
            )}
          </div>
        )}
        <button
          onClick={onSignOut}
          className="text-sidebar-foreground/60 hover:text-white transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
};

export default SidebarChrome;
