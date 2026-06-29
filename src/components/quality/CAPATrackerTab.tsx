import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CAPA {
  id: string;
  capa_number: string;
  trigger_type: string;
  trigger_ref_id: string | null;
  problem_statement: string;
  why_1: string | null;
  why_2: string | null;
  why_3: string | null;
  why_4: string | null;
  why_5: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  responsible_person: string | null;
  due_date: string | null;
  completed_date: string | null;
  verification_by: string | null;
  verified_date: string | null;
  effectiveness_check: string | null;
  status: string;
  created_at: string;
}

const columns = [
  { key: "open", label: "Open", color: "border-red-400" },
  { key: "in_progress", label: "In Progress", color: "border-amber-400" },
  { key: "completed", label: "Completed", color: "border-blue-400" },
  { key: "verified", label: "Verified & Closed", color: "border-green-400" },
];

const triggerTypes = ["incident", "audit_finding", "complaint", "near_miss", "nabh_gap", "other"];

const CAPATrackerTab: React.FC = () => {
  const { toast } = useToast();
  const [capas, setCAPAs] = useState<CAPA[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<CAPA | null>(null);
  const [verifyOpen, setVerifyOpen] = useState<CAPA | null>(null);
  const [effectivenessCheck, setEffectivenessCheck] = useState("");
  const [dragItem, setDragItem] = useState<string | null>(null);

  // New CAPA form
  const [form, setForm] = useState({
    trigger_type: "incident",
    problem_statement: "",
    why_1: "", why_2: "", why_3: "", why_4: "", why_5: "",
    root_cause: "",
    corrective_action: "",
    preventive_action: "",
    due_date: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCAPAs(); }, []);

  const loadCAPAs = async () => {
    const { data } = await supabase.from("capa_records").select("*").order("created_at", { ascending: false });
    setCAPAs((data as any) || []);
    setLoading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    const updates: any = { status };
    if (status === "completed") updates.completed_date = new Date().toISOString().split("T")[0];
    if (status === "verified" || status === "closed") updates.verified_date = new Date().toISOString().split("T")[0];
    await supabase.from("capa_records").update(updates).eq("id", id);
    loadCAPAs();
  };

  const handleDrop = (targetStatus: string) => {
    if (!dragItem) return;
    const capa = capas.find((c) => c.id === dragItem);
    if (!capa || capa.status === targetStatus) { setDragItem(null); return; }

    // Allow only valid transitions
    const order = ["open", "in_progress", "completed", "verified"];
    const fromIdx = order.indexOf(capa.status);
    const toIdx = order.indexOf(targetStatus);
    if (toIdx < fromIdx) { setDragItem(null); return; }

    if (targetStatus === "verified") {
      setVerifyOpen(capa);
      setDragItem(null);
      return;
    }

    updateStatus(dragItem, targetStatus);
    setDragItem(null);
  };

  const handleVerify = async () => {
    if (!verifyOpen) return;
    await supabase.from("capa_records").update({
      status: "verified",
      verified_date: new Date().toISOString().split("T")[0],
      effectiveness_check: effectivenessCheck,
    }).eq("id", verifyOpen.id);
    toast({ title: "CAPA verified & closed" });
    setVerifyOpen(null);
    setEffectivenessCheck("");
    loadCAPAs();
  };

  const handleSaveNew = async () => {
    if (!form.problem_statement.trim()) {
      toast({ title: "Problem statement required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) { toast({ title: "Not authenticated", variant: "destructive" }); setSaving(false); return; }
      const { data: userProfile } = await supabase.from("users").select("hospital_id").eq("auth_user_id", userId).maybeSingle();
      if (!userProfile) { toast({ title: "User profile not found", variant: "destructive" }); setSaving(false); return; }

      const capaNumber = `CAPA-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const rootCause = form.root_cause || form.why_5 || form.why_4 || form.why_3 || form.why_2 || form.why_1 || "";

      await supabase.from("capa_records").insert({
        hospital_id: userProfile.hospital_id,
        capa_number: capaNumber,
        trigger_type: form.trigger_type,
        problem_statement: form.problem_statement,
        why_1: form.why_1 || null,
        why_2: form.why_2 || null,
        why_3: form.why_3 || null,
        why_4: form.why_4 || null,
        why_5: form.why_5 || null,
        root_cause: rootCause || null,
        corrective_action: form.corrective_action || null,
        preventive_action: form.preventive_action || null,
        due_date: form.due_date || null,
      });

      toast({ title: "CAPA created", description: capaNumber });
      setFormOpen(false);
      setForm({ trigger_type: "incident", problem_statement: "", why_1: "", why_2: "", why_3: "", why_4: "", why_5: "", root_cause: "", corrective_action: "", preventive_action: "", due_date: "" });
      loadCAPAs();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const getDueDateColor = (due: string | null) => {
    if (!due) return "";
    const diff = (new Date(due).getTime() - Date.now()) / 86400000;
    if (diff < 0) return "text-destructive font-semibold";
    if (diff < 7) return "text-amber-600 dark:text-amber-400 font-medium";
    return "text-muted-foreground";
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CAPA Board</h3>
        <Button size="sm" onClick={() => setFormOpen(true)}>+ New CAPA</Button>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
        {columns.map((col) => {
          const items = capas.filter((c) => {
            if (col.key === "verified") return c.status === "verified" || c.status === "closed";
            return c.status === col.key;
          });
          return (
            <div
              key={col.key}
              className={cn("flex-1 min-w-[220px] flex flex-col rounded-lg border-t-[3px] bg-muted/20", col.color)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.key)}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{col.label}</span>
                <Badge variant="secondary" className="text-[9px]">{items.length}</Badge>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {items.map((capa) => (
                  <div
                    key={capa.id}
                    draggable
                    onDragStart={() => setDragItem(capa.id)}
                    onClick={() => setDetailOpen(capa)}
                    className="bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-mono font-semibold text-foreground">{capa.capa_number}</span>
                      <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{capa.trigger_type.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-[11px] text-foreground line-clamp-2 mb-1.5">{capa.problem_statement}</p>
                    {capa.due_date && (
                      <span className={cn("text-[9px]", getDueDateColor(capa.due_date))}>
                        Due: {new Date(capa.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-center py-6 text-[10px] text-muted-foreground">No items</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New CAPA Slide-over */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm">New CAPA</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-xs">Trigger Type</Label>
              <Select value={form.trigger_type} onValueChange={(v) => setForm({ ...form, trigger_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {triggerTypes.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Problem Statement *</Label>
              <Textarea value={form.problem_statement} onChange={(e) => setForm({ ...form, problem_statement: e.target.value })} className="mt-1 text-xs" rows={3} />
            </div>

            {/* 5-Why */}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">5-Why Analysis</p>
              <div>
                <Label className="text-[10px] text-muted-foreground">Why 1: Why did the problem occur?</Label>
                <Textarea value={form.why_1} onChange={(e) => setForm({ ...form, why_1: e.target.value })} className="mt-0.5 text-xs" rows={2} />
              </div>
              {form.why_1 && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Why 2: Why did that happen?</Label>
                  <Textarea value={form.why_2} onChange={(e) => setForm({ ...form, why_2: e.target.value })} className="mt-0.5 text-xs" rows={2} />
                </div>
              )}
              {form.why_2 && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Why 3: And why did that happen?</Label>
                  <Textarea value={form.why_3} onChange={(e) => setForm({ ...form, why_3: e.target.value })} className="mt-0.5 text-xs" rows={2} />
                </div>
              )}
              {form.why_3 && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Why 4 (optional)</Label>
                  <Textarea value={form.why_4} onChange={(e) => setForm({ ...form, why_4: e.target.value })} className="mt-0.5 text-xs" rows={2} />
                </div>
              )}
              {form.why_4 && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Why 5 (optional)</Label>
                  <Textarea value={form.why_5} onChange={(e) => setForm({ ...form, why_5: e.target.value })} className="mt-0.5 text-xs" rows={2} />
                </div>
              )}
              <div>
                <Label className="text-[10px] text-muted-foreground">Root Cause</Label>
                <Textarea
                  value={form.root_cause || form.why_5 || form.why_4 || form.why_3 || form.why_2 || form.why_1}
                  onChange={(e) => setForm({ ...form, root_cause: e.target.value })}
                  className="mt-0.5 text-xs"
                  rows={2}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Corrective Action</Label>
              <Textarea value={form.corrective_action} onChange={(e) => setForm({ ...form, corrective_action: e.target.value })} className="mt-1 text-xs" rows={2} placeholder="What will fix this specific occurrence?" />
            </div>

            <div>
              <Label className="text-xs">Preventive Action</Label>
              <Textarea value={form.preventive_action} onChange={(e) => setForm({ ...form, preventive_action: e.target.value })} className="mt-1 text-xs" rows={2} placeholder="What will prevent recurrence?" />
            </div>

            <div>
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1" />
            </div>

            <Button onClick={handleSaveNew} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save CAPA"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* CAPA Detail Dialog */}
      <Dialog open={!!detailOpen} onOpenChange={() => setDetailOpen(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">{detailOpen?.capa_number}</DialogTitle>
          </DialogHeader>
          {detailOpen && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-[10px]">Trigger</Label><p className="font-medium capitalize">{detailOpen.trigger_type.replace(/_/g, " ")}</p></div>
                <div><Label className="text-[10px]">Status</Label><p className="font-medium capitalize">{detailOpen.status.replace(/_/g, " ")}</p></div>
                <div><Label className="text-[10px]">Due Date</Label><p className={cn("font-medium", getDueDateColor(detailOpen.due_date))}>{detailOpen.due_date ? new Date(detailOpen.due_date).toLocaleDateString() : "—"}</p></div>
              </div>

              <div><Label className="text-[10px]">Problem</Label><p className="mt-0.5 bg-muted/30 rounded p-2">{detailOpen.problem_statement}</p></div>

              {[detailOpen.why_1, detailOpen.why_2, detailOpen.why_3, detailOpen.why_4, detailOpen.why_5].some(Boolean) && (
                <div>
                  <Label className="text-[10px]">5-Why Analysis</Label>
                  <div className="mt-1 space-y-1">
                    {[detailOpen.why_1, detailOpen.why_2, detailOpen.why_3, detailOpen.why_4, detailOpen.why_5]
                      .map((w, i) => w ? <p key={i} className="text-muted-foreground">Why {i + 1}: {w}</p> : null)}
                  </div>
                </div>
              )}

              {detailOpen.root_cause && <div><Label className="text-[10px]">Root Cause</Label><p className="mt-0.5 bg-muted/30 rounded p-2">{detailOpen.root_cause}</p></div>}
              {detailOpen.corrective_action && <div><Label className="text-[10px]">Corrective Action</Label><p className="mt-0.5">{detailOpen.corrective_action}</p></div>}
              {detailOpen.preventive_action && <div><Label className="text-[10px]">Preventive Action</Label><p className="mt-0.5">{detailOpen.preventive_action}</p></div>}
              {detailOpen.effectiveness_check && <div><Label className="text-[10px]">Effectiveness Check</Label><p className="mt-0.5">{detailOpen.effectiveness_check}</p></div>}

              <div className="flex gap-2 pt-2 border-t border-border">
                {detailOpen.status === "open" && <Button size="sm" onClick={() => { updateStatus(detailOpen.id, "in_progress"); setDetailOpen(null); }}>Start Work</Button>}
                {detailOpen.status === "in_progress" && <Button size="sm" onClick={() => { updateStatus(detailOpen.id, "completed"); setDetailOpen(null); }}>Mark Complete</Button>}
                {detailOpen.status === "completed" && <Button size="sm" onClick={() => { setVerifyOpen(detailOpen); setDetailOpen(null); }}>Verify & Close</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Verification Dialog */}
      <Dialog open={!!verifyOpen} onOpenChange={() => setVerifyOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Verify CAPA: {verifyOpen?.capa_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Effectiveness Check</Label>
              <Textarea value={effectivenessCheck} onChange={(e) => setEffectivenessCheck(e.target.value)} className="mt-1 text-xs" rows={3} placeholder="Was root cause addressed? What evidence confirms effectiveness?" />
            </div>
            <Button onClick={handleVerify} className="w-full" size="sm">Verify & Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CAPATrackerTab;
