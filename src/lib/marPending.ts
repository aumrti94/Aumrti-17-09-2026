// Shared helper for computing "expected but not yet recorded" medication doses against the
// canonical nursing_mar table. nursing_mar only ever has a persisted row once a nurse has
// recorded a real outcome (given/held/omitted/refused) or Kardex's "Generate Today's MAR" wrote
// a "pending" placeholder — so any consumer that needs today's full expected dose list (not just
// what's already been charted) must recompute it from the active medication schedule, same as
// NursingPage.tsx's task queue does.

export function getScheduledTimes(frequency: string): string[] {
  const f = (frequency || "").toUpperCase().trim();
  if (f === "OD" || f === "QD" || f.includes("ONCE")) return ["08:00"];
  if (f === "BD" || f === "BID" || f.includes("TWICE")) return ["08:00", "20:00"];
  if (f === "TDS" || f === "TID" || f.includes("THRICE")) return ["08:00", "14:00", "20:00"];
  if (f === "QID" || f.includes("FOUR")) return ["06:00", "12:00", "18:00", "22:00"];
  if (f.includes("Q6") || f.includes("6H")) return ["06:00", "12:00", "18:00", "00:00"];
  if (f.includes("Q8") || f.includes("8H")) return ["06:00", "14:00", "22:00"];
  if (f.includes("Q12") || f.includes("12H")) return ["08:00", "20:00"];
  if (f === "SOS" || f === "PRN" || f.includes("NEEDED")) return [];
  return ["08:00"];
}

export interface ActiveMedication {
  id: string;
  admission_id: string;
  drug_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
}

export interface PendingDose {
  medicationId: string;
  admissionId: string;
  drugName: string;
  dose: string | null;
  route: string | null;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
}

// recordedKeys: set of `${medication_id}_${scheduled_date}_${scheduled_time}` already present in
// nursing_mar (any outcome — given/held/omitted/refused/pending all count as "already recorded",
// since a pending placeholder still occupies that dose's slot).
export function computePendingDoses(
  meds: ActiveMedication[],
  recordedKeys: Set<string>,
  scheduledDate: string,
): PendingDose[] {
  const result: PendingDose[] = [];
  for (const med of meds) {
    const times = getScheduledTimes(med.frequency || "");
    for (const time of times) {
      const key = `${med.id}_${scheduledDate}_${time}:00`;
      if (!recordedKeys.has(key)) {
        result.push({
          medicationId: med.id,
          admissionId: med.admission_id,
          drugName: med.drug_name,
          dose: med.dose,
          route: med.route,
          scheduledDate,
          scheduledTime: time,
        });
      }
    }
  }
  return result;
}
