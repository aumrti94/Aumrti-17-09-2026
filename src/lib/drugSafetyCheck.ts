import { supabase } from "@/integrations/supabase/client";
import { checkDrugBankDDI } from "./drugbankAPI";

export interface DrugInteraction {
  id: string;
  drug_a: string;
  drug_b: string;
  severity: string;
  mechanism: string | null;
  clinical_effect: string | null;
  recommendation: string | null;
}

export interface AllergyConflict {
  allergy: string;
  drug: string;
  type: "direct" | "cross_reactivity";
  severity: string;
}

export interface DrugSafetyResult {
  hasIssues: boolean;
  interactions: DrugInteraction[];
  allergyConflicts: AllergyConflict[];
  duplicates: string[];
  worstSeverity: "contraindicated" | "major" | "moderate" | "minor" | "none";
  /**
   * True when a reference lookup failed, so this result is INCOMPLETE rather than clean.
   *
   * KNOWN-BUG-108. Supabase returns errors as VALUES, and this module used to destructure
   * only `data` — a timed-out interaction query yielded `data: null`, zero findings, and
   * `hasIssues: false`. A transport failure was indistinguishable from a clean bill of
   * health on a patient-safety surface. The check now fails LOUD: `hasIssues` is true and
   * `worstSeverity` is raised, so a prescribing gate reading either one stops.
   */
  checkUnavailable: boolean;
  /** Human-readable reasons the check is incomplete. Empty when checkUnavailable is false. */
  unavailableReasons: string[];
}

/**
 * Severity vocabularies, merged.
 *
 * KNOWN-BUG-106. `drug_interactions.severity` uses contraindicated/major/moderate/minor,
 * while `drug_allergy_cross_reactivity.risk_level` uses high/moderate/low — and 'high' is
 * also this module's own fallback (`cr.risk_level || "high"`). 'high' was absent from this
 * map, so it scored 0, and a HIGH-risk penicillin cross-reaction reported worstSeverity
 * 'none' — ranking below a moderate one. Any gate reading worstSeverity let it through.
 */
const SEVERITY_RANK: Record<string, number> = {
  contraindicated: 4,
  major: 3,
  moderate: 2,
  minor: 1,
  none: 0,
  // drug_allergy_cross_reactivity.risk_level
  high: 3,
  low: 1,
};

/**
 * An unrecognised severity ranks as MAJOR, never as none.
 *
 * A value this module has not seen means "a reference table says this is dangerous and we
 * cannot tell how dangerous" — which is not the same as safe, and must not collapse to the
 * bottom of the scale. Failing upward shows a warning that a clinician can dismiss; failing
 * downward hides one they never see.
 */
const UNKNOWN_SEVERITY_RANK = 3;

/**
 * Prescribing the same molecule twice is a real overdose, not an informational note, so it
 * has to reach worstSeverity — the second facet of KNOWN-BUG-106 was that duplicates never
 * did, leaving hasIssues true and worstSeverity 'none' on a paracetamol double-dose.
 *
 * 'moderate' rather than 'major': duplication warrants a hard look, but the same molecule
 * under two brands is sometimes deliberate (different routes, PRN plus scheduled).
 * RATIFICATION OUTSTANDING — Dr. Ramesh owns the clinical grading of this.
 */
const DUPLICATE_THERAPY_SEVERITY = "moderate";

function rankSeverity(value: string | null | undefined): number {
  const key = String(value ?? "").toLowerCase().trim();
  if (!key) return UNKNOWN_SEVERITY_RANK;
  const rank = SEVERITY_RANK[key];
  return rank === undefined ? UNKNOWN_SEVERITY_RANK : rank;
}

const RANK_TO_SEVERITY: Record<number, DrugSafetyResult["worstSeverity"]> = {
  4: "contraindicated",
  3: "major",
  2: "moderate",
  1: "minor",
  0: "none",
};

