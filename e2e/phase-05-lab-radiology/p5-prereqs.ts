/**
 * Phase 5 — provision the configuration the Lab and Radiology journeys need, before they run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 5 used to fail loudly with "Run: npm run qa:seed" whenever a master row was missing. That
 * is honest but useless: the person running the suite gets forty red cases with no common cause
 * visible from any of them, and the tracker records forty product defects for one configuration
 * gap. `SETTINGS_PREREQ_MATRIX.md` lists every one of these rows as a Phase 5 prerequisite; this
 * file is that matrix made executable.
 *
 * **A prerequisite is not the thing under test.** If a lab test is missing a critical range, the
 * correct behaviour is to put one there and get on with testing the critical-value workflow — not
 * to report "critical values do not work". The one case that asserts the configuration *itself*
 * (`TC-P5C-001`, and all of section 5L) runs BEFORE this provisioner is allowed to fix anything,
 * which is why `ensureP5Prerequisites()` returns a report of what it had to repair: 5L asserts
 * that report is empty on a properly seeded tenant.
 *
 * THE ONE STATE THAT LOOKS LIKE FORTY DEFECTS
 * -------------------------------------------
 * Migration `20261009000171_lab_test_default_inactive.sql` runs `UPDATE lab_test_master SET
 * is_active = false` and flips the column default. Every lookup in the app filters on
 * `is_active = true`, so a tenant migrated *after* it was seeded has no orderable tests at all.
 * `ensureLabCatalogue()` reactivates them and says so — that single line in the report is the
 * difference between one configuration note and forty phantom bug reports.
 *
 * Everything here is idempotent and cheap on the happy path: one read per table, and a write only
 * where the tenant actually differs from the catalogue.
 */
import { db } from '../utils/db-verify';
import { MOCK } from '../fixtures/mock-data';

/** What had to be repaired. Empty means the tenant was already configured correctly. */
export interface PrereqReport {
  repaired: string[];
}

/* ── Lab catalogue ────────────────────────────────────────────────────── */

/**
 * Every test in `MOCK.labTests` exists, is active, and carries its normal AND critical ranges.
 *
 * The critical range is the part that matters most and is the part most often absent. `calcFlag`
 * (`LabResultWorkspace.tsx:103-110`) derives `CH`/`CL` from `critical_low`/`critical_high` alone,
 * and only a `CH`/`CL` flag raises a `clinical_alerts` row or blocks release. A catalogue with a
 * normal range but no critical range means a potassium of 7.2 flags a harmless "H", no alert is
 * raised, and the whole of P5-S07 passes vacuously while the hospital has no critical-value
 * alerting whatsoever.
 */
export async function ensureLabCatalogue(hospitalId: string, report: PrereqReport): Promise<void> {
  const { data, error } = await db()
    .from('lab_test_master')
    .select('id, test_name, is_active, critical_low, critical_high, normal_min, normal_max, autoverify_eligible')
    .eq('hospital_id', hospitalId);
  if (error) throw new Error(`Reading lab_test_master: ${error.message}`);

  const existing = new Map(
    (data ?? []).map(r => [(r as { test_name: string }).test_name, r as Record<string, unknown>]),
  );

  const missing = MOCK.labTests.filter(t => !existing.has(t.name));
  if (missing.length) {
    const { error: insErr } = await db().from('lab_test_master').insert(
      missing.map(t => ({
        hospital_id: hospitalId, test_name: t.name, test_code: t.code,
        category: t.category, sample_type: t.sampleType, fee: t.fee, unit: t.unit || null,
        normal_min: t.normalMin, normal_max: t.normalMax,
        critical_low: t.criticalLow, critical_high: t.criticalHigh,
        male_normal_min: t.maleNormalMin, male_normal_max: t.maleNormalMax,
        female_normal_min: t.femaleNormalMin, female_normal_max: t.femaleNormalMax,
        method: t.method,
        autoverify_eligible: t.autoverifyEligible === true,
        tat_minutes: t.tatMinutes, is_active: true,
      })) as never,
    );
    if (insErr) throw new Error(`Creating lab tests (${missing.map(t => t.name).join(', ')}): ${insErr.message}`);
    report.repaired.push(`lab_test_master: created ${missing.length} missing test(s) — ${missing.map(t => t.name).join(', ')}`);
  }

  // Reactivate and backfill ranges on rows that exist but are unusable.
  for (const t of MOCK.labTests) {
    const row = existing.get(t.name);
    if (!row) continue;

    const patch: Record<string, unknown> = {};
    if (row.is_active === false) patch.is_active = true;
    if (row.critical_low == null && t.criticalLow != null) patch.critical_low = t.criticalLow;
    if (row.critical_high == null && t.criticalHigh != null) patch.critical_high = t.criticalHigh;
    if (row.normal_min == null && t.normalMin != null) patch.normal_min = t.normalMin;
    if (row.normal_max == null && t.normalMax != null) patch.normal_max = t.normalMax;
    if (t.autoverifyEligible === true && row.autoverify_eligible !== true) patch.autoverify_eligible = true;
    if (!Object.keys(patch).length) continue;

    const { error: upErr } = await db().from('lab_test_master')
      .update(patch as never).eq('id', row.id as string);
    if (upErr) throw new Error(`Repairing lab test "${t.name}": ${upErr.message}`);
    report.repaired.push(`lab_test_master "${t.name}": set ${Object.keys(patch).join(', ')}`);
  }
}

