/**
 * Clinical protocols — the standard treatment pathways nursing and duty doctors follow, and
 * the ones a NABH assessor asks to see evidence of.
 *
 * HISTORY: until Phase 2 QA this screen was a local-state mock. It listed five hardcoded
 * protocols and "Save Protocol" showed a green toast without a single Supabase call, so
 * `clinical_protocols` stayed empty and every protocol a hospital wrote vanished on reload.
 * A protocol nobody can retrieve is a protocol nobody follows. Logged as BUG-P2-005, fixed here.
 */
import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

interface ProtocolRow {
  id: string;
  protocol_name: string;
  category: string | null;
  description: string | null;
  steps: unknown;
  is_active: boolean | null;
}

interface ProtocolForm {
  name: string;
  category: string;
  desc: string;
  steps: string[];
}

const BLANK: ProtocolForm = { name: "", category: "", desc: "", steps: [""] };

/** `steps` is jsonb, so anything could be in there. Render defensively. */
function stepsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s));
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [raw];
    } catch {
      return [raw];
    }
  }
  return [];
}

const SettingsProtocolsPage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [showPanel, setShowPanel] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProtocolForm>(BLANK);

  const { data: protocols, isLoading } = useQuery({
    queryKey: ["settings-protocols", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("clinical_protocols")
        .select("id, protocol_name, category, description, steps, is_active")
        .eq("hospital_id", hospitalId)
        .order("protocol_name");
      if (error) throw error;
      return (data ?? []) as ProtocolRow[];
    },
    enabled: !!hospitalId,
  });

  const openEdit = (p: ProtocolRow) => {
    setEditId(p.id);
    const steps = stepsOf(p.steps);
    setForm({
      name: p.protocol_name,
      category: p.category ?? "",
      desc: p.description ?? "",
      steps: steps.length ? steps : [""],
    });
    setShowPanel(true);
  };

  const saveProtocol = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital context.");
      const steps = form.steps.map((s) => s.trim()).filter(Boolean);
      const row = {
        hospital_id: hospitalId,
        protocol_name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.desc.trim() || null,
        steps,
      };
      if (editId) {
        const { error } = await supabase.from("clinical_protocols").update(row).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clinical_protocols").insert({ ...row, is_active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Protocol saved" });
      qc.invalidateQueries({ queryKey: ["settings-protocols"] });
      setShowPanel(false);
      setEditId(null);
      setForm(BLANK);
    },
    onError: (e: Error) =>
      toast({ title: "Could not save protocol", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("clinical_protocols").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-protocols"] }),
    onError: (e: Error) =>
      toast({ title: "Could not update protocol", description: e.message, variant: "destructive" }),
  });

  const attemptSave = () => {
    if (!form.name.trim()) {
      toast({ title: "Protocol name is required", variant: "destructive" });
      return;
    }
    if (form.steps.every((s) => !s.trim())) {
      toast({
        title: "Add at least one step",
        description: "A protocol with no steps tells the ward nothing.",
        variant: "destructive",
      });
      return;
    }
    saveProtocol.mutate();
  };

  return (
    <SettingsPageWrapper title="Clinical Protocols" hideSave>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Standard treatment protocols and emergency procedures.</p>
          <Button size="sm" onClick={() => { setEditId(null); setForm({ ...BLANK, steps: [""] }); setShowPanel(true); }} className="gap-1">
            <Plus size={14} /> Add Protocol
          </Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Protocol Name</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Steps</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Active</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr></thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && (protocols?.length ?? 0) === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No protocols defined yet. Add the ones your wards actually follow — sepsis, code blue, fall prevention.
                </td></tr>
              )}
              {protocols?.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.protocol_name}</td>
                  <td className="px-4 py-2.5">{p.category ? <Badge variant="outline">{p.category}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{stepsOf(p.steps).length} steps</td>
                  <td className="px-4 py-2.5">
                    <Switch checked={!!p.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: p.id, active: v })} />
                  </td>
                  <td className="px-4 py-2.5"><Button variant="ghost" size="sm" onClick={() => openEdit(p)}>View/Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={showPanel} onOpenChange={setShowPanel}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader><SheetTitle>{editId ? "Edit" : "Add"} Protocol</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" /></div>
            <div><Label>Description</Label><Textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} className="mt-1" rows={2} /></div>
            <div>
              <Label>Steps</Label>
              {form.steps.map((s, i) => (
                <div key={i} className="flex gap-2 mt-1.5">
                  <span className="text-xs text-muted-foreground mt-2.5 w-5">{i + 1}.</span>
                  <Input value={s} onChange={(e) => { const n = [...form.steps]; n[i] = e.target.value; setForm({ ...form, steps: n }); }} className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={() => setForm({ ...form, steps: [...form.steps, ""] })}><Plus size={12} /> Add Step</Button>
            </div>
            <Button onClick={attemptSave} className="w-full" disabled={saveProtocol.isPending}>
              {saveProtocol.isPending ? "Saving…" : "Save Protocol"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </SettingsPageWrapper>
  );
};

export default SettingsProtocolsPage;
