import React from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  allergies: string | null | undefined;
  onAddAllergy?: () => void;
}

const AllergyBanner: React.FC<Props> = ({ allergies, onAddAllergy }) => {
  const allergyList = allergies
    ? allergies.split(",").map((a) => a.trim()).filter(Boolean)
    : [];

  if (allergyList.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-muted/50 flex-shrink-0">
        <span className="text-xs text-muted-foreground">No known allergies recorded</span>
        {onAddAllergy && (
          <button onClick={onAddAllergy} className="text-xs text-primary hover:underline">
            + Add Allergy
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3.5 py-2.5 mb-3 rounded-lg border-[1.5px] border-destructive bg-destructive/5 flex-shrink-0">
      <AlertTriangle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-wide text-destructive">
          Known Allergies
        </span>
        <div className="flex flex-wrap gap-1 mt-1">
          {allergyList.map((a, i) => (
            <span
              key={i}
              className="inline-block text-xs font-bold text-destructive bg-destructive/10 rounded-full px-2.5 py-0.5"
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AllergyBanner;
