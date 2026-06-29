import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Check, Pencil, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";

interface Step { name: string; role: string; required: boolean; timeLimit: number; }
interface Workflow { id: string; name: string; builtin: boolean; steps: Step[]; }

const BUILTIN: Workflow[] = [
  {
    id: "simple", name: "Simple Cash", builtin: true,
    steps: [
      { name: "Clinical Clearance", role: "Doctor", required: true, timeLimit: 30 },
      { name: "Billing Settlement", role: "Billing Executive", required: true, timeLimit: 60 },
    ],
  },
  {
    id: "standard", name: "Standard", builtin: true,
    steps: [
      { name: "Clinical Clearance", role: "Doctor", required: true, timeLimit: 30 },
      { name: "Pharmacy Clearance", role: "Pharmacist", required: true, timeLimit: 20 },
      { name: "Billing Settlement", role: "Billing Executive", required: true, timeLimit: 60 },
      { name: "Nursing Clearance", role: "Nurse", required: true, timeLimit: 15 },
    ],
  },
  {
    id: "insurance", name: "Insurance", builtin: true,
    steps: [
      { name: "Clinical Clearance", role: "Doctor", required: true, timeLimit: 30 },
      { name: "Pharmacy Clearance", role: "Pharmacist", required: true, timeLimit: 20 },
      { name: "Insurance Pre-approval", role: "Insurance Coordinator", required: true, timeLimit: 120 },
      { name: "Billing Settlement", role: "Billing Executive", required: true, timeLimit: 60 },
      { name: "TPA Final Clearance", role: "Insurance Coordinator", required: true, timeLimit: 60 },
      { name: "Nursing Clearance", role: "Nurse", required: true, timeLimit: 15 },
    ],
  },
];

const roles = [
  "Doctor", "Nurse", "Pharmacist", "Billing Executive",
  "Insurance Coordinator", "OT Technician", "Lab Technician",
  "Radiology Technician", "Admin",
];

const newId = () => `custom_${Date.now()}`;

const SettingsDischargeWorkflowPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);

  // All custom workflows stored in DB
  const [customWorkflows, setCustomWorkflows] = useState<Workflow[]>([]);
  // Which workflow ID is currently "active" (the hospital's discharge workflow)
  const [activeId, setActiveId] = useState<string>("standard");
  // Which workflow is selected for editing in the editor panel
  const [selectedId, setSelectedId] = useState<string>("standard");
  // Editor draft steps
  const [draftSteps, setDraftSteps] = useState<Step[]>(BUILTIN[1].steps);
  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // New workflow creation
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const allWorkflows: Workflow[] = [...BUILTIN, ...customWorkflows];
  const selected = allWorkflows.find((w) => w.id === selectedId) || BUILTIN[1];

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("hospitals")
      .select("discharge_workflow, discharge_workflow_presets")
      .eq("id", hospitalId)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.discharge_workflow_presets) {
          const presets = data.discharge_workflow_presets as Workflow[];
          setCustomWorkflows(presets);
        }
        if (data?.discharge_workflow) {
          // Find which workflow matches the saved steps (by ID stored alongside)
          const saved = data.discharge_workflow as any;
          if (saved?.id) {
            setActiveId(saved.id);
            setSelectedId(saved.id);
            const match = [...BUILTIN, ...(data.discharge_workflow_presets as Workflow[] || [])].find((w) => w.id === saved.id);
            if (match) setDraftSteps(match.steps);
          } else if (Array.isArray(saved)) {
            // Legacy: plain Step[] — keep as-is on standard
            setDraftSteps(saved);
          }
        }
      });
  }, [hospitalId]);

  // When user selects a different workflow to edit, load its steps into editor
  const handleSelectWorkflow = (wf: Workflow) => {
    setSelectedId(wf.id);
    setDraftSteps([...wf.steps.map((s) => ({ ...s }))]);
  };

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);

    // Persist editor steps back into the workflow (custom only; builtin stays immutable in code)
    let updatedCustom = customWorkflows;
    if (!selected.builtin) {
      updatedCustom = customWorkflows.map((w) => w.id === selectedId ? { ...w, steps: draftSteps } : w);
      setCustomWorkflows(updatedCustom);
    }

    // Save active workflow steps + id to discharge_workflow, and updated custom list
    await (supabase as any).from("hospitals").update({
      discharge_workflow: { id: selectedId, steps: draftSteps } as any,
      discharge_workflow_presets: updatedCustom as any,
    } as any).eq("id", hospitalId);

    setActiveId(selectedId);
    toast({ title: "Discharge workflow saved", description: `"${selected.name}" is now the active workflow` });
    setSaving(false);
  };

  const handleCreateNew = async () => {
    const name = newName.trim();
    if (!name || !hospitalId) return;
    const wf: Workflow = { id: newId(), name, builtin: false, steps: [] };
    const updated = [...customWorkflows, wf];
    setCustomWorkflows(updated);
    await (supabase as any).from("hospitals").update({ discharge_workflow_presets: updated as any } as any).eq("id", hospitalId);
    setCreatingNew(false);
    setNewName("");
    handleSelectWorkflow(wf);
    toast({ title: `Workflow "${name}" created` });
  };

  const handleDeleteCustom = async (id: string, name: string) => {
    if (!hospitalId) return;
    const updated = customWorkflows.filter((w) => w.id !== id);
    setCustomWorkflows(updated);
    await (supabase as any).from("hospitals").update({ discharge_workflow_presets: updated as any } as any).eq("id", hospitalId);
    if (selectedId === id) handleSelectWorkflow(BUILTIN[1]);
    if (activeId === id) setActiveId("standard");
    toast({ title: `"${name}" deleted` });
  };

  const handleRenameConfirm = async (id: string) => {
    const name = renameValue.trim();
    if (!name || !hospitalId) return;
    const updated = customWorkflows.map((w) => w.id === id ? { ...w, name } : w);
    setCustomWorkflows(updated);
    await (supabase as any).from("hospitals").update({ discharge_workflow_presets: updated as any } as any).eq("id", hospitalId);
    setRenamingId(null);
    setRenameValue("");
  };

  const updateStep = (i: number, patch: Partial<Step>) => {
    setDraftSteps((prev) => prev.map((s, j) => j === i ? { ...s, ...patch } : s));
  };

  return (
    <SettingsPageWrapper title="Discharge Workflow" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-5">
        Each hospital can have a unique workflow. Select a built-in preset or create your own custom workflow.
      </p>

      <div className="flex gap-6">
        {/* LEFT: Workflow list */}
        <div className="w-56 flex-shrink-0">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Built-in</p>
          <div className="space-y-1 mb-4">
            {BUILTIN.map((wf) => (
              <button
                key={wf.id}
                onClick={() => handleSelectWorkflow(wf)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors border",
                  selectedId === wf.id
                    ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                    : "bg-card border-border hover:bg-muted text-foreground"
                )}
              >
                <span>{wf.name}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-muted-foreground">{wf.steps.length} steps</span>
                  {activeId === wf.id && <Check size={12} className="text-emerald-500" />}
                </div>
              </button>
            ))}
          </div>

          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Custom</p>
          <div className="space-y-1 mb-3">
            {customWorkflows.length === 0 && (
              <p className="text-[11px] text-muted-foreground px-1 italic">No custom workflows yet</p>
            )}
            {customWorkflows.map((wf) => (
              <div
                key={wf.id}
                className={cn(
                  "rounded-lg border transition-colors",
                  selectedId === wf.id ? "bg-primary/10 border-primary/30" : "bg-card border-border hover:bg-muted"
                )}
              >
                {renamingId === wf.id ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm(wf.id); if (e.key === "Escape") setRenamingId(null); }}
                      className="h-6 text-xs flex-1 px-1"
                    />
                    <button onClick={() => handleRenameConfirm(wf.id)} className="text-emerald-600 hover:text-emerald-700"><Check size={12} /></button>
                    <button onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleSelectWorkflow(wf)}
                    className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-1"
                  >
                    <span className={cn("flex-1 truncate", selectedId === wf.id ? "text-primary font-semibold" : "text-foreground")}>{wf.name}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{wf.steps.length} steps</span>
                    {activeId === wf.id && <Check size={12} className="text-emerald-500 flex-shrink-0" />}
                  </button>
                )}
                {renamingId !== wf.id && (
                  <div className="flex items-center gap-1 px-2 pb-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingId(wf.id); setRenameValue(wf.name); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                    ><Pencil size={10} /> Rename</button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCustom(wf.id, wf.name); }}
                      className="text-[10px] text-destructive hover:text-destructive/80 flex items-center gap-0.5"
                    ><Trash2 size={10} /> Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Create new workflow */}
          {creatingNew ? (
            <div className="space-y-1.5">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateNew(); if (e.key === "Escape") { setCreatingNew(false); setNewName(""); } }}
                placeholder="Workflow name…"
                className="h-8 text-sm"
              />
              <div className="flex gap-1">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleCreateNew} disabled={!newName.trim()}>Create</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setCreatingNew(false); setNewName(""); }}><X size={12} /></Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={() => setCreatingNew(true)}>
              <Plus size={13} /> New Custom Workflow
            </Button>
          )}
        </div>

        {/* RIGHT: Steps editor */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-bold text-foreground">
              {selected.builtin ? `${selected.name} (read-only preset)` : selected.name}
            </p>
            {selected.builtin && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">built-in</span>
            )}
            {activeId === selected.id && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold ml-auto">✓ Active</span>
            )}
          </div>

          {selected.builtin ? (
            /* Built-in: read-only view */
            <div className="space-y-2">
              {selected.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3 bg-muted/50 border border-border rounded-lg px-3 py-2.5 opacity-75">
                  <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <span className="flex-1 text-sm text-foreground">{step.name}</span>
                  <span className="text-xs text-muted-foreground w-40">{step.role}</span>
                  <span className="text-xs text-muted-foreground w-16">{step.timeLimit} min</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded", step.required ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-500")}>
                    {step.required ? "required" : "optional"}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                Built-in presets cannot be edited. Create a custom workflow to make changes.
              </p>
              {activeId !== selected.id && (
                <Button size="sm" className="mt-1 gap-1" onClick={handleSave} disabled={saving}>
                  <Check size={13} /> Set as Active Workflow
                </Button>
              )}
            </div>
          ) : (
            /* Custom: editable */
            <>
              <div className="space-y-2">
                {draftSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2.5">
                    <GripVertical size={14} className="text-muted-foreground cursor-grab flex-shrink-0" />
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <Input
                      value={step.name}
                      onChange={(e) => updateStep(i, { name: e.target.value })}
                      placeholder="Step name"
                      className="flex-1 h-8"
                    />
                    <Select value={step.role} onValueChange={(v) => updateStep(i, { role: v })}>
                      <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Input
                        type="number"
                        value={step.timeLimit}
                        onChange={(e) => updateStep(i, { timeLimit: +e.target.value })}
                        className="w-16 h-8"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                    <Switch
                      checked={step.required}
                      onCheckedChange={(v) => updateStep(i, { required: v })}
                    />
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive flex-shrink-0"
                      onClick={() => setDraftSteps(draftSteps.filter((_, j) => j !== i))}
                    ><Trash2 size={13} /></Button>
                  </div>
                ))}
                {draftSteps.length === 0 && (
                  <div className="border border-dashed border-border rounded-lg py-8 text-center text-sm text-muted-foreground">
                    No steps yet — click "Add Step" to begin building your workflow
                  </div>
                )}
              </div>
              <Button
                variant="outline" size="sm" className="mt-3 gap-1"
                onClick={() => setDraftSteps([...draftSteps, { name: "", role: "Doctor", required: true, timeLimit: 30 }])}
              >
                <Plus size={14} /> Add Step
              </Button>
              {activeId !== selected.id && (
                <p className="text-[11px] text-amber-600 mt-3">
                  Click "Save Changes" above to save edits and set this as the active workflow.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsDischargeWorkflowPage;
