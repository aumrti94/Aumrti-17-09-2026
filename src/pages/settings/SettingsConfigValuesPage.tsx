import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Plus, Pencil, Trash2, RotateCcw, Save, X,
  Loader2, GripVertical, FlaskConical, Pill, Users, Building2,
  HeartPulse, Shield, Clipboard, Package, Activity, Droplets,
  Stethoscope, Home, Wrench, List,
} from "lucide-react";

// ── Category registry ─────────────────────────────────────────────────────────

interface CategoryDef {
  key:   string;
  label: string;
  desc:  string;
  icon:  React.ElementType;
  group: string;
}

const CATEGORIES: CategoryDef[] = [
  // Clinical
  { key: "admission_types",       label: "Admission Types",         desc: "Elective, Emergency, Transfer…",          icon: Stethoscope,  group: "Clinical"      },
  { key: "allergy_types",         label: "Allergy Types",           desc: "Drug, Food, Environmental, Latex, Dye…",  icon: Activity,     group: "Clinical"      },
  { key: "insurance_types",       label: "Insurance / Payer Types", desc: "Self Pay, PMJAY, TPA, CGHS…",             icon: Shield,       group: "Clinical"      },
  { key: "drug_routes",           label: "Drug Routes",             desc: "Oral, IV, IM, SC, Topical…",              icon: Pill,         group: "Clinical"      },
  { key: "drug_frequencies",      label: "Drug Frequencies",        desc: "OD, BD, TDS, QID, SOS…",                 icon: Pill,         group: "Clinical"      },
  { key: "dialysis_complications",label: "Dialysis Complications",  desc: "Hypotension, Cramps, Arrhythmia…",        icon: Droplets,     group: "Clinical"      },
  { key: "death_manner_types",    label: "Death Manner Types",      desc: "Natural, Accidental, Suicide…",           icon: Clipboard,    group: "Clinical"      },
  { key: "record_requester_types",label: "Record Requester Types",  desc: "Patient, Lawyer, Police, Court…",         icon: Clipboard,    group: "Clinical"      },
  { key: "home_care_services",    label: "Home Care Services",      desc: "Wound Dressing, IV Therapy…",             icon: Home,         group: "Clinical"      },
  { key: "physio_modalities",     label: "Physio Modalities",       desc: "UST, IFT, TENS, SWD…",                   icon: Activity,     group: "Clinical"      },

  // HR & Payroll
  { key: "leave_types",           label: "Leave Types",             desc: "Casual, Sick, Earned, Maternity…",        icon: Users,        group: "HR & Payroll"  },
  { key: "attendance_statuses",   label: "Attendance Statuses",     desc: "Present, Absent, Half Day…",              icon: Users,        group: "HR & Payroll"  },

  // Finance & Insurance
  { key: "tpa_companies",         label: "TPA Companies",           desc: "Star Health, New India, HDFC Ergo…",      icon: Shield,       group: "Finance"       },
  { key: "government_schemes",    label: "Government Schemes",      desc: "PMJAY, CGHS, ECHS, ESI, Arogyasri…",     icon: HeartPulse,   group: "Finance"       },
  { key: "claim_denial_categories",label:"Claim Denial Categories", desc: "Docs Missing, Policy Exclusion…",         icon: Shield,       group: "Finance"       },
  { key: "claim_rejection_codes", label: "Claim Rejection Codes",   desc: "Not Medically Necessary, ICD Error…",     icon: Shield,       group: "Finance"       },

  // Diagnostics
  { key: "lab_test_categories",   label: "Lab Test Categories",     desc: "Haematology, Biochemistry, Micro…",       icon: FlaskConical, group: "Diagnostics"   },
  { key: "sample_types",          label: "Sample Types",            desc: "Blood, Urine, Stool, Swab, CSF…",         icon: FlaskConical, group: "Diagnostics"   },

  // Operations
  { key: "housekeeping_task_types",label:"Housekeeping Task Types", desc: "Bed Turnover, OT Cleaning…",              icon: Wrench,       group: "Operations"    },
  { key: "housekeeping_area_types",label:"Housekeeping Area Types", desc: "Ward, OT, ICU, Corridor…",                icon: Building2,    group: "Operations"    },
  { key: "equipment_categories",  label: "Equipment Categories",    desc: "Diagnostic, Therapeutic, Surgical…",      icon: Package,      group: "Operations"    },
  { key: "inventory_categories",  label: "Inventory Categories",    desc: "Surgical, Consumable, Linen…",            icon: Package,      group: "Operations"    },

  // Structure
  { key: "department_types",      label: "Department Types",        desc: "Clinical, Administrative, Support…",      icon: Building2,    group: "Structure"     },
];

