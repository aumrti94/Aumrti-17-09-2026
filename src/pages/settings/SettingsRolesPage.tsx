import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  ArrowLeft,
  Plus,
  Lock,
  Trash2,
  Eye,
  Save,
  X,
  ShieldCheck,
  Users,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { logConfigChange } from "@/lib/ims";
import { MODULE_TABS, MODULE_ACTIONS, parseModuleTabs, parseModuleActions } from "@/lib/tabPermissions";
import { Zap } from "lucide-react";

/* ───── Module definitions ───── */
const MODULES = [
  { key: "opd", label: "OPD (Outpatient)", emoji: "🩺" },
  { key: "ipd", label: "IPD (Inpatient)", emoji: "🛏️" },
  { key: "emergency", label: "Emergency", emoji: "🚑" },
  { key: "nursing", label: "Nursing", emoji: "💉" },
  { key: "lab", label: "Laboratory (LIS)", emoji: "🔬" },
  { key: "radiology", label: "Radiology (RIS)", emoji: "🩻" },
  { key: "pharmacy", label: "Pharmacy", emoji: "💊" },
  { key: "ot", label: "Operation Theatre", emoji: "✂️" },
  { key: "billing", label: "Billing & Finance", emoji: "🧾" },
  { key: "insurance", label: "Insurance / TPA", emoji: "🛡️" },
  { key: "hr", label: "HR & Payroll", emoji: "👥" },
  { key: "inventory", label: "Inventory", emoji: "📦" },
  { key: "quality", label: "Quality & NABH", emoji: "🏅" },
  { key: "analytics", label: "Analytics & BI", emoji: "📊" },
  { key: "patients", label: "Patient Registry", emoji: "📋" },
  { key: "settings", label: "Settings", emoji: "⚙️" },
  { key: "reports", label: "Reports", emoji: "📈" },
  { key: "user_management", label: "User Management", emoji: "🔑" },
] as const;

type ModuleKey = (typeof MODULES)[number]["key"];
const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
type Action = (typeof ACTIONS)[number];

/* Valid app_role enum values — role_permissions.role_name MUST match users.role enum */
const VALID_APP_ROLES: { value: string; label: string }[] = [
  { value: "super_admin",       label: "Super Admin" },
  { value: "hospital_admin",    label: "Admin" },
  { value: "doctor",            label: "Doctor" },
  { value: "nurse",             label: "Nurse" },
  { value: "receptionist",      label: "Reception" },
  { value: "pharmacist",        label: "Pharmacist" },
  { value: "lab_tech",          label: "Lab Tech" },
  { value: "lab_technician",    label: "Lab Technician" },
  { value: "radiologist",       label: "Radiologist" },
  { value: "accountant",        label: "Accountant" },
  { value: "billing_executive", label: "Billing Executive" },
  { value: "billing_staff",     label: "Billing Staff" },
  { value: "hr_manager",        label: "HR Manager" },
  { value: "cfo",               label: "CFO" },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "hsl(var(--primary))",
  doctor: "#3B82F6",
  nurse: "#8B5CF6",
  pharmacist: "#10B981",
  lab_technician: "#F59E0B",
  billing_executive: "#EF4444",
  hr_manager: "#EC4899",
  receptionist: "#06B6D4",
};

interface RolePermission {
  id: string;
  hospital_id: string;
  role_name: string;
  role_label: string;
  is_system_role: boolean;
  permissions: Record<string, unknown>;
  created_at: string;
}

/* ───── Helpers ───── */
const parsePermissions = (perms: Record<string, unknown>): Record<ModuleKey, Record<Action, boolean>> => {
  const result = {} as Record<ModuleKey, Record<Action, boolean>>;
  const isAll = perms.all === true;

  for (const mod of MODULES) {
    const val = perms[mod.key];
    
    // Default to false
    result[mod.key] = { view: false, create: false, edit: false, delete: false, approve: false, export: false };

    if (isAll) {
      result[mod.key] = { view: true, create: true, edit: true, delete: true, approve: true, export: true };
      continue;
    }

    if (typeof val === "string") {
      // Legacy string format: "r" or "rw"
      const hasRead = val === "r" || val === "rw";
      const hasWrite = val === "rw";
      result[mod.key] = {
        view: hasRead,
        create: hasWrite,
        edit: hasWrite,
        delete: hasWrite,
        approve: false,
        export: hasRead,
      };
    } else if (val && typeof val === "object") {
      // New granular format: { view: true, create: false, ... }
      const modPerms = val as Record<string, boolean>;
      result[mod.key] = {
        view: !!modPerms.view,
        create: !!modPerms.create,
        edit: !!modPerms.edit,
        delete: !!modPerms.delete,
        approve: !!modPerms.approve,
        export: !!modPerms.export,
      };
    }
  }
  return result;
};