/**
 * Panels exist AND have members.
 *
 * A group with no members is not a panel. `NewLabOrderModal.fetchRates()` detects a covered group
 * by checking every `lab_test_group_items` row for the group is in the selection — with no member
 * rows that check is vacuously true for the empty set and the group price never applies, so the
 * Fever Panel bills as three separate tests and TC-P5A-013 tests nothing.
 */
export async function ensureLabGroups(hospitalId: string, report: PrereqReport): Promise<void> {
  const { data: groups, error } = await db()
    .from('lab_test_groups').select('id, group_name, group_code, fee, is_active')
    .eq('hospital_id', hospitalId);
  if (error) throw new Error(`Reading lab_test_groups: ${error.message}`);

  const byName = new Map(
    (groups ?? []).map(g => [(g as { group_name: string }).group_name, g as Record<string, unknown>]),
  );

  for (const g of MOCK.labTestGroups) {
    let row = byName.get(g.name);

    if (!row) {
      const { data, error: insErr } = await db().from('lab_test_groups').insert({
        hospital_id: hospitalId, group_name: g.name, group_code: g.code,
        category: g.category, fee: g.fee, tat_minutes: g.tatMinutes, is_active: true,
      } as never).select('id, group_name').maybeSingle();
      if (insErr) throw new Error(`Creating lab test group "${g.name}": ${insErr.message}`);
      row = data as Record<string, unknown>;
      report.repaired.push(`lab_test_groups: created "${g.name}"`);
    } else if (row.is_active === false) {
      await db().from('lab_test_groups').update({ is_active: true } as never).eq('id', row.id as string);
      report.repaired.push(`lab_test_groups "${g.name}": reactivated`);
    }

    const groupId = row.id as string;

    // Members. `lab_test_group_items` has no hospital_id — it is scoped through its group — and
    // carries UNIQUE (group_id, test_id), so a plain insert of the difference is safe.
    const [{ data: memberRows }, { data: testRows }] = await Promise.all([
      db().from('lab_test_group_items').select('test_id').eq('group_id', groupId),
      db().from('lab_test_master').select('id, test_name').eq('hospital_id', hospitalId),
    ]);

    const testIdByName = new Map(
      (testRows ?? []).map(t => [(t as { test_name: string }).test_name, (t as { id: string }).id]),
    );
    const have = new Set((memberRows ?? []).map(m => (m as { test_id: string }).test_id));

    const wanted = g.members
      .map(name => testIdByName.get(name))
      .filter((id): id is string => Boolean(id));

    const toAdd = wanted.filter(id => !have.has(id));
    if (toAdd.length) {
      const { error: mErr } = await db().from('lab_test_group_items')
        .insert(toAdd.map(test_id => ({ group_id: groupId, test_id })) as never);
      if (mErr) throw new Error(`Adding members to "${g.name}": ${mErr.message}`);
      report.repaired.push(
        `lab_test_group_items: added ${toAdd.length} member(s) to "${g.name}" — without members ` +
        `the group price never applies and the panel bills as separate tests`,
      );
    }
  }
}

/* ── Radiology catalogue ──────────────────────────────────────────────── */

/**
 * Modalities first, then studies that reference them.
 *
 * `requires_form_f` is the authoritative PCPNDT trigger (migration `20261013000019`), and it must
 * be set from the catalogue rather than inferred from the study name — that is the whole point of
 * the column. A study seeded without it makes every PCPNDT case fall back to a substring match on
 * "obstetric", which is the defect the flag was added to remove.
 */
