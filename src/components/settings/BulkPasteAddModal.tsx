import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BulkPasteColumn {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "number" | "select";
  /** Required when type is "select". */
  options?: { value: string; label: string }[];
}

interface BulkPasteAddModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  columns: BulkPasteColumn[];
  /** Lower-cased existing values (keyed by the first column) used to flag duplicates. */
  existingKeys?: Set<string>;
  onSubmit: (rows: Record<string, string>[]) => Promise<{ error?: string } | void>;
  /** Rows shown when the dialog opens. Defaults to 5. */
  initialRowCount?: number;
}

const blankRow = (columns: BulkPasteColumn[]): Record<string, string> =>
  Object.fromEntries(columns.map(c => [c.key, ""]));

const BulkPasteAddModal: React.FC<BulkPasteAddModalProps> = ({
  open, onOpenChange, title, description, columns, existingKeys, onSubmit, initialRowCount = 5,
}) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<string, string>[]>(() =>
    Array.from({ length: initialRowCount }, () => blankRow(columns))
  );
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setRows(Array.from({ length: initialRowCount }, () => blankRow(columns)));
    setSaving(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const updateCell = (i: number, key: string, val: string) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  };

  const addRow = () => setRows(prev => [...prev, blankRow(columns)]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));

  // A row counts if its first (primary) column has content.
  const primaryKey = columns[0].key;
  const seen = new Set<string>();
  const evaluated = rows.map(r => {
    const primary = (r[primaryKey] || "").trim();
    if (!primary) return { row: r, filled: false, missing: false, duplicate: false };
    const missing = columns.some(c => c.required && !r[c.key]?.trim());
    const dedupeKey = primary.toLowerCase();
    const duplicate = !missing && (seen.has(dedupeKey) || !!existingKeys?.has(dedupeKey));
    if (!missing && !duplicate) seen.add(dedupeKey);
    return { row: r, filled: true, missing, duplicate };
  });

  const validRows = evaluated.filter(e => e.filled && !e.missing && !e.duplicate).map(e => e.row);
  const problemCount = evaluated.filter(e => e.filled && (e.missing || e.duplicate)).length;

  const handleSubmit = async () => {
    if (validRows.length === 0) return;
    setSaving(true);
    try {
      const result = await onSubmit(validRows);
      if (result && "error" in result && result.error) {
        toast({ title: "Failed to add", description: result.error, variant: "destructive" });
      } else {
        toast({ title: `${validRows.length} added ✓` });
        handleClose(false);
        return;
      }
    } catch (e) {
      toast({ title: "Failed to add", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Fill in as many rows as you need, then save them all at once."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border max-h-[22rem] overflow-y-auto">
          <div
            className="grid gap-x-2 items-center px-3 py-1.5 bg-muted/40 border-b border-border sticky top-0"
            style={{ gridTemplateColumns: `${columns.map(() => "1fr").join(" ")} 28px` }}
          >
            {columns.map(col => (
              <span key={col.key} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {col.label}{col.required && <span className="text-destructive"> *</span>}
              </span>
            ))}
            <span />
          </div>

          {evaluated.map((e, i) => (
            <div
              key={i}
              className={cn(
                "grid gap-x-2 items-center px-3 py-1.5 border-b border-border/50 last:border-0",
                (e.missing || e.duplicate) && "bg-destructive/5"
              )}
              style={{ gridTemplateColumns: `${columns.map(() => "1fr").join(" ")} 28px` }}
            >
              {columns.map(col => (
                col.type === "select" ? (
                  <select
                    key={col.key}
                    className="h-8 text-xs rounded-md border border-input bg-background px-2"
                    value={e.row[col.key]}
                    onChange={ev => updateCell(i, col.key, ev.target.value)}
                  >
                    <option value="">{col.placeholder ?? `— ${col.label} —`}</option>
                    {col.options?.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    key={col.key}
                    className="h-8 text-xs"
                    type={col.type === "number" ? "number" : "text"}
                    placeholder={col.placeholder ?? col.label}
                    value={e.row[col.key]}
                    onChange={ev => updateCell(i, col.key, ev.target.value)}
                  />
                )
              ))}
              <button
                onClick={() => removeRow(i)}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Remove row"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5 text-xs w-fit">
          <Plus size={12} /> Add Row
        </Button>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {validRows.length} will be added
            {problemCount > 0 && ` — ${problemCount} row${problemCount === 1 ? "" : "s"} need${problemCount === 1 ? "s" : ""} attention (missing/duplicate)`}
          </span>
          <Button size="sm" onClick={handleSubmit} disabled={saving || validRows.length === 0} className="gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add {validRows.length || ""} {validRows.length === 1 ? "Value" : "Values"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkPasteAddModal;
