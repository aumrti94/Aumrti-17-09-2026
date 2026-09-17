import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home, LayoutGrid, UserPlus, Stethoscope, BedDouble,
  FlaskConical, Pill, Receipt, BarChart3, Inbox, Settings,
  LogOut, HeartPulse, Activity, FolderOpen, X, CalendarDays, Building2, ShieldCheck, Wrench, Users, UserCircle,
} from "lucide-react";
import { useCredentialAlert } from "@/hooks/useCredentialAlert";
import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";
import { useSidebar } from "@/hooks/useSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";
import { hasActionAccess } from "@/lib/tabPermissions";
import SidebarChrome, { type SidebarNavGroup, type SidebarNavItem } from "./SidebarChrome";

interface SidebarItem {
  label: string;
  path: string;
  icon: React.ElementType;
  moduleKey?: string; // optional: if set, hidden when module is disabled
  // optional: if set, this Quick Access shortcut is gated by the `dashboard` module
  // action of the same key, so admins can hide it per role/user (SettingsRolesPage /
  // StaffAccessPanel) without removing the underlying module.
  actionKey?: string;
}

const topItems: SidebarItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: Home },
  { label: "All Modules", path: "/modules", icon: LayoutGrid },
  { label: "Patients", path: "/patients", icon: UserPlus, moduleKey: "patients" },
];

const quickAccessItems: SidebarItem[] = [
  { label: "Scheduling",       path: "/schedule",    icon: CalendarDays, moduleKey: "opd",       actionKey: "quick_scheduling" },
  { label: "OPD Queue",        path: "/opd",         icon: Stethoscope,  moduleKey: "opd",       actionKey: "quick_opd" },
  { label: "IPD / Wards",      path: "/ipd",         icon: BedDouble,    moduleKey: "ipd",       actionKey: "quick_ipd" },
  { label: "Billing",          path: "/billing",     icon: Receipt,      moduleKey: "billing",   actionKey: "quick_billing" },
  { label: "HR & Staff",       path: "/hr",          icon: Users,        moduleKey: "hr",        actionKey: "quick_hr" },
  { label: "CEO Board",        path: "/ceo-board",   icon: Building2,    moduleKey: "analytics", actionKey: "quick_ceo_board" },
  { label: "Govt Schemes",     path: "/pmjay",       icon: HeartPulse,   moduleKey: "insurance", actionKey: "quick_govt_schemes" },
  { label: "Lab",              path: "/lab",         icon: FlaskConical, moduleKey: "lab",       actionKey: "quick_lab" },
  { label: "Analytics",        path: "/analytics",   icon: BarChart3,    moduleKey: "analytics", actionKey: "quick_analytics" },
];

const recordsItems: SidebarItem[] = [
  { label: "Medical Records", path: "/mrd",          icon: FolderOpen,  moduleKey: "mrd" },
  { label: "IPC Dashboard",   path: "/ipc/dashboard",icon: ShieldCheck, moduleKey: "ipc" },
  { label: "FMS / Safety",    path: "/fms/dashboard",icon: Wrench,      moduleKey: "fms" },
  { label: "ABDM / ABHA",     path: "/abdm",         icon: ShieldCheck },
];

const bottomItems: SidebarItem[] = [
  { label: "My HR", path: "/my-hr", icon: UserCircle },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Settings", path: "/settings", icon: Settings },
];

interface AppSidebarProps {
  isMobileOverlay?: boolean;
  onClose?: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ isMobileOverlay, onClose }) => {
  const { collapsed } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hospitalId, role, permissions, loading } = useHospitalId();
  const { expiringCount } = useCredentialAlert();
  const [userName, setUserName] = useState("User");
  const [userInitials, setUserInitials] = useState("U");
  const [pendingConsentCount, setPendingConsentCount] = useState(0);

  // Entitlement comes from the Platform console only (plan + feature overrides),
  // the same decision <ModuleGate> enforces on the route itself.
  const { enabledModules, isLoading: subLoading } = useSubscriptionConfig();

  const filterItems = (items: SidebarItem[]) =>
    items.filter((item) =>
      hasAccess(item.path, role, permissions) &&
      (!item.moduleKey || subLoading || isModuleKeyAllowed(item.moduleKey, enabledModules)) &&
      (!item.actionKey || hasActionAccess("dashboard", item.actionKey, permissions, role))
    );

  useEffect(() => {
    if (hospitalId) {
      supabase
        .from("abdm_consents")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "REQUESTED")
        .then(({ count }) => setPendingConsentCount(count ?? 0));
    }
  }, [hospitalId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("full_name, role").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => {
          if (data) {
            setUserName(data.full_name || "User");
            const parts = (data.full_name || "U").split(" ");
            setUserInitials(parts.map((p: string) => p[0]).join("").toUpperCase().slice(0, 2));
          }
        });
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({ title: "Signed out successfully" });
    navigate("/login", { replace: true });
  };

  const handleNav = (path: string) => {
    navigate(path);
    if (onClose) onClose();
  };

  const toNavItems = (items: SidebarItem[]): SidebarNavItem[] =>
    filterItems(items).map((item) => ({
      key: item.path,
      label: item.label,
      icon: item.icon,
      active: location.pathname === item.path,
      onClick: () => handleNav(item.path),
      badge: item.path === "/hr" ? expiringCount : item.path === "/abdm" ? pendingConsentCount : 0,
      emphasize: item.path === "/modules",
    }));

  const topGroups: SidebarNavGroup[] = [{ key: "top", items: toNavItems(topItems) }];
  const scrollGroups: SidebarNavGroup[] = [
    { key: "quick-access", label: "Quick Access", items: toNavItems(quickAccessItems) },
    { key: "records", label: "Records", items: toNavItems(recordsItems) },
  ];
  const bottomGroups: SidebarNavGroup[] = [{ key: "bottom", items: toNavItems(bottomItems) }];

  return (
    <SidebarChrome
      topGroups={topGroups}
      scrollGroups={scrollGroups}
      bottomGroups={bottomGroups}
      collapsed={collapsed}
      isMobileOverlay={isMobileOverlay}
      onClose={onClose}
      user={{
        name: userName,
        initials: userInitials,
        subtitle: (role || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      }}
      onSignOut={handleSignOut}
    />
  );
};

export default AppSidebar;
