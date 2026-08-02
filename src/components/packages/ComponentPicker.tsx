import React, { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Search, X } from "lucide-react";
import { formatINRExact } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * One option from a priced master (lab_test_master / radiology_study_master / service_master).
 */
export interface PickerOption {
  id: string;
  name: string;
  fee: number;
  /** Secondary line — modality, department, test code. Optional. */
  detail?: string | null;
}

interface Props {
  label: string;
  /** Placeholder shown on the trigger when nothing is picked. */
  placeholder: string;
  options: PickerOption[];
  /** Ids currently selected. Order of selection is preserved by the parent. */
  selectedIds: string[];
  onToggle: (option: PickerOption) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
  /** Shown when the master itself is empty — points the user at the right settings page. */
  emptyHint: string;
}

/**
 * Searchable checkbox dropdown over a priced master, plus the selected lines and their total.
 *
 * Modelled on the day-care procedure picker (DayCareAdmissionModal) rather than a new
 * abstraction: that pattern is already proven in this codebase for exactly this job — bundle
 * several priced items from a master and show what they add up to.
 */
const ComponentPicker: React.FC<Props> = ({
  label, placeholder, options, selectedIds, onToggle, onRemove, loading, emptyHint,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.detail || "").toLowerCase().includes(q)
    );
  }, [options, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(
    () => selectedIds.map((id) => options.find((o) => o.id === id)).filter(Boolean) as PickerOption[],
    [selectedIds, options]
  );
  const subtotal = selected.reduce((s, o) => s + (Number(o.fee) || 0), 0);

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>

      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 border rounded px-2 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors"
          >
            <span className={cn("truncate", selectedIds.length === 0 && "text-muted-foreground")}>
              {selectedIds.length === 0 ? placeholder : `${selectedIds.length} selected`}
            </span>
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
          <div className="relative mb-1">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-7 h-8 text-xs"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {/* overscroll-contain: hitting the end of this list must not scroll the dialog behind it. */}
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {loading && (
              <p className="text-xs text-muted-foreground text-center py-3 px-2">Loading…</p>
            )}
            {!loading && options.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3 px-2">{emptyHint}</p>
            )}
            {/* "you have none configured" and "none match your search" send the user to
                completely different places, so they stay distinct messages. */}
            {!loading && options.length > 0 && visible.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3 px-2">
                Nothing matches “{search.trim()}”.
              </p>
            )}
            {visible.map((o) => {
              const checked = selectedSet.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onToggle(o)}
                  className={cn(
                    "w-full flex items-start gap-2 text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                    checked && "bg-teal-50"
                  )}
                >
                  <Checkbox checked={checked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{o.name}</span>
                    <span className="block text-muted-foreground">
                      {o.detail ? `${o.detail} · ` : ""}{formatINRExact(Number(o.fee) || 0)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="border rounded mt-1">
          <div className="divide-y max-h-32 overflow-y-auto">
            {selected.map((o) => (
              <div key={o.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <span className="flex-1 min-w-0 truncate font-medium">{o.name}</span>
                <span className="w-20 text-right font-mono shrink-0">
                  {formatINRExact(Number(o.fee) || 0)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${o.name}`}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onRemove(o.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-2 py-1 bg-muted/40 text-xs font-medium">
            <span>Subtotal</span>
            <span className="font-mono">{formatINRExact(subtotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComponentPicker;
