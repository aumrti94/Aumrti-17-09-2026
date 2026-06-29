import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home, Calendar, Receipt, FileText, Video, User, LogOut,
  MessageSquare, Heart, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface PatientPortalLayoutProps {
  children: React.ReactNode;
  hospitalName: string;
  hospitalLogo: string | null;
  patientName: string;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { path: "/portal/dashboard",    icon: Home,     label: "Dashboard"    },
  { path: "/portal/appointments", icon: Calendar, label: "Appointments" },
  { path: "/portal/bills",        icon: Receipt,  label: "Bills"        },
  { path: "/portal/reports",      icon: FileText, label: "Reports"      },
  { path: "/portal/teleconsult",  icon: Video,    label: "Teleconsult"  },
  { path: "/portal/profile",      icon: User,     label: "Profile"      },
] as const;

// AI Health Tools — desktop sidebar only (not in mobile bottom tab bar)
const AI_NAV_ITEMS = [
  { path: "/portal/chat",          icon: MessageSquare, label: "AI Assistant"  },
  { path: "/portal/health-coach",  icon: Heart,         label: "Health Coach"  },
  { path: "/portal/health-story",  icon: BookOpen,      label: "Health Story"  },
] as const;

const TEAL = "#0E7B7B";
const TEAL_LIGHT = "#E6F4F4";

function Initials({ name }: { name: string }) {
  const text = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      className="flex items-center justify-center rounded-full text-white text-xs font-bold shrink-0"
      style={{ width: 32, height: 32, background: TEAL }}
    >
      {text}
    </span>
  );
}

const PatientPortalLayout: React.FC<PatientPortalLayoutProps> = ({
  children,
  hospitalName,
  hospitalLogo,
  patientName,
  onLogout,
}) => {
  const navigate    = useNavigate();
  const location    = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#F8FAFC" }}>

      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col w-56 shrink-0 h-full overflow-y-auto bg-white"
        style={{ borderRight: "1px solid #E2E8F0" }}
      >
        {/* Hospital brand */}
        <div
          className="flex items-center gap-2.5 px-4 py-4 shrink-0"
          style={{ borderBottom: "1px solid #F1F5F9" }}
        >
          {hospitalLogo ? (
            <img src={hospitalLogo} alt="" className="h-8 w-8 rounded-lg object-contain shrink-0" />
          ) : (
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: TEAL }}
            >
              <span className="text-white text-xs font-bold">H</span>
            </div>
          )}
          <span className="text-sm font-bold text-slate-900 leading-tight line-clamp-2">
            {hospitalName}
          </span>
        </div>

        {/* Patient identity */}
        <div
          className="flex items-center gap-2.5 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid #F1F5F9" }}
        >
          <Initials name={patientName} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "#94A3B8" }}>Patient</p>
            <p className="text-sm font-semibold text-slate-800 truncate">{patientName}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-all duration-150",
                  active
                    ? "text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
                style={active ? { background: TEAL } : undefined}
              >
                <item.icon
                  size={17}
                  className={cn(!active && "text-slate-400")}
                  style={active ? { color: "#fff" } : undefined}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* AI Health Tools — desktop only */}
        <div className="px-2 pt-2 pb-1 shrink-0" style={{ borderTop: "1px solid #F1F5F9" }}>
          <p className="px-3 py-1 text-[9px] uppercase tracking-widest font-semibold" style={{ color: "#94A3B8" }}>
            AI Health Tools
          </p>
          {AI_NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-all duration-150",
                  active
                    ? "text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
                style={active ? { background: TEAL } : undefined}
              >
                <item.icon
                  size={17}
                  className={cn(!active && "text-slate-400")}
                  style={active ? { color: "#fff" } : undefined}
                />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Logout */}
        <div className="px-2 pb-4 shrink-0" style={{ borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
          >
            <LogOut size={17} />
            Logout
          </button>
        </div>
      </aside>

      {/* ── Content column ───────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top header */}
        <header
          className="md:hidden flex items-center justify-between px-4 shrink-0 bg-white"
          style={{ height: 56, borderBottom: "1px solid #E2E8F0", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        >
          <div className="flex items-center gap-2">
            {hospitalLogo ? (
              <img src={hospitalLogo} alt="" className="h-7 w-7 rounded-lg object-contain" />
            ) : (
              <div
                className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: TEAL }}
              >
                <span className="text-white text-xs font-bold">H</span>
              </div>
            )}
            <span className="text-sm font-bold text-slate-900 truncate max-w-[180px]">{hospitalName}</span>
          </div>

          <div className="relative">
            <button onClick={() => setMenuOpen((o) => !o)}>
              <Initials name={patientName} />
            </button>

            {menuOpen && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-10 bg-white rounded-xl shadow-xl z-50 overflow-hidden"
                  style={{ border: "1px solid #E2E8F0", minWidth: 168 }}
                >
                  <div className="px-4 py-3" style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <p className="text-xs font-semibold text-slate-800 truncate">{patientName}</p>
                  </div>
                  <div className="px-4 py-1.5" style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <p className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: "#94A3B8" }}>AI Health Tools</p>
                  </div>
                  {AI_NAV_ITEMS.map((item) => (
                    <button
                      key={item.path}
                      onClick={() => { setMenuOpen(false); navigate(item.path); }}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm w-full hover:bg-slate-50 text-slate-700"
                    >
                      <item.icon size={14} style={{ color: TEAL }} />
                      {item.label}
                    </button>
                  ))}
                  <button
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    className="flex items-center gap-2 px-4 py-3 text-sm w-full hover:bg-slate-50 text-red-500 font-medium"
                    style={{ borderTop: "1px solid #F1F5F9" }}
                  >
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 64px)" }}>
          <div className="md:pb-0">{children}</div>
        </main>

        {/* ── Mobile bottom tab bar ───────────────────────────────── */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 flex bg-white"
          style={{
            height: "calc(64px + env(safe-area-inset-bottom))",
            paddingBottom: "env(safe-area-inset-bottom)",
            borderTop: "1px solid #E2E8F0",
            boxShadow: "0 -1px 8px rgba(0,0,0,0.06)",
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            const color  = active ? TEAL : "#94A3B8";
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
              >
                {/* Active indicator pill at top */}
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-9 h-[3px] rounded-full"
                    style={{ background: TEAL }}
                  />
                )}

                {/* Icon with teal bg circle when active */}
                <span
                  className={cn(
                    "flex items-center justify-center rounded-xl transition-all",
                    active ? "w-10 h-6" : "w-6 h-6"
                  )}
                  style={active ? { background: TEAL_LIGHT } : undefined}
                >
                  <item.icon size={active ? 17 : 20} color={color} />
                </span>

                <span
                  className="font-medium leading-none"
                  style={{ fontSize: 10, color }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default PatientPortalLayout;
