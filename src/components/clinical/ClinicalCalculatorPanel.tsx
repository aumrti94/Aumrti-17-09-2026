import { useState, useCallback } from "react";
import { CALCULATORS, CALCULATOR_CATEGORIES, type Calculator, type CalcResult } from "@/lib/clinicalCalculators";
import { useToast } from "@/hooks/use-toast";
import { Calculator as CalcIcon, X, ChevronLeft, Copy, ClipboardPaste, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  /** Called with formatted text when user clicks "Insert to Note" */
  onInsertToNote?: (text: string) => void;
}

export default function ClinicalCalculatorPanel({ onInsertToNote }: Props) {
  const { toast } = useToast();
  const [open, setOpen]               = useState(false);
  const [category, setCategory]       = useState("All");
  const [search, setSearch]           = useState("");
  const [selected, setSelected]       = useState<Calculator | null>(null);
  const [values, setValues]           = useState<Record<string, string>>({});
  const [result, setResult]           = useState<CalcResult | null>(null);

  const filtered = CALCULATORS.filter(c => {
    const matchCat = category === "All" || c.category === category;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const select = (calc: Calculator) => {
    setSelected(calc);
    setValues({});
    setResult(null);
  };

  const back = () => { setSelected(null); setResult(null); setValues({}); };

  const calculate = useCallback(() => {
    if (!selected) return;
    try {
      const r = selected.calculate(values);
      setResult(r);
    } catch {
      toast({ title: "Calculation error — check inputs", variant: "destructive" });
    }
  }, [selected, values, toast]);

  const insertNote = () => {
    if (!result?.noteText) return;
    onInsertToNote?.(result.noteText);
    navigator.clipboard.writeText(result.noteText).catch(() => {});
    toast({ title: "Copied to clipboard", description: result.noteText });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Clinical Calculators (Σ)"
        className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 text-xs font-semibold transition-colors"
      >
        <CalcIcon size={13} />
        <span className="hidden sm:inline">Calculators</span>
        <span className="font-mono text-violet-500">Σ</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[360px] bg-card border-l border-border shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 h-12 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          {selected && (
            <button onClick={back} className="text-muted-foreground hover:text-foreground transition-colors mr-1">
              <ChevronLeft size={16} />
            </button>
          )}
          <CalcIcon size={14} className="text-violet-600" />
          <span className="text-[13px] font-semibold text-foreground">
            {selected ? selected.name : "Clinical Calculators"}
          </span>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Calculator list */}
      {!selected && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Search + category filter */}
          <div className="flex-shrink-0 p-3 space-y-2 border-b border-border">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search calculators…"
                className="h-8 pl-8 text-[12px]"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {CALCULATOR_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                    category === cat
                      ? "bg-violet-600 text-white border-violet-600"
                      : "text-muted-foreground border-border hover:bg-muted/50"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-8">No calculators match.</p>
            ) : filtered.map(calc => (
              <button
                key={calc.id}
                onClick={() => select(calc)}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{calc.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{calc.description}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5 font-medium">
                    {calc.category}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Calculator form */}
      {selected && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex-1 p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">{selected.description}</p>

            {selected.inputs.map(inp => (
              <div key={inp.id}>
                <label className="text-[12px] font-medium text-foreground block mb-1">
                  {inp.label}{inp.unit && <span className="text-muted-foreground font-normal ml-1">({inp.unit})</span>}
                </label>

                {inp.type === "select" ? (
                  <Select
                    value={values[inp.id] || ""}
                    onValueChange={v => setValues(prev => ({ ...prev, [inp.id]: v }))}
                  >
                    <SelectTrigger className="h-9 text-[13px]">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {inp.options?.map(o => (
                        <SelectItem key={o.value} value={o.value} className="text-[13px]">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    value={values[inp.id] || ""}
                    onChange={e => setValues(prev => ({ ...prev, [inp.id]: e.target.value }))}
                    min={inp.min}
                    max={inp.max}
                    step={inp.step || 1}
                    placeholder="Enter value"
                    className="h-9 text-[13px]"
                  />
                )}
              </div>
            ))}

            <Button onClick={calculate} size="sm" className="w-full gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
              <CalcIcon size={13} /> Calculate
            </Button>

            {/* Result */}
            {result && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-violet-600 uppercase tracking-wide">Result</p>
                    <p className="text-[20px] font-bold text-violet-900 leading-tight mt-0.5">{result.score}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(result.score).then(() => toast({ title: "Copied" }))}
                    className="text-violet-400 hover:text-violet-700 transition-colors shrink-0 mt-1"
                    title="Copy result"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="text-[12px] text-violet-800 leading-relaxed">{result.interpretation}</p>
                {result.details && <p className="text-[11px] text-violet-600">{result.details}</p>}

                {onInsertToNote && result.noteText && (
                  <button
                    onClick={insertNote}
                    className="w-full flex items-center justify-center gap-1.5 text-[12px] font-medium text-violet-700 bg-white border border-violet-300 rounded-lg py-1.5 hover:bg-violet-50 transition-colors mt-1"
                  >
                    <ClipboardPaste size={12} /> Insert to Note
                  </button>
                )}
              </div>
            )}

            {selected.reference && (
              <p className="text-[10px] text-muted-foreground">Reference: {selected.reference}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