function getWorstSeverity(
  interactions: DrugInteraction[],
  allergyConflicts: AllergyConflict[],
  duplicates: string[],
  checkUnavailable: boolean
): DrugSafetyResult["worstSeverity"] {
  let worst = 0;
  for (const i of interactions) worst = Math.max(worst, rankSeverity(i.severity));
  for (const a of allergyConflicts) worst = Math.max(worst, rankSeverity(a.severity));
  if (duplicates.length > 0) worst = Math.max(worst, rankSeverity(DUPLICATE_THERAPY_SEVERITY));
  // An incomplete check outranks a quiet one: the prescriber must see that the safety net
  // was not fully in place, at a severity that any gate treats as blocking.
  if (checkUnavailable) worst = Math.max(worst, UNKNOWN_SEVERITY_RANK);
  return RANK_TO_SEVERITY[worst] ?? "none";
}

/**
 * Normalize drug name for matching: lowercase, strip dosage suffixes.
 *
 * KNOWN-BUG-111: this used to take `string` and be called with values off a medication list
 * that can contain nulls, so `null.toLowerCase()` threw and the whole safety check REJECTED
 * rather than returning. A safety check that throws hands the decision to whatever the
 * caller's catch block does — which is not obviously safer than one that returns clean.
 */
function normalize(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s*\d+\s*(mg|ml|mcg|g|iu|%)\s*/gi, "")
    .trim();
}

/**
 * Substring matching below this length produces nonsense ("k" matching "aspirin"), so short
 * aliases must match exactly. Long enough that real generic stems ("mox", "iron") still work
 * as exact matches while never being used as substrings.
 */
const MIN_SUBSTRING_LEN = 4;

/** Do two normalized names refer to the same substance, as far as string matching can tell? */
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < MIN_SUBSTRING_LEN || b.length < MIN_SUBSTRING_LEN) return false;
  return a.includes(b) || b.includes(a);
}

/** True when any alias of the drug matches `term`. */
function aliasesMatch(aliases: string[], term: string): boolean {
  return aliases.some((a) => namesMatch(a, term));
}

/** True when two drugs share any alias — i.e. they are the same substance under two names. */
function aliasesOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => namesMatch(x, y)));
}

/**
 * Split a generic_name into its constituent substances.
 *
 * Indian formularies write combinations as "Amoxicillin + Clavulanate",
 * "Etophylline + Theophylline", "Paracetamol/Caffeine". Each constituent has to be checked
 * separately or a combination brand slips past an allergy to just one of its components.
 */
function splitGenerics(generic: string | null | undefined): string[] {
  if (!generic) return [];
  return generic
    .split(/\s*(?:\+|\/|,|&|\band\b|\bwith\b)\s*/i)
    .map(normalize)
    .filter((g) => g.length > 1);
}

/**
 * Resolve each prescribed name to the set of names worth matching on: what the prescriber
 * typed, PLUS the generic constituents that name maps to in `drug_master`.
 *
 * WHY THIS EXISTS. The reference tables this module matches against —
 * `drug_allergy_cross_reactivity` and `drug_interactions` — are keyed on GENERIC names
 * ('penicillin' → amoxicillin, ampicillin, co-amoxiclav …). Indian doctors prescribe by BRAND
 * almost exclusively, and `drug_master` is itself brand-keyed. Without this resolution
 * "Amoxicillin" was correctly blocked for a penicillin-allergic patient while "Mox 500" — the
 * same molecule, and the way the drug is actually ordered — passed silently, because
 * normalize() only strips the strength and leaves "mox".
 *
 * `drug_master` is RLS-scoped to the caller's hospital, so the tenant filter is optional and
 * only narrows further when a hospitalId is supplied.
 */