const GROUP_ORDER = ["Clinical", "HR & Payroll", "Finance", "Diagnostics", "Operations", "Structure"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConfigRow {
  id:          string;
  hospital_id: string | null;
  value:       string;
  label:       string;
  sort_order:  number;
  is_active:   boolean;
  is_system:   boolean;
  metadata:    Record<string, unknown> | null;
}

// ── Row form (inline add/edit) ────────────────────────────────────────────────

interface RowFormState {
  value:      string;
  label:      string;
  sort_order: string;
}
const EMPTY_FORM: RowFormState = { value: "", label: "", sort_order: "0" };

// ── Main component ────────────────────────────────────────────────────────────

const SettingsConfigValuesPage: React.FC = () => {
  const navigate    = useNavigate();
  const { toast }   = useToast();
  const { hospitalId } = useHospitalId();
  const qc          = useQueryClient();

  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].key);
  const [addOpen,   setAddOpen]   = useState(false);
  const [addForm,   setAddForm]   = useState<RowFormState>(EMPTY_FORM);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [editForm,  setEditForm]  = useState<RowFormState>(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [resetting, setResetting] = useState(false);

  const catDef = CATEGORIES.find(c => c.key === activeCat)!;

  // ── Query: all rows for active category (hospital-specific + system) ────────

  const { data: rows = [], isLoading } = useQuery<ConfigRow[]>({
    queryKey: ["settings-config-values", activeCat, hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await (supabase as any)
        .from("hospital_config_values")
        .select("id, hospital_id, value, label, sort_order, is_active, is_system, metadata")
        .eq("category", activeCat)
        .or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
        .order("sort_order", { ascending: true })
        .order("label",      { ascending: true });
      if (error) throw error;

      // Mark whether the hospital has overridden each system default
      const hospitalValues = new Set<string>(
        (data ?? []).filter((r: ConfigRow) => r.hospital_id !== null).map((r: ConfigRow) => r.value)
      );
      return (data ?? []).map((r: ConfigRow) => ({
        ...r,
        _overridden: r.hospital_id === null && hospitalValues.has(r.value),
      }));
    },
    enabled: !!hospitalId,
    staleTime: 0, // settings page should always be fresh
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["settings-config-values", activeCat] });
    qc.invalidateQueries({ queryKey: ["config-values", activeCat] });
  }, [qc, activeCat]);

  // ── Add ───────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!hospitalId || !addForm.value.trim() || !addForm.label.trim()) {
      toast({ title: "Value and Label are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("hospital_config_values").insert({
      hospital_id: hospitalId,
      category:    activeCat,
      value:       addForm.value.trim().replace(/\s+/g, "_"),
      label:       addForm.label.trim(),
      sort_order:  Number(addForm.sort_order) || 0,
      is_active:   true,
      is_system:   false,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Added ✓" });
      setAddOpen(false);
      setAddForm(EMPTY_FORM);
      invalidate();
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const startEdit = (row: ConfigRow) => {
    setEditId(row.id);
    setEditForm({ value: row.value, label: row.label, sort_order: String(row.sort_order) });
  };

  const handleEdit = async () => {
    if (!editId || !hospitalId) return;
    setSaving(true);
    const row = rows.find(r => r.id === editId);

    if (row?.hospital_id === null) {
      // System default → create a hospital-specific override instead of updating the system row
      const { error } = await (supabase as any).from("hospital_config_values").upsert({
        hospital_id: hospitalId,
        category:    activeCat,
        value:       row.value, // keep value the same — only override label/sort
        label:       editForm.label.trim(),
        sort_order:  Number(editForm.sort_order) || 0,
        is_active:   true,
        is_system:   false,
      }, { onConflict: "hospital_id,category,value" });
      setSaving(false);
      if (error) toast({ title: "Failed to save override", description: error.message, variant: "destructive" });
      else { toast({ title: "Override saved ✓" }); setEditId(null); invalidate(); }
    } else {
      // Hospital-specific row → update it directly
      const { error } = await (supabase as any).from("hospital_config_values")
        .update({ label: editForm.label.trim(), sort_order: Number(editForm.sort_order) || 0 })
        .eq("id", editId);
      setSaving(false);
      if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      else { toast({ title: "Saved ✓" }); setEditId(null); invalidate(); }
    }
  };

  // ── Toggle active ─────────────────────────────────────────────────────────

  const toggleActive = useMutation({
    mutationFn: async ({ row, val }: { row: ConfigRow; val: boolean }) => {
      if (!hospitalId) return;
      if (row.hospital_id === null) {
        // Create override that disables the system row for this hospital
        await (supabase as any).from("hospital_config_values").upsert({
          hospital_id: hospitalId,
          category:    activeCat,
          value:       row.value,
          label:       row.label,
          sort_order:  row.sort_order,
          is_active:   val,
          is_system:   false,
        }, { onConflict: "hospital_id,category,value" });
      } else {
        await (supabase as any).from("hospital_config_values")
          .update({ is_active: val }).eq("id", row.id);
      }
    },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (row: ConfigRow) => {
    if (row.is_system && row.hospital_id === null) {
      toast({ title: "Cannot delete system defaults — disable them instead", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete "${row.label}"?`)) return;
    const { error } = await (supabase as any).from("hospital_config_values").delete().eq("id", row.id);
    if (error) toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted ✓" }); invalidate(); }
  };

  // ── Reset category to system defaults ─────────────────────────────────────

  const handleReset = async () => {
    if (!hospitalId) return;
    if (!confirm(`Reset "${catDef.label}" to system defaults? All your customisations for this category will be deleted.`)) return;
    setResetting(true);
    await (supabase as any).from("hospital_config_values")
      .delete()
      .eq("hospital_id", hospitalId)
      .eq("category", activeCat);
    setResetting(false);
    toast({ title: "Reset to system defaults ✓" });
    invalidate();
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    cats: CATEGORIES.filter(c => c.group === g),
  }));

  // Visible rows: deduplicate so hospital override shows, system default hidden
  const hospitalValues = new Set(rows.filter(r => r.hospital_id !== null).map(r => r.value));
  const visible = rows.filter(r => !(r.hospital_id === null && hospitalValues.has(r.value)));

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0">
        <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <List size={15} className="text-primary" />
          <h1 className="text-sm font-bold">Configurable Dropdowns & Lookup Values</h1>
        </div>
        <span className="text-xs text-muted-foreground ml-1">
          Customise every dropdown in the system for your hospital
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav — categories */}
        <nav className="w-[260px] border-r border-border bg-background overflow-y-auto shrink-0 py-2">
          {grouped.map(({ group, cats }) => (
            <div key={group} className="mb-3">
              <p className="px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {group}
              </p>
              {cats.map(cat => {
                const Icon    = cat.icon;
                const active  = activeCat === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => { setActiveCat(cat.key); setAddOpen(false); setEditId(null); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors border-l-[3px]",
                      active
                        ? "bg-primary/5 text-primary border-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/50 border-transparent"
                    )}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Right panel */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Panel header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold">{catDef.label}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{catDef.desc}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Reset to Defaults
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => { setAddOpen(v => !v); setEditId(null); setAddForm(EMPTY_FORM); }}
              >
                <Plus size={12} />
                Add Value
              </Button>
            </div>
          </div>

          {/* Inline add form */}
          {addOpen && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-semibold text-primary">New Value</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Value (code)</Label>
                  <Input
                    className="mt-1 h-8 text-xs font-mono"
                    placeholder="e.g. my_type"
                    value={addForm.value}
                    onChange={e => setAddForm(f => ({ ...f, value: e.target.value }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Stored in DB — no spaces</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold">Display Label</Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    placeholder="e.g. My Type"
                    value={addForm.label}
                    onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Sort Order</Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    type="number"
                    placeholder="0"
                    value={addForm.sort_order}
                    onChange={e => setAddForm(f => ({ ...f, sort_order: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={saving} className="gap-1.5 text-xs">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)} className="text-xs">
                  <X size={12} className="mr-1" /> Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Values list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[24px_1fr_1fr_80px_80px_100px] gap-x-3 items-center px-3 py-2 bg-muted/40 border-b border-border">
                <span />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Display Label</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Value (code)</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Order</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actions</span>
              </div>

              {visible.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No values configured for this category.
                  <br />
                  <button className="mt-2 text-primary underline text-xs" onClick={() => setAddOpen(true)}>
                    Add the first one
                  </button>
                </div>
              )}

              {visible.map((row, idx) => {
                const isEditing    = editId === row.id;
                const isSystemOnly = row.hospital_id === null;

                return (
                  <div
                    key={row.id}
                    className={cn(
                      "grid grid-cols-[24px_1fr_1fr_80px_80px_100px] gap-x-3 items-center px-3 py-2.5 border-b border-border/50 last:border-0",
                      idx % 2 === 0 ? "bg-background" : "bg-muted/10",
                      !row.is_active && "opacity-50"
                    )}
                  >
                    {/* Drag handle (visual only) */}
                    <GripVertical size={14} className="text-muted-foreground/40" />

                    {/* Label or edit */}
                    {isEditing ? (
                      <Input
                        className="h-7 text-xs"
                        value={editForm.label}
                        onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{row.label}</span>
                        {isSystemOnly && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground border-muted-foreground/30 shrink-0">
                            system
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Value (code) — read-only */}
                    <span className="text-xs font-mono text-muted-foreground truncate">{row.value}</span>

                    {/* Sort order or edit */}
                    {isEditing ? (
                      <Input
                        className="h-7 text-xs w-16"
                        type="number"
                        value={editForm.sort_order}
                        onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground tabular-nums">{row.sort_order}</span>
                    )}

                    {/* Active toggle */}
                    <Switch
                      checked={row.is_active}
                      onCheckedChange={val => toggleActive.mutate({ row, val })}
                      disabled={toggleActive.isPending}
                    />

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            onClick={handleEdit}
                            disabled={saving}
                            className="h-6 w-6 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Save"
                          >
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(row)}
                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={isSystemOnly ? "Override this system value" : "Edit"}
                          >
                            <Pencil size={12} />
                          </button>
                          {!isSystemOnly && (
                            <button
                              onClick={() => handleDelete(row)}
                              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1">
            <span className="flex items-center gap-1">
              <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground border-muted-foreground/30">system</Badge>
              System default — click ✏ to create a hospital override
            </span>
            <span>• Custom values you add are hospital-specific</span>
            <span>• Toggle the switch to hide a value from dropdowns</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsConfigValuesPage;
