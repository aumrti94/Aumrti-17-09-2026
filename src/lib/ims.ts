import { supabase } from "@/integrations/supabase/client";

type AccessAction = "view" | "download" | "print" | "export" | "share";

let _cachedUserId: string | null = null;

async function getImsUserId(): Promise<string | null> {
  if (_cachedUserId) return _cachedUserId;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (data?.id) _cachedUserId = data.id;
  return data?.id ?? null;
}

supabase.auth.onAuthStateChange(() => { _cachedUserId = null; });

/**
 * Fire-and-forget: log a record access event (view / print / export / download / share).
 * Never throws or awaits — safe to call from any sync/async context.
 */
export function logRecordAccess(params: {
  hospitalId: string | null;
  recordType: string;
  recordId?: string | null;
  patientId?: string | null;
  action: AccessAction;
}): void {
  if (!params.hospitalId) return;
  getImsUserId().then(userId => {
    if (!userId) return;
    (supabase as any).from("record_access_logs").insert({
      hospital_id: params.hospitalId,
      record_type: params.recordType,
      record_id: params.recordId || null,
      accessed_by: userId,
      access_action: params.action,
      patient_id: params.patientId || null,
    }).catch(() => null);
  }).catch(() => null);
}

/**
 * Fire-and-forget: log a configuration change (tariff edit, permission save, template change).
 * Pass userId explicitly when already available to skip an extra DB round-trip.
 */
export function logConfigChange(params: {
  hospitalId: string | null;
  configArea: string;
  itemId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  userId?: string | null;
}): void {
  if (!params.hospitalId) return;
  const doLog = async () => {
    const userId = params.userId || await getImsUserId();
    if (!userId) return;
    await (supabase as any).from("config_change_logs").insert({
      hospital_id: params.hospitalId,
      config_area: params.configArea,
      item_id: params.itemId || null,
      changed_by: userId,
      old_value: params.oldValue ?? null,
      new_value: params.newValue ?? null,
      reason: params.reason || null,
    }).catch(() => null);
  };
  doLog().catch(() => null);
}
