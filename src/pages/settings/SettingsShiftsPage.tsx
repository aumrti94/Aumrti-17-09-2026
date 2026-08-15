/**
 * Shift master — the timings HR rosters, nursing hand-overs and OT lists are all built on.
 *
 * HISTORY: until Phase 2 QA this screen was a local-state mock. It rendered three hardcoded
 * shifts, and "Save" showed a green toast without issuing a single Supabase call — so every
 * shift a hospital defined vanished on reload and `shift_master` stayed empty, silently
 * breaking rostering downstream. Logged as BUG-P2-002 and fixed here.
 *
 * Cross-midnight is the case that matters: a night shift 22:00 → 06:00 is EIGHT hours, not
 * minus sixteen. See durationHours().
 */
import React, { useMemo, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { durationHours } from "@/lib/shiftTiming";

interface ShiftRow {
  id: string;
  shift_name: string;
  shift_code: string;
  start_time: string;
  end_time: string;
  shift_type: string | null;
  color_code: string | null;
  duration_hours: number | null;
  is_active: boolean | null;
}

type ShiftForm = Partial<{
  shift_name: string; shift_code: string; start_time: string;
  end_time: string; color_code: string;
}>;

const BLANK: ShiftForm = { shift_name: "", shift_code: "", start_time: "", end_time: "", color_code: "#3b82f6" };

const SettingsShiftsPage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [editing, setEditing] = useState<string | null>(null);
  const [newShift, setNewShift] = useState(false);
  const [form, setForm] = useState<ShiftForm>({});

  const { data: shifts, isLoading } = useQuery({
    queryKey: ["settings-shifts", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("shift_master")
        .select("id, shift_name, shift_code, start_time, end_time, shift_type, color_code, duration_hours, is_active")
        .eq("hospital_id", hospitalId)
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
    enabled: !!hospitalId,
  });

  const existingCodes = useMemo(
    () => new Set((shifts ?? []).map((s) => s.shift_code?.toUpperCase())),
    [shifts],
  );

  const invalid = (f: ShiftForm, ignoreCode?: string): string | null => {
    if (!f.shift_name?.trim()) return "Shift name is required.";
    if (!f.shift_code?.trim()) return "Shift code is required.";
    if (!f.start_time) return "Start time is required.";
    if (!f.end_time) return "End time is required.";
    if (f.start_time === f.end_time) return "Start and end time cannot be the same — that is a zero-length shift.";
    const code = f.shift_code.trim().toUpperCase();
    if (code !== ignoreCode?.toUpperCase() && existingCodes.has(code)) {
      return `Shift code "${code}" is already in use.`;
    }
    return null;
  };

  const saveShift = useMutation({
    mutationFn: async ({ id, values }: { id: string | null; values: ShiftForm }) => {
      if (!hospitalId) throw new Error("No hospital context.");
      const row = {
        hospital_id: hospitalId,
        shift_name: values.shift_name!.trim(),
        shift_code: values.shift_code!.trim().toUpperCase(),
        start_time: values.start_time!,
        end_time: values.end_time!,
        shift_type: "general",
        color_code: values.color_code ?? "#3b82f6",
        duration_hours: durationHours(values.start_time!, values.end_time!),
      };
      if (id) {
        const { error } = await supabase.from("shift_master").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shift_master").insert({ ...row, is_active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Shift saved" });
      qc.invalidateQueries({ queryKey: ["settings-shifts"] });
      setEditing(null);
      setNewShift(false);
      setForm({});
    },
    onError: (e: Error) => toast({ title: "Could not save shift", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("shift_master").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-shifts"] }),
    onError: (e: Error) => toast({ title: "Could not update shift", description: e.message, variant: "destructive" }),
  });

  const deleteShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_master").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Shift deleted" });
      qc.invalidateQueries({ queryKey: ["settings-shifts"] });
    },
    onError: (e: Error) => toast({ title: "Could not delete shift", description: e.message, variant: "destructive" }),
  });

  const commit = (id: string | null, current?: ShiftRow) => {
    const merged: ShiftForm = {
      shift_name: form.shift_name ?? current?.shift_name,
      shift_code: form.shift_code ?? current?.shift_code,
      start_time: form.start_time ?? current?.start_time,
      end_time: form.end_time ?? current?.end_time,
      color_code: form.color_code ?? current?.color_code ?? "#3b82f6",
    };
    const problem = invalid(merged, current?.shift_code);
    if (problem) {
      toast({ title: "Check the shift details", description: problem, variant: "destructive" });
      return;
    }
    saveShift.mutate({ id, values: merged });
  };

  return (
    <SettingsPageWrapper title="Shifts" hideSave>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Manage hospital shift timings and patterns.</p>
          <Button size="sm" onClick={() => { setNewShift(true); setForm({ ...BLANK }); }} className="gap-1" disabled={newShift}>
            <Plus size={14} /> Add Shift
          </Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Code</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Start</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">End</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Hours</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Colour</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Active</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && (shifts?.length ?? 0) === 0 && !newShift && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No shifts defined yet. Add one so rosters and nursing hand-overs have timings to use.
                </td></tr>
              )}
              {shifts?.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  {editing === s.id ? (
                    <>
                      <td className="px-4 py-2"><Input value={form.shift_name ?? s.shift_name} onChange={(e) => setForm({ ...form, shift_name: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2"><Input value={form.shift_code ?? s.shift_code} onChange={(e) => setForm({ ...form, shift_code: e.target.value })} className="h-8 w-16" /></td>
                      <td className="px-4 py-2"><Input type="time" value={form.start_time ?? s.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2"><Input type="time" value={form.end_time ?? s.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {durationHours(form.start_time ?? s.start_time, form.end_time ?? s.end_time)} h
                      </td>
                      <td className="px-4 py-2"><input type="color" value={form.color_code ?? s.color_code ?? "#3b82f6"} onChange={(e) => setForm({ ...form, color_code: e.target.value })} className="w-8 h-8 rounded cursor-pointer" /></td>
                      <td className="px-4 py-2"><Switch checked={!!s.is_active} disabled /></td>
                      <td className="px-4 py-2 flex gap-1">
                        <Button size="sm" onClick={() => commit(s.id, s)} disabled={saveShift.isPending}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm({}); }}>Cancel</Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-foreground">{s.shift_name}</td>
                      <td className="px-4 py-2.5"><Badge variant="outline">{s.shift_code}</Badge></td>
                      <td className="px-4 py-2.5">{s.start_time}</td>
                      <td className="px-4 py-2.5">{s.end_time}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.duration_hours ?? durationHours(s.start_time, s.end_time)} h</td>
                      <td className="px-4 py-2.5"><div className="w-6 h-6 rounded-full" style={{ background: s.color_code ?? "#3b82f6" }} /></td>
                      <td className="px-4 py-2.5">
                        <Switch checked={!!s.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: s.id, active: v })} />
                      </td>
                      <td className="px-4 py-2.5 flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(s.id); setForm({}); }}><Pencil size={13} /></Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          onClick={() => { if (window.confirm(`Delete shift "${s.shift_name}"? This cannot be undone.`)) deleteShift.mutate(s.id); }}
                        ><Trash2 size={13} /></Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {newShift && (
                <tr className="border-t border-border bg-accent/20">
                  <td className="px-4 py-2"><Input placeholder="Name" value={form.shift_name ?? ""} onChange={(e) => setForm({ ...form, shift_name: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2"><Input placeholder="Code" value={form.shift_code ?? ""} onChange={(e) => setForm({ ...form, shift_code: e.target.value })} className="h-8 w-16" /></td>
                  <td className="px-4 py-2"><Input type="time" value={form.start_time ?? ""} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2"><Input type="time" value={form.end_time ?? ""} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {form.start_time && form.end_time ? `${durationHours(form.start_time, form.end_time)} h` : "—"}
                  </td>
                  <td className="px-4 py-2"><input type="color" value={form.color_code ?? "#3b82f6"} onChange={(e) => setForm({ ...form, color_code: e.target.value })} className="w-8 h-8 rounded cursor-pointer" /></td>
                  <td className="px-4 py-2">—</td>
                  <td className="px-4 py-2 flex gap-1">
                    <Button size="sm" onClick={() => commit(null)} disabled={saveShift.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setNewShift(false); setForm({}); }}>Cancel</Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsShiftsPage;