const serializePermissions = (
  matrix: Record<ModuleKey, Record<Action, boolean>>,
  tabMatrix: Record<string, Record<string, boolean>>,
  actionMatrix: Record<string, Record<string, boolean>>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const mod of MODULES) {
    const m = matrix[mod.key];
    const hasAny = Object.values(m).some(Boolean);
    if (hasAny) {
      const entry: Record<string, unknown> = { ...m };

      const tabs = tabMatrix[mod.key];
      const tabDefs = MODULE_TABS[mod.key] ?? [];
      if (tabDefs.some((t) => tabs && tabs[t.key] === false)) entry.tabs = tabs;

      const actions = actionMatrix[mod.key];
      const actionDefs = MODULE_ACTIONS[mod.key] ?? [];
      if (actionDefs.some((a) => actions && actions[a.key] === false)) entry.actions = actions;

      result[mod.key] = entry;
    }
  }
  return result;
};

/* ───── Feature-access helpers (Cash / Day Closure) ─────
   Roles that can ALWAYS close the day, regardless of config. Mirrors
   BYPASS_ROLES in src/lib/tabPermissions.ts. */
const CLOSURE_BYPASS_ROLES = ["super_admin", "hospital_admin"];

/* Does this role currently have Cash Closure access? Mirrors
   hasActionAccess("billing","day_closure") — default-allow. */
const isClosureAllowed = (role: RolePermission): boolean => {
  if (CLOSURE_BYPASS_ROLES.includes(role.role_name)) return true;
  const p = role.permissions as Record<string, any>;
  if (p?.all === true) return true;
  const billing = p?.billing;
  if (!billing || typeof billing === "string") return true;
  const actions = billing.actions;
  if (!actions || actions.day_closure === undefined) return true;
  return !!actions.day_closure;
};

/* Return a new permissions blob with billing.actions.day_closure set for the
   given role, preserving the existing billing shape. `allowed` true clears the
   explicit toggle (back to default-allow); false persists an explicit block. */
const withClosureAccess = (
  perms: Record<string, unknown>,
  allowed: boolean
): Record<string, unknown> => {
  const next: Record<string, any> = { ...(perms ?? {}) };
  let billing = next.billing;
  if (typeof billing === "string") {
    const s = billing;
    const hasRead = s === "r" || s === "rw";
    const hasWrite = s === "rw";
    billing = { view: hasRead, create: hasWrite, edit: hasWrite, delete: hasWrite, approve: false, export: hasRead };
  } else if (billing && typeof billing === "object") {
    billing = { ...billing };
  } else {
    billing = {};
  }
  const actions = { ...(billing.actions ?? {}) };
  if (allowed) {
    delete actions.day_closure;
  } else {
    actions.day_closure = false;
  }
  if (Object.keys(actions).length > 0) billing.actions = actions;
  else delete billing.actions;
  next.billing = billing;
  return next;
};

