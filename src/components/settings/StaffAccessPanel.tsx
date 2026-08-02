import React, { useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Lock, Save, ChevronRight, ChevronDown, Layers, Zap, ShieldCheck } from "lucide-react";
import { PERMISSION_MODULES, type UserOverrideBlob } from "@/lib/moduleRegistry";
import { CATEGORIES, type ModuleCategory } from "@/lib/modules";
import { MODULE_TABS, MODULE_ACTIONS } from "@/lib/tabPermissions";
import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";

/**
 * Layer 4 — per-user access editor (restrict-only within the assigned role).
 *
 * The user's role permissions are the CEILING: anything the role denies is shown locked
 * (the L3→L4 clamp, visible for context — never grantable here). Anything the role grants
 * can be withheld for this specific user. Saving upserts a "withhold map" into
 * user_permission_overrides; an empty map deletes the row (pure inherit from the role).
 */

const CRUD = ["view", "create", "edit", "delete", "approve", "export"] as const;
type Crud = (typeof CRUD)[number];

/** Does the role blob grant this CRUD action for the module? (the ceiling) */
function roleGrants(roleBlob: Record<string, any> | null, moduleKey: string, action: Crud): boolean {
  if (!roleBlob) return false;
  if (roleBlob.all === true) return true;
  const v = roleBlob[moduleKey];
  if (!v) return false;
  if (typeof v === "string") {
    const read = v === "r" || v === "rw";
    const write = v === "rw";
    if (action === "create" || action === "edit" || action === "delete") return write;
    if (action === "approve") return false;
    return read; // view / export
  }
  return !!v[action];
}

/** Role default for a tab/action key within a module (default-allow unless explicit false). */
function roleAllowsKey(roleBlob: Record<string, any> | null, moduleKey: string, group: "tabs" | "actions", key: string): boolean {
  if (!roleBlob) return true;
  if (roleBlob.all === true) return true;
  const v = roleBlob[moduleKey];
  if (!v || typeof v !== "object") return true;
  const map = v[group];
  if (!map) return true;
  return map[key] !== false;
}

interface Props {
  userId: string;
  role: string;
  staffName?: string;
}

