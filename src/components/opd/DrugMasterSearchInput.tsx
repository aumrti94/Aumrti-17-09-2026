import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";

export interface DrugSearchRow {
  drug_name: string;
  generic_name: string | null;
  is_ndps: boolean;
  routes?: string[] | null;
  category?: string | null;
  schedule_type?: string | null;
}

interface Props {
  value: string;
  hospitalId: string | null;
  /** Free-typed text (drug name not necessarily from the master). */
  onChange: (text: string) => void;
  /** A drug picked from the Drug Master dropdown. */
  onSelect: (drug: DrugSearchRow) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
}

/**
 * Drug-name input that autocompletes from the hospital's Drug Master
 * (drug_master table). Self-contained: owns its debounced search + dropdown so
 * it can be dropped anywhere a drug name is entered (Add Drug, Rx templates, …).
 */
const DrugMasterSearchInput: React.FC<Props> = ({
  value, hospitalId, onChange, onSelect,
  placeholder = "Search drug name…", className = "", inputClassName = "", autoFocus,
}) => {
  const [results, setResults] = useState<DrugSearchRow[]>([]);
  const [open, setOpen] = useState(false);
  // Suppress the dropdown for the value we just picked (so selecting doesn't
  // immediately re-open the list with the exact same drug).
  const justPickedRef = useRef<string | null>(null);
  const debounced = useDebounce(value, 250);

  useEffect(() => {
    if (!open) { setResults([]); return; }
    if (justPickedRef.current && justPickedRef.current === debounced) { setResults([]); return; }
    if (!debounced || debounced.trim().length < 2 || !hospitalId) { setResults([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("drug_master")
        .select("drug_name, generic_name, is_ndps, routes, category, schedule_type")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`drug_name.ilike.%${debounced}%,generic_name.ilike.%${debounced}%`)
        .limit(10);
      if (!cancelled) setResults((data as DrugSearchRow[]) || []);
    })();
    return () => { cancelled = true; };
  }, [debounced, hospitalId, open]);

  const pick = (r: DrugSearchRow) => {
    justPickedRef.current = r.drug_name;
    onSelect(r);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => { justPickedRef.current = null; onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b border-border/50 last:border-b-0"
            >
              <span className="font-medium text-foreground">{r.drug_name}</span>
              {r.schedule_type && (
                <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded font-bold ${
                  r.schedule_type === "H" || r.schedule_type === "H1"
                    ? "bg-amber-100 text-amber-700"
                    : r.schedule_type === "X"
                    ? "bg-red-100 text-red-700"
                    : "bg-muted text-muted-foreground"
                }`}>Sch {r.schedule_type}</span>
              )}
              <div className="text-muted-foreground text-xs mt-0.5">
                {r.generic_name && <span>{r.generic_name}</span>}
                {r.routes && r.routes.length > 0 && (
                  <span className="ml-2 text-muted-foreground/70">· {r.routes.join("/")} </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DrugMasterSearchInput;
