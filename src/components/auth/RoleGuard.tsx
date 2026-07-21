import React, { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hasAccess } from "@/lib/routeRoles";
import { useAumrtiAdmin } from "@/hooks/useAumrtiAdmin";

interface RoleGuardProps {
  allowedRoles: string[];
  children: React.ReactNode;
}

const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children }) => {
  const { role, permissions, loading } = useHospitalId();
  const { toast } = useToast();
  const location = useLocation();
  const hasShownToast = useRef(false);

  const isAuthorized = hasAccess(location.pathname, role, permissions);

  // A platform admin has no `users` row, so `role` is null and EVERY app route denies —
  // including /dashboard, which we redirect to below. Without this check they land in a
  // redirect loop behind an "Access denied" toast. Only queried when already denied.
  const { isAdmin: isPlatformAdmin, isLoading: adminLoading } = useAumrtiAdmin({
    enabled: !loading && !isAuthorized && role === null,
  });

  useEffect(() => {
    if (!loading && !isAuthorized && !adminLoading && !isPlatformAdmin && !hasShownToast.current) {
      toast({
        title: "Access denied",
        description: "You don't have permission to view this module.",
        variant: "destructive",
      });
      hasShownToast.current = true;
    }
    
    // Reset the toast flag when the location or authorization status changes
    if (isAuthorized) {
      hasShownToast.current = false;
    }
  }, [loading, isAuthorized, adminLoading, isPlatformAdmin, toast]);

  // Only block rendering on the very first load (no role data yet).
  // If role is already known, a background re-check is in progress — let the
  // existing content stay visible instead of flashing a full-screen spinner.
  if (loading && role === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthorized) {
    return <>{children}</>;
  }

  // Denied — wait for the platform-admin check before choosing where to send them.
  if (adminLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isPlatformAdmin) {
    return <Navigate to="/platform" replace />;
  }

  return <Navigate to="/dashboard" replace />;
};

export default RoleGuard;
