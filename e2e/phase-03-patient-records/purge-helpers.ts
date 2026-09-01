/**
 * Shared patient cleanup for Phase 3 specs.
 *
 * ROOT CAUSE THIS FIXES: every table that references `patients.id` in this schema
 * (patient_consents, abdm_consent_logs, patient_documents, ed_visits, opd_tokens, ...)
 * declares `patient_id uuid REFERENCES patients(id)` with NO `ON DELETE CASCADE`. Every
 * registration writes a `patient_consents` row, so a bare `DELETE FROM patients` always fails
 * with a Postgres FK violation — and every spec's original purge() never checked the error,
 * so created test patients silently piled up across runs. That's what produced stale
 * "Kavya Prasad"/"Farida Sheikh" rows that later tests' name-only lookups picked up instead
 * of the row they'd just created (TC-P3A-005, TC-P3A-014, TC-P3H-002/003/004).
 *
 * Delete known child rows first, then the patient — and surface errors instead of swallowing
 * them, so a broken purge fails loudly instead of quietly poisoning every later run.
 */
import { db } from '../utils/db-verify';

export async function purgePatientsByName(hid: string, names: string[]): Promise<void> {
  if (!names.length) return;
  const { data: victims, error: selErr } = await db()
    .from('patients').select('id').eq('hospital_id', hid).in('full_name', names);
  if (selErr) throw new Error(`purge lookup failed for [${names.join(', ')}]: ${selErr.message}`);
  const ids = (victims ?? []).map((v: { id: string }) => v.id);
  if (!ids.length) return;

  await db().from('patient_consents').delete().in('patient_id', ids);
  await (db() as any).from('abdm_consent_logs').delete().in('patient_id', ids);
  await (db() as any).from('patient_documents').delete().in('patient_id', ids);
  await db().from('ed_visits').delete().in('patient_id', ids);
  await (db() as any).from('opd_tokens').delete().in('patient_id', ids);

  const { error } = await db().from('patients').delete().in('id', ids);
  if (error) {
    throw new Error(
      `purge failed for [${names.join(', ')}] after deleting known child rows: ${error.message}. ` +
      `A new child table may now reference patients.id without ON DELETE CASCADE — add it here.`,
    );
  }
}

/** Same, but by explicit patient id (used where the row was created outside a name lookup). */
export async function purgePatientsById(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db().from('patient_consents').delete().in('patient_id', ids);
  await (db() as any).from('abdm_consent_logs').delete().in('patient_id', ids);
  await (db() as any).from('patient_documents').delete().in('patient_id', ids);
  await db().from('ed_visits').delete().in('patient_id', ids);
  await (db() as any).from('opd_tokens').delete().in('patient_id', ids);

  const { error } = await db().from('patients').delete().in('id', ids);
  if (error) throw new Error(`purge failed for ids [${ids.join(', ')}]: ${error.message}`);
}
