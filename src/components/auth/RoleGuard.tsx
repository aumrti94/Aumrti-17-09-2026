import React, { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hasAccess } from "@/lib/routeRoles";

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

  useEffect(() => {
    if (!loading && !isAuthorized && !hasShownToast.current) {
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
  }, [loading, isAuthorized, toast]);

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

  return <Navigate to="/dashboard" replace />;
};

export default RoleGuard;
