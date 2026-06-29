import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

export type AIFeature =
  | "clinical_note"
  | "discharge_summary"
  | "differential_dx"
  | "icd_suggest"
  | "radiology_impression"
  | "voice_dictation"
  | "executive_digest";

const DEFAULTS: Record<AIFeature, boolean> = {
  clinical_note: true,
  discharge_summary: true,
  differential_dx: true,
  icd_suggest: true,
  radiology_impression: true,
  voice_dictation: true,
  executive_digest: true,
};

let cachedFlags: Record<string, boolean> | null = null;
let cacheHospitalId: string | null = null;

export function useAIFeatureFlag(feature: AIFeature): boolean {
  const { hospitalId } = useHospitalId();
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS[feature]);

  useEffect(() => {
    if (!hospitalId) return;

    if (cachedFlags && cacheHospitalId === hospitalId) {
      setEnabled(cachedFlags[feature] ?? DEFAULTS[feature]);
      return;
    }

    (async () => {
      const { data } = await supabase
        .from("hospitals")
        .select("ai_feature_flags")
        .eq("id", hospitalId)
        .maybeSingle();

      const flags = (data?.ai_feature_flags as Record<string, boolean>) ?? {};
      cachedFlags = flags;
      cacheHospitalId = hospitalId;
      setEnabled(flags[feature] ?? DEFAULTS[feature]);
    })();
  }, [hospitalId, feature]);

  return enabled;
}

// Invalidate the module-level cache when settings are saved
export function invalidateAIFlagCache() {
  cachedFlags = null;
  cacheHospitalId = null;
}
