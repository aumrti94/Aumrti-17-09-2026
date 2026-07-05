import { supabase } from "@/integrations/supabase/client";

/**
 * Cross-module roster visibility helper. Clinical surfaces (nursing board,
 * OT team pickers, etc.) can call this to see who is rostered on shift for a
 * given date, without duplicating the HR roster queries. Read-only.
 */
export interface OnDutyStaff {
  user_id: string;
  full_name: string;
  role: string;
  shift_name: string | null;
  shift_code: string | null;
  start_time: string | null;
  end_time: string | null;
}

export async function getOnDutyStaff(hospitalId: string, date: string): Promise<OnDutyStaff[]> {
  if (!hospitalId || !date) return [];
  const { data } = await (supabase as any)
    .from("duty_roster")
    .select("user_id, is_off, shift_id, u:users(full_name, role), s:shift_master(shift_name, shift_code, start_time, end_time)")
    .eq("hospital_id", hospitalId)
    .eq("roster_date", date)
    .eq("is_off", false)
    .not("shift_id", "is", null);

  return ((data || []) as any[]).map((r) => ({
    user_id: r.user_id,
    full_name: r.u?.full_name || "",
    role: r.u?.role || "",
    shift_name: r.s?.shift_name ?? null,
    shift_code: r.s?.shift_code ?? null,
    start_time: r.s?.start_time ?? null,
    end_time: r.s?.end_time ?? null,
  }));
}

/** Convenience: only staff of a given role on duty (e.g. "nurse"). */
export async function getOnDutyByRole(hospitalId: string, date: string, role: string): Promise<OnDutyStaff[]> {
  return (await getOnDutyStaff(hospitalId, date)).filter((s) => s.role === role);
}
