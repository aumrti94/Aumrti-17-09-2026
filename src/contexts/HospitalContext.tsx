import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ENTITLEMENT_KEY } from "@/lib/tabPermissions";
import { resolveEntitlement, type EntitlementMap } from "@/lib/entitlementResolve";

/**
 * Fetch the plan default + per-hospital override rows and resolve them into the
 * effective entitlement (see resolveEntitlement). Plan defaults are the base;
 * per-hospital overrides win per key and can re-enable a plan-withheld tab.
 */
async function fetchEntitlement(hospitalId: string): Promise<EntitlementMap | null> {
  const [hospRes, subRes] = await Promise.all([
    (supabase as any)
      .from("hospital_module_entitlements")
      .select("module_key, tabs, actions")
      .eq("hospital_id", hospitalId),
    (supabase as any)
      .from("hospital_subscriptions")
      .select("plan_id")
      .eq("hospital_id", hospitalId)
      .maybeSingle(),
  ]);

  const hospRows: any[] = hospRes.data || [];
  const planId: string | undefined = subRes.data?.plan_id;

  let planRows: any[] = [];
  if (planId) {
    const planRes = await (supabase as any)
      .from("plan_features")
      .select("module_key, tabs, actions")
      .eq("plan_id", planId);
    planRows = planRes.data || [];
  }

  return resolveEntitlement(planRows, hospRows);
}

/**
 * Fold the hospital entitlement into the role-permission blob under the reserved
 * __entitlement key (see tabPermissions.ts). Strips any prior entitlement first so
 * re-applies are idempotent. Returns null when nothing is left (no role perms, no
 * entitlement) to preserve the "null = fully permissive" convention.
 */
function applyEntitlement(
  base: Record<string, any> | null,
  entitlement: EntitlementMap | null,
): Record<string, any> | null {
  const rest = { ...(base || {}) };
  delete rest[ENTITLEMENT_KEY];
  if (entitlement) rest[ENTITLEMENT_KEY] = entitlement;
  return Object.keys(rest).length ? rest : null;
}

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
  // Remembered so the realtime entitlement listener can rewrite the session cache.
  const authUserIdRef = useRef<string | null>(null);

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
      authUserIdRef.current = authUserId;

      setHospitalId(userData.hospital_id);
      setUserId((userData as any).id ?? null);
      setRole(userData.role);
      setFullName((userData as any).full_name ?? null);

      const [{ data: permsData, error: permsError }, entitlement] = await Promise.all([
        supabase
          .from("role_permissions")
          .select("permissions")
          .eq("hospital_id", userData.hospital_id)
          .eq("role_name", userData.role)
          .maybeSingle(),
        fetchEntitlement(userData.hospital_id),
      ]);

      if (permsError) {
        console.error("Fetch permissions error:", permsError.message);
      }

      const rolePerms = (permsData?.permissions as Record<string, any>) || null;
      const perms = applyEntitlement(rolePerms, entitlement);
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

        authUserIdRef.current = authUserId;

        const [{ data: permsData }, entitlement] = await Promise.all([
          supabase
            .from("role_permissions")
            .select("permissions")
            .eq("hospital_id", userData.hospital_id)
            .eq("role_name", userData.role)
            .maybeSingle(),
          fetchEntitlement(userData.hospital_id),
        ]);

        const rolePerms = (permsData?.permissions as Record<string, any>) || null;
        const perms = applyEntitlement(rolePerms, entitlement);

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

  // Live-apply platform entitlement changes without a reload. Mirrors the
  // useSubscriptionConfig realtime channel that already handles module on/off.
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`module-entitlements-${hospitalId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hospital_module_entitlements", filter: `hospital_id=eq.${hospitalId}` },
        async () => {
          const entitlement = await fetchEntitlement(hospitalId);
          setPermissions((prev) => {
            const next = applyEntitlement(prev, entitlement);
            const authUserId = authUserIdRef.current;
            if (authUserId) {
              writeCache(authUserId, {
                hospitalId,
                userId,
                role,
                permissions: next,
                fullName,
                loading: false,
              });
            }
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hospitalId, userId, role, fullName]);

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
