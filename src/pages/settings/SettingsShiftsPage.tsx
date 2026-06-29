import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Shift {
  id: string; name: string; code: string; start: string; end: string; type: string; color: string; active: boolean;
}

const defaultShifts: Shift[] = [
  { id: "1", name: "Morning", code: "M", start: "07:00", end: "14:00", type: "general", color: "#22c55e", active: true },
  { id: "2", name: "Afternoon", code: "A", start: "14:00", end: "21:00", type: "general", color: "#3b82f6", active: true },
  { id: "3", name: "Night", code: "N", start: "21:00", end: "07:00", type: "general", color: "#6366f1", active: true },
];

const SettingsShiftsPage: React.FC = () => {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>(defaultShifts);
  const [editing, setEditing] = useState<string | null>(null);
  const [newShift, setNewShift] = useState(false);
  const [form, setForm] = useState<Partial<Shift>>({});

  const handleSave = () => {
    if (editing) {
      setShifts(shifts.map((s) => (s.id === editing ? { ...s, ...form } as Shift : s)));
      setEditing(null);
    } else if (newShift) {
      setShifts([...shifts, { ...form, id: Date.now().toString(), active: true } as Shift]);
      setNewShift(false);
    }
    setForm({});
    toast({ title: "Shift saved" });
  };

  return (
    <SettingsPageWrapper title="Shifts" hideSave>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Manage hospital shift timings and patterns.</p>
          <Button size="sm" onClick={() => { setNewShift(true); setForm({}); }} className="gap-1"><Plus size={14} /> Add Shift</Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Code</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Start</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">End</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Colour</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Active</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  {editing === s.id ? (
                    <>
                      <td className="px-4 py-2"><Input value={form.name ?? s.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2"><Input value={form.code ?? s.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="h-8 w-16" /></td>
                      <td className="px-4 py-2"><Input type="time" value={form.start ?? s.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2"><Input type="time" value={form.end ?? s.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="h-8" /></td>
                      <td className="px-4 py-2"><input type="color" value={form.color ?? s.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-8 h-8 rounded cursor-pointer" /></td>
                      <td className="px-4 py-2"><Switch checked={s.active} /></td>
                      <td className="px-4 py-2"><Button size="sm" onClick={handleSave}>Save</Button></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                      <td className="px-4 py-2.5"><Badge variant="outline">{s.code}</Badge></td>
                      <td className="px-4 py-2.5">{s.start}</td>
                      <td className="px-4 py-2.5">{s.end}</td>
                      <td className="px-4 py-2.5"><div className="w-6 h-6 rounded-full" style={{ background: s.color }} /></td>
                      <td className="px-4 py-2.5"><Switch checked={s.active} onCheckedChange={(v) => setShifts(shifts.map((sh) => sh.id === s.id ? { ...sh, active: v } : sh))} /></td>
                      <td className="px-4 py-2.5 flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(s.id); setForm(s); }}><Pencil size={13} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setShifts(shifts.filter((sh) => sh.id !== s.id))}><Trash2 size={13} /></Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {newShift && (
                <tr className="border-t border-border bg-accent/20">
                  <td className="px-4 py-2"><Input placeholder="Name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2"><Input placeholder="Code" value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} className="h-8 w-16" /></td>
                  <td className="px-4 py-2"><Input type="time" value={form.start ?? ""} onChange={(e) => setForm({ ...form, start: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2"><Input type="time" value={form.end ?? ""} onChange={(e) => setForm({ ...form, end: e.target.value })} className="h-8" /></td>
                  <td className="px-4 py-2"><input type="color" value={form.color ?? "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-8 h-8 rounded cursor-pointer" /></td>
                  <td className="px-4 py-2">—</td>
                  <td className="px-4 py-2 flex gap-1">
                    <Button size="sm" onClick={handleSave}>Save</Button>
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
