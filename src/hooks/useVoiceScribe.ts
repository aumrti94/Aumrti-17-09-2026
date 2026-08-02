import { createContext, useContext } from "react";
import type { VoiceScribeContextType } from "@/contexts/VoiceScribeContext";

/**
 * Split out of VoiceScribeContext.tsx so that file exports only components — a
 * file mixing component and non-component exports silently disables Fast
 * Refresh for it.
 *
 * The VoiceScribeContextType import above is type-only and therefore erased at
 * build time, so this does not create a runtime import cycle with the provider.
 */
export const VoiceScribeContext = createContext<VoiceScribeContextType | null>(null);

export const useVoiceScribe = () => {
  const ctx = useContext(VoiceScribeContext);
  if (!ctx) throw new Error("useVoiceScribe must be used inside VoiceScribeProvider");
  return ctx;
};
