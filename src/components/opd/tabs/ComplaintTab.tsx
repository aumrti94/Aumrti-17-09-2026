import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import type { EncounterData } from "../ConsultationWorkspace";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";

interface Props {
  encounter: EncounterData;
  onChange: (partial: Partial<EncounterData>) => void;
}

const DURATIONS = [
  "Today", "2-3 days", "1 week", "2 weeks", "1 month",
  "3 months", "6 months", "1 year", "More than 1 year",
];

const ONSETS = ["Sudden", "Gradual", "Insidious"];

const SkeletonChips = () => (
  <div className="flex flex-wrap gap-1.5">
    {Array.from({ length: 6 }).map((_, i) => (
      <span key={i} className="h-7 w-20 rounded-full bg-muted animate-pulse inline-block" />
    ))}
  </div>
);

const ComplaintTab: React.FC<Props> = ({ encounter, onChange }) => {
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [showManager, setShowManager] = useState(false);
  const { items: complaints, isLoading, save, reset } = useDoctorQuickPicks<string>("complaints");

  const toggleChip = useCallback((chip: string) => {
    const next = new Set(selectedChips);
    if (next.has(chip)) {
      next.delete(chip);
    } else {
      next.add(chip);
      const current = encounter.chief_complaint;
      onChange({ chief_complaint: current + (current ? ", " : "") + chip });
    }
    setSelectedChips(next);
  }, [selectedChips, encounter.chief_complaint, onChange]);

  // Duration is stored as a "Duration: X" line inside the HPI text (no dedicated column),
  // so it never clobbers the voice/AI-filled history paragraph.
  const durationMatch = encounter.history_of_present_illness.match(/^Duration:\s*(.+?)(?:\n|$)/);
  const currentDuration = durationMatch && DURATIONS.includes(durationMatch[1].trim()) ? durationMatch[1].trim() : "";

  const setDuration = (value: string) => {
    const withoutDuration = encounter.history_of_present_illness
      .replace(/^Duration:\s*.*(?:\n|$)/, "")
      .replace(/^\n/, "");
    const next = value
      ? `Duration: ${value}${withoutDuration ? "\n" + withoutDuration : ""}`
      : withoutDuration;
    onChange({ history_of_present_illness: next });
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Chief complaint */}
      <div>
        <label className="text-xs font-bold text-slate-700 mb-1.5 block">Chief Complaint *</label>
        <textarea
          value={encounter.chief_complaint}
          onChange={(e) => onChange({ chief_complaint: e.target.value })}
          placeholder="Patient's main complaint in their own words..."
          className="w-full min-h-[100px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
        />
      </div>

      {/* History of Present Illness */}
      <div>
        <label className="text-xs font-bold text-slate-700 mb-1.5 block">History of Present Illness</label>
        <textarea
          value={encounter.history_of_present_illness}
          onChange={(e) => onChange({ history_of_present_illness: e.target.value })}
          placeholder="History of present illness — onset, progression, aggravating/relieving factors..."
          className="w-full min-h-[80px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
        />
      </div>

      {/* Duration + Onset */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-slate-700 mb-1 block">Duration</label>
          <select
            value={currentDuration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm outline-none"
          >
            <option value="">Select...</option>
            {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-700 mb-1 block">Onset</label>
          <select
            value={encounter.soap_subjective}
            onChange={(e) => onChange({ soap_subjective: e.target.value })}
            className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm outline-none"
          >
            <option value="">Select...</option>
            {ONSETS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {/* Quick chips */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Quick add</span>
          <button
            onClick={() => setShowManager(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-[#1A2F5A] transition-colors"
          >
            <Pencil className="h-3 w-3" />
            {showManager ? "Done" : "Manage"}
          </button>
        </div>

        {isLoading ? (
          <SkeletonChips />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {complaints.map((c) => (
              <button
                key={c}
                onClick={() => toggleChip(c)}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border transition-colors",
                  selectedChips.has(c)
                    ? "bg-blue-50 border-[#1A2F5A] text-[#1A2F5A]"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {showManager && !isLoading && (
          <QuickPickManagerPanel
            items={complaints}
            onSave={save}
            onReset={reset}
            label="complaint chips"
          />
        )}
      </div>
    </div>
  );
};

export default ComplaintTab;
