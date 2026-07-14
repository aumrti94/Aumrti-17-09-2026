import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Building2, CreditCard, Tag, BarChart3, Settings, LogOut, Shield, Radar, Newspaper, BrainCircuit, Heart, Smartphone, KeyRound, AlertTriangle, ScrollText, ShieldCheck, Workflow, FlaskConical, Headset, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAumrtiAdmin } from "@/hooks/useAumrtiAdmin";
import PlatformGuard from "./PlatformGuard";

const NAV = [
  { to: "/platform",             label: "Overview",   icon: LayoutDashboard, exact: true },
  { to: "/platform/briefing",    label: "Briefing",   icon: Newspaper },
  { to: "/platform/churn-radar", label: "Churn Radar",icon: Radar },
  { to: "/platform/hospitals",   label: "Hospitals",  icon: Building2 },
  { to: "/platform/plans",       label: "Plans",      icon: CreditCard },
  { to: "/platform/discounts",   label: "Discounts",  icon: Tag },
  { to: "/platform/referrals",   label: "Referrals",  icon: Gift },
  { to: "/platform/revenue",        label: "Revenue",    icon: BarChart3 },
  { to: "/platform/ai-performance",   label: "AI Costs",       icon: BrainCircuit },
  { to: "/platform/api-config",       label: "API Hub",        icon: KeyRound },
  { to: "/platform/customer-success", label: "Cust. Success",  icon: Heart },
  { to: "/platform/mobile",           label: "Mobile App",     icon: Smartphone },
  { to: "/platform/incidents",        label: "Incidents",      icon: AlertTriangle },
  { to: "/platform/audit",            label: "Audit Log",      icon: ScrollText },
  { to: "/platform/compliance",       label: "Compliance",     icon: ShieldCheck },
  { to: "/platform/automation-rules", label: "Automation",     icon: Workflow },
  { to: "/platform/feature-flags",    label: "Feature Flags",  icon: FlaskConical },
  { to: "/platform/support",          label: "Support",        icon: Headset },
  { to: "/platform/settings",         label: "Settings",       icon: Settings },
];

export default function PlatformShell() {
  const { admin } = useAumrtiAdmin();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <PlatformGuard>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="w-[200px] flex-shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
          {/* Logo */}
          <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
            <Shield size={18} className="text-white shrink-0" />
            <span className="text-[14px] font-bold text-sidebar-foreground tracking-tight">Aumrti Platform</span>
          </div>

          {/* Nav links */}
          <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
            {NAV.map(({ to, label, icon: Icon, exact }) => (
              <NavLink
                key={to}
                to={to}
                end={exact}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white"
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Admin profile + sign out */}
          <div className="p-3 border-t border-sidebar-border">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground shrink-0">
                {admin?.full_name?.[0]?.toUpperCase() ?? "A"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-sidebar-foreground truncate">{admin?.full_name ?? "Admin"}</p>
                <p className="text-[11px] text-sidebar-foreground/60 truncate">{admin?.email}</p>
              </div>
              <button
                onClick={signOut}
                title="Sign out"
                className="text-sidebar-foreground/60 hover:text-red-400 transition-colors shrink-0"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </PlatformGuard>
  );
}
