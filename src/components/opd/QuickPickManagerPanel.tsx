import React, { useState, useEffect, useMemo } from "react";
import { X, Plus, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  items: string[];
  onSave: (items: string[]) => Promise<void>;
  onReset: () => Promise<void>;
  label: string;
  /**
   * Names from the corresponding master (lab_test_master / radiology_study_master).
   * When supplied the input autocompletes against them and any chip that matches
   * nothing is flagged. Free text is still accepted — a doctor may keep a shortcut
   * for something the master doesn't carry yet.
   */
  suggestions?: string[];
  /** Human name of that master, used in the warning tooltip. */
  suggestionLabel?: string;
}

const MAX_SUGGESTIONS = 8;

const QuickPickManagerPanel: React.FC<Props> = ({
  items,
  onSave,
  onReset,
  label,
  suggestions,
  suggestionLabel = "master",
}) => {
  const [draft, setDraft] = useState<string[]>(items);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    setDraft(items);
  }, [items]);

  // Lower-cased master index. Absent when the caller passes no suggestions, which is
  // what keeps every existing call site (complaints, exam findings, diagnoses)
  // behaving exactly as before — no dropdown, no badges.
  const masterIndex = useMemo(
    () => (suggestions ? new Set(suggestions.map((s) => s.toLowerCase().trim())) : null),
    [suggestions]
  );

  const matches = useMemo(() => {
    if (!suggestions || !input.trim()) return [];
    const q = input.toLowerCase().trim();
    const chosen = new Set(draft.map((d) => d.toLowerCase().trim()));
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !chosen.has(s.toLowerCase().trim()))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, input, draft]);

  const isOffMaster = (name: string) =>
    !!masterIndex && !masterIndex.has(name.toLowerCase().trim());

  const commitSave = async (list: string[]) => {
    setSaving(true);
    try { await onSave(list); } finally { setSaving(false); }
  };

  const addItem = (value?: string) => {
    const v = (value ?? input).trim();
    setShowSuggestions(false);
    if (!v || draft.some((d) => d.toLowerCase().trim() === v.toLowerCase().trim())) {
      setInput("");
      return;
    }
    const next = [...draft, v];
    setDraft(next);
    setInput("");
    commitSave(next);
  };

  const removeItem = (idx: number) => {
    const next = draft.filter((_, i) => i !== idx);
    setDraft(next);
    commitSave(next);
  };

  const handleReset = async () => {
    setResetting(true);
    try { await onReset(); } finally { setResetting(false); }
  };

  const suggestionsOpen = showSuggestions && matches.length > 0;

  return (
    <div className="mt-2 border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-slate-600">Manage {label}</p>

      {draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((item, i) => {
            const offMaster = isOffMaster(item);
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-white border text-slate-700",
                  offMaster ? "border-amber-300" : "border-slate-200"
                )}
              >
                {offMaster && (
                  // An off-master name can't be resolved when the order is committed, so it
                  // is never ordered and never billed. Warn, don't block. The tooltip sits on
                  // a wrapper because lucide icons don't accept a `title` prop.
                  <span
                    className="inline-flex"
                    title={`Not in the ${suggestionLabel} — an order for this won't match and won't be billed`}
                  >
                    <AlertTriangle
                      className="h-3 w-3 text-amber-500 flex-shrink-0"
                      aria-label={`Not in the ${suggestionLabel}`}
                    />
                  </span>
                )}
                {item}
                <button
                  onClick={() => removeItem(i)}
                  disabled={saving}
                  className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setShowSuggestions(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Top match wins when the dropdown is open; otherwise the raw text is
                // added as-is so off-master entries stay possible.
                addItem(suggestionsOpen ? matches[0] : undefined);
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            placeholder={suggestions ? "Search or type a new one, then Enter..." : "Type and press Enter to add..."}
            className="w-full h-8 px-3 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1A2F5A] bg-white"
          />
          {suggestionsOpen && (
            <div className="absolute z-20 left-0 right-0 top-8 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
              {matches.map((name) => (
                <button
                  key={name}
                  // mousedown fires before the input's blur, so the click isn't lost.
                  onMouseDown={(e) => { e.preventDefault(); addItem(name); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => addItem(suggestionsOpen ? matches[0] : undefined)}
          disabled={!input.trim() || saving}
          className="h-8 w-8 flex items-center justify-center bg-[#1A2F5A] text-white rounded-lg disabled:opacity-40 hover:bg-[#152647] transition-colors flex-shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        onClick={handleReset}
        disabled={resetting}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-[#1A2F5A] transition-colors"
      >
        <RotateCcw className={cn("h-3 w-3", resetting && "animate-spin")} />
        Reset to defaults
      </button>
    </div>
  );
};

export default QuickPickManagerPanel;
