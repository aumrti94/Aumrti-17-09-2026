// Antimicrobial susceptibility testing (AST) intrinsic-resistance checks + AI resistance
// phenotype detection.
// Lab AI features, Phase 15.
//
// Same split as Phases 12/13: intrinsic resistance is textbook microbiology (CLSI M100
// intrinsic-resistance tables) — a deterministic, explainable check, safe to flag
// inline without an LLM. Resistance PHENOTYPE (MRSA, VRE, ESBL, CRE) inference from a
// full susceptibility pattern is genuinely a pattern-recognition task better suited to
// an LLM; it is advisory only and always feeds the existing antibiotic-stewardship
// alert pipeline (alert_type 'antibiotic_stewardship', already whitelisted) rather than
// blocking anything — a wrong phenotype guess should prompt a review, not gate care.
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";

export type Sensitivity = "S" | "I" | "R";

interface IntrinsicRule {
  organismPattern: RegExp;
  drugPattern: RegExp;
  note: string;
}

// A focused, well-established subset of CLSI M100 intrinsic resistance — not
// exhaustive, but each entry here is textbook and safe to flag without qualification.
const INTRINSIC_RULES: IntrinsicRule[] = [
  { organismPattern: /enterococcus/i, drugPattern: /ceftriaxone|cefuroxime/i, note: "Enterococcus spp. are intrinsically resistant to cephalosporins" },
  { organismPattern: /enterococcus/i, drugPattern: /clindamycin/i, note: "Enterococcus spp. are intrinsically resistant to clindamycin" },
  { organismPattern: /klebsiella/i, drugPattern: /ampicillin|amoxicillin/i, note: "Klebsiella spp. are intrinsically resistant to ampicillin/amoxicillin" },
  { organismPattern: /proteus/i, drugPattern: /nitrofurantoin/i, note: "Proteus spp. are intrinsically resistant to nitrofurantoin" },
  { organismPattern: /proteus|morganella|providencia/i, drugPattern: /doxycycline/i, note: "Proteeae are intrinsically resistant to tetracyclines" },
  { organismPattern: /pseudomonas/i, drugPattern: /ampicillin|amoxicillin|ceftriaxone|cefuroxime|cotrimoxazole|doxycycline|nitrofurantoin/i, note: "Pseudomonas aeruginosa is intrinsically resistant to this agent" },
  { organismPattern: /acinetobacter/i, drugPattern: /ampicillin|amoxicillin|cefuroxime/i, note: "Acinetobacter spp. are intrinsically resistant to this agent" },
  {
    organismPattern: /e\.?\s?coli|escherichia|klebsiella|proteus|pseudomonas|acinetobacter|enterobacter|citrobacter|serratia/i,
    drugPattern: /vancomycin|clindamycin/i,
    note: "Gram-negative rods are intrinsically resistant to glycopeptides/clindamycin (no cell-wall target / poor penetration)",
  },
];

export interface IntrinsicConflict {
  drug: string;
  note: string;
}

/**
 * Deterministic check: for the given organism, does the entered sensitivity grid mark
 * any drug S or I when it is textbook intrinsically resistant? These are the only
 * antibiogram findings safe to flag as a data-entry error without a qualifying human.
 */
export function checkIntrinsicResistanceConflicts(
  organism: string,
  sensitivity: Record<string, Sensitivity | undefined>
): IntrinsicConflict[] {
  if (!organism?.trim()) return [];
  const conflicts: IntrinsicConflict[] = [];
  for (const [drug, result] of Object.entries(sensitivity)) {
    if (result !== "S" && result !== "I") continue;
    const rule = INTRINSIC_RULES.find(r => r.organismPattern.test(organism) && r.drugPattern.test(drug));
    if (rule) conflicts.push({ drug, note: rule.note });
  }
  return conflicts;
}

export interface ResistancePhenotype {
  phenotype: string;
  confidence: "high" | "moderate" | "low";
  explanation: string;
  stewardship_alert: boolean;
}

/**
 * AI holistic phenotype inference (MRSA, VRE, ESBL, CRE, ...) from the full
 * organism + sensitivity pattern. Advisory only. When a finding is marked
 * stewardship_alert, the caller should raise an antibiotic_stewardship clinical
 * alert (this function does not insert it itself — the caller has the order/patient
 * context needed for a useful alert message).
 */
export async function detectResistancePhenotype(opts: {
  hospitalId: string;
  patientId: string;
  organism: string;
  specimenType: string;
  sensitivity: Record<string, Sensitivity | undefined>;
}): Promise<ResistancePhenotype[]> {
  const tested = Object.entries(opts.sensitivity).filter(([, v]) => v);
  if (!opts.organism?.trim() || tested.length === 0) return [];

  const panelText = tested.map(([drug, r]) => `${drug}: ${r}`).join(", ");

  const response = await callAI({
    featureKey: "lab_ast_phenotype",
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    prompt: `You are a clinical microbiology AI. Infer likely antimicrobial resistance phenotypes from
this susceptibility pattern for an Indian hospital.

Organism: ${opts.organism}
Specimen: ${opts.specimenType}
Susceptibility panel: ${panelText}

Consider phenotypes such as: MRSA (oxacillin/cefoxitin resistant Staph aureus), VRE (vancomycin-
resistant Enterococcus), ESBL (3rd-gen cephalosporin resistant but carbapenem-susceptible
Enterobacteriaceae), CRE (carbapenem-resistant Enterobacteriaceae — always escalate), MDR
Pseudomonas/Acinetobacter (resistant to 3+ antibiotic classes).

Return ONLY JSON array (empty if the pattern does not support a specific phenotype call):
[{"phenotype":"ESBL-producing Enterobacteriaceae","confidence":"high","explanation":"Resistant to
ceftriaxone/cefuroxime, susceptible to carbapenems","stewardship_alert":true}]

Set stewardship_alert true only for phenotypes requiring infection-control/antibiotic-stewardship
escalation (MRSA, VRE, ESBL, CRE, MDR organisms).`,
    maxTokens: 350,
  });

  if (response.error || !response.text) return [];
  try {
    const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    const result = Array.isArray(parsed) ? parsed : [];

    (supabase as any).from("ai_feature_logs").insert({
      hospital_id: opts.hospitalId,
      module: "lab",
      feature_key: "lab_ast_phenotype",
      patient_id: opts.patientId,
      input_summary: `${opts.organism}, ${tested.length} drugs tested`,
      output_summary: `${result.length} phenotype(s)`,
      success: true,
    }).then(() => {});

    return result as ResistancePhenotype[];
  } catch {
    return [];
  }
}
