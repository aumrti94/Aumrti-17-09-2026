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

  // CHECK 1: Duplicates (fast, local)
  for (const existing of currentDrugs) {
    const existingNorm = normalize(existing);
    if (
      existingNorm === newDrugNorm ||
      existingNorm.includes(newDrugNorm) ||
      newDrugNorm.includes(existingNorm)
    ) {
      results.duplicates.push(existing);
      results.hasIssues = true;
    }
  }

  // CHECK 2: Drug-Drug Interactions — try DrugBank first, fall back to local DB
  if (currentDrugs.length > 0) {
    const currentNorms = currentDrugs.map(normalize);

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
    const allNames = [newDrugNorm, ...currentNorms];
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

        const newMatchesA = newDrugNorm.includes(a) || a.includes(newDrugNorm);
        const newMatchesB = newDrugNorm.includes(b) || b.includes(newDrugNorm);

        for (const existingNorm of currentNorms) {
          const existMatchesA = existingNorm.includes(a) || a.includes(existingNorm);
          const existMatchesB = existingNorm.includes(b) || b.includes(existingNorm);

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

    // Direct match
    for (const allergy of allergiesNorm) {
      if (
        newDrugNorm.includes(allergy) ||
        allergy.includes(newDrugNorm)
      ) {
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

        const crossList: string[] = (cr.cross_reacts as string[]) || [];
        const drugMatchesCross = crossList.some(
          (d) => newDrugNorm.includes(d) || d.includes(newDrugNorm)
        );
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
