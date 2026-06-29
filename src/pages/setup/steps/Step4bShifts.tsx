import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Clock } from "lucide-react";

interface Shift {
  name: string;
  code: string;
  start: string;
  end: string;
  color: string;
}

interface Props {
  hospitalId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const defaultShifts: Shift[] = [
  { name: "Morning", code: "M", start: "06:00", end: "14:00", color: "#10B981" },
  { name: "Evening", code: "E", start: "14:00", end: "22:00", color: "#F59E0B" },
  { name: "Night",   code: "N", start: "22:00", end: "06:00", color: "#6366F1" },
];

const Step4bShifts: React.FC<Props> = ({ hospitalId, onComplete, onSkip }) => {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>(defaultShifts);
  const [saving, setSaving] = useState(false);

  const update = (i: number, field: keyof Shift, val: string) => {
    setShifts((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  };

  const addRow = () => {
    if (shifts.length >= 6) return;
    setShifts((prev) => [...prev, { name: "", code: "", start: "08:00", end: "16:00", color: "#64748B" }]);
  };

  const removeRow = (i: number) => {
    if (shifts.length <= 1) return;
    setShifts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    const valid = shifts.filter((s) => s.name.trim() && s.code.trim() && s.start && s.end);
    if (valid.length === 0) {
      toast({ title: "Add at least one shift", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Delete existing shifts for this hospital then re-insert
      await supabase.from("shift_master").delete().eq("hospital_id", hospitalId);
      const { error } = await supabase.from("shift_master").insert(
        valid.map((s) => ({
          hospital_id: hospitalId,
          shift_name: s.name.trim(),
          shift_code: s.code.trim().toUpperCase().slice(0, 3),
          start_time: s.start.length === 5 ? s.start + ":00" : s.start,
          end_time: s.end.length === 5 ? s.end + ":00" : s.end,
          color_code: s.color,
          is_active: true,
        }))
      );
      if (error) throw error;
      toast({ title: "Shifts saved!" });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed to save shifts", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Clock size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 4 · Shifts</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Set up hospital shifts</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Define your duty shift timings. Staff attendance and handovers will use these.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-[13px] text-blue-700 mb-6">
        These defaults match Indian hospital practice — just confirm or adjust timings as needed.
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs border-b border-border">
                <th className="pb-2 pr-3 font-medium">Shift Name</th>
                <th className="pb-2 pr-3 font-medium">Code</th>
                <th className="pb-2 pr-3 font-medium">Start Time</th>
                <th className="pb-2 pr-3 font-medium">End Time</th>
                <th className="pb-2 pr-3 font-medium">Color</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-3">
                    <Input
                      value={s.name}
                      onChange={(e) => update(i, "name", e.target.value)}
                      placeholder="e.g. Morning"
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-20">
                    <Input
                      value={s.code}
                      onChange={(e) => update(i, "code", e.target.value.slice(0, 3).toUpperCase())}
                      placeholder="M"
                      className="h-8 text-sm text-center"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-32">
                    <input
                      type="time"
                      value={s.start}
                      onChange={(e) => update(i, "start", e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-32">
                    <input
                      type="time"
                      value={s.end}
                      onChange={(e) => update(i, "end", e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="py-2.5 pr-3 w-16">
                    <input
                      type="color"
                      value={s.color}
                      onChange={(e) => update(i, "color", e.target.value)}
                      className="h-8 w-10 rounded cursor-pointer border border-input"
                    />
                  </td>
                  <td className="py-2.5 w-8">
                    <button
                      onClick={() => removeRow(i)}
                      disabled={shifts.length <= 1}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {shifts.length < 6 && (
          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Plus size={15} /> Add another shift
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mt-8">
        <button
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for now →
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step4bShifts;
