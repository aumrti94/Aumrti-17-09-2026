import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, CreditCard, Tag, BarChart3, Settings, Radar, Newspaper,
  BrainCircuit, Heart, Smartphone, KeyRound, AlertTriangle, ScrollText, ShieldCheck,
  Workflow, FlaskConical, Headset, Gift,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAumrtiAdmin } from "@/hooks/useAumrtiAdmin";
import { useSidebar } from "@/hooks/useSidebar";
import SidebarChrome, { type SidebarNavGroup, type SidebarNavItem } from "@/components/layout/SidebarChrome";

interface PlatformNavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  exact?: boolean;
}

// Same 19 destinations as the old flat NAV array, regrouped per the design
// review: Overview (top) · Growth · Commerce · Operations (scrollable middle)
// · Settings (bottom) — mirrors AppSidebar's top/scroll-groups/bottom shape.
const overviewItems: PlatformNavItem[] = [
  { label: "Overview", path: "/platform", icon: LayoutDashboard, exact: true },
];

const growthItems: PlatformNavItem[] = [
  { label: "Briefing",        path: "/platform/briefing",         icon: Newspaper },
  { label: "Churn Radar",     path: "/platform/churn-radar",      icon: Radar },
  { label: "Referrals",       path: "/platform/referrals",        icon: Gift },
  { label: "Cust. Success",   path: "/platform/customer-success", icon: Heart },
];

const commerceItems: PlatformNavItem[] = [
  { label: "Hospitals",  path: "/platform/hospitals",      icon: Building2 },
  { label: "Plans",      path: "/platform/plans",          icon: CreditCard },
  { label: "Discounts",  path: "/platform/discounts",      icon: Tag },
  { label: "Revenue",    path: "/platform/revenue",        icon: BarChart3 },
  { label: "AI Costs",   path: "/platform/ai-performance", icon: BrainCircuit },
];

const operationsItems: PlatformNavItem[] = [
  { label: "Incidents",      path: "/platform/incidents",        icon: AlertTriangle },
  { label: "Audit Log",      path: "/platform/audit",            icon: ScrollText },
  { label: "Compliance",     path: "/platform/compliance",       icon: ShieldCheck },
  { label: "Automation",     path: "/platform/automation-rules", icon: Workflow },
  { label: "Feature Flags",  path: "/platform/feature-flags",    icon: FlaskConical },
  { label: "API Hub",        path: "/platform/api-config",       icon: KeyRound },
  { label: "Mobile App",     path: "/platform/mobile",           icon: Smartphone },
  { label: "Support",        path: "/platform/support",          icon: Headset },
];

const settingsItems: PlatformNavItem[] = [
  { label: "Settings", path: "/platform/settings", icon: Settings },
];

interface PlatformSidebarProps {
  isMobileOverlay?: boolean;
  onClose?: () => void;
}

const PlatformSidebar: React.FC<PlatformSidebarProps> = ({ isMobileOverlay, onClose }) => {
  const { collapsed } = useSidebar();
  const { admin } = useAumrtiAdmin();
  const location = useLocation();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const handleNav = (path: string) => {
    navigate(path);
    if (onClose) onClose();
  };

  // Matches the old NavLink semantics: `exact` items only light up on an
  // exact pathname match; everything else lights up for itself and any
  // nested route below it (e.g. /platform/hospitals/:id keeps "Hospitals" lit).
  const isActive = (item: PlatformNavItem) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const toNavItems = (items: PlatformNavItem[]): SidebarNavItem[] =>
    items.map((item) => ({
      key: item.path,
      label: item.label,
      icon: item.icon,
      active: isActive(item),
      onClick: () => handleNav(item.path),
    }));

  const topGroups: SidebarNavGroup[] = [{ key: "overview", items: toNavItems(overviewItems) }];
  const scrollGroups: SidebarNavGroup[] = [
    { key: "growth", label: "Growth", items: toNavItems(growthItems) },
    { key: "commerce", label: "Commerce", items: toNavItems(commerceItems) },
    { key: "operations", label: "Operations", items: toNavItems(operationsItems) },
  ];
  const bottomGroups: SidebarNavGroup[] = [{ key: "settings", items: toNavItems(settingsItems) }];

  return (
    <SidebarChrome
      topGroups={topGroups}
      scrollGroups={scrollGroups}
      bottomGroups={bottomGroups}
      collapsed={collapsed}
      isMobileOverlay={isMobileOverlay}
      onClose={onClose}
      mobileTitle="Platform"
      user={{
        name: admin?.full_name ?? "Admin",
        initials: admin?.full_name?.[0]?.toUpperCase() ?? "A",
        subtitle: admin?.email,
      }}
      onSignOut={signOut}
    />
  );
};

export default PlatformSidebar;
