import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const ROLE_ROUTES: Record<string, string> = {
  super_admin: "/dashboard",
  hospital_admin: "/dashboard",
  doctor: "/opd",
  nurse: "/nursing",
  accountant: "/billing",
  billing_executive: "/billing",
  billing_staff: "/billing",
  cfo: "/accounts",
  pharmacist: "/pharmacy",
  lab_tech: "/lab",
  lab_technician: "/lab",
  radiologist: "/radiology",
  hr_manager: "/hr",
  receptionist: "/opd",
};

const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    let handled = false;
    // Set just before we intentionally sign out a rejected user, so the SIGNED_OUT
    // handler below doesn't bounce them to /login before the rejection screen renders.
    let rejecting = false;

    // Resolve where this freshly-authenticated user should land. The resolve_oauth_login
    // RPC (SECURITY DEFINER) decides: platform admin, hospital staff, or rejected — and
    // links the staff row to this auth user by verified email on first social sign-in.
    const resolveAndRoute = async () => {
      if (handled) return;
      handled = true;

      const { data, error: rpcErr } = await (supabase as any).rpc("resolve_oauth_login");
      if (rpcErr) {
        setError(rpcErr.message || "Could not complete sign-in.");
        return;
      }

      const target = data?.target as string | undefined;
      if (target === "platform") {
        navigate("/platform", { replace: true });
      } else if (target === "app") {
        const route = data?.role ? (ROLE_ROUTES[data.role] ?? "/dashboard") : "/dashboard";
        navigate(route, { replace: true });
      } else {
        // No Aumrti account is linked to this email (or it's inactive) — sign out and explain.
        rejecting = true;
        await supabase.auth.signOut();
        setRejected(true);
      }
    };

    // Supabase handles the URL hash/code exchange automatically via onAuthStateChange.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        resolveAndRoute();
      } else if (event === "SIGNED_OUT" && !rejecting) {
        navigate("/login", { replace: true });
      }
    });

    // Fallback: if already signed in (race with onAuthStateChange), resolve immediately.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) resolveAndRoute();
    });

    // Surface an error returned in the URL hash (e.g. access_denied from the provider).
    const hash = window.location.hash;
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.replace("#", "?"));
      const msg = params.get("error_description") ?? params.get("error") ?? "OAuth sign-in failed";
      setError(decodeURIComponent(msg.replace(/\+/g, " ")));
    }

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (rejected) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4 text-center px-6 max-w-md mx-auto">
        <p className="text-foreground font-semibold">No Aumrti account linked to this email</p>
        <p className="text-sm text-muted-foreground">
          This email isn't registered with any hospital on Aumrti. Ask your hospital admin to add
          you as a user, or register your hospital to get started.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/register")}
            className="text-sm font-medium text-primary hover:underline"
          >
            Register your hospital →
          </button>
          <button
            onClick={() => navigate("/login")}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4 text-center px-6">
        <p className="text-destructive font-medium">{error}</p>
        <button
          onClick={() => navigate("/login")}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center flex-col gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Signing you in…</span>
    </div>
  );
};

export default AuthCallbackPage;
