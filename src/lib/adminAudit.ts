import { supabase } from "@/integrations/supabase/client";

// Fire-and-forget logger for the fleet-wide admin_audit_log table — never
// blocks or fails the action it's logging.
export async function logAdminAction(
  action: string,
  opts?: { hospitalId?: string | null; hospitalName?: string | null; details?: Record<string, unknown> }
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: adminRow } = await (supabase as any)
      .from("aumrti_admins")
      .select("id, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    await (supabase as any).from("admin_audit_log").insert({
      admin_id: adminRow?.id ?? null,
      admin_name: adminRow?.full_name ?? null,
      action,
      target_hospital_id: opts?.hospitalId ?? null,
      target_hospital_name: opts?.hospitalName ?? null,
      details: opts?.details ?? {},
    });
  } catch {
    // Never block the caller's action on a logging failure.
  }
}