/* ───── Main Component ───── */
const SettingsRolesPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<Record<ModuleKey, Record<Action, boolean>> | null>(null);
  const [tabMatrix, setTabMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [actionMatrix, setActionMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [editLabel, setEditLabel] = useState("");
  const [previewRole, setPreviewRole] = useState<RolePermission | null>(null);
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const [pickerRole, setPickerRole] = useState<string>("");
  const [pickerLabel, setPickerLabel] = useState<string>("");
  const [changeReason, setChangeReason] = useState("");
  const [closureDropdownOpen, setClosureDropdownOpen] = useState(false);

  /* ── Fetch roles ── */
  const { data: roles = [] } = useQuery({
    queryKey: ["role-permissions", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("role_permissions")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("is_system_role", { ascending: false })
        .order("role_label");
      if (error) throw error;
      return (data ?? []) as unknown as RolePermission[];
    },
    enabled: !!hospitalId,
  });

  /* ── Fetch staff counts per role ── */
  const { data: staffCounts = {} } = useQuery({
    queryKey: ["staff-role-counts", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return {};
      const { data, error } = await supabase.from("users").select("role").eq("hospital_id", hospitalId);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const u of data ?? []) {
        counts[u.role] = (counts[u.role] || 0) + 1;
      }
      return counts;
    },
    enabled: !!hospitalId,
  });

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  useEffect(() => {
    if (selectedRole) {
      const perms = selectedRole.permissions as Record<string, any>;
      setMatrix(parsePermissions(perms));
      const tabs: Record<string, Record<string, boolean>> = {};
      const actions: Record<string, Record<string, boolean>> = {};
      for (const mod of MODULES) {
        if (MODULE_TABS[mod.key]) tabs[mod.key] = parseModuleTabs(mod.key, perms);
        if (MODULE_ACTIONS[mod.key]) actions[mod.key] = parseModuleActions(mod.key, perms);
      }
      setTabMatrix(tabs);
      setActionMatrix(actions);
      setEditLabel(selectedRole.role_label);
      setExpandedModules(new Set());
    } else {
      setMatrix(null);
      setTabMatrix({});
      setActionMatrix({});
      setEditLabel("");
    }
  }, [selectedRoleId, selectedRole]);

  /* ── Save mutation ── */
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRole || !matrix) return;
      const perms = serializePermissions(matrix, tabMatrix, actionMatrix);
      const oldPerms = selectedRole.permissions;
      const { error } = await supabase
        .from("role_permissions")
        .update({
          permissions: perms as any,
          role_label: editLabel || selectedRole.role_label,
        } as any)
        .eq("id", selectedRole.id);
      if (error) throw error;
      logConfigChange({ hospitalId, configArea: "role_permissions", itemId: selectedRole.id, oldValue: oldPerms, newValue: perms, reason: changeReason || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["settings-custom-roles"] });
      setChangeReason("");
      toast({ title: "Permissions saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  /* ── Feature access: toggle Cash / Day Closure for a single role ── */
  const closureMutation = useMutation({
    mutationFn: async ({ role, allowed }: { role: RolePermission; allowed: boolean }) => {
      const oldPerms = role.permissions;
      const newPerms = withClosureAccess(oldPerms, allowed);
      const { error } = await supabase
        .from("role_permissions")
        .update({ permissions: newPerms as any } as any)
        .eq("id", role.id);
      if (error) throw error;
      logConfigChange({ hospitalId, configArea: "role_permissions", itemId: role.id, oldValue: oldPerms, newValue: newPerms, reason: `Cash Closure access ${allowed ? "granted" : "revoked"}` });
    },
    onSuccess: (_d, { allowed }) => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["settings-custom-roles"] });
      toast({ title: `Cash Closure ${allowed ? "enabled" : "disabled"} for role` });
    },
    onError: () => toast({ title: "Failed to update access", variant: "destructive" }),
  });

  /* ── Create role: pick from valid app_role enum so users.role stays compatible ── */
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital");
      if (!pickerRole) throw new Error("Please pick a role");
      const { data, error } = await supabase
        .from("role_permissions")
        .insert({
          hospital_id: hospitalId,
          role_name: pickerRole,
          role_label: pickerLabel || pickerRole,
          is_system_role: false,
          permissions: {},
        } as any)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["settings-custom-roles"] });
      setSelectedRoleId(data.id);
      setCreatePickerOpen(false);
      setPickerRole("");
      setPickerLabel("");
      toast({ title: "Role created" });
    },
    onError: (e: any) =>
      toast({ title: "Failed to create role", description: e.message, variant: "destructive" }),
  });

  /* ── Delete role ── */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const role = roles.find((r) => r.id === id);
      if (!role) throw new Error("Role not found");
      // Check if any active users still have this role_name assigned
      const { data: affectedUsers } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("hospital_id", hospitalId)
        .eq("role", role.role_name)
        .eq("is_active", true)
        .limit(5);
      if (affectedUsers && affectedUsers.length > 0) {
        const names = affectedUsers.map((u) => u.full_name).join(", ");
        throw new Error(`Cannot delete: ${affectedUsers.length} active user(s) still have this role — ${names}. Reassign their roles first.`);
      }
      const { error } = await supabase.from("role_permissions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["settings-custom-roles"] });
      setSelectedRoleId(null);
      toast({ title: "Role deleted" });
    },
    onError: (e: any) => toast({ title: "Cannot delete role", description: e.message, variant: "destructive" }),
  });

  /* ── Toggle permission ── */
  const togglePerm = useCallback(
    (mod: ModuleKey, action: Action) => {
      if (!matrix) return;
      setMatrix((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [mod]: { ...prev[mod], [action]: !prev[mod][action] },
        };
      });
    },
    [matrix, selectedRole]
  );

  /* ── Toggle tab permission ── */
  const toggleTab = useCallback((mod: string, tabKey: string) => {
    setTabMatrix((prev) => ({
      ...prev,
      [mod]: { ...(prev[mod] ?? {}), [tabKey]: !(prev[mod]?.[tabKey] ?? true) },
    }));
  }, []);

  /* ── Toggle action permission ── */
  const toggleAction = useCallback((mod: string, actionKey: string) => {
    setActionMatrix((prev) => ({
      ...prev,
      [mod]: { ...(prev[mod] ?? {}), [actionKey]: !(prev[mod]?.[actionKey] ?? true) },
    }));
  }, []);

  /* ── Toggle module expand (show/hide tab rows) ── */
  const toggleExpand = useCallback((mod: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      next.has(mod) ? next.delete(mod) : next.add(mod);
      return next;
    });
  }, []);

  /* ── Quick presets ── */
  const applyModulePreset = (mod: ModuleKey, preset: "full" | "view" | "none") => {
    if (!matrix) return;
    const vals: Record<Action, boolean> =
      preset === "full"
        ? { view: true, create: true, edit: true, delete: true, approve: true, export: true }
        : preset === "view"
        ? { view: true, create: false, edit: false, delete: false, approve: false, export: true }
        : { view: false, create: false, edit: false, delete: false, approve: false, export: false };
    setMatrix((prev) => (prev ? { ...prev, [mod]: vals } : prev));
    // Reset all tabs to enabled when applying a module preset
    const defs = MODULE_TABS[mod] ?? [];
    if (defs.length > 0) {
      setTabMatrix((prev) => ({
        ...prev,
        [mod]: Object.fromEntries(defs.map((t) => [t.key, true])),
      }));
    }
  };

  const applyGlobalPreset = (preset: "full" | "view" | "clinical" | "finance") => {
    if (!matrix) return;
    const clinicalKeys = new Set(["opd", "ipd", "emergency", "nursing", "lab", "radiology", "pharmacy", "ot"]);
    const financeKeys = new Set(["billing", "insurance", "analytics", "reports"]);

    setMatrix((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const mod of MODULES) {
        const isClinical = clinicalKeys.has(mod.key);
        const isFinance = financeKeys.has(mod.key);
        let grant: "full" | "view" | "none" = "none";
        if (preset === "full") grant = "full";
        else if (preset === "view") grant = "view";
        else if (preset === "clinical") grant = isClinical ? "full" : "none";
        else if (preset === "finance") grant = isFinance ? "full" : "none";

        next[mod.key] =
          grant === "full"
            ? { view: true, create: true, edit: true, delete: true, approve: true, export: true }
            : grant === "view"
            ? { view: true, create: false, edit: false, delete: false, approve: false, export: true }
            : { view: false, create: false, edit: false, delete: false, approve: false, export: false };
      }
      return next;
    });
  };

  const toggleAllRow = () => {
    if (!matrix) return;
    const allOn = MODULES.every((m) => ACTIONS.every((a) => matrix[m.key][a]));
    const val = !allOn;
    setMatrix((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const mod of MODULES) {
        next[mod.key] = { view: val, create: val, edit: val, delete: val, approve: val, export: val };
      }
      return next;
    });
  };

  const roleColor = (name: string) => ROLE_COLORS[name] || "hsl(var(--muted-foreground))";

  /* ── Preview modal ── */
  if (previewRole) {
    const perms = parsePermissions(previewRole.permissions as Record<string, unknown>);
    const visibleModules = MODULES.filter((m) => perms[m.key].view);
    return (
      <div className="fixed inset-0 z-[100] bg-background flex flex-col">
        <div className="h-12 flex items-center justify-between px-6 bg-orange-500 text-white">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Eye size={16} />
            Previewing as: {previewRole.role_label}
            <span className="text-orange-100 text-xs ml-2">This shows what {previewRole.role_label} sees</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setPreviewRole(null)}>
            Exit Preview
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-8">
          <h2 className="text-lg font-bold text-foreground mb-4">Visible Modules ({visibleModules.length})</h2>
          <div className="grid grid-cols-4 gap-3">
            {visibleModules.map((m) => (
              <div key={m.key} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">{m.emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{m.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {perms[m.key].create ? "Full access" : "View only"}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {visibleModules.length === 0 && (
            <p className="text-muted-foreground text-sm mt-10 text-center">This role has no module access.</p>
          )}
          <h2 className="text-lg font-bold text-foreground mt-8 mb-4">
            Hidden Modules ({MODULES.length - visibleModules.length})
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {MODULES.filter((m) => !perms[m.key].view).map((m) => (
              <div key={m.key} className="bg-muted/50 border border-border rounded-xl p-4 flex items-center gap-3 opacity-50">
                <span className="text-2xl">{m.emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">{m.label}</p>
                  <p className="text-xs text-destructive">No access</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden bg-background">
      {/* ── LEFT PANEL ── */}
      <div className="w-[280px] flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-[52px] flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft size={16} />
            </button>
            <span className="text-sm font-bold text-foreground">Roles</span>
          </div>
          <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => setCreatePickerOpen(true)} disabled={roles.length >= 15}>
            <Plus size={12} /> Create
          </Button>
        </div>

        {/* ── Create Role picker modal ── */}
        {createPickerOpen && (
          <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={() => setCreatePickerOpen(false)}>
            <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-bold text-foreground mb-1">Customise Permissions for a Role</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Choose one of the system roles to override its default permissions for this hospital.
              </p>
              <label className="text-xs font-medium text-foreground block mb-1">Role</label>
              <select
                value={pickerRole}
                onChange={(e) => {
                  const v = e.target.value;
                  setPickerRole(v);
                  const found = VALID_APP_ROLES.find((r) => r.value === v);
                  if (found && !pickerLabel) setPickerLabel(found.label);
                }}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm mb-3"
              >
                <option value="">— Select a role —</option>
                {VALID_APP_ROLES
                  .filter((r) => !roles.some((existing) => existing.role_name === r.value))
                  .map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
              </select>
              <label className="text-xs font-medium text-foreground block mb-1">Display Label</label>
              <Input
                value={pickerLabel}
                onChange={(e) => setPickerLabel(e.target.value)}
                placeholder="e.g. Senior Doctor"
                className="mb-4 h-9"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setCreatePickerOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={() => createMutation.mutate()}
                  disabled={!pickerRole || createMutation.isPending}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
                selectedRoleId === role.id
                  ? "bg-primary/10 border-l-[3px] border-primary"
                  : "hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: roleColor(role.role_name) }}
                />
                <span className="text-[13px] font-semibold text-foreground truncate">{role.role_label}</span>
                <Badge variant={role.is_system_role ? "secondary" : "outline"} className="ml-auto text-[9px] h-4 px-1.5">
                  {role.is_system_role ? "System" : "Custom"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 pl-5">
                {staffCounts[role.role_name] || 0} staff members
              </p>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-border">
          <p className="text-[11px] text-muted-foreground">15 roles maximum</p>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {/* ── Feature Access: pick which roles can perform sensitive actions ── */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">Feature Access</h3>
            <span className="text-[11px] text-muted-foreground">— pick which roles can perform a sensitive action</span>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <Lock size={12} className="text-amber-600" /> Cash / Day Closure
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Who can lock the end-of-day cash reconciliation.
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {roles.filter(isClosureAllowed).map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 text-[10px] rounded-full border border-border bg-background px-2 py-0.5 text-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: roleColor(r.role_name) }} />
                    {r.role_label}
                  </span>
                ))}
                {roles.filter(isClosureAllowed).length === 0 && (
                  <span className="text-[11px] text-destructive">No roles can close the day.</span>
                )}
              </div>
            </div>
            <div className="relative flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={() => setClosureDropdownOpen((o) => !o)}
              >
                {roles.filter(isClosureAllowed).length} of {roles.length} roles
                <ChevronDown size={13} />
              </Button>
              {closureDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setClosureDropdownOpen(false)} />
                  <div className="absolute right-0 mt-1 z-50 w-64 bg-card border border-border rounded-lg shadow-xl p-1 max-h-72 overflow-y-auto">
                    <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Allowed roles
                    </p>
                    {roles.map((role) => {
                      const bypass = CLOSURE_BYPASS_ROLES.includes(role.role_name);
                      const checked = isClosureAllowed(role);
                      return (
                        <label
                          key={role.id}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px]",
                            bypass ? "opacity-60 cursor-not-allowed" : "hover:bg-muted cursor-pointer"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={checked}
                            disabled={bypass || closureMutation.isPending}
                            onChange={(e) => closureMutation.mutate({ role, allowed: e.target.checked })}
                          />
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: roleColor(role.role_name) }} />
                          <span className="truncate text-foreground">{role.role_label}</span>
                          {bypass && <span className="ml-auto text-[10px] text-muted-foreground">Always</span>}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Unchecked roles are blocked from Cash Closure in the app and at the database. Admins always have access.
          </p>
        </div>

        {!selectedRole || !matrix ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <ShieldCheck size={48} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Select a role to configure permissions</p>
            </div>
          </div>
        ) : (
          <>
            {/* Role header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: roleColor(selectedRole.role_name) }} />
                {selectedRole.is_system_role ? (
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selectedRole.role_label}</h2>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock size={10} /> System role — cannot be renamed
                    </p>
                  </div>
                ) : (
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="text-lg font-bold h-9 w-64 border-dashed"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setPreviewRole(selectedRole)}>
                  <Eye size={14} /> Preview
                </Button>
                {!selectedRole.is_system_role && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1"
                    onClick={() => deleteMutation.mutate(selectedRole.id)}
                  >
                    <Trash2 size={14} /> Delete
                  </Button>
                )}
                <Input
                  value={changeReason}
                  onChange={e => setChangeReason(e.target.value)}
                  placeholder="Reason for change…"
                  className="h-8 text-xs w-44"
                />
                <Button size="sm" className="gap-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  <Save size={14} /> Save
                </Button>
              </div>
            </div>

            {/* Quick presets */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-medium text-muted-foreground">Apply Preset:</span>
              {(["full", "view", "clinical", "finance"] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs capitalize"
                  onClick={() => applyGlobalPreset(p)}
                >
                  {p === "full" ? "Full Access" : p === "view" ? "View Only" : p === "clinical" ? "Clinical Only" : "Finance Only"}
                </Button>
              ))}
            </div>

            {/* Permission matrix */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_repeat(6,80px)] bg-muted/50 border-b border-border">
                <div className="px-4 py-2.5 text-[11px] font-bold uppercase text-muted-foreground">Module</div>
                {ACTIONS.map((a) => (
                  <div key={a} className="px-2 py-2.5 text-[11px] font-bold uppercase text-muted-foreground text-center capitalize">
                    {a}
                  </div>
                ))}
              </div>

              {/* All modules master row */}
              <div className="grid grid-cols-[1fr_repeat(6,80px)] border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="px-4 py-2.5 flex items-center gap-2">
                  <span className="text-sm">🌐</span>
                  <span className="text-[13px] font-bold text-foreground">All Modules</span>
                </div>
                {ACTIONS.map((a, i) => (
                  <div key={a} className="flex items-center justify-center py-2.5">
                    {i === 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        onClick={toggleAllRow}
                      >
                        Toggle All
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Module rows */}
              {MODULES.map((mod) => {
                const perms = matrix[mod.key];
                const modTabs = MODULE_TABS[mod.key] ?? [];
                const modActions = MODULE_ACTIONS[mod.key] ?? [];
                const isExpanded = expandedModules.has(mod.key);
                const tabPerms = tabMatrix[mod.key] ?? {};
                const actionPerms = actionMatrix[mod.key] ?? {};
                const restrictedTabCount = modTabs.filter((t) => tabPerms[t.key] === false).length;
                const restrictedActionCount = modActions.filter((a) => actionPerms[a.key] === false).length;
                const hasCustomize = modTabs.length > 0 || modActions.length > 0;
                return (
                  <React.Fragment key={mod.key}>
                    <div className="group grid grid-cols-[1fr_repeat(6,80px)] border-b border-border hover:bg-muted/30 transition-colors">
                      <div className="px-4 py-2.5 flex items-center gap-2">
                        <span className="text-sm">{mod.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] text-foreground">{mod.label}</span>
                            {restrictedTabCount > 0 && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-600 border-amber-300">
                                {modTabs.length - restrictedTabCount}/{modTabs.length} tabs
                              </Badge>
                            )}
                            {restrictedActionCount > 0 && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-rose-600 border-rose-300">
                                {modActions.length - restrictedActionCount}/{modActions.length} actions
                              </Badge>
                            )}
                          </div>
                          <div className="hidden group-hover:flex gap-1 mt-0.5 items-center">
                            <button className="text-[10px] text-primary hover:underline" onClick={() => applyModulePreset(mod.key, "full")}>Full</button>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <button className="text-[10px] text-primary hover:underline" onClick={() => applyModulePreset(mod.key, "view")}>View Only</button>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <button className="text-[10px] text-destructive hover:underline" onClick={() => applyModulePreset(mod.key, "none")}>None</button>
                          </div>
                        </div>
                        {hasCustomize && (
                          <button
                            onClick={() => toggleExpand(mod.key)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-border whitespace-nowrap"
                            title="Configure tabs & action controls"
                          >
                            <Layers size={10} />
                            Customise
                            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </button>
                        )}
                      </div>
                      {ACTIONS.map((action) => (
                        <div key={action} className="flex items-center justify-center py-2.5">
                          <Switch
                            checked={perms[action]}
                            onCheckedChange={() => togglePerm(mod.key, action)}
                            className="scale-75"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Expanded customisation panel — Tabs + Actions */}
                    {isExpanded && hasCustomize && (
                      <div className="border-b border-border bg-muted/20">

                        {/* Tab Access section */}
                        {modTabs.length > 0 && (
                          <>
                            <div className="px-6 py-2 flex items-center gap-2 border-b border-border/40">
                              <Layers size={11} className="text-blue-500" />
                              <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Tab Visibility</span>
                              <span className="text-[10px] text-muted-foreground ml-1">— which tabs this role can see</span>
                              <button
                                className="ml-auto text-[10px] text-primary hover:underline"
                                onClick={() => {
                                  const allOn = modTabs.every((t) => tabPerms[t.key] !== false);
                                  setTabMatrix((prev) => ({
                                    ...prev,
                                    [mod.key]: Object.fromEntries(modTabs.map((t) => [t.key, !allOn])),
                                  }));
                                }}
                              >
                                {modTabs.every((t) => tabPerms[t.key] !== false) ? "Disable All" : "Enable All"}
                              </button>
                            </div>
                            <div className="px-6 py-3 flex flex-wrap gap-x-6 gap-y-2 border-b border-border/30">
                              {modTabs.map((tab) => {
                                const enabled = tabPerms[tab.key] !== false;
                                return (
                                  <label key={tab.key} className="flex items-center gap-2 cursor-pointer select-none">
                                    <Switch checked={enabled} onCheckedChange={() => toggleTab(mod.key, tab.key)} className="scale-75" />
                                    <span className={cn("text-[12px]", enabled ? "text-foreground" : "text-muted-foreground line-through")}>
                                      {tab.label}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </>
                        )}

                        {/* Action Controls section */}
                        {modActions.length > 0 && (
                          <>
                            <div className="px-6 py-2 flex items-center gap-2 border-b border-border/40">
                              <Zap size={11} className="text-rose-500" />
                              <span className="text-[11px] font-semibold text-rose-600 uppercase tracking-wide">Action Controls</span>
                              <span className="text-[10px] text-muted-foreground ml-1">— which buttons/actions this role can perform</span>
                              <button
                                className="ml-auto text-[10px] text-primary hover:underline"
                                onClick={() => {
                                  const allOn = modActions.every((a) => actionPerms[a.key] !== false);
                                  setActionMatrix((prev) => ({
                                    ...prev,
                                    [mod.key]: Object.fromEntries(modActions.map((a) => [a.key, !allOn])),
                                  }));
                                }}
                              >
                                {modActions.every((a) => actionPerms[a.key] !== false) ? "Disable All" : "Enable All"}
                              </button>
                            </div>
                            <div className="px-6 py-3 grid grid-cols-2 gap-x-8 gap-y-2.5">
                              {modActions.map((action) => {
                                const enabled = actionPerms[action.key] !== false;
                                return (
                                  <label key={action.key} className="flex items-start gap-2 cursor-pointer select-none">
                                    <Switch checked={enabled} onCheckedChange={() => toggleAction(mod.key, action.key)} className="scale-75 mt-0.5 shrink-0" />
                                    <div>
                                      <span className={cn("text-[12px] font-medium block", enabled ? "text-foreground" : "text-muted-foreground line-through")}>
                                        {action.label}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">{action.description}</span>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SettingsRolesPage;
