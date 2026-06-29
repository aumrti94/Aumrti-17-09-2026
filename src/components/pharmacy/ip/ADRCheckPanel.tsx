import React, { useState, useEffect } from "react";
import { callAI } from "@/lib/aiProvider";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Interaction {
  drug1: string;
  drug2: string;
  type: string;
  effect: string;
  recommendation: string;
}

interface ADRResult {
  has_interaction: boolean;
  severity: string;
  interactions: Interaction[];
  allergy_conflict: boolean;
  safe_to_dispense: boolean;
}

interface Props {
  drugName: string;
  drugDose: string;
  currentMedications: { drug_name: string; dose: string }[];
  patientAllergies: string[];
  hospitalId: string;
  onAcknowledged: () => void;
  onBlock: () => void;
}

const ADRCheckPanel: React.FC<Props> = ({
  drugName, drugDose, currentMedications, patientAllergies, hospitalId, onAcknowledged, onBlock,
}) => {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ADRResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!currentMedications?.length) {
        setResult({ has_interaction: false, severity: "none", interactions: [], allergy_conflict: false, safe_to_dispense: true });
        setLoading(false);
        return;
      }
      try {
        const response = await callAI({
          featureKey: "voice_scribe",
          hospitalId,
          prompt: `Check for adverse drug reactions and interactions.
    
NEW DRUG BEING DISPENSED: ${drugName} ${drugDose}

CURRENT MEDICATIONS:
${currentMedications.map(m => `${m.drug_name} ${m.dose}`).join("\n")}

KNOWN ALLERGIES: ${patientAllergies?.join(", ") || "None recorded"}

Check for:
1. Drug-drug interactions
2. Drug-allergy conflicts  
3. Contraindications

Return ONLY JSON:
{
  "has_interaction": true,
  "severity": "moderate",
  "interactions": [
    {
      "drug1": "Warfarin",
      "drug2": "Aspirin",
      "type": "pharmacodynamic",
      "effect": "Increased bleeding risk",
      "recommendation": "Monitor INR closely. Consider alternative."
    }
  ],
  "allergy_conflict": false,
  "safe_to_dispense": true
}`,
          maxTokens: 300,
        });
        const parsed = JSON.parse(
          response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
        );
        setResult(parsed);
      } catch {
        setResult(null);
      }
      setLoading(false);
    };
    check();
  }, [drugName, drugDose, currentMedications, patientAllergies, hospitalId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md text-xs text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Checking drug interactions…
      </div>
    );
  }

  if (!result || !result.has_interaction) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-700">
        <CheckCircle2 size={14} /> No interactions detected
      </div>
    );
  }

  const isMajor = result.severity === "major" || result.severity === "contraindicated";
  const isModerate = result.severity === "moderate";

  if (isMajor && !acknowledged) {
    return (
      <div className="border-2 border-destructive rounded-lg bg-destructive/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-destructive" />
          <span className="text-sm font-bold text-destructive uppercase">Major Drug Interaction Detected</span>
        </div>
        {result.interactions.map((inter, i) => (
          <div key={i} className="bg-card rounded p-2 border border-destructive/20 text-xs space-y-1">
            <p className="font-bold text-foreground">{inter.drug1} + {inter.drug2}</p>
            <p className="text-destructive">{inter.effect}</p>
            <p className="text-muted-foreground">💡 {inter.recommendation}</p>
          </div>
        ))}
        {result.allergy_conflict && (
          <p className="text-xs text-destructive font-bold">⚠️ Allergy conflict detected!</p>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="destructive" size="sm" className="text-xs" onClick={onBlock}>
            Change Drug
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowOverride(true)}>
            Override with Reason
          </Button>
        </div>
        {showOverride && (
          <div className="space-y-2 pt-1">
            <Textarea
              placeholder="Clinical justification for override (required)…"
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              className="h-16 text-xs"
            />
            <Button
              size="sm"
              className="text-xs"
              disabled={overrideReason.trim().length < 10}
              onClick={() => { setAcknowledged(true); onAcknowledged(); }}
            >
              Confirm Override
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isModerate && !acknowledged) {
    return (
      <div className="border border-amber-300 rounded-lg bg-amber-50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-600" />
          <span className="text-xs font-bold text-amber-700 uppercase">Moderate Drug Interaction</span>
        </div>
        {result.interactions.map((inter, i) => (
          <div key={i} className="text-xs space-y-0.5">
            <p className="font-semibold text-foreground">{inter.drug1} + {inter.drug2}: {inter.effect}</p>
            <p className="text-muted-foreground">💡 {inter.recommendation}</p>
          </div>
        ))}
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            onChange={e => { if (e.target.checked) { setAcknowledged(true); onAcknowledged(); } }}
            className="rounded"
          />
          <span className="text-amber-700 font-medium">I acknowledge this interaction and confirm dispensing</span>
        </label>
      </div>
    );
  }

  // Minor or acknowledged
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-600">
      <AlertTriangle size={14} /> Minor interaction noted — {result.interactions[0]?.effect || "proceed with caution"}
      {!acknowledged && (
        <button onClick={() => { setAcknowledged(true); onAcknowledged(); }} className="underline text-amber-700 font-medium ml-1">OK</button>
      )}
    </div>
  );
};

export default ADRCheckPanel;
