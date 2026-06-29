import React from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", label: "Malayalam", native: "മലയാളം" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
];

interface Props {
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
  className?: string;
}

const LanguageSelector: React.FC<Props> = ({ value, onChange, compact, className }) => {
  const selected = SUPPORTED_LANGUAGES.find(l => l.code === value) || SUPPORTED_LANGUAGES[0];

  if (compact) {
    return (
      <div className={cn("relative inline-block", className)}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="appearance-none pl-6 pr-3 py-1 text-xs border rounded-md bg-background cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {SUPPORTED_LANGUAGES.map(l => (
            <option key={l.code} value={l.code}>{l.native} ({l.label})</option>
          ))}
        </select>
        <Globe className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {SUPPORTED_LANGUAGES.map(l => (
        <button
          key={l.code}
          onClick={() => onChange(l.code)}
          className={cn(
            "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
            l.code === value
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:bg-muted"
          )}
        >
          <span>{l.native}</span>
          <span className="ml-1 text-[10px] opacity-70">{l.label}</span>
        </button>
      ))}
    </div>
  );
};

export default LanguageSelector;
