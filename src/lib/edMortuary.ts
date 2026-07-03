import { supabase } from "@/integrations/supabase/client";

/**
 * Route an ED patient into the mortuary pipeline (used for both an ED "expired"
 * disposition and a Brought-Dead / BID arrival). Mirrors exactly the fields the
 * Emergency workspace already wrote for expired patients, so behaviour is unchanged —
 * it is extracted here only so the new BID arrival path can reuse it.
 *
 * Creates a mortuary_admissions row (+ an mlc_records row when the case is medico-legal)
 * and returns the generated body number. The caller shows the toast.
 */
export async function routeEdPatientToMortuary(opts: {
  hospitalId: string;
  patientId: string;
  pronouncedBy: string | null;
  cause?: string | null;
  isMlc?: boolean;
  mlcDetails?: { police_station?: string; officer?: string; fir?: string };
  notes?: string;
}): Promise<{ bodyNumber: string }> {
  const {
    hospitalId, patientId, pronouncedBy,
    cause, isMlc = false, mlcDetails = {}, notes,
  } = opts;

  const year = new Date().getFullYear();
  const bodyNumber = `BODY-${year}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`;

  await supabase.from("mortuary_admissions").insert({
    hospital_id: hospitalId,
    patient_id: patientId,
    admission_id: null,
    body_number: bodyNumber,
    time_of_death: new Date().toISOString(),
    pronounced_by: pronouncedBy,
    cause_of_death: cause || "Under investigation",
    manner_of_death: "undetermined",
    is_mlc: isMlc,
    status: "in_mortuary",
    notes: notes ?? `Patient brought from Emergency Department. MLC: ${isMlc ? "Yes" : "No"}`,
  });

  if (isMlc) {
    await supabase.from("mlc_records").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      mlc_number: `MLC-${year}-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, "0")}`,
      incident_type: "unknown_cause",
      police_station: mlcDetails.police_station || "",
      officer_name: mlcDetails.officer || "",
      fir_number: mlcDetails.fir || "",
      status: "open",
    });
  }

  return { bodyNumber };
}
