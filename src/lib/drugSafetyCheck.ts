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
}

const SEVERITY_RANK: Record<string, number> = {
  contraindicated: 4,
  major: 3,
  moderate: 2,
  minor: 1,
  none: 0,
};

function getWorstSeverity(
  interactions: DrugInteraction[],
  allergyConflicts: AllergyConflict[]
): DrugSafetyResult["worstSeverity"] {
  let worst = 0;
  for (const i of interactions) {
    worst = Math.max(worst, SEVERITY_RANK[i.severity] || 0);
  }
  for (const a of allergyConflicts) {
    worst = Math.max(worst, SEVERITY_RANK[a.severity] || 0);
  }
  const map: Record<number, DrugSafetyResult["worstSeverity"]> = {
    4: "contraindicated",
    3: "major",
    2: "moderate",
    1: "minor",
    0: "none",
  };
  return map[worst] || "none";
}

/** Normalize drug name for matching: lowercase, strip dosage suffixes */
function normalize(name: string): string {
  return name
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
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(names.map((n) => (n ?? "").trim()).filter(Boolean))];
  if (!unique.length) return out;

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
    const { data: exact } = await base().in("drug_name", unique).limit(200);
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
      const { data } = await base().ilike("drug_name", n).limit(1);
      const row = (data ?? [])[0] as { generic_name: string | null } | undefined;
      if (row) add(n, row.generic_name);
    }
  } catch {
    // A formulary lookup failure must never block prescribing — fall back to the typed name,
    // which is exactly the behaviour that existed before this resolution was added.
  }

  return out;
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
  };

  const newDrugNorm = normalize(newDrug);
  if (!newDrugNorm) return results;

  // Brand → generic resolution, done ONCE for every name in play. All three checks below match
  // on these aliases rather than on the raw typed name; see resolveAliases() for why.
  const aliasMap = await resolveAliases([newDrug, ...currentDrugs], hospitalId);
  const aliasesOf = (name: string): string[] => aliasMap.get((name ?? "").trim()) ?? [normalize(name)];
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
    const { data: allInteractions } = await supabase
      .from("drug_interactions")
      .select("*")
      .or(
        `drug_a.in.(${allNames.map((n) => `"${n}"`).join(",")}),drug_b.in.(${allNames.map((n) => `"${n}"`).join(",")})`
      );

    if (allInteractions) {
      for (const interaction of allInteractions) {
        const a = interaction.drug_a;
        const b = interaction.drug_b;
        // Skip if already found via DrugBank
        const alreadyFound = results.interactions.some(
          (i) => (i.drug_a === a && i.drug_b === b) || (i.drug_a === b && i.drug_b === a)
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

    // Cross-reactivity
    const { data: crossReacts } = await supabase
      .from("drug_allergy_cross_reactivity")
      .select("*");

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
  results.interactions.sort(
    (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
  );

  results.worstSeverity = getWorstSeverity(
    results.interactions,
    results.allergyConflicts
  );

  return results;
};
