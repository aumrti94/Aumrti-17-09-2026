import React from "react";
import { Link } from "react-router-dom";
import { Menu, Search, Wifi, WifiOff, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import AumrtiLogo from "@/components/brand/AumrtiLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * Presentational header shell shared by the HMS `AppHeader` and the Platform
 * admin `PlatformHeader`. Holds only the tenant-agnostic chrome: logo/menu
 * toggle, breadcrumb, search trigger, dark-mode toggle, a plain online
 * indicator, and the avatar dropdown shell.
 *
 * Deliberately does NOT know about `useHospitalId`, hospital branding,
 * `useOfflineSync`'s sync queue, or the hospital-scoped `NotificationCentre`
 * — those stay in `AppHeader`, which has hospital context. `PlatformHeader`
 * has none of that and simply doesn't pass the corresponding slots.
 */

export interface HeaderChromeBreadcrumbItem {
  label: string;
  href?: string; // omit for the current page (rendered as BreadcrumbPage)
}

export interface HeaderChromeAvatarItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface HeaderChromeProps {
  logoHref?: string;
  onMenuClick: () => void;
  isMobile: boolean;
  breadcrumbs: HeaderChromeBreadcrumbItem[];
  /** Shown in place of the breadcrumb on mobile. */
  mobileTitle?: string;
  /** Center slot — hospital branding on HMS, admin identity on Platform. */
  centerSlot?: React.ReactNode;
  onSearchClick?: () => void;
  searchPlaceholder?: string;
  /** Omit to hide the dark-mode toggle entirely. */
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  /** Plain browser online/offline pill. Omit to hide (e.g. surface has its own). */
  online?: boolean;
  /** Extra tenant-specific buttons (incident report, sync queue, notifications, ...). */
  extraActions?: React.ReactNode;
  avatarInitials: string;
  avatarItems: HeaderChromeAvatarItem[];
}

export const HeaderChrome: React.FC<HeaderChromeProps> = ({
  logoHref = "/dashboard",
  onMenuClick,
  isMobile,
  breadcrumbs,
  mobileTitle,
  centerSlot,
  onSearchClick,
  searchPlaceholder = "Search…",
  darkMode,
  onToggleDarkMode,
  online,
  extraActions,
  avatarInitials,
  avatarItems,
}) => {
  const currentLabel = breadcrumbs[breadcrumbs.length - 1]?.label ?? mobileTitle ?? "";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b border-border flex items-center px-3 gap-2 sm:px-4 sm:gap-4">
      {/* Left: Aumrti mark + hamburger + breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <Link to={logoHref} aria-label="Aumrti — go to home" className="shrink-0 hover:opacity-80 transition-opacity">
          <AumrtiLogo variant="lockup" className="h-9 w-auto max-w-[120px]" />
        </Link>
        <button
          onClick={onMenuClick}
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-muted transition-colors active:scale-95"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>

        {!isMobile && (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.slice(0, -1).map((crumb) => (
                <React.Fragment key={crumb.label}>
                  <BreadcrumbItem>
                    {crumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </React.Fragment>
              ))}
              <BreadcrumbItem>
                <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}

        {isMobile && (
          <span className="text-sm font-semibold text-foreground truncate">{currentLabel}</span>
        )}
      </div>

      {/* Center slot — hospital branding / admin identity */}
      {!isMobile && centerSlot}

      {/* Center: search trigger (hidden on mobile) */}
      {!isMobile && onSearchClick && (
        <div className="flex-1 flex justify-center max-w-md mx-auto">
          <button
            onClick={onSearchClick}
            className="flex items-center gap-2 w-full max-w-sm h-9 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <Search size={16} />
            <span className="flex-1 text-left">{searchPlaceholder}</span>
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        </div>
      )}

      {/* Spacer when there's no search trigger to fill the middle */}
      {(isMobile || !onSearchClick) && <div className="flex-1" />}

      {/* Right: status + extra actions + user */}
      <div className="flex items-center gap-1 sm:gap-2">
        {extraActions}

        {onToggleDarkMode && (
          <button
            onClick={onToggleDarkMode}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        )}

        {!isMobile && online !== undefined && (
          <span
            title={online ? "Online" : "Offline"}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
              online ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]" : "bg-destructive/10 text-destructive"
            )}
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? "Online" : "Offline"}
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:ring-2 hover:ring-ring/20 transition-shadow">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {avatarInitials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {avatarItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                className={item.danger ? "text-destructive" : undefined}
                onClick={item.onClick}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default HeaderChrome;
