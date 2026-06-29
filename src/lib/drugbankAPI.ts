import { supabase } from "@/integrations/supabase/client";
import type { DrugInteraction } from "./drugSafetyCheck";

/**
 * Query DrugBank DDI API via edge function proxy.
 * Returns DrugInteraction[] compatible with local format, or null on failure.
 */
export async function checkDrugBankDDI(
  newDrug: string,
  existingDrug: string,
  hospitalId: string
): Promise<DrugInteraction[] | null> {
  try {
    const { data, error } = await supabase.functions.invoke("check-drugbank-ddi", {
      body: { drug_a: newDrug, drug_b: existingDrug, hospital_id: hospitalId },
    });
    if (error || !data?.interactions) return null;
    return data.interactions as DrugInteraction[];
  } catch {
    return null;
  }
}
