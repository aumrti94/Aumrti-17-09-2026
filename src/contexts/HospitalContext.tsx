import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface HospitalContextValue {
  hospitalId: string | null;
  userId: string | null;
  role: string | null;
  permissions: Record<string, any> | null;
  fullName: string | null;
  loading: boolean;
}

const HospitalContext = createContext<HospitalContextValue>({
  hospitalId: null,
  userId: null,
  role: null,
  permissions: null,
  fullName: null,
  loading: true,
});

const CACHE_KEY_PREFIX = "hms_ctx_";

function readCache(userId: string): HospitalContextValue | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.hospitalId) return parsed as HospitalContextValue;
  } catch {
    // ignore parse errors
  }
  return null;
}

function writeCache(userId: string, value: HospitalContextValue) {
  try {
    sessionStorage.setItem(CACHE_KEY_PREFIX + userId, JSON.stringify(value));
  } catch {
    // ignore storage errors (private/incognito may block)
  }
}

function clearCache() {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(CACHE_KEY_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export const HospitalProvider = ({ children }: { children: React.ReactNode }) => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, any> | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Tracks whether we have successfully resolved data at least once in this session.
  // Prevents auth events (SIGNED_IN, INITIAL_SESSION) from re-triggering a loading
  // cycle when the tab regains focus.
  const resolvedRef = useRef(false);

  useEffect(() => {
    const resolve = async () => {
      try {
        setLoading(true);
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError) {
          console.error("Auth error:", authError.message);
          setLoading(false);
          return;
        }

        if (!user) {
          setHospitalId(null);
          setRole(null);
          setPermissions(null);
          setFullName(null);
          setLoading(false);
          return;
        }

        // Check sessionStorage cache first — populates instantly, avoids spinner on tab switch
        const cached = readCache(user.id);
        if (cached) {
          setHospitalId(cached.hospitalId);
          setUserId(cached.userId ?? null);
          setRole(cached.role);
          setPermissions(cached.permissions);
          setFullName(cached.fullName);
          resolvedRef.current = true;
          setLoading(false);
          // Background re-validate silently (no loading state change)
          refreshInBackground(user.id);
          return;
        }

        await fetchAndApply(user.id);
      } catch (error) {
        console.error("Unexpected error in HospitalContext:", error);
        setLoading(false);
      }
    };

    const fetchAndApply = async (authUserId: string) => {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, hospital_id, role, full_name, is_active")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (userError) {
        console.error("Fetch user data error:", userError.message);
        setLoading(false);
        return;
      }

      if (!userData) {
        setLoading(false);
        return;
      }

      // Deactivated staff must not be allowed to use the app
      if ((userData as any).is_active === false) {
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      const wasFirstResolution = !resolvedRef.current;

      setHospitalId(userData.hospital_id);
      setUserId((userData as any).id ?? null);
      setRole(userData.role);
      setFullName((userData as any).full_name ?? null);

      const { data: permsData, error: permsError } = await supabase
        .from("role_permissions")
        .select("permissions")
        .eq("hospital_id", userData.hospital_id)
        .eq("role_name", userData.role)
        .maybeSingle();

      if (permsError) {
        console.error("Fetch permissions error:", permsError.message);
      }

      const perms = (permsData?.permissions as Record<string, any>) || null;
      setPermissions(perms);
      resolvedRef.current = true;
      setLoading(false);

      writeCache(authUserId, {
        hospitalId: userData.hospital_id,
        userId: (userData as any).id ?? null,
        role: userData.role,
        permissions: perms,
        fullName: (userData as any).full_name ?? null,
        loading: false,
      });

      // Log LOGIN event on first resolution (fresh login, not background re-validate)
      if (wasFirstResolution && userData.hospital_id && (userData as any).id) {
        supabase.from("audit_log").insert({
          hospital_id: userData.hospital_id,
          changed_by: (userData as any).id,
          user_id: (userData as any).id,
          user_role: userData.role,
          action: "LOGIN",
          table_name: "session",
          entity_type: "session",
          details: {
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
            timestamp: new Date().toISOString(),
          },
        }).then(() => {}).catch(() => {});
      }
    };

    // Silently re-fetches from Supabase without touching loading state.
    const refreshInBackground = async (authUserId: string) => {
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("id, hospital_id, role, full_name, is_active")
          .eq("auth_user_id", authUserId)
          .maybeSingle();

        if (!userData) return;

        if ((userData as any).is_active === false) {
          await supabase.auth.signOut();
          return;
        }

        const { data: permsData } = await supabase
          .from("role_permissions")
          .select("permissions")
          .eq("hospital_id", userData.hospital_id)
          .eq("role_name", userData.role)
          .maybeSingle();

        const perms = (permsData?.permissions as Record<string, any>) || null;

        setHospitalId(userData.hospital_id);
        setUserId((userData as any).id ?? null);
        setRole(userData.role);
        setFullName((userData as any).full_name ?? null);
        setPermissions(perms);

        writeCache(authUserId, {
          hospitalId: userData.hospital_id,
          userId: (userData as any).id ?? null,
          role: userData.role,
          permissions: perms,
          fullName: (userData as any).full_name ?? null,
          loading: false,
        });
      } catch (err) {
        console.error("Background refresh error:", err);
      }
    };

    resolve();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED and INITIAL_SESSION don't change the user's hospital/role data.
      // Skipping prevents an unnecessary loading cycle that makes the app appear to hard-refresh.
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;

      if (!session) {
        resolvedRef.current = false;
        clearCache();
        setHospitalId(null);
        setUserId(null);
        setRole(null);
        setPermissions(null);
        setFullName(null);
        setLoading(false);
      } else if (!resolvedRef.current) {
        // Only re-resolve if we haven't loaded data yet (e.g. SIGNED_IN on fresh login).
        resolve();
      }
      // If resolvedRef.current is true and the user is still signed in, no action needed —
      // data is already loaded and correct.
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = React.useMemo(
    () => ({ hospitalId, userId, role, permissions, fullName, loading }),
    [hospitalId, userId, role, permissions, fullName, loading]
  );

  return (
    <HospitalContext.Provider value={value}>
      {children}
    </HospitalContext.Provider>
  );
};

export const useHospitalContext = (): HospitalContextValue => {
  return useContext(HospitalContext);
};