async function resolveAliases(
  names: string[],
  hospitalId: string
): Promise<{ aliases: Map<string, string[]>; degradedReason: string | null }> {
  const out = new Map<string, string[]>();
  let degradedReason: string | null = null;
  const unique = [...new Set(names.map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (!unique.length) return { aliases: out, degradedReason: null };

  // Whatever happens below, a drug always matches on the name that was typed.
  for (const n of unique) out.set(n, [normalize(n)]);

  const add = (key: string, generic: string | null | undefined) => {
    const merged = new Set([...(out.get(key) ?? []), ...splitGenerics(generic)]);
    out.set(key, [...merged].filter(Boolean));
  };

  const base = () => {
    const q = supabase.from("drug_master").select("drug_name, generic_name");
    return hospitalId ? q.eq("hospital_id", hospitalId) : q;
  };

  try {
    // Pass 1 — exact names. This is the normal path: DrugMasterSearchInput writes the
    // catalogue's own drug_name into the prescription when the doctor picks a suggestion.
    const { data: exact, error: exactError } = await base().in("drug_name", unique).limit(200);
    if (exactError) degradedReason = `Formulary lookup failed: ${exactError.message}`;
    const resolved = new Set<string>();
    for (const row of (exact ?? []) as { drug_name: string; generic_name: string | null }[]) {
      const key = unique.find((n) => n === row.drug_name);
      if (!key) continue;
      resolved.add(key);
      add(key, row.generic_name);
    }

    // Pass 2 — anything still unresolved, matched case-insensitively. Covers a drug typed by
    // hand rather than picked from the list. Capped so a long medication list cannot turn one
    // safety check into a dozen round trips.
    let budget = 8;
    for (const n of unique) {
      if (resolved.has(n) || budget-- <= 0) continue;
      const { data, error: fuzzyError } = await base().ilike("drug_name", n).limit(1);
      if (fuzzyError && !degradedReason) degradedReason = `Formulary lookup failed: ${fuzzyError.message}`;
      const row = (data ?? [])[0] as { generic_name: string | null } | undefined;
      if (row) add(n, row.generic_name);
    }
  } catch (e) {
    // A formulary lookup failure must never BLOCK prescribing — fall back to the typed name,
    // which is the behaviour that existed before this resolution was added. But it must not
    // be silent either: without drug_master, "Mox 500" is no longer known to be amoxicillin,
    // so a brand prescribed against a documented allergy is missed. The caller reports the
    // check as incomplete rather than clean. (KNOWN-BUG-108, formulary facet.)
    degradedReason = `Formulary lookup failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return { aliases: out, degradedReason };
}

export const checkDrugSafety = async (
  newDrug: string,
  currentDrugs: string[],
  patientAllergies: string[],
  hospitalId = ""
): Promise<DrugSafetyResult> => {
  const results: DrugSafetyResult = {
    hasIssues: false,
    interactions: [],
    allergyConflicts: [],
    duplicates: [],
    worstSeverity: "none",
    checkUnavailable: false,
    unavailableReasons: [],
  };

  /** Record that a reference lookup failed, so the result reads incomplete, never clean. */
  const markUnavailable = (reason: string) => {
    results.checkUnavailable = true;
    results.hasIssues = true;
    if (!results.unavailableReasons.includes(reason)) results.unavailableReasons.push(reason);
  };

  const newDrugNorm = normalize(newDrug);
  if (!newDrugNorm) return results;

  // Brand → generic resolution, done ONCE for every name in play. All three checks below match
  // on these aliases rather than on the raw typed name; see resolveAliases() for why.
  const { aliases: aliasMap, degradedReason } = await resolveAliases([newDrug, ...currentDrugs], hospitalId);
  if (degradedReason) markUnavailable(degradedReason);
  const aliasesOf = (name: string | null | undefined): string[] =>
    aliasMap.get(String(name ?? "").trim()) ?? [normalize(name)];
  const newAliases = aliasesOf(newDrug);

  // CHECK 1: Duplicates — including the same molecule under two different brands
  // ("Dolo 650" and "Crocin" are both paracetamol, and prescribing both is a real overdose).
  for (const existing of currentDrugs) {
    if (aliasesOverlap(newAliases, aliasesOf(existing))) {
      results.duplicates.push(existing);
      results.hasIssues = true;
    }
  }

  // CHECK 2: Drug-Drug Interactions — try DrugBank first, fall back to local DB
  if (currentDrugs.length > 0) {
    const currentNorms = currentDrugs.flatMap(aliasesOf);

    // Try DrugBank for each pair (up to 3 pairs to avoid excessive calls)
    if (hospitalId) {
      for (const existingDrug of currentDrugs.slice(0, 3)) {
        const dbInteractions = await checkDrugBankDDI(newDrug, existingDrug, hospitalId);
        if (dbInteractions && dbInteractions.length > 0) {
          results.interactions.push(...dbInteractions);
          results.hasIssues = true;
        }
      }
    }

    // Also query local DB for any pairs not covered by DrugBank
    const allNames = [...new Set([...newAliases, ...currentNorms])];
    // KNOWN-BUG-108: `error` was not destructured here. Supabase returns errors as values,
    // so a failed or timed-out query left `allInteractions` null, the `if` below never ran,
    // and the result came back clean.
    const { data: allInteractions, error: interactionsError } = await supabase
      .from("drug_interactions")
      .select("*")
      .or(
        `drug_a.in.(${allNames.map((n) => `"${n}"`).join(",")}),drug_b.in.(${allNames.map((n) => `"${n}"`).join(",")})`
      );

    if (interactionsError) {
      markUnavailable(`Interaction check unavailable: ${interactionsError.message}`);
    }

    if (allInteractions) {
      for (const interaction of allInteractions) {
        const a = interaction.drug_a;
        const b = interaction.drug_b;
        // Skip if already found via DrugBank. Compared normalized (KNOWN-BUG-107): DrugBank and
        // this local table don't share a casing convention, so a raw `===` let the same pair
        // ("Aspirin"/"aspirin") report twice — alert fatigue on the prescribing screen.
        const na = normalize(a);
        const nb = normalize(b);
        const alreadyFound = results.interactions.some(
          (i) => (normalize(i.drug_a) === na && normalize(i.drug_b) === nb) ||
            (normalize(i.drug_a) === nb && normalize(i.drug_b) === na)
        );
        if (alreadyFound) continue;

        const newMatchesA = aliasesMatch(newAliases, a);
        const newMatchesB = aliasesMatch(newAliases, b);

        for (const existingNorm of currentNorms) {
          const existMatchesA = namesMatch(existingNorm, a);
          const existMatchesB = namesMatch(existingNorm, b);

          if (
            (newMatchesA && existMatchesB) ||
            (newMatchesB && existMatchesA)
          ) {
            results.interactions.push(interaction as DrugInteraction);
            results.hasIssues = true;
            break;
          }
        }
      }
    }
  }

  // CHECK 3: Allergy conflicts
  if (patientAllergies.length > 0) {
    const allergiesNorm = patientAllergies.map((a) => a.toLowerCase().trim());

    // Direct match — against the typed name AND the generic it resolves to, so a brand whose
    // molecule IS the allergen ("Mox 500" for an "Amoxicillin" allergy) is caught.
    for (const allergy of allergiesNorm) {
      if (aliasesMatch(newAliases, allergy)) {
        results.allergyConflicts.push({
          allergy,
          drug: newDrug,
          type: "direct",
          severity: "contraindicated",
        });
        results.hasIssues = true;
      }
    }

    // Cross-reactivity. Same errors-as-values fix as the interaction query above: a dead
    // reference table used to read as "no cross-reactions", which for a penicillin-allergic
    // patient is the difference between a blocked cephalosporin and an anaphylaxis.
    const { data: crossReacts, error: crossError } = await supabase
      .from("drug_allergy_cross_reactivity")
      .select("*");

    if (crossError) {
      markUnavailable(`Cross-reactivity check unavailable: ${crossError.message}`);
    }

    if (crossReacts) {
      for (const cr of crossReacts) {
        const allergenNorm = cr.allergen?.toLowerCase() || "";
        const matchesAllergy = allergiesNorm.some(
          (a) => a.includes(allergenNorm) || allergenNorm.includes(a)
        );
        if (!matchesAllergy) continue;

        // The cross_reacts array is keyed on generics ('penicillin' → amoxicillin,
        // co-amoxiclav …), so this compares against the resolved aliases. Matching the raw
        // brand here is what let every brand-name prescription through.
        const crossList: string[] = (cr.cross_reacts as string[]) || [];
        const drugMatchesCross = crossList.some((d) => aliasesMatch(newAliases, normalize(d)));
        if (drugMatchesCross) {
          results.allergyConflicts.push({
            allergy: cr.allergen || "",
            drug: newDrug,
            type: "cross_reactivity",
            severity: cr.risk_level || "high",
          });
          results.hasIssues = true;
        }
      }
    }
  }

  // Sort interactions: contraindicated first
  results.interactions.sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity));

  results.worstSeverity = getWorstSeverity(
    results.interactions,
    results.allergyConflicts,
    results.duplicates,
    results.checkUnavailable
  );

  return results;
};