const StaffAccessPanel: React.FC<Props> = ({ userId, role, staffName }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { enabledModules } = useSubscriptionConfig();

  const [withholds, setWithholds] = useState<UserOverrideBlob>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Role ceiling
  const { data: roleBlob = null } = useQuery({
    queryKey: ["role-blob", hospitalId, role],
    queryFn: async () => {
      if (!hospitalId || !role) return null;
      const { data } = await supabase
        .from("role_permissions")
        .select("permissions")
        .eq("hospital_id", hospitalId)
        .eq("role_name", role)
        .maybeSingle();
      return (data?.permissions as Record<string, any>) ?? null;
    },
    enabled: !!hospitalId && !!role,
  });

  // Existing per-user override
  const { data: existingOverride } = useQuery({
    queryKey: ["user-override", userId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("user_permission_overrides")
        .select("permissions")
        .eq("user_id", userId)
        .maybeSingle();
      return (data?.permissions as UserOverrideBlob) ?? {};
    },
    enabled: !!userId,
  });

  // Seed local state once the override row loads
  React.useEffect(() => {
    if (existingOverride) setWithholds(structuredClone(existingOverride));
  }, [existingOverride]);

  const isEntitled = useCallback((key: string) => isModuleKeyAllowed(key, enabledModules), [enabledModules]);

  const isWithheld = (mod: string, action: Crud) => withholds[mod]?.[action] === false;
  const isKeyWithheld = (mod: string, group: "tabs" | "actions", key: string) =>
    (withholds[mod]?.[group] as Record<string, boolean> | undefined)?.[key] === false;

  const setCrudWithhold = (mod: string, action: Crud, withhold: boolean) => {
    setWithholds((prev) => {
      const next = structuredClone(prev);
      next[mod] = next[mod] ?? {};
      if (withhold) next[mod]![action] = false;
      else delete next[mod]![action];
      if (next[mod] && Object.keys(next[mod]!).length === 0) delete next[mod];
      return next;
    });
  };

  const setKeyWithhold = (mod: string, group: "tabs" | "actions", key: string, withhold: boolean) => {
    setWithholds((prev) => {
      const next = structuredClone(prev);
      next[mod] = next[mod] ?? {};
      const map = (next[mod]![group] as Record<string, boolean>) ?? {};
      if (withhold) map[key] = false;
      else delete map[key];
      if (Object.keys(map).length > 0) (next[mod] as any)[group] = map;
      else delete (next[mod] as any)[group];
      if (next[mod] && Object.keys(next[mod]!).length === 0) delete next[mod];
      return next;
    });
  };

  const toggleExpand = (mod: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(mod)) n.delete(mod);
      else n.add(mod);
      return n;
    });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital");
      const hasAny = Object.keys(withholds).length > 0;
      if (!hasAny) {
        // Pure inherit → drop the row entirely
        await (supabase as any).from("user_permission_overrides").delete().eq("user_id", userId);
        return;
      }
      const { error } = await (supabase as any)
        .from("user_permission_overrides")
        .upsert(
          {
            user_id: userId,
            hospital_id: hospitalId,
            permissions: withholds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-override", userId] });
      toast({ title: "Access saved", description: `Per-user access updated${staffName ? ` for ${staffName}` : ""}.` });
    },
    onError: (e: any) => toast({ title: "Failed to save access", description: e.message, variant: "destructive" }),
  });

  const withheldCount = useMemo(() => Object.keys(withholds).length, [withholds]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-5 py-3 border-b border-border flex items-center gap-2">
        <ShieldCheck size={15} className="text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">User Access Overrides</p>
          <p className="text-[11px] text-muted-foreground">
            Restrict this user within the <span className="font-medium">{role}</span> role. Locked rows are not granted by the role.
          </p>
        </div>
        <Button size="sm" className="gap-1 h-8" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save size={13} /> Save
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
        {withheldCount > 0 && (
          <p className="text-[11px] text-amber-600 mb-2">
            {withheldCount} module{withheldCount > 1 ? "s" : ""} restricted for this user.
          </p>
        )}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_repeat(6,44px)] bg-muted/50 border-b border-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Module</div>
            {CRUD.map((a) => (
              <div key={a} className="px-1 py-2 text-[9px] font-bold uppercase text-muted-foreground text-center capitalize">
                {a.slice(0, 4)}
              </div>
            ))}
          </div>

          {CATEGORIES.map((cat: ModuleCategory) => {
            const catModules = PERMISSION_MODULES.filter((m) => m.category === cat);
            if (catModules.length === 0) return null;
            return (
              <React.Fragment key={cat}>
                <div className="grid grid-cols-[1fr_repeat(6,44px)] bg-muted/40 border-b border-border">
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{cat}</div>
                  <div className="col-span-6" />
                </div>
                {catModules.map((mod) => {
                  const entitled = isEntitled(mod.key);
                  const grantsView = entitled && roleGrants(roleBlob, mod.key, "view");
                  const modTabs = MODULE_TABS[mod.key] ?? [];
                  const modActions = MODULE_ACTIONS[mod.key] ?? [];
                  const hasCustomize = grantsView && (modTabs.length > 0 || modActions.length > 0);
                  const isExpanded = expanded.has(mod.key);
                  const locked = !grantsView;
                  return (
                    <React.Fragment key={mod.key}>
                      <div className={cn(
                        "group grid grid-cols-[1fr_repeat(6,44px)] border-b border-border",
                        locked ? "bg-muted/20 opacity-60" : "hover:bg-muted/30",
                      )}>
                        <div className="px-3 py-2 flex items-center gap-1.5 min-w-0">
                          <span className="text-xs">{mod.icon}</span>
                          <span className="text-[12px] text-foreground truncate">{mod.label}</span>
                          {!entitled ? (
                            <Badge variant="outline" className="text-[8px] h-4 px-1 text-muted-foreground border-border gap-0.5 shrink-0">
                              <Lock size={7} /> Not in plan
                            </Badge>
                          ) : locked ? (
                            <Badge variant="outline" className="text-[8px] h-4 px-1 text-muted-foreground border-border gap-0.5 shrink-0">
                              <Lock size={7} /> Role has no access
                            </Badge>
                          ) : null}
                          {hasCustomize && (
                            <button
                              onClick={() => toggleExpand(mod.key)}
                              className="ml-auto flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded border border-transparent hover:border-border shrink-0"
                              title="Restrict tabs & actions"
                            >
                              <Layers size={9} />
                              {isExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                            </button>
                          )}
                        </div>
                        {CRUD.map((action) => {
                          const roleAllows = entitled && roleGrants(roleBlob, mod.key, action);
                          const checked = roleAllows && !isWithheld(mod.key, action);
                          return (
                            <div key={action} className="flex items-center justify-center py-2">
                              <Switch
                                checked={checked}
                                disabled={!roleAllows}
                                onCheckedChange={(v) => setCrudWithhold(mod.key, action, !v)}
                                className="scale-[0.6]"
                              />
                            </div>
                          );
                        })}
                      </div>

                      {isExpanded && hasCustomize && (
                        <div className="border-b border-border bg-muted/20">
                          {modTabs.length > 0 && (
                            <div className="px-5 py-2 border-b border-border/30">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Layers size={10} className="text-blue-500" />
                                <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Tabs</span>
                              </div>
                              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                                {modTabs.map((tab) => {
                                  const roleAllows = roleAllowsKey(roleBlob, mod.key, "tabs", tab.key);
                                  const checked = roleAllows && !isKeyWithheld(mod.key, "tabs", tab.key);
                                  return (
                                    <label key={tab.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <Switch checked={checked} disabled={!roleAllows} onCheckedChange={(v) => setKeyWithhold(mod.key, "tabs", tab.key, !v)} className="scale-[0.6]" />
                                      <span className={cn("text-[11px]", checked ? "text-foreground" : "text-muted-foreground line-through")}>{tab.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {modActions.length > 0 && (
                            <div className="px-5 py-2">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <Zap size={10} className="text-rose-500" />
                                <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wide">Actions</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                                {modActions.map((act) => {
                                  const roleAllows = roleAllowsKey(roleBlob, mod.key, "actions", act.key);
                                  const checked = roleAllows && !isKeyWithheld(mod.key, "actions", act.key);
                                  return (
                                    <label key={act.key} className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <Switch checked={checked} disabled={!roleAllows} onCheckedChange={(v) => setKeyWithhold(mod.key, "actions", act.key, !v)} className="scale-[0.6] shrink-0" />
                                      <span className={cn("text-[11px]", checked ? "text-foreground" : "text-muted-foreground line-through")}>{act.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StaffAccessPanel;
