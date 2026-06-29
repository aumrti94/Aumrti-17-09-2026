import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Stethoscope, UserPlus, Receipt, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";

const tabs = [
  { label: "Dashboard", icon: Home, path: "/dashboard" },
  { label: "OPD", icon: Stethoscope, path: "/opd" },
  { label: "Patients", icon: UserPlus, path: "/patients" },
  { label: "Billing", icon: Receipt, path: "/billing" },
  { label: "More", icon: MoreHorizontal, path: "/modules" },
];

const MobileTabBar: React.FC = () => {
  const location = useLocation();
  const { role, permissions } = useHospitalId();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 h-14 bg-card border-t border-border flex items-center justify-around md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {tabs.filter(tab => hasAccess(tab.path, role, permissions)).map((tab) => {
        const Icon = tab.icon;
        const active = location.pathname === tab.path || location.pathname.startsWith(tab.path + "/");
        return (
          <Link
            key={tab.label}
            to={tab.path}
            className={cn(
              "flex flex-col items-center justify-center min-w-[44px] min-h-[44px] py-1 px-2 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon size={22} />
            <span className="mt-0.5">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;
