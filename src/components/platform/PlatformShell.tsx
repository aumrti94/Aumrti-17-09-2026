import { Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { useSidebar } from "@/hooks/useSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import PlatformGuard from "./PlatformGuard";
import PlatformSidebar from "./PlatformSidebar";
import PlatformHeader from "./PlatformHeader";

const PlatformShellContent = () => {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <PlatformHeader />

      {/* Desktop sidebar */}
      {!isMobile && <PlatformSidebar />}

      {/* Mobile sidebar overlay */}
      {isMobile && mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 z-50 w-64 animate-in slide-in-from-left duration-200">
            <PlatformSidebar isMobileOverlay onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      <main
        className={cn(
          "mt-14 overflow-y-auto overflow-x-hidden transition-[margin-left] duration-200",
          isMobile ? "ml-0 h-[calc(100vh-56px)]" : "",
          !isMobile && collapsed ? "ml-16 h-[calc(100vh-56px)]" : "",
          !isMobile && !collapsed ? "ml-56 h-[calc(100vh-56px)]" : ""
        )}
      >
        <Outlet />
      </main>
    </div>
  );
};

export default function PlatformShell() {
  return (
    <PlatformGuard>
      <SidebarProvider>
        <PlatformShellContent />
      </SidebarProvider>
    </PlatformGuard>
  );
}
