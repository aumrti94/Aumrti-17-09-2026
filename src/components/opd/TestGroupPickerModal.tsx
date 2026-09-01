import React, { useEffect, useState } from "react";
import { GripVertical, ArrowUpDown } from "lucide-react";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrderStateChip, type OrderState } from "@/components/opd/tabs/RxOrdersTab";

interface TestGroupPickerModalProps {
  open: boolean;
  title: string;
  feeLabel?: string;
  /** Names in the doctor's saved priority order (new/unranked names appended at the end). */
  items: string[];
  selectedNames: Set<string>;
  /** lowercased name → how far along the money is. Absent = not ordered yet, so the row is
   *  pickable and carries no chip at all (an unordered catalogue row is the normal case; a
   *  PRESCRIBED chip on every unticked test would be noise). */
  orderedNames?: Map<string, OrderState>;
  onClose: () => void;
  onConfirm: (finalSelectedNames: string[]) => void;
  /** Persists the doctor's drag-to-reorder priority for this group. */
  onReorder: (newOrder: string[]) => void;
}

const TestGroupPickerModal: React.FC<TestGroupPickerModalProps> = ({
  open,
  title,
  feeLabel,
  items,
  selectedNames,
  orderedNames,
  onClose,
  onConfirm,
  onReorder,
}) => {
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [mode, setMode] = useState<"select" | "reorder">("select");

  useEffect(() => {
    if (open) {
      setLocal(new Set(selectedNames));
      setOrder(items);
      setMode("select");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title]);

  const toggle = (name: string) => {
    setLocal((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      const next = arrayMove(prev, oldIndex, newIndex);
      onReorder(next);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {title}
            {feeLabel && <span className="text-xs font-normal text-muted-foreground">{feeLabel}</span>}
            <button
              onClick={() => setMode((m) => (m === "select" ? "reorder" : "select"))}
              className={cn(
                "ml-auto mr-6 flex items-center gap-1 text-[11px] font-normal rounded-full px-2 py-0.5 border transition-colors",
                mode === "reorder"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <ArrowUpDown className="h-3 w-3" />
              {mode === "reorder" ? "Done" : "Set priority order"}
            </button>
          </DialogTitle>
        </DialogHeader>

        {mode === "reorder" && (
          <p className="text-xs text-muted-foreground -mt-2">Drag tests to set your priority order for quick access.</p>
        )}

        <div className="flex-1 overflow-y-auto border border-border rounded-md bg-background/50 p-1.5">
          {mode === "select" ? (
            <div className="grid grid-cols-2 gap-1">
              {order.map((name) => {
                const orderState = orderedNames?.get(name.toLowerCase().trim()) ?? null;
                const checked = local.has(name);
                // Either state means a real order row already exists for this encounter, so
                // re-picking it would raise a second order for the same test.
                const alreadyOrdered = orderState !== null;
                return (
                  <label
                    key={name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border border-border/60 cursor-pointer hover:bg-muted/30"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={alreadyOrdered}
                      onCheckedChange={() => toggle(name)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{name}</p>
                      {alreadyOrdered && <OrderStateChip state={orderState} className="text-[10px]" />}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 gap-1">
                  {order.map((name) => (
                    <SortableTestRow key={name} name={name} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {mode === "select" && (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <span className="text-xs text-muted-foreground">{local.size} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={() => onConfirm(Array.from(local))}>Apply</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

const SortableTestRow: React.FC<{ name: string }> = ({ name }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: name });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded border border-border/60 bg-background cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-50 ring-2 ring-primary"
      )}
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <p className="text-sm text-foreground truncate">{name}</p>
    </div>
  );
};

export default TestGroupPickerModal;
