import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { ArrowLeft, Plus, X, Building2, Trash2, Blocks, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useConfigValues } from "@/hooks/useConfigValues";
import { cn } from "@/lib/utils";
import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";
import { useProductMode } from "@/contexts/ProductModeContext";
import { moduleDepartmentLinks } from "@/lib/moduleDepartments";

const COMMON_DEPTS = [
  "General Medicine", "General Surgery", "Paediatrics", "Gynaecology & Obstetrics",
  "Orthopaedics", "Cardiology", "ENT", "Ophthalmology", "Dermatology", "Neurology",
  "Psychiatry", "Urology", "Emergency / Casualty", "ICU / Critical Care",
  "Radiology", "Pathology / Laboratory", "Pharmacy", "Physiotherapy",
];


const SettingsDepartmentsPage: React.FC = () => {
  const navigate = useNavigate();
  const deptTypeOptions = useConfigValues("department_types");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "clinical" as string, head_doctor_id: "", dept_code: "" });
  const [checkedDepts, setCheckedDepts] = useState<Set<string>>(new Set());
  const [checkedModuleDepts, setCheckedModuleDepts] = useState<Set<string>>(new Set());

  const { enabledModules } = useSubscriptionConfig();
  const { isModuleEnabled } = useProductMode();

  const { data: departments, isLoading } = useQuery({
    queryKey: ["settings-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name, type, is_active, head_doctor_id").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { hospitalId } = useHospitalId();

  const { data: doctors } = useQuery({
    queryKey: ["settings-doctors-list", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data } = await supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).order("full_name");
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  const getHospitalId = async () => {
    const { data } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!data) throw new Error("No hospital context");
    return data.hospital_id;
  };

  const deleteDept = useMutation({
    mutationFn: async (id: string) => {
      // Guard: check no active staff assigned before deleting
      const { data: staff } = await supabase.from("users").select("id").eq("department_id", id).eq("is_active", true).limit(1);
      if (staff && staff.length > 0) throw new Error("Cannot delete: active staff members are assigned to this department.");
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Department deleted" });
      qc.invalidateQueries({ queryKey: ["settings-departments"] });
    },
    onError: (e: any) => toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  const saveDept = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      if (editingId) {
        const { error } = await supabase.from("departments").update({
          name: form.name, type: form.type as any, head_doctor_id: form.head_doctor_id || null,
          ...(form.dept_code ? { dept_code: form.dept_code } : {}),
        } as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("departments").insert({
          hospital_id: hid, name: form.name, type: form.type as any, head_doctor_id: form.head_doctor_id || null,
          ...(form.dept_code ? { dept_code: form.dept_code } : {}),
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: `Department ${editingId ? "updated" : "added"}` });
      qc.invalidateQueries({ queryKey: ["settings-departments"] });
      closeDrawer();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkAdd = useMutation({
    mutationFn: async (names: string[]) => {
      const hid = await getHospitalId();
      if (!names.length) return 0;
      const rows = names.map((n) => ({ hospital_id: hid, name: n, type: "clinical" as const, is_active: true }));
      const { error } = await supabase.from("departments").insert(rows);
      if (error) throw error;
      return names.length;
    },
    onSuccess: (count) => {
      toast({ title: `${count} departments added` });
      qc.invalidateQueries({ queryKey: ["settings-departments"] });
      setCheckedDepts(new Set());
      setCheckedModuleDepts(new Set());
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("departments").update({ is_active: !active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-departments"] }),
  });

  const openDrawer = (dept?: any) => {
    if (dept) {
      setEditingId(dept.id);
      setForm({ name: dept.name, type: dept.type, head_doctor_id: dept.head_doctor_id ?? "", dept_code: (dept as any).dept_code ?? "" });
    } else {
      setEditingId(null);
      setForm({ name: "", type: "clinical", head_doctor_id: "", dept_code: "" });
    }
    setDrawerOpen(true);
  };

  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); };

  const existingNames = useMemo(() => new Set(departments?.map((d) => d.name) ?? []), [departments]);
  const availableCommon = COMMON_DEPTS.filter((n) => !existingNames.has(n));
  const showBanner = !isLoading && (departments?.length ?? 0) < 3 && availableCommon.length > 0;

  // Departments implied by the specialized/clinical modules this hospital runs.
  // Only modules the hospital can actually access (plan-entitled AND toggled on)
  // are considered. We keep BOTH the ones already set up and the ones still
  // missing, so the full module→department mapping is visible (a hidden row
  // reads as "module missing" even when the department already exists).
  const moduleDeptRows = useMemo(() => {
    const map = new Map<string, { department: string; modules: string[]; exists: boolean }>();
    for (const link of moduleDepartmentLinks()) {
      const accessible = isModuleKeyAllowed(link.moduleKey, enabledModules) && isModuleEnabled(link.moduleKey);
      if (!accessible) continue;
      const row = map.get(link.department);
      if (row) {
        if (!row.modules.includes(link.moduleName)) row.modules.push(link.moduleName);
      } else {
        map.set(link.department, {
          department: link.department,
          modules: [link.moduleName],
          exists: existingNames.has(link.department),
        });
      }
    }
    return [...map.values()].sort((a, b) => a.department.localeCompare(b.department));
  }, [enabledModules, isModuleEnabled, existingNames]);

  const moduleDeptMissing = moduleDeptRows.filter((r) => !r.exists);
  const moduleDeptPresent = moduleDeptRows.filter((r) => r.exists);

  const toggleCheck = (name: string) => {
    setCheckedDepts((prev) => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
  };

  const toggleModuleCheck = (name: string) => {
    setCheckedModuleDepts((prev) => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
  };

  const typeColor = (t: string) => {
    if (t === "clinical") return "bg-blue-50 text-blue-700";
    if (t === "administrative") return "bg-amber-50 text-amber-700";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Departments</h1>
            <p className="text-xs text-muted-foreground">Settings › Departments</p>
          </div>
        </div>
        <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
          <Plus size={14} /> Add Department
        </button>
      </div>

      {/* QUICK ADD BANNER */}
      {showBanner && (
        <div className="flex-shrink-0 mx-6 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-[13px] text-amber-800 font-medium mb-3">Add departments so OPD and IPD have options to show</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3">
            {availableCommon.map((name) => (
              <label key={name} className="flex items-center gap-2 cursor-pointer text-[13px] text-foreground hover:bg-amber-100/50 rounded px-1 py-0.5">
                <input type="checkbox" checked={checkedDepts.has(name)} onChange={() => toggleCheck(name)}
                  className="h-4 w-4 rounded border-amber-300 text-[hsl(222,55%,23%)] focus:ring-0" />
                {name}
              </label>
            ))}
          </div>
          <button onClick={() => bulkAdd.mutate(Array.from(checkedDepts))} disabled={checkedDepts.size === 0 || bulkAdd.isPending}
            className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700 active:scale-[0.97] disabled:opacity-40">
            {bulkAdd.isPending ? "Adding..." : `Add Selected Departments (${checkedDepts.size})`}
          </button>
        </div>
      )}

      {/* MODULE-DERIVED DEPARTMENTS */}
      {!isLoading && moduleDeptRows.length > 0 && (
        <div className="flex-shrink-0 mx-6 mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Blocks size={15} className="text-blue-700" />
            <p className="text-[13px] text-blue-900 font-medium">Departments for the modules you run</p>
            <span className="text-[11px] text-blue-700/70">
              {moduleDeptPresent.length}/{moduleDeptRows.length} set up
            </span>
          </div>

          {moduleDeptMissing.length > 0 ? (
            <>
              <p className="text-[12px] text-blue-800/80 mb-3">
                These specialized modules don&rsquo;t have a matching department yet. Add the ones you actually operate.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3">
                {moduleDeptMissing.map(({ department, modules }) => (
                  <label key={department} className="flex items-center gap-2 cursor-pointer text-[13px] text-foreground hover:bg-blue-100/50 rounded px-1 py-0.5">
                    <input type="checkbox" checked={checkedModuleDepts.has(department)} onChange={() => toggleModuleCheck(department)}
                      className="h-4 w-4 rounded border-blue-300 text-blue-700 focus:ring-0" />
                    <span>{department}</span>
                    <span className="text-[11px] text-blue-700/70 truncate">· {modules.join(", ")}</span>
                  </label>
                ))}
              </div>
              <button onClick={() => bulkAdd.mutate(Array.from(checkedModuleDepts))} disabled={checkedModuleDepts.size === 0 || bulkAdd.isPending}
                className="bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-800 active:scale-[0.97] disabled:opacity-40">
                {bulkAdd.isPending ? "Adding..." : `Add Selected Departments (${checkedModuleDepts.size})`}
              </button>
            </>
          ) : (
            <p className="text-[12px] text-emerald-700 mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Every module you run already has a matching department.
            </p>
          )}

          {moduleDeptPresent.length > 0 && (
            <div className="mt-3 pt-3 border-t border-blue-200/70">
              <p className="text-[11px] font-medium text-blue-800/70 uppercase tracking-wide mb-1.5">Already set up</p>
              <div className="flex flex-wrap gap-1.5">
                {moduleDeptPresent.map(({ department, modules }) => (
                  <span key={department} title={modules.join(", ")}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-800/80 bg-blue-100/60 rounded-full px-2 py-0.5">
                    <CheckCircle2 size={11} className="text-emerald-600" /> {department}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 overflow-y-auto">
        {!isLoading && (departments?.length ?? 0) === 0 && !showBanner ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center"><Building2 size={24} className="text-muted-foreground" /></div>
            <p className="text-sm font-medium text-foreground">No departments yet</p>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97]">
              <Plus size={14} /> Add First Department
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2.5 font-medium">Department Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
              {departments?.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-6 py-3 font-medium text-foreground">{d.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium capitalize", typeColor(d.type))}>{d.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", d.is_active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                      <span className="text-[12px] text-muted-foreground">{d.is_active ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openDrawer(d)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                      <button onClick={() => toggleActive.mutate({ id: d.id, active: d.is_active })}
                        className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-muted">
                        {d.is_active ? "Deactivate" : "Activate"}
                      </button>
                      {!d.is_active && (
                        <button
                          onClick={() => { if (window.confirm(`Delete "${d.name}"? This cannot be undone.`)) deleteDept.mutate(d.id); }}
                          className="text-xs text-destructive hover:text-destructive/80 px-2 py-1 rounded hover:bg-destructive/10"
                          title="Delete department"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* DRAWER */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{editingId ? "Edit Department" : "Add Department"}</h2>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Department Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="General Medicine" className="h-10" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Type *</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {deptTypeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Department Code</label>
                <Input value={form.dept_code} onChange={(e) => setForm({ ...form, dept_code: e.target.value.toUpperCase() })} placeholder="e.g. MED, SURG, GYN" className="h-10" maxLength={10} />
                <p className="text-[10px] text-muted-foreground mt-1">Used in reports and GL integration</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Head of Department</label>
                <select value={form.head_doctor_id} onChange={(e) => setForm({ ...form, head_doctor_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">None</option>
                  {doctors?.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
              <button onClick={closeDrawer} className="flex-1 h-11 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">Cancel</button>
              <button onClick={() => saveDept.mutate()} disabled={!form.name || saveDept.isPending}
                className="flex-[2] h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
                {saveDept.isPending ? "Saving..." : "Save Department"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsDepartmentsPage;
