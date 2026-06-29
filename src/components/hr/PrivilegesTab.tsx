import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Award, Plus, Loader2, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";
import { isPast, parseISO, differenceInDays, format } from "date-fns";

interface Props {
  hospitalId: string;
}

interface Privilege {
  id: string;
  user_id: string;
  department_id: string | null;
  privilege_scope: string;
  privilege_details: string | null;
  granted_by: string | null;
  granted_at: string | null;
  review_due_date: string | null;
  active: boolean;
  user_name?: string;
  dept_name?: string;
  grantor_name?: string;
}

interface StaffMember { id: string; full_name: string; }
interface Department  { id: string; name: string; }

const PRIVILEGE_SCOPES = [
  "General Surgery - Level I",
  "General Surgery - Level II",
  "Orthopaedic Surgery",
  "Gynaecology & Obstetrics",
  "Anaesthesia - ASA I-II",
  "Anaesthesia - ASA III-IV",
  "Laparoscopic Surgery",
  "Emergency Procedures",
  "ICU Management",
  "Endoscopy",
  "Cardiac Catheterisation",
  "Paediatric Procedures",
  "Other",
];

const EMPTY_FORM = {
  user_id: "",
  department_id: "",
  privilege_scope: "",
  privilege_details: "",
  review_due_date: "",
};

const reviewStatus = (due: string | null) => {
  if (!due) return "none";
  if (isPast(parseISO(due))) return "overdue";
  const days = differenceInDays(parseISO(due), new Date());
  if (days <= 30) return "due_soon";
  return "ok";
};

const PrivilegesTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");

  const load = useCallback(async () => {
    setLoading(true);
    const [privRes, staffRes, deptRes] = await Promise.all([
      (supabase as any)
        .from("staff_privileges")
        .select("*, u:users!staff_privileges_user_id_fkey(full_name), d:departments(name), g:users!staff_privileges_granted_by_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true),
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);

    setStaff(staffRes.data || []);
    setDepartments(deptRes.data || []);
    setPrivileges(
      (privRes.data || []).map((p: any) => ({
        ...p,
        user_name: p.u?.full_name,
        dept_name: p.d?.name,
        grantor_name: p.g?.full_name,
      }))
    );
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.user_id || !form.privilege_scope) return;
    setSaving(true);
    const { error } = await (supabase as any).from("staff_privileges").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      department_id: form.department_id || null,
      privilege_scope: form.privilege_scope,
      privilege_details: form.privilege_details || null,
      granted_by: userId || null,
      granted_at: new Date().toISOString(),
      review_due_date: form.review_due_date || null,
      active: true,
    });
    if (error) {
      toast({ title: "Failed to save privilege", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Privilege granted" });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      load();
    }
    setSaving(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    await (supabase as any).from("staff_privileges").update({ active: !current }).eq("id", id);
    toast({ title: current ? "Privilege deactivated" : "Privilege reactivated" });
    load();
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("staff_privileges").delete().eq("id", id);
    toast({ title: "Privilege removed" });
    load();
  };

  const overdue  = privileges.filter(p => p.active && reviewStatus(p.review_due_date) === "overdue");
  const dueSoon  = privileges.filter(p => p.active && reviewStatus(p.review_due_date) === "due_soon");
  const inactive = privileges.filter(p => !p.active);

  const filtered = privileges.filter(p => {
    if (filterActive === "active"   && !p.active) return false;
    if (filterActive === "inactive" && p.active)  return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.user_name || "").toLowerCase().includes(q) ||
        (p.privilege_scope || "").toLowerCase().includes(q) ||
        (p.dept_name || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Award className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Clinical Privileges</span>
          {overdue.length > 0  && <Badge className="bg-red-100 text-red-700 border-red-200">{overdue.length} Review Overdue</Badge>}
          {dueSoon.length > 0  && <Badge className="bg-amber-100 text-amber-700 border-amber-200">{dueSoon.length} Due in 30d</Badge>}
          {inactive.length > 0 && <Badge className="bg-muted text-muted-foreground">{inactive.length} Inactive</Badge>}
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)} className="h-7 text-xs gap-1 shrink-0">
          <Plus className="h-3 w-3" /> Grant Privilege
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Staff Member *</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Department</label>
              <select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Privilege Scope *</label>
              <select value={form.privilege_scope} onChange={e => setForm(f => ({ ...f, privilege_scope: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select scope…</option>
                {PRIVILEGE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {form.privilege_scope === "Other" && (
                <Input value={form.privilege_scope === "Other" ? "" : form.privilege_scope}
                  onChange={e => setForm(f => ({ ...f, privilege_scope: e.target.value }))}
                  placeholder="Describe privilege scope" className="h-8 text-sm mt-1" />
              )}
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Privilege Details</label>
              <Input value={form.privilege_details} onChange={e => setForm(f => ({ ...f, privilege_details: e.target.value }))}
                placeholder="Specific conditions, restrictions, or supporting credentials" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Review Due Date</label>
              <Input type="date" value={form.review_due_date} onChange={e => setForm(f => ({ ...f, review_due_date: e.target.value }))} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.user_id || !form.privilege_scope} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Grant Privilege
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff, scope…"
          className="h-7 text-xs max-w-[200px]" />
        <div className="flex rounded border border-input overflow-hidden text-xs">
          {(["all", "active", "inactive"] as const).map(v => (
            <button key={v} onClick={() => setFilterActive(v)}
              className={cn("px-2 py-1 capitalize", filterActive === v ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}>
              {v}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} records</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading privileges…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            {privileges.length === 0
              ? "No privileges on record. Grant clinical privileges to document staff competencies for NABH HRM.3."
              : "No privileges match your filter."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => {
              const rs = reviewStatus(p.review_due_date);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "border rounded-lg px-3 py-2.5 flex items-start justify-between gap-3",
                    !p.active             ? "opacity-60 border-border bg-muted/30" :
                    rs === "overdue"      ? "border-red-200 bg-red-50/50 dark:bg-red-950/20" :
                    rs === "due_soon"     ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" :
                    "border-border bg-card"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{p.user_name || "—"}</span>
                      {p.dept_name && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{p.dept_name}</span>}
                      {!p.active && <Badge className="text-[10px] h-4">Inactive</Badge>}
                      {p.active && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                    </div>
                    <p className="text-xs font-medium text-foreground">{p.privilege_scope}</p>
                    {p.privilege_details && <p className="text-[11px] text-muted-foreground">{p.privilege_details}</p>}
                    <div className="flex items-center gap-3 flex-wrap">
                      {p.granted_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Granted {format(parseISO(p.granted_at), "dd MMM yyyy")}
                          {p.grantor_name ? ` by ${p.grantor_name}` : ""}
                        </span>
                      )}
                      {p.review_due_date && (
                        <span className={cn(
                          "text-[10px] px-1.5 py-px rounded border font-medium flex items-center gap-1",
                          rs === "overdue"  ? "bg-red-100 text-red-700 border-red-200" :
                          rs === "due_soon" ? "bg-amber-100 text-amber-700 border-amber-200" :
                          "bg-muted text-muted-foreground border-border"
                        )}>
                          {rs === "overdue" && <AlertTriangle className="h-2.5 w-2.5" />}
                          Review: {format(parseISO(p.review_due_date), "dd MMM yyyy")}
                          {rs === "overdue" ? " (Overdue)" : rs === "due_soon" ? " (Due Soon)" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => toggleActive(p.id, p.active)}>
                      {p.active ? "Deactivate" : "Reactivate"}
                    </Button>
                    <button onClick={() => handleDelete(p.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivilegesTab;
