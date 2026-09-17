import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Wifi, WifiOff, RefreshCw, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/hooks/useSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import NotificationCentre from "./NotificationCentre";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";
import { hasActionAccess } from "@/lib/tabPermissions";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { AlertTriangle } from "lucide-react";
import QuickEventModal from "@/components/safety/QuickEventModal";
import HeaderChrome, { type HeaderChromeBreadcrumbItem } from "./HeaderChrome";

const routeLabels: Record<string, string> = {
  "/": "Dashboard",
  "/opd": "OPD",
  "/ipd": "IPD",
  "/emergency": "Emergency",
  "/ot": "OT",
  "/nursing": "Nursing",
  "/lab": "Lab",
  "/radiology": "Radiology",
  "/pharmacy": "Pharmacy",
  "/billing": "Billing",
  "/insurance": "Insurance",
  "/payments": "Payments",
  "/hr": "HR",
  "/inventory": "Inventory",
  "/quality": "Quality",
  "/settings": "Settings",
};

const AppHeader: React.FC = () => {
  const { toggle, setMobileOpen } = useSidebar();
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const { pendingCount, syncing, triggerSync } = useOfflineSync();
  const { hospitalId: contextHospitalId, role, permissions, fullName } = useHospitalId();
  const showSettings = hasAccess("/settings", role, permissions);
  // Top-bar buttons are gated by `dashboard` module actions so admins can hide them per
  // role/user (SettingsRolesPage / StaffAccessPanel). Default = allow (backward compatible).
  const headerAction = (key: string) => hasActionAccess("dashboard", key, permissions, role);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState<string>("");
  const [hospitalLogo, setHospitalLogo] = useState<string | null>(null);
  const userInitials = fullName
    ? fullName.split(" ").map((p: string) => p[0]).join("").toUpperCase().slice(0, 2)
    : "U";
  const [incidentOpen, setIncidentOpen] = useState(false);
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
    if (contextHospitalId) {
      setHospitalId(contextHospitalId);
      supabase
        .from("hospitals")
        .select("name, logo_url, primary_color")
        .eq("id", contextHospitalId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setHospitalName(data.name ?? "");
            setHospitalLogo((data as any).logo_url ?? null);
            // Apply hospital primary color as CSS variable so the whole app reflects it
            const color = (data as any).primary_color;
            if (color) {
              document.documentElement.style.setProperty("--brand-primary", color);
              // Convert hex to hsl for Tailwind's hsl-based --primary variable
              // Simple approach: set the raw hex on a custom property used by key UI elements
              document.documentElement.style.setProperty("--primary-hex", color);
            }
          }
        });
    }
  }, [contextHospitalId]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({ title: "Signed out successfully" });
    navigate("/login", { replace: true });
  };

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
    if (isMobile) {
      setMobileOpen(true);
    } else {
      toggle();
    }
  };

  const currentLabel = routeLabels[location.pathname] || "Page";
  const isHome = location.pathname === "/";

  const breadcrumbs: HeaderChromeBreadcrumbItem[] = isHome
    ? [{ label: currentLabel }]
    : [{ label: "Dashboard", href: "/dashboard" }, { label: currentLabel }];

  // Order preserved exactly as before the HeaderChrome rewire: incident report,
  // dark-mode toggle, sync status, report event, notifications, then avatar
  // (avatar itself is rendered by HeaderChrome). All of these are hospital/role
  // gated via `headerAction`, which is why they live in the tenant-owned
  // `extraActions` slot rather than HeaderChrome's generic online/darkMode props.
  const extraActions = (
    <>
      {headerAction("header_report_incident") && (
        <>
          <button
            onClick={() => setIncidentOpen(true)}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-red-50 text-red-500 hover:text-red-600 transition-colors"
            aria-label="Report Incident / Complaint"
            title="Report Incident / Complaint"
          >
            <AlertTriangle size={18} />
          </button>
          <QuickEventModal open={incidentOpen} onOpenChange={setIncidentOpen} />
        </>
      )}

      {headerAction("header_theme") && (
        <button
          onClick={() => setDarkMode((prev) => !prev)}
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          aria-label="Toggle dark mode"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      )}

      {!isMobile && headerAction("header_sync_status") && (
        <button
          onClick={() => { if (online && pendingCount > 0) triggerSync(); }}
          title={pendingCount > 0 ? `${pendingCount} item(s) queued — click to sync` : online ? "Online" : "Offline"}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
            !online
              ? "bg-destructive/10 text-destructive"
              : syncing
              ? "bg-blue-500/10 text-blue-600"
              : pendingCount > 0
              ? "bg-amber-500/10 text-amber-600 cursor-pointer hover:bg-amber-500/20"
              : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
          )}
        >
          {!online
            ? <WifiOff size={12} />
            : syncing
            ? <RefreshCw size={12} className="animate-spin" />
            : <Wifi size={12} />
          }
          {!online ? "Offline" : syncing ? "Syncing…" : pendingCount > 0 ? `${pendingCount} queued` : "Online"}
        </button>
      )}

      {/* Global Report Event trigger */}
      {headerAction("header_report_event") && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-report-event"))}
          title="Report a safety event or complaint"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium transition-colors border border-amber-500/20"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {!isMobile && "Report Event"}
        </button>
      )}

      {headerAction("header_notifications") && <NotificationCentre hospitalId={hospitalId} />}
    </>
  );

  return (
    <HeaderChrome
      logoHref="/dashboard"
      onMenuClick={handleMenuClick}
      isMobile={isMobile}
      breadcrumbs={breadcrumbs}
      centerSlot={
        hospitalName ? (
          <div className="flex items-center gap-2 px-3 shrink-0">
            {hospitalLogo ? (
              <img src={hospitalLogo} alt={hospitalName} className="h-7 w-auto object-contain max-w-[120px]" />
            ) : (
              <span className="text-[13px] font-semibold text-foreground truncate max-w-[160px]" title={hospitalName}>
                {hospitalName}
              </span>
            )}
          </div>
        ) : null
      }
      onSearchClick={() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      }}
      searchPlaceholder="Search modules..."
      extraActions={extraActions}
      avatarInitials={userInitials}
      avatarItems={[
        { label: "Profile", onClick: () => navigate("/settings/profile") },
        ...(hasAccess("/settings", role, permissions)
          ? [{ label: "Hospital Settings", onClick: () => navigate("/settings") }]
          : []),
        { label: "Sign Out", onClick: handleSignOut, danger: true },
      ]}
    />
  );
};

export default AppHeader;
