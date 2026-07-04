import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, Pencil, Layers, X, Upload, HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";
import BulkLabTestImportModal from "@/components/settings/BulkLabTestImportModal";
import { useConfigValues } from "@/hooks/useConfigValues";

const SettingsLabTestsPage: React.FC = () => {
  const { toast } = useToast();
  const labCategoryOptions = useConfigValues("lab_test_categories");
  const { hospitalId } = useHospitalId();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"tests" | "groups">("tests");
  const [showBulkImport, setShowBulkImport] = useState(false);

  // --- Test state ---
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const blankForm = { test_name: "", test_code: "", category: "Haematology", sample_type: "Blood", unit: "", normal_min: "", normal_max: "", critical_low: "", critical_high: "", method: "", male_normal_min: "", male_normal_max: "", female_normal_min: "", female_normal_max: "", tat_minutes: "120", fee: "0" };
  const [form, setForm] = useState(blankForm);
  const showGenderRanges = form.test_name.toLowerCase().includes("haemoglobin") || form.test_name.toLowerCase().includes("hemoglobin") || form.test_name.toLowerCase().includes("hb") || form.test_name.toLowerCase().includes("rbc") || form.test_name.toLowerCase().includes("hematocrit") || form.test_name.toLowerCase().includes("haematocrit") || form.male_normal_min || form.male_normal_max || form.female_normal_min || form.female_normal_max;

  // --- Group state ---
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const blankGroup = { group_name: "", group_code: "", category: "Haematology", fee: "0", tat_minutes: "60" };
  const [groupForm, setGroupForm] = useState(blankGroup);
  const [groupTestSearch, setGroupTestSearch] = useState("");
  const [selectedGroupTestIds, setSelectedGroupTestIds] = useState<string[]>([]);

  // --- Queries ---
  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["settings-lab-tests", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("lab_test_master")
        .select("id, test_name, test_code, category, sample_type, unit, normal_min, normal_max, critical_low, critical_high, method, male_normal_min, male_normal_max, female_normal_min, female_normal_max, tat_minutes, is_active, fee")
        .eq("hospital_id", hospitalId)
        .order("test_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!hospitalId,
  });

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["settings-lab-groups", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await (supabase as any)
        .from("lab_test_groups")
        .select("id, group_name, group_code, category, fee, tat_minutes, is_active, lab_test_group_items(test_id, lab_test_master:test_id(test_name, test_code))")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .order("group_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!hospitalId,
  });

  // --- Test mutations ---
  const filtered = tests.filter((t: any) => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.test_name?.toLowerCase().includes(q) || t.test_code?.toLowerCase().includes(q);
    const matchCat = category === "all" || t.category === category;
    return matchSearch && matchCat;
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lab_test_master").insert({
        hospital_id: hospitalId!,
        test_name: form.test_name,
        test_code: form.test_code,
        category: form.category,
        sample_type: form.sample_type,
        unit: form.unit || null,
        normal_min: form.normal_min ? Number(form.normal_min) : null,
        normal_max: form.normal_max ? Number(form.normal_max) : null,
        critical_low: form.critical_low ? Number(form.critical_low) : null,
        critical_high: form.critical_high ? Number(form.critical_high) : null,
        method: form.method || null,
        male_normal_min: form.male_normal_min ? Number(form.male_normal_min) : null,
        male_normal_max: form.male_normal_max ? Number(form.male_normal_max) : null,
        female_normal_min: form.female_normal_min ? Number(form.female_normal_min) : null,
        female_normal_max: form.female_normal_max ? Number(form.female_normal_max) : null,
        tat_minutes: form.tat_minutes ? Number(form.tat_minutes) : null,
        fee: form.fee ? Number(form.fee) : 0,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-lab-tests"] });
      setShowAdd(false);
      setForm(blankForm);
      toast({ title: "Test added" });
    },
    onError: (err: any) => toast({ title: "Failed to add test", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lab_test_master").update({
        test_name: form.test_name,
        test_code: form.test_code,
        category: form.category,
        sample_type: form.sample_type,
        unit: form.unit || null,
        normal_min: form.normal_min ? Number(form.normal_min) : null,
        normal_max: form.normal_max ? Number(form.normal_max) : null,
        critical_low: form.critical_low ? Number(form.critical_low) : null,
        critical_high: form.critical_high ? Number(form.critical_high) : null,
        method: form.method || null,
        male_normal_min: form.male_normal_min ? Number(form.male_normal_min) : null,
        male_normal_max: form.male_normal_max ? Number(form.male_normal_max) : null,
        female_normal_min: form.female_normal_min ? Number(form.female_normal_min) : null,
        female_normal_max: form.female_normal_max ? Number(form.female_normal_max) : null,
        tat_minutes: form.tat_minutes ? Number(form.tat_minutes) : null,
        fee: form.fee ? Number(form.fee) : 0,
      } as any).eq("id", editId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-lab-tests"] });
      setEditId(null);
      setForm(blankForm);
      toast({ title: "Test updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update test", description: err.message, variant: "destructive" }),
  });

  const openEdit = (t: any) => {
    setEditId(t.id);
    setForm({
      test_name: t.test_name || "",
      test_code: t.test_code || "",
      category: t.category || "Haematology",
      sample_type: t.sample_type || "Blood",
      unit: t.unit || "",
      normal_min: t.normal_min != null ? String(t.normal_min) : "",
      normal_max: t.normal_max != null ? String(t.normal_max) : "",
      critical_low: t.critical_low != null ? String(t.critical_low) : "",
      critical_high: t.critical_high != null ? String(t.critical_high) : "",
      method: t.method || "",
      male_normal_min: t.male_normal_min != null ? String(t.male_normal_min) : "",
      male_normal_max: t.male_normal_max != null ? String(t.male_normal_max) : "",
      female_normal_min: t.female_normal_min != null ? String(t.female_normal_min) : "",
      female_normal_max: t.female_normal_max != null ? String(t.female_normal_max) : "",
      tat_minutes: t.tat_minutes != null ? String(t.tat_minutes) : "120",
      fee: t.fee != null ? String(t.fee) : "0",
    });
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("lab_test_master").update({ is_active: active }).eq("id", id);
    if (error) { toast({ title: "Update failed", variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["settings-lab-tests"] });
  };

  const formatRange = (min: number | null, max: number | null) => {
    if (min != null && max != null) return `${min}–${max}`;
    if (min != null) return `≥${min}`;
    if (max != null) return `≤${max}`;
    return "—";
  };

  // --- Group mutations ---
  const saveGroupMutation = useMutation({
    mutationFn: async () => {
      if (editGroupId) {
        const { error } = await (supabase as any).from("lab_test_groups").update({
          group_name: groupForm.group_name,
          group_code: groupForm.group_code || null,
          category: groupForm.category,
          fee: Number(groupForm.fee) || 0,
          tat_minutes: Number(groupForm.tat_minutes) || null,
        }).eq("id", editGroupId);
        if (error) throw error;
        // Replace items
        await (supabase as any).from("lab_test_group_items").delete().eq("group_id", editGroupId);
        if (selectedGroupTestIds.length > 0) {
          await (supabase as any).from("lab_test_group_items").insert(
            selectedGroupTestIds.map(tid => ({ group_id: editGroupId, test_id: tid }))
          );
        }
      } else {
        const { data: newGroup, error } = await (supabase as any).from("lab_test_groups").insert({
          hospital_id: hospitalId!,
          group_name: groupForm.group_name,
          group_code: groupForm.group_code || null,
          category: groupForm.category,
          fee: Number(groupForm.fee) || 0,
          tat_minutes: Number(groupForm.tat_minutes) || null,
          is_active: true,
        }).select("id").maybeSingle();
        if (error) throw error;
        if (selectedGroupTestIds.length > 0 && newGroup) {
          await (supabase as any).from("lab_test_group_items").insert(
            selectedGroupTestIds.map(tid => ({ group_id: newGroup.id, test_id: tid }))
          );
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-lab-groups"] });
      closeGroupDialog();
      toast({ title: editGroupId ? "Group updated" : "Group created" });
    },
    onError: (err: any) => toast({ title: "Failed to save group", description: err.message, variant: "destructive" }),
  });

  const openGroupEdit = (g: any) => {
    setEditGroupId(g.id);
    setGroupForm({
      group_name: g.group_name || "",
      group_code: g.group_code || "",
      category: g.category || "Haematology",
      fee: g.fee != null ? String(g.fee) : "0",
      tat_minutes: g.tat_minutes != null ? String(g.tat_minutes) : "60",
    });
    setSelectedGroupTestIds((g.lab_test_group_items || []).map((i: any) => i.test_id));
    setShowGroupDialog(true);
  };

  const closeGroupDialog = () => {
    setShowGroupDialog(false);
    setEditGroupId(null);
    setGroupForm(blankGroup);
    setSelectedGroupTestIds([]);
    setGroupTestSearch("");
  };

  const toggleGroupTest = (testId: string) => {
    setSelectedGroupTestIds(prev =>
      prev.includes(testId) ? prev.filter(id => id !== testId) : [...prev, testId]
    );
  };

  const filteredGroupTests = (tests as any[]).filter((t: any) => {
    const q = groupTestSearch.toLowerCase();
    return !q || t.test_name?.toLowerCase().includes(q) || t.test_code?.toLowerCase().includes(q);
  });

  return (
    <SettingsPageWrapper title="Lab Test Master" hideSave wide>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {[
          { key: "tests", label: "Individual Tests" },
          { key: "groups", label: "Test Groups / Panels", icon: <Layers size={13} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── TESTS TAB ── */}
      {activeTab === "tests" && (
        <div className="space-y-4">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tests..." className="pl-9 h-9" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {labCategoryOptions.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)} className="gap-1"><Upload size={14} /> Bulk Import</Button>
            <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1"><Plus size={14} /> Add Test</Button>
          </div>

          <p className="text-xs text-muted-foreground">{filtered.length} test{filtered.length !== 1 ? "s" : ""}</p>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Test Name</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Code</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Category</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Sample</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Normal Range</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">TAT</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">Fee (₹)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Active</th>
                <th className="px-3 py-2 font-medium text-muted-foreground"></th>
              </tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>}
                {!isLoading && filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No tests found. Add your first lab test.</td></tr>}
                {filtered.map((t: any) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-3 py-2.5 font-medium text-foreground">{t.test_name}</td>
                    <td className="px-3 py-2.5"><Badge variant="outline">{t.test_code}</Badge></td>
                    <td className="px-3 py-2.5 text-muted-foreground capitalize">{t.category}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.sample_type}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatRange(t.normal_min, t.normal_max)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.tat_minutes ? `${t.tat_minutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-foreground font-mono text-right">{t.fee ? `₹${Number(t.fee).toLocaleString("en-IN")}` : "—"}</td>
                    <td className="px-3 py-2.5"><Switch checked={t.is_active} onCheckedChange={(v) => toggleActive(t.id, v)} /></td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── GROUPS TAB ── */}
      {activeTab === "groups" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Group multiple tests into a panel with a single price (e.g. Lipid Profile = TC + HDL + LDL + TG)
            </p>
            <Button size="sm" onClick={() => setShowGroupDialog(true)} className="gap-1 shrink-0">
              <Plus size={14} /> Add Group
            </Button>
          </div>

          {groupsLoading && <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>}
          {!groupsLoading && groups.length === 0 && (
            <div className="border border-dashed border-border rounded-lg py-12 text-center">
              <Layers size={32} className="mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No test groups yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create a group like "Lipid Profile" and select which tests it includes.</p>
            </div>
          )}

          <div className="space-y-3">
            {(groups as any[]).map((g: any) => {
              const groupTests = (g.lab_test_group_items || []).map((i: any) => i.lab_test_master).filter(Boolean);
              return (
                <div key={g.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{g.group_name}</span>
                        {g.group_code && <Badge variant="outline" className="text-xs">{g.group_code}</Badge>}
                        <Badge variant="secondary" className="text-xs capitalize">{g.category}</Badge>
                        <span className="text-sm font-bold text-primary">₹{Number(g.fee).toLocaleString("en-IN")}</span>
                        {g.tat_minutes && <span className="text-xs text-muted-foreground">TAT: {g.tat_minutes}m</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {groupTests.length === 0
                          ? <span className="text-xs text-muted-foreground italic">No tests added</span>
                          : groupTests.map((t: any) => (
                            <span key={t?.test_code} className="inline-flex items-center gap-0.5 bg-muted text-muted-foreground text-[10px] px-2 py-0.5 rounded-full">
                              {t?.test_name}
                            </span>
                          ))
                        }
                      </div>
                    </div>
                    <button onClick={() => openGroupEdit(g)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0">
                      <Pencil size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Add/Edit Test Dialog ── */}
      <Dialog open={showAdd || !!editId} onOpenChange={(open) => { if (!open) { setShowAdd(false); setEditId(null); setForm(blankForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Lab Test" : "Add Lab Test"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Test Name *</Label><Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Code *</Label><Input value={form.test_code} onChange={(e) => setForm({ ...form, test_code: e.target.value })} className="mt-1" /></div>
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{labCategoryOptions.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Sample Type</Label><Input value={form.sample_type} onChange={(e) => setForm({ ...form, sample_type: e.target.value })} className="mt-1" /></div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Label>Unit</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-primary transition-colors">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-72 text-xs space-y-2 p-3">
                      <p className="font-bold text-foreground text-[13px]">Unit Field Guide</p>
                      <div className="space-y-1">
                        <p className="font-semibold text-foreground">Numeric tests</p>
                        <p className="text-muted-foreground">Enter a standard unit (e.g. <code className="bg-muted px-0.5 rounded">mg/dL</code>, <code className="bg-muted px-0.5 rounded">g/dL</code>, <code className="bg-muted px-0.5 rounded">U/L</code>, <code className="bg-muted px-0.5 rounded">%</code>) and set Normal Min / Max. Result entry shows a number field with H / L flags.</p>
                        <p className="text-[11px] text-muted-foreground">e.g. Haemoglobin → g/dL · Blood Sugar → mg/dL · SGPT → U/L</p>
                      </div>
                      <hr className="border-border" />
                      <div className="space-y-1">
                        <p className="font-semibold text-foreground">Qualitative / Report tests</p>
                        <p className="text-muted-foreground">Enter <code className="bg-muted px-1 rounded">report</code> as the unit and <strong>leave Normal Min &amp; Max empty</strong>. Result entry shows a dropdown: <em>Positive · Negative · Detected · Not detected · Equivocal</em>.</p>
                        <p className="text-[11px] text-muted-foreground">e.g. Culture &amp; Sensitivity · Peripheral Smear · Dengue NS1 · Malaria Antigen · Sputum AFB</p>
                      </div>
                      <hr className="border-border" />
                      <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-1.5">
                        ⚡ The qualitative dropdown appears whenever Normal Min &amp; Max are both empty — regardless of the unit text.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Normal Min (default)</Label><Input type="number" value={form.normal_min} onChange={(e) => setForm({ ...form, normal_min: e.target.value })} className="mt-1" /></div>
              <div><Label>Normal Max (default)</Label><Input type="number" value={form.normal_max} onChange={(e) => setForm({ ...form, normal_max: e.target.value })} className="mt-1" /></div>
            </div>
            {/* Critical (panic) values — trigger critical_lab_value alerts on result entry */}
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-red-600">Critical Low</Label><Input type="number" value={form.critical_low} onChange={(e) => setForm({ ...form, critical_low: e.target.value })} className="mt-1 border-red-200" placeholder="Panic low value" /></div>
              <div><Label className="text-red-600">Critical High</Label><Input type="number" value={form.critical_high} onChange={(e) => setForm({ ...form, critical_high: e.target.value })} className="mt-1 border-red-200" placeholder="Panic high value" /></div>
            </div>
            <div><Label>Method</Label><Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="mt-1" placeholder="e.g. ELISA, PCR, Colorimetric" /></div>
            {showGenderRanges && (
              <>
                <p className="text-xs text-muted-foreground -mt-1">Gender-specific ranges (overrides default when patient sex is known)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-blue-600">Male Min</Label><Input type="number" value={form.male_normal_min} onChange={(e) => setForm({ ...form, male_normal_min: e.target.value })} className="mt-1 border-blue-200" placeholder="e.g. 13.5" /></div>
                  <div><Label className="text-blue-600">Male Max</Label><Input type="number" value={form.male_normal_max} onChange={(e) => setForm({ ...form, male_normal_max: e.target.value })} className="mt-1 border-blue-200" placeholder="e.g. 17.5" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-rose-600">Female Min</Label><Input type="number" value={form.female_normal_min} onChange={(e) => setForm({ ...form, female_normal_min: e.target.value })} className="mt-1 border-rose-200" placeholder="e.g. 12.0" /></div>
                  <div><Label className="text-rose-600">Female Max</Label><Input type="number" value={form.female_normal_max} onChange={(e) => setForm({ ...form, female_normal_max: e.target.value })} className="mt-1 border-rose-200" placeholder="e.g. 15.5" /></div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>TAT (minutes)</Label><Input type="number" value={form.tat_minutes} onChange={(e) => setForm({ ...form, tat_minutes: e.target.value })} className="mt-1" /></div>
              <div><Label>Fee (₹)</Label><Input type="number" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} className="mt-1" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditId(null); setForm(blankForm); }}>Cancel</Button>
            <Button onClick={() => editId ? editMutation.mutate() : addMutation.mutate()} disabled={!form.test_name || !form.test_code || addMutation.isPending || editMutation.isPending}>
              {(addMutation.isPending || editMutation.isPending) ? "Saving..." : editId ? "Update Test" : "Save Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Import Modal ── */}
      {hospitalId && (
        <BulkLabTestImportModal
          open={showBulkImport}
          onClose={() => setShowBulkImport(false)}
          hospitalId={hospitalId}
        />
      )}

      {/* ── Add/Edit Group Dialog ── */}
      <Dialog open={showGroupDialog} onOpenChange={(open) => { if (!open) closeGroupDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editGroupId ? "Edit Test Group" : "Create Test Group"}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Group details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Group Name * <span className="text-muted-foreground font-normal">(e.g. Lipid Profile)</span></Label>
                <Input value={groupForm.group_name} onChange={(e) => setGroupForm({ ...groupForm, group_name: e.target.value })} placeholder="Lipid Profile" className="mt-1" />
              </div>
              <div>
                <Label>Group Code</Label>
                <Input value={groupForm.group_code} onChange={(e) => setGroupForm({ ...groupForm, group_code: e.target.value })} placeholder="LIP" className="mt-1" />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={groupForm.category} onValueChange={(v) => setGroupForm({ ...groupForm, category: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{labCategoryOptions.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Group Price (₹) *</Label>
                <Input type="number" value={groupForm.fee} onChange={(e) => setGroupForm({ ...groupForm, fee: e.target.value })} placeholder="500" className="mt-1" />
              </div>
              <div>
                <Label>TAT (minutes)</Label>
                <Input type="number" value={groupForm.tat_minutes} onChange={(e) => setGroupForm({ ...groupForm, tat_minutes: e.target.value })} placeholder="60" className="mt-1" />
              </div>
            </div>

            {/* Selected tests */}
            <div>
              <Label className="mb-2 block">
                Tests in this group
                <span className="ml-2 text-muted-foreground font-normal">({selectedGroupTestIds.length} selected)</span>
              </Label>
              {selectedGroupTestIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 p-2 bg-primary/5 border border-primary/20 rounded-lg">
                  {selectedGroupTestIds.map(tid => {
                    const t = (tests as any[]).find((x: any) => x.id === tid);
                    return t ? (
                      <span key={tid} className="inline-flex items-center gap-1 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                        {t.test_name}
                        <button onClick={() => toggleGroupTest(tid)} className="hover:opacity-70"><X size={10} /></button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {/* Test search and selector */}
              <div className="relative mb-2">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={groupTestSearch}
                  onChange={(e) => setGroupTestSearch(e.target.value)}
                  placeholder="Search and add tests..."
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <div className="border border-border rounded-lg max-h-[200px] overflow-y-auto">
                {filteredGroupTests.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {groupTestSearch ? "No tests match your search" : "Search for tests to add"}
                  </p>
                )}
                {filteredGroupTests.map((t: any) => {
                  const selected = selectedGroupTestIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleGroupTest(t.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm border-b border-border/50 last:border-b-0 flex items-center justify-between transition-colors",
                        selected ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                      )}
                    >
                      <span>
                        <span className="font-medium">{t.test_name}</span>
                        <span className="text-muted-foreground text-xs ml-2">{t.category}</span>
                      </span>
                      <span className={cn("w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs",
                        selected ? "bg-primary border-primary text-primary-foreground" : "border-border"
                      )}>
                        {selected && "✓"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={closeGroupDialog}>Cancel</Button>
            <Button
              onClick={() => saveGroupMutation.mutate()}
              disabled={!groupForm.group_name || selectedGroupTestIds.length === 0 || saveGroupMutation.isPending}
            >
              {saveGroupMutation.isPending ? "Saving..." : editGroupId ? "Update Group" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsLabTestsPage;
