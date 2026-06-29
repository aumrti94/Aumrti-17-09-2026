// Disaster & Epidemic Management utilities (F10: COP.4 NABH compliance)

import { supabase } from "@/integrations/supabase/client";
import { logNABHEvidence } from "./nabh-evidence";

export interface EpidemicProtocol {
  id: string;
  protocol_name: string;
  is_active: boolean;
  activated_at: string | null;
  activated_by: string | null;
  triage_mode: string;
  isolation_beds: number;
  ppe_level: string;
  visitor_policy: string | null;
  notes: string | null;
}

export async function getActiveEpidemicProtocol(
  hospitalId: string
): Promise<EpidemicProtocol | null> {
  const { data } = await (supabase as any)
    .from("epidemic_protocols")
    .select("*")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function activateProtocol(
  hospitalId: string,
  protocolId: string,
  userId: string
): Promise<void> {
  // Deactivate any currently active protocol
  await (supabase as any)
    .from("epidemic_protocols")
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq("hospital_id", hospitalId)
    .eq("is_active", true);

  // Activate the selected protocol
  await (supabase as any)
    .from("epidemic_protocols")
    .update({
      is_active: true,
      activated_at: new Date().toISOString(),
      activated_by: userId,
      deactivated_at: null,
    })
    .eq("id", protocolId);

  const { data: protocol } = await (supabase as any)
    .from("epidemic_protocols")
    .select("protocol_name")
    .eq("id", protocolId)
    .single();

  await logNABHEvidence(
    hospitalId,
    "COP.4",
    `Epidemic protocol activated: ${protocol?.protocol_name || protocolId}`
  );
}

export async function deactivateProtocol(
  hospitalId: string,
  userId: string
): Promise<void> {
  await (supabase as any)
    .from("epidemic_protocols")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
    })
    .eq("hospital_id", hospitalId)
    .eq("is_active", true);

  await logNABHEvidence(
    hospitalId,
    "COP.4",
    `Epidemic protocol deactivated by user ${userId}`
  );
}

export function getTriageModeLabel(protocol: EpidemicProtocol | null): string {
  if (!protocol) return "Standard";
  switch (protocol.triage_mode) {
    case "mass_casualty": return "Mass Casualty Incident (MCI)";
    case "epidemic": return "Epidemic Protocol";
    default: return "Standard Triage";
  }
}
