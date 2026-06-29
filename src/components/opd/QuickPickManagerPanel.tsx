import React, { useState, useEffect } from "react";
import { X, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  items: string[];
  onSave: (items: string[]) => Promise<void>;
  onReset: () => Promise<void>;
  label: string;
}

const QuickPickManagerPanel: React.FC<Props> = ({ items, onSave, onReset, label }) => {
  const [draft, setDraft] = useState<string[]>(items);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setDraft(items);
  }, [items]);

  const commitSave = async (list: string[]) => {
    setSaving(true);
    try { await onSave(list); } finally { setSaving(false); }
  };

  const addItem = () => {
    const v = input.trim();
    if (!v || draft.includes(v)) { setInput(""); return; }
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

  return (
    <div className="mt-2 border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-slate-600">Manage {label}</p>

      {draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-700"
            >
              {item}
              <button
                onClick={() => removeItem(i)}
                disabled={saving}
                className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          placeholder="Type and press Enter to add..."
          className="flex-1 h-8 px-3 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1A2F5A] bg-white"
        />
        <button
          onClick={addItem}
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