export async function ensureRadiologyCatalogue(hospitalId: string, report: PrereqReport): Promise<void> {
  const { data: mods, error: mErr } = await db()
    .from('radiology_modalities').select('id, name, modality_type, is_active')
    .eq('hospital_id', hospitalId);
  if (mErr) throw new Error(`Reading radiology_modalities: ${mErr.message}`);

  const modByName = new Map(
    (mods ?? []).map(m => [(m as { name: string }).name, m as Record<string, unknown>]),
  );

  const missingMods = MOCK.radiologyModalities.filter(m => !modByName.has(m.name));
  if (missingMods.length) {
    const { data, error } = await db().from('radiology_modalities').insert(
      missingMods.map(m => ({
        hospital_id: hospitalId, name: m.name, modality_type: m.type, is_active: true,
      })) as never,
    ).select('id, name, modality_type');
    if (error) throw new Error(`Creating radiology modalities: ${error.message}`);
    for (const row of data ?? []) modByName.set((row as { name: string }).name, row as Record<string, unknown>);
    report.repaired.push(`radiology_modalities: created ${missingMods.map(m => m.name).join(', ')}`);
  }

  const { data: studies, error: sErr } = await db()
    .from('radiology_study_master').select('id, study_name, is_active, requires_form_f, modality_id')
    .eq('hospital_id', hospitalId);
  if (sErr) throw new Error(`Reading radiology_study_master: ${sErr.message}`);

  const studyByName = new Map(
    (studies ?? []).map(s => [(s as { study_name: string }).study_name, s as Record<string, unknown>]),
  );

  const missingStudies = MOCK.radiologyStudies.filter(s => !studyByName.has(s.name));
  if (missingStudies.length) {
    const { error } = await db().from('radiology_study_master').insert(
      missingStudies.map(s => {
        const mod = modByName.get(s.modality);
        return {
          hospital_id: hospitalId, study_name: s.name,
          modality_id: (mod?.id as string) ?? null,
          modality_type: (mod?.modality_type as string) ?? null,
          fee: s.fee, sort_order: s.sortOrder, is_active: true,
          requires_form_f: s.requiresFormF === true,
        };
      }) as never,
    );
    if (error) throw new Error(`Creating radiology studies: ${error.message}`);
    report.repaired.push(`radiology_study_master: created ${missingStudies.map(s => s.name).join(', ')}`);
  }

  for (const s of MOCK.radiologyStudies) {
    const row = studyByName.get(s.name);
    if (!row) continue;
    const patch: Record<string, unknown> = {};
    if (row.is_active === false) patch.is_active = true;
    if (s.requiresFormF === true && row.requires_form_f !== true) patch.requires_form_f = true;
    if (!Object.keys(patch).length) continue;

    const { error } = await db().from('radiology_study_master')
      .update(patch as never).eq('id', row.id as string);
    if (error) throw new Error(`Repairing radiology study "${s.name}": ${error.message}`);
    report.repaired.push(`radiology_study_master "${s.name}": set ${Object.keys(patch).join(', ')}`);
  }
}

/**
 * PCPNDT machine and doctor registration. Without these the statutory Form F cannot be completed
 * even when it is correctly raised — the register needs the machine registration number on it.
 */
export async function ensurePcpndtSettings(hospitalId: string, report: PrereqReport): Promise<void> {
  const { data, error } = await db()
    .from('pcpndt_settings').select('id, machine_registration_number')
    .eq('hospital_id', hospitalId).maybeSingle();
  if (error) throw new Error(`Reading pcpndt_settings: ${error.message}`);
  if (data && (data as { machine_registration_number: string | null }).machine_registration_number) return;

  const p = MOCK.phase5.pcpndt;
  const { error: upErr } = await db().from('pcpndt_settings').upsert([{
    hospital_id: hospitalId,
    machine_name: p.machineName,
    machine_registration_number: p.machineRegistrationNumber,
    doctor_pcpndt_registration: p.doctorPcpndtRegistration,
  }] as never, { onConflict: 'hospital_id', ignoreDuplicates: false });
  if (upErr) throw new Error(`Writing pcpndt_settings: ${upErr.message}`);
  report.repaired.push('pcpndt_settings: wrote machine + doctor PCPNDT registration');
}

/* ── The whole matrix ─────────────────────────────────────────────────── */

/**
 * Everything Phase 5 needs, provisioned if absent.
 *
 * Returns what it had to repair. On a tenant seeded by `npm run qa:seed` the list is empty; a
 * non-empty list is a configuration note for the run report, not a defect. Section 5L asserts it
 * is empty, which is how "the seeder and the app still agree" stays under test.
 */
export async function ensureP5Prerequisites(hospitalId: string): Promise<PrereqReport> {
  const report: PrereqReport = { repaired: [] };
  await ensureLabCatalogue(hospitalId, report);
  await ensureLabGroups(hospitalId, report);
  await ensureRadiologyCatalogue(hospitalId, report);
  await ensurePcpndtSettings(hospitalId, report);
  return report;
}

/** Memoised per hospital — the provisioning is idempotent, but re-reading six tables per test is not free. */
const done = new Map<string, Promise<PrereqReport>>();

export function p5Prerequisites(hospitalId: string): Promise<PrereqReport> {
  let hit = done.get(hospitalId);
  if (!hit) {
    hit = ensureP5Prerequisites(hospitalId);
    done.set(hospitalId, hit);
  }
  return hit;
}
