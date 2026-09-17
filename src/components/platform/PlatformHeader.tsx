import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAumrtiAdmin } from "@/hooks/useAumrtiAdmin";
import { useSidebar } from "@/hooks/useSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import HeaderChrome, { type HeaderChromeBreadcrumbItem } from "@/components/layout/HeaderChrome";

// Mirrors the label set in PlatformSidebar — kept local since it's only used
// here to resolve a breadcrumb, not for nav rendering.
const PLATFORM_ROUTE_LABELS: Array<{ path: string; label: string; exact?: boolean }> = [
  { path: "/platform", label: "Overview", exact: true },
  { path: "/platform/briefing", label: "Briefing" },
  { path: "/platform/churn-radar", label: "Churn Radar" },
  { path: "/platform/referrals", label: "Referrals" },
  { path: "/platform/customer-success", label: "Cust. Success" },
  { path: "/platform/hospitals", label: "Hospitals" },
  { path: "/platform/plans", label: "Plans" },
  { path: "/platform/discounts", label: "Discounts" },
  { path: "/platform/revenue", label: "Revenue" },
  { path: "/platform/ai-performance", label: "AI Costs" },
  { path: "/platform/incidents", label: "Incidents" },
  { path: "/platform/audit", label: "Audit Log" },
  { path: "/platform/compliance", label: "Compliance" },
  { path: "/platform/automation-rules", label: "Automation" },
  { path: "/platform/feature-flags", label: "Feature Flags" },
  { path: "/platform/api-config", label: "API Hub" },
  { path: "/platform/mobile", label: "Mobile App" },
  { path: "/platform/support", label: "Support" },
  { path: "/platform/settings", label: "Settings" },
];

function resolveLabel(pathname: string): string {
  // Longest-prefix match so nested routes (e.g. /platform/hospitals/:id)
  // resolve to their parent nav label, same semantics as the sidebar's
  // active-state matching.
  const match = PLATFORM_ROUTE_LABELS
    .filter((r) => (r.exact ? pathname === r.path : pathname.startsWith(r.path)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.label ?? "Platform";
}

const PlatformHeader: React.FC = () => {
  const { toggle, setMobileOpen } = useSidebar();
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { admin } = useAumrtiAdmin();
  const [online, setOnline] = useState(navigator.onLine);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("hms_theme") === "dark";
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("hms_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("hms_theme", "light");
    }
  }, [darkMode]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const handleMenuClick = () => {
    if (isMobile) setMobileOpen(true);
    else toggle();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const isOverview = location.pathname === "/platform";
  const currentLabel = resolveLabel(location.pathname);
  const breadcrumbs: HeaderChromeBreadcrumbItem[] = isOverview
    ? [{ label: currentLabel }]
    : [{ label: "Platform", href: "/platform" }, { label: currentLabel }];

  return (
    <HeaderChrome
      logoHref="/platform"
      onMenuClick={handleMenuClick}
      isMobile={isMobile}
      breadcrumbs={breadcrumbs}
      centerSlot={
        <div className="flex items-center gap-2 px-3 shrink-0">
          <Shield size={15} className="text-muted-foreground" />
          <span className="text-[13px] font-semibold text-foreground truncate max-w-[160px]">
            Aumrti Platform
          </span>
        </div>
      }
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((prev) => !prev)}
      online={online}
      avatarInitials={admin?.full_name?.[0]?.toUpperCase() ?? "A"}
      avatarItems={[
        { label: "Platform Settings", onClick: () => navigate("/platform/settings") },
        { label: "Sign Out", onClick: handleSignOut, danger: true },
      ]}
    />
  );
};

export default PlatformHeader;
