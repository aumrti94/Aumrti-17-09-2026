import React, { useState, useEffect, useRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { X, Search } from "lucide-react";
import { ICD10_DATA, PROCEDURE_DATA } from "@/lib/icd10Data";

// ── Types ──────────────────────────────────────────────────────────────────

interface CodeEntry {
  code: string;
  desc: string;
}

interface CodeSearchInputProps {
  data: CodeEntry[];
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
  maxDisplay?: number;
  className?: string;
}

// ── Generic engine ─────────────────────────────────────────────────────────

const CodeSearchInput: React.FC<CodeSearchInputProps> = ({
  data,
  value,
  onChange,
  placeholder = "Search by code or description…",
  maxDisplay = 20,
  className,
}) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return data
      .filter(
        (item) =>
          !value.includes(item.code) &&
          (item.code.toLowerCase().startsWith(q) || item.desc.toLowerCase().includes(q))
      )
      .slice(0, maxDisplay);
  }, [query, value, data, maxDisplay]);

  const select = (item: CodeEntry) => {
    onChange([...value, item.code]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (code: string) => onChange(value.filter((c) => c !== code));

  const showEmpty = open && query.trim().length >= 2 && filtered.length === 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap gap-1 min-h-9 rounded-md border border-input bg-background px-2 py-1.5 cursor-text transition-colors",
          open ? "ring-2 ring-ring ring-offset-background ring-offset-2" : "hover:border-ring/50"
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Selected code badges */}
        {value.map((code) => (
          <Badge key={code} variant="secondary" className="text-xs gap-1 pr-1 font-mono h-5 leading-none">
            {code}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(code); }}
              className="ml-0.5 hover:text-destructive transition-colors"
            >
              <X size={9} />
            </button>
          </Badge>
        ))}

        {/* Search input */}
        <span className="inline-flex items-center flex-1 min-w-[120px] gap-1">
          <Search size={11} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => { if (query.trim()) setOpen(true); }}
            placeholder={value.length === 0 ? placeholder : "Add more…"}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </span>
      </div>

      {/* Results dropdown */}
      {(open && filtered.length > 0) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-64 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(item)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-baseline gap-2 transition-colors"
            >
              <span className="font-mono text-xs font-bold text-primary shrink-0">{item.code}</span>
              <span className="text-muted-foreground text-xs truncate">— {item.desc}</span>
            </button>
          ))}
        </div>
      )}

      {showEmpty && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md px-3 py-2 text-xs text-muted-foreground">
          No codes found for "<span className="font-medium text-foreground">{query}</span>"
        </div>
      )}
    </div>
  );
};

// ── ICD-10 dataset (top ~500 — Indian hospital context) ────────────────────

// ── Common procedure / CPT codes for Indian hospitals ─────────────────────

// ── ICD-10 Search export ───────────────────────────────────────────────────

interface ICD10SearchProps {
  value: string[];
  onChange: (codes: string[]) => void;
  className?: string;
}

const ICD10Search: React.FC<ICD10SearchProps> = ({ value, onChange, className }) => (
  <CodeSearchInput
    data={ICD10_DATA}
    value={value}
    onChange={onChange}
    placeholder="Search ICD-10 code or diagnosis…"
    className={className}
  />
);

// ── Procedure Code Search export ──────────────────────────────────────────

interface ProcedureCodeSearchProps {
  value: string[];
  onChange: (codes: string[]) => void;
  className?: string;
}

export const ProcedureCodeSearch: React.FC<ProcedureCodeSearchProps> = ({ value, onChange, className }) => (
  <CodeSearchInput
    data={PROCEDURE_DATA}
    value={value}
    onChange={onChange}
    placeholder="Search CPT / procedure code…"
    className={className}
  />
);

export default ICD10Search;
