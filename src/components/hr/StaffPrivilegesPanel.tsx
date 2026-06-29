import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { logConfigChange } from "@/lib/ims";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, format } from "date-fns";

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

interface Props {
  userId: string;
  staffName: string;
}

interface Privilege {
  id: string;
  department_id: string | null;
  privilege_scope: string;
  privilege_details: string | null;
  granted_by: string | null;
  granted_at: string | null;
  review_due_date: string | null;
  active: boolean;
  dept_name?: string;
  grantor_name?: string;
}

const EMPTY_GRANT = {
  privilege_scope: "",
  department_id: "",
  privilege_details: "",
  review_due_date: "",
};

function reviewUrgency(due: string | null): "overdue" | "soon" | "ok" {
  if (!due) return "ok";
  const days = differenceInDays(parseISO(due), new Date());
  if (days < 0) return "overdue";
  if (days <= 30) return "soon";
  return "ok";
}

const StaffPrivilegesPanel: React.FC<Props> = ({ userId, staffName }) => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [showGrant, setShowGrant] = useState(false);
  const [grantForm, setGrantForm] = useState(EMPTY_GRANT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [privRes, deptRes] = await Promise.all([
      (supabase as any)
        .from("staff_privileges")
        .select("id, department_id, privilege_scope, privilege_details, granted_by, granted_at, review_due_date, active, d:departments(name), g:users!staff_privileges_granted_by_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .eq("user_id", userId)
        .order("granted_at", { ascending: false }),
      supabase.from("departments").select("id, name")
        .eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
    ]);
    setDepartments(deptRes.data || []);
    setPrivileges(
      (privRes.data || []).map((p: any) => ({
        ...p,
        dept_name: p.d?.name,
        grantor_name: p.g?.full_name,
      }))
    );
    setLoading(false);
  }, [userId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (priv: Privilege) => {
    if (!hospitalId) return;
    setToggling(priv.id);
    const newActive = !priv.active;
    await (supabase as any).from("staff_privileges").update({ active: newActive }).eq("id", priv.id);
    logConfigChange({
      hospitalId,
      configArea: "staff_privileges",
      itemId: priv.id,
      oldValue: { active: priv.active },
      newValue: { active: newActive },
      reason: `${newActive ? "Activated" : "Deactivated"} privilege "${priv.privilege_scope}" for ${staffName}`,
    });
    toast({ title: newActive ? "Privilege activated" : "Privilege deactivated" });
    setPrivileges(prev => prev.map(p => p.id === priv.id ? { ...p, active: newActive } : p));
    setToggling(null);
  };

  const handleGrant = async () => {
    if (!hospitalId || !grantForm.privilege_scope) return;
    setSaving(true);
    const { data: authUser } = await supabase.auth.getUser();
    let grantedBy: string | null = null;
    if (authUser.user) {
      const { data: userRow } = await supabase.from("users").select("id")
        .eq("auth_user_id", authUser.user.id).maybeSingle();
      grantedBy = userRow?.id ?? null;
    }
    const { error } = await (supabase as any).from("staff_privileges").insert({
      hospital_id: hospitalId,
      user_id: userId,
      department_id: grantForm.department_id || null,
      privilege_scope: grantForm.privilege_scope,
      privilege_details: grantForm.privilege_details || null,
      granted_by: grantedBy,
      granted_at: new Date().toISOString(),
      review_due_date: grantForm.review_due_date || null,
      active: true,
    });
    if (error) {
      toast({ title: "Failed to save privilege", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Privilege granted to ${staffName}` });
      setShowGrant(false);
      setGrantForm(EMPTY_GRANT);
      load();
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="px-5 py-2.5 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {privileges.length} Privilege{privileges.length !== 1 ? "s" : ""} on Record
        </span>
        <Button size="sm" onClick={() => setShowGrant(v => !v)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Grant Privilege
        </Button>
      </div>

      {/* Grant form */}
      {showGrant && (
        <div className="px-5 py-4 border-b border-border bg-muted/30 space-y-3 shrink-0">
          <p className="text-xs font-semibold">New Privilege — {staffName}</p>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Privilege Scope *</label>
            <select
              value={grantForm.privilege_scope}
              onChange={e => setGrantForm(f => ({ ...f, privilege_scope: e.target.value }))}
              className="w-full h-8 text-sm border border-input rounded px-2 bg-background"
            >
              <option value="">Select scope…</option>
              {PRIVILEGE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Department</label>
            <select
              value={grantForm.department_id}
              onChange={e => setGrantForm(f => ({ ...f, department_id: e.target.value }))}
              className="w-full h-8 text-sm border border-input rounded px-2 bg-background"
            >
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Details / Restrictions</label>
            <Input
              value={grantForm.privilege_details}
              onChange={e => setGrantForm(f => ({ ...f, privilege_details: e.target.value }))}
              placeholder="Specific conditions or notes…"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Review Due Date</label>
            <Input
              type="date"
              value={grantForm.review_due_date}
              onChange={e => setGrantForm(f => ({ ...f, review_due_date: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleGrant} disabled={saving || !grantForm.privilege_scope} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Privilege
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowGrant(false)} className="h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : privileges.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No privileges recorded.<br />
            <span className="text-xs">Use "+ Grant Privilege" to document NABH HRM.3 compliance.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[480px]">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
                <tr>
                  {["Department", "Privilege Scope", "Granted By", "Granted", "Review Due", "Active"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {privileges.map(p => {
                  const urg = reviewUrgency(p.review_due_date);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-t border-border/50 transition-colors",
                        !p.active      ? "opacity-55" :
                        urg === "overdue" ? "bg-red-50/70 dark:bg-red-950/30" :
                        urg === "soon"    ? "bg-amber-50/70 dark:bg-amber-950/30" : ""
                      )}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {p.dept_name || "—"}
                      </td>
                      <td className="px-3 py-2.5 font-medium max-w-[140px]">
                        <div className="truncate" title={p.privilege_scope}>{p.privilege_scope}</div>
                        {p.privilege_details && (
                          <div className="text-[10px] text-muted-foreground truncate mt-px" title={p.privilege_details}>
                            {p.privilege_details}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {p.grantor_name || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {p.granted_at ? format(parseISO(p.granted_at), "dd MMM yy") : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {p.review_due_date ? (
                          <span className={cn(
                            "flex items-center gap-0.5",
                            urg === "overdue" ? "text-red-600 font-semibold" :
                            urg === "soon"    ? "text-amber-600 font-semibold" :
                            "text-muted-foreground"
                          )}>
                            {urg === "overdue" && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
                            {format(parseISO(p.review_due_date), "dd MMM yy")}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => handleToggle(p)}
                          disabled={toggling === p.id}
                          title={p.active ? "Active — click to deactivate" : "Inactive — click to activate"}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                            toggling === p.id ? "opacity-50" : "cursor-pointer",
                            p.active ? "bg-emerald-500" : "bg-muted-foreground/30"
                          )}
                        >
                          {toggling === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mx-auto text-white" />
                          ) : (
                            <span className={cn(
                              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                              p.active ? "translate-x-[18px]" : "translate-x-0.5"
                            )} />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffPrivilegesPanel;
