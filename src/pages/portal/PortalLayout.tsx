import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Home, Calendar, FlaskConical, Receipt, Video, User, LogOut } from "lucide-react";

interface PortalLayoutProps {
  children: React.ReactNode;
  hospitalName: string;
  hospitalLogo: string | null;
  patientName: string;
  onLogout: () => void;
}

const tabs = [
  { path: "/portal/dashboard",    icon: Home,         label: "Home"    },
  { path: "/portal/appointments", icon: Calendar,     label: "Appts"   },
  { path: "/portal/reports",      icon: FlaskConical, label: "Reports" },
  { path: "/portal/teleconsult",  icon: Video,        label: "Video"   },
  { path: "/portal/bills",        icon: Receipt,      label: "Bills"   },
  { path: "/portal/profile",      icon: User,         label: "Profile" },
];

const PortalLayout: React.FC<PortalLayoutProps> = ({
  children, hospitalName, hospitalLogo, patientName, onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);

  const initials = patientName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-[480px] mx-auto min-h-screen flex flex-col" style={{ background: "#F8FAFC" }}>
      {/* Header — 56px */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4"
        style={{
          height: 56,
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E8F0",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <div className="flex items-center gap-2">
          {hospitalLogo ? (
            <img src={hospitalLogo} alt="" className="h-7 w-7 rounded object-contain" />
          ) : (
            <div className="h-7 w-7 rounded flex items-center justify-center" style={{ background: "#0E7B7B" }}>
              <span className="text-white text-xs font-bold">H</span>
            </div>
          )}
          <span className="text-sm font-bold" style={{ color: "#0F172A" }}>
            {hospitalName}
          </span>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center justify-center rounded-full text-white text-xs font-bold"
            style={{ width: 32, height: 32, background: "#0E7B7B" }}
          >
            {initials}
          </button>
          {showMenu && (
            <div
              className="absolute right-0 top-10 bg-white rounded-lg shadow-lg border py-1 z-50"
              style={{ borderColor: "#E2E8F0", minWidth: 140 }}
            >
              <button
                onClick={() => { setShowMenu(false); onLogout(); }}
                className="flex items-center gap-2 px-4 py-2.5 text-sm w-full hover:bg-gray-50"
                style={{ color: "#EF4444" }}
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content area */}
      <main className="flex-1" style={{ paddingTop: 56, paddingBottom: 56 }}>
        {children}
      </main>

      {/* Bottom nav — 56px */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center"
        style={{
          height: 56,
          background: "#FFFFFF",
          borderTop: "1px solid #E2E8F0",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          const color = active ? "#0E7B7B" : "#94A3B8";
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
            >
              <tab.icon size={22} color={color} />
              <span className="font-medium" style={{ fontSize: 10, color }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default PortalLayout;
