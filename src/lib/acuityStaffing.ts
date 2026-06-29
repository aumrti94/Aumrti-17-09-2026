// Acuity-Based Nursing Staffing (F4: COP.6.c NABH compliance)
// Calculates required nurse:patient ratios from NEWS2 scores

import { supabase } from "@/integrations/supabase/client";
import { getNEWS2Level } from "./news2";

export interface WardAcuityResult {
  wardId: string;
  wardName: string;
  patientCount: number;
  highAcuity: number;   // NEWS2 >= 7
  mediumAcuity: number; // NEWS2 5-6
  lowAcuity: number;    // NEWS2 0-4
  avgNews2: number;
  requiredNurses: number;
  nursesOnDuty: number;
  ratioMet: boolean;
  snapshotId?: string;
}

// NABH COP.6 nurse:patient ratios
// 1:3 for each high-acuity (NEWS2>=7), 1:4 medium (NEWS2 5-6), 1:6 general
export function calculateRequiredNurses(
  patientCount: number,
  highAcuity: number,
  mediumAcuity: number
): number {
  const lowAcuity = patientCount - highAcuity - mediumAcuity;
  const needed = Math.ceil(highAcuity / 3) + Math.ceil(mediumAcuity / 4) + Math.ceil(lowAcuity / 6);
  return Math.max(needed, 1);
}

export async function computeWardAcuity(
  hospitalId: string,
  wardId: string,
  wardName: string,
  nursesOnDuty: number = 0
): Promise<WardAcuityResult> {
  // Single query: active admissions + latest NEWS2 via correlated subquery
  const { data: admissions } = await (supabase as any)
    .from("admissions")
    .select(`
      id,
      ipd_vitals!inner(news2_score, recorded_at)
    `)
    .eq("hospital_id", hospitalId)
    .eq("ward_id", wardId)
    .eq("status", "admitted")
    .order("ipd_vitals.recorded_at", { ascending: false });

  // Deduplicate to latest vitals per admission
  const seen = new Set<string>();
  const latest: Array<{ id: string; news2: number }> = [];
  for (const a of admissions || []) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      const vitals = Array.isArray(a.ipd_vitals) ? a.ipd_vitals : [a.ipd_vitals];
      const news2 = vitals[0]?.news2_score ?? 0;
      latest.push({ id: a.id, news2: Number(news2) });
    }
  }

  const patientCount = latest.length;
  const highAcuity = latest.filter(p => p.news2 >= 7).length;
  const mediumAcuity = latest.filter(p => p.news2 >= 5 && p.news2 <= 6).length;
  const lowAcuity = patientCount - highAcuity - mediumAcuity;
  const avgNews2 = patientCount > 0 ? latest.reduce((s, p) => s + p.news2, 0) / patientCount : 0;
  const requiredNurses = calculateRequiredNurses(patientCount, highAcuity, mediumAcuity);
  const ratioMet = nursesOnDuty >= requiredNurses;

  // Persist snapshot
  const { data: snap } = await (supabase as any)
    .from("ward_acuity_snapshots")
    .insert({
      hospital_id: hospitalId,
      ward_id: wardId,
      ward_name: wardName,
      patient_count: patientCount,
      high_acuity: highAcuity,
      medium_acuity: mediumAcuity,
      low_acuity: lowAcuity,
      avg_news2: Math.round(avgNews2 * 10) / 10,
      nurses_on_duty: nursesOnDuty,
      required_nurses: requiredNurses,
      ratio_met: ratioMet,
    })
    .select("id")
    .single();

  if (!ratioMet) {
    await (supabase as any).from("staffing_alerts").insert({
      hospital_id: hospitalId,
      ward_id: wardId,
      ward_name: wardName,
      snapshot_id: snap?.id,
      alert_type: "ratio_breach",
      message: `${wardName}: ${requiredNurses} nurses required (${nursesOnDuty} on duty) for ${patientCount} patients (${highAcuity} high, ${mediumAcuity} medium acuity)`,
      severity: highAcuity > 0 ? "critical" : "warning",
    });
  }

  return {
    wardId, wardName, patientCount,
    highAcuity, mediumAcuity, lowAcuity,
    avgNews2: Math.round(avgNews2 * 10) / 10,
    requiredNurses, nursesOnDuty, ratioMet,
    snapshotId: snap?.id,
  };
}
