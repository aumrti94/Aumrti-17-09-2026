import React, { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import ModuleGate from "./ModuleGate";
import { AIEntitlementSync } from "@/components/access/AIEntitlementSync";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import MobileTabBar from "./MobileTabBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { VoiceScribeProvider } from "@/contexts/VoiceScribeContext";
import VoiceScribePanel from "@/components/voice/VoiceScribePanel";
import CommandPalette from "./CommandPalette";
import IdleTimer from "@/components/auth/IdleTimer";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Download, X } from "lucide-react";
import ReportEventModal from "@/components/safety/ReportEventModal";
import CredentialExpiryBanner from "./CredentialExpiryBanner";
import { CredentialAlertProvider } from "@/contexts/CredentialAlertContext";
import { ProductModeProvider } from "@/contexts/ProductModeContext";
import TrialBanner from "@/components/subscription/TrialBanner";
import ImpersonationBanner from "./ImpersonationBanner";

const PWAInstallBanner: React.FC = () => {
  const { canInstall, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = React.useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-50 px-4 pb-2 pointer-events-none md:bottom-4 md:left-auto md:right-4 md:max-w-sm">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-primary/20 bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">Install Aumrti HMS</p>
          <p className="text-[10px] text-muted-foreground">Add to home screen for quick access</p>
        </div>
        <button
          onClick={promptInstall}
          className="shrink-0 flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground"
        >
          <Download className="h-3 w-3" /> Install
        </button>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const ShellContent: React.FC = () => {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <AppHeader />
      <IdleTimer />
      <AIEntitlementSync />

      {/* Desktop sidebar */}
      {!isMobile && <AppSidebar />}

      {/* Mobile sidebar overlay */}
      {isMobile && mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 z-50 w-64 animate-in slide-in-from-left duration-200">
            <AppSidebar isMobileOverlay onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      <CommandPalette />

      <main
        className={cn(
          "mt-14 overflow-y-auto overflow-x-hidden transition-[margin-left] duration-200",
          isMobile ? "ml-0 h-[calc(100vh-56px-56px)] pb-safe" : "",
          !isMobile && collapsed ? "ml-16 h-[calc(100vh-56px)]" : "",
          !isMobile && !collapsed ? "ml-56 h-[calc(100vh-56px)]" : ""
        )}
      >
        <div
          className="h-full w-full"
        >
          <Suspense fallback={
            <div className="h-full w-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          }>
            <ModuleGate>
              <Outlet />
            </ModuleGate>
          </Suspense>
        </div>
      </main>

      {isMobile && <MobileTabBar />}
      <VoiceScribePanel />
      <ReportEventModal />
      <TrialBanner />
      <ImpersonationBanner />
      <CredentialExpiryBanner />
      <PWAInstallBanner />
    </div>
  );
};

const AppShell: React.FC = () => (
  <VoiceScribeProvider>
    <SidebarProvider>
      <CredentialAlertProvider>
        <ProductModeProvider>
          <ShellContent />
        </ProductModeProvider>
      </CredentialAlertProvider>
    </SidebarProvider>
  </VoiceScribeProvider>
);

export default AppShell;
