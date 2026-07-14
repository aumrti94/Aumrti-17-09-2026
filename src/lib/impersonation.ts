import { supabase } from "@/integrations/supabase/client";

const ADMIN_SESSION_KEY = "aumrti_admin_stashed_session";
const IMPERSONATION_KEY = "aumrti_impersonating";

export interface ImpersonationState {
  hospitalId: string;
  hospitalName: string;
  impersonatedName: string | null;
  impersonatedRole: string | null;
  startedAt: string;
}

export function getImpersonationState(): ImpersonationState | null {
  const raw = sessionStorage.getItem(IMPERSONATION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function startImpersonation(hospitalId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error("No active admin session");

  const { data: result, error } = await supabase.functions.invoke("admin-impersonate-start", {
    body: { hospital_id: hospitalId },
  });
  if (error || result?.error) throw new Error(result?.error || error?.message || "Failed to start impersonation");

  // Stash the admin's own session BEFORE swapping — this is what lets
  // "End Impersonation" return to the admin cockpit without a fresh login.
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(sessionData.session));

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: result.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(`Failed to establish impersonated session: ${verifyErr.message}`);

  const state: ImpersonationState = {
    hospitalId,
    hospitalName: result.hospital_name,
    impersonatedName: result.impersonated_name,
    impersonatedRole: result.impersonated_role,
    startedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(state));
}

export async function endImpersonation(): Promise<void> {
  const state = getImpersonationState();
  const stashedRaw = sessionStorage.getItem(ADMIN_SESSION_KEY);

  // Best-effort audit log before the session swaps back — after this point
  // we're the admin again, not the impersonated hospital user, and this
  // table only allows an aumrti_admin to insert.
  try {
    if (stashedRaw && state) {
      const stashed = JSON.parse(stashedRaw);
      await supabase.auth.setSession({ access_token: stashed.access_token, refresh_token: stashed.refresh_token });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: adminRow } = await (supabase as any)
          .from("aumrti_admins").select("id, full_name").eq("auth_user_id", user.id).maybeSingle();
        await (supabase as any).from("admin_audit_log").insert({
          admin_id: adminRow?.id ?? null,
          admin_name: adminRow?.full_name ?? null,
          action: "impersonation_end",
          target_hospital_id: state.hospitalId,
          target_hospital_name: state.hospitalName,
          details: { started_at: state.startedAt },
        });
      }
    }
  } finally {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(IMPERSONATION_KEY);
  }
}
