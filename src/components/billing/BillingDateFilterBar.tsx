import React from "react";
import { cn } from "@/lib/utils";
import { CalendarDays, RotateCcw } from "lucide-react";
import {
  BILLING_DATE_PRESETS,
  describeBillingDateRange,
  resolveBillingDateRange,
  type BillingDatePreset,
} from "@/lib/billingDateRange";

interface Props {
  preset: BillingDatePreset;
  startDate: string;
  endDate: string;
  onPresetChange: (p: BillingDatePreset) => void;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  /** Shown muted on the right, e.g. "24 bills · ₹1,20,000". */
  summary?: React.ReactNode;
  /** Set when a tab ignores the range (search mode, pending inbox) so the bar can say so. */
  inactiveNote?: string;
}

/**
 * One date range for the whole Billing page. Presets cover the common single-day and
 * rolling-window cases; Custom takes an explicit From/To. Leaving To blank means that
 * single From day, so "just this one date" needs no extra mode.
 */
const BillingDateFilterBar: React.FC<Props> = ({
  preset, startDate, endDate,
  onPresetChange, onStartDateChange, onEndDateChange,
  summary, inactiveNote,
}) => {
  const range = resolveBillingDateRange(preset, startDate, endDate);
  const isCustom = preset === "custom";

  return (
    <div className={cn(
      "flex-shrink-0 flex items-center flex-wrap gap-x-3 gap-y-2 px-4 py-2 border-b border-border bg-muted/30",
      inactiveNote && "opacity-60",
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        <CalendarDays size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Period</span>
      </div>

      {/* Wraps for the same reason as the bill queue's copy — six presets overflow a narrow
          viewport, and the labels are nowrap, so the last one would be clipped mid-word. */}
      <div className="flex items-center flex-wrap gap-x-1 gap-y-1">
        {BILLING_DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPresetChange(p.key)}
            aria-pressed={preset === p.key}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap border transition-colors active:scale-[0.97]",
              preset === p.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => onStartDateChange(e.target.value)}
            aria-label="From date"
            className="text-[11px] border border-border rounded px-1.5 py-1 bg-card text-foreground focus:border-primary focus:outline-none"
          />
          <span className="text-[11px] text-muted-foreground">to</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            aria-label="To date (leave blank for a single day)"
            className="text-[11px] border border-border rounded px-1.5 py-1 bg-card text-foreground focus:border-primary focus:outline-none"
          />
          {endDate && (
            <button
              onClick={() => onEndDateChange("")}
              title="Clear the To date to show that single day only"
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      )}

      <span className="text-[11px] text-muted-foreground">
        {inactiveNote || `Showing ${describeBillingDateRange(range)}`}
      </span>

      {summary && <div className="ml-auto text-[11px] text-muted-foreground">{summary}</div>}
    </div>
  );
};

export default BillingDateFilterBar;
