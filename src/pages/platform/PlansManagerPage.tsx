import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit2, Save, X, Loader2, Check, Users, Sparkles, ArrowUp, ArrowDown, Trash2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ALL_MODULES } from "@/lib/modules";
import { ROUTE_TO_MODULE_KEY, CANONICAL_MODULE_KEYS } from "@/hooks/useSubscriptionConfig";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { callAIOrThrow } from "@/lib/aiProvider";
import { MODULE_TABS, MODULE_ACTIONS } from "@/lib/tabPermissions";
import { ModuleAccessDrawer } from "@/components/access/ModuleAccessDrawer";

type ModuleDetail = { tabs: Record<string, boolean>; actions: Record<string, boolean> };

type Highlight = { text: string; included: boolean };

interface EnterpriseLead {
  id: string;
  hospital_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  beds_range: string | null;
  state: string | null;
  message: string | null;
  status: "new" | "contacted" | "demo_scheduled" | "converted" | "lost";
  notes: string | null;
  created_at: string;
}

const LEAD_STATUS_COLORS: Record<string, string> = {
  new:            "bg-blue-500/15 text-blue-700",
  contacted:      "bg-amber-500/15 text-amber-700",
  demo_scheduled: "bg-purple-500/15 text-purple-700",
  converted:      "bg-emerald-500/15 text-emerald-700",
  lost:           "bg-red-500/15 text-red-600",
};

const LEAD_STATUSES = ["new", "contacted", "demo_scheduled", "converted", "lost"] as const;

interface Plan {
  id: string; name: string; slug: string;
  price_monthly: number; price_yearly: number;
  max_beds: number | null; max_staff: number | null;
  storage_included_gb: number | null;
  trial_days: number; is_active: boolean;
  is_custom_price: boolean; sort_order: number;
  badge_text: string | null; description: string | null;
  razorpay_plan_id: string | null;
  ai_included_budget_usd: number | null;
  feature_highlights: Highlight[];
}

// Single source of truth — shared with the runtime module gate (useSubscriptionConfig).
// Keeping these in sync guarantees that every module a CEO can toggle here is the same
// set the app gates with the "Module Not Enabled" lock screen.
const ROUTE_KEY = ROUTE_TO_MODULE_KEY;
const ALL_KEYS = CANONICAL_MODULE_KEYS;

async function fetchPlans() {
  const [pRes, fRes] = await Promise.all([
    (supabase as any).from("subscription_plans").select("*").order("sort_order"),
    (supabase as any).from("plan_features").select("plan_id, module_key, is_enabled, tabs, actions"),
  ]);
  const featureMap = new Map<string, Map<string, boolean>>();
  const featureDetailMap = new Map<string, Map<string, ModuleDetail>>();
  for (const f of (fRes.data || [])) {
    if (!featureMap.has(f.plan_id)) featureMap.set(f.plan_id, new Map());
    featureMap.get(f.plan_id)!.set(f.module_key, f.is_enabled);
    if (!featureDetailMap.has(f.plan_id)) featureDetailMap.set(f.plan_id, new Map());
    featureDetailMap.get(f.plan_id)!.set(f.module_key, { tabs: f.tabs || {}, actions: f.actions || {} });
  }
  return { plans: (pRes.data || []) as Plan[], featureMap, featureDetailMap };
}

const BLANK_PLAN: Partial<Plan> = {
  name: "", slug: "", price_monthly: 0, price_yearly: 0,
  max_beds: 50, max_staff: 20, storage_included_gb: null, trial_days: 30,
  is_active: true, is_custom_price: false, sort_order: 99,
  badge_text: null, description: null, razorpay_plan_id: null,
  ai_included_budget_usd: null, feature_highlights: [],
};

export default function PlansManagerPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"plans" | "leads">("plans");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Plan>>(BLANK_PLAN);
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [isNew, setIsNew] = useState(false);
  // Per-module tab/action defaults for the plan being edited (module_key → withheld maps).
  // Staged locally; persisted with the rest of the plan on "Save Changes".
  const [planDetails, setPlanDetails] = useState<Map<string, ModuleDetail>>(new Map());
  const [customiseKey, setCustomiseKey] = useState<string | null>(null);

  const toggleKey = (key: string) => {
    setEnabledKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const { data, isLoading } = useQuery({
    queryKey: ["platform-plans"],
    queryFn: fetchPlans,
    staleTime: 60_000,
  });

  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["enterprise-leads"],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("enterprise_leads")
        .select("*")
        .order("created_at", { ascending: false });
      return (rows || []) as EnterpriseLead[];
    },
    staleTime: 30_000,
  });

  const updateLeadStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      await (supabase as any)
        .from("enterprise_leads")
        .update({ status, ...(notes !== undefined ? { notes } : {}), updated_at: new Date().toISOString() })
        .eq("id", id);
    },
    onSuccess: () => {
      toast.success("Lead updated");
      qc.invalidateQueries({ queryKey: ["enterprise-leads"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const openEdit = (plan: Plan) => {
    setForm({ ...plan, feature_highlights: Array.isArray(plan.feature_highlights) ? plan.feature_highlights : [] });
    setIsNew(false);
    const planFeatures = data?.featureMap.get(plan.id) || new Map();
    // Mirror the app's gate exactly: with any feature rows, a module is enabled only when
    // its row is === true (missing row = disabled). Zero rows = legacy "all open".
    const hasRows = planFeatures.size > 0;
    setEnabledKeys(new Set(ALL_KEYS.filter((k) => {
      // AI master defaults ON: a plan with no ai_suite row still has AI enabled.
      if (k === "ai_suite") return planFeatures.get("ai_suite") !== false;
      return hasRows ? planFeatures.get(k) === true : true;
    })));
    const details = data?.featureDetailMap.get(plan.id);
    setPlanDetails(
      details
        ? new Map(Array.from(details, ([k, v]) => [k, { tabs: { ...v.tabs }, actions: { ...v.actions } }]))
        : new Map(),
    );
    setEditing(plan.id);
  };

  const openNew = () => {
    setForm({ ...BLANK_PLAN });
    setIsNew(true);
    setEnabledKeys(new Set(ALL_KEYS));
    setPlanDetails(new Map());
    setEditing("new");
  };

  const [planError, setPlanError] = useState<string | null>(null);

  const savePlan = useMutation({
    mutationFn: async () => {
      let planId = editing === "new" ? null : editing!;
      // Drop blank-text bullets before persisting.
      const payload = {
        ...form,
        feature_highlights: (form.feature_highlights ?? []).filter((h) => h.text.trim() !== ""),
      };
      if (isNew || editing === "new") {
        const { data: inserted, error } = await (supabase as any)
          .from("subscription_plans").insert([payload]).select("id").maybeSingle();
        if (error) throw error;
        if (!inserted) throw new Error("No data returned from plan insertion");
        planId = inserted.id;
      } else {
        const { error } = await (supabase as any).from("subscription_plans").update(payload).eq("id", planId);
        if (error) throw error;
      }
      // Upsert all plan_features (module on/off + per-module tab/action defaults)
      const rows = ALL_KEYS.map((k) => {
        const d = planDetails.get(k);
        return { plan_id: planId, module_key: k, is_enabled: enabledKeys.has(k), tabs: d?.tabs ?? {}, actions: d?.actions ?? {} };
      });
      const { error: featError } = await (supabase as any).from("plan_features")
        .upsert(rows, { onConflict: "plan_id,module_key" });
      if (featError) throw featError;
    },
    onSuccess: () => {
      setPlanError(null);
      toast.success("Plan saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["platform-plans"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setPlanError(m); toast.error(m); },
  });

  const togglePlanActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await (supabase as any).from("subscription_plans").update({ is_active }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-plans"] }),
  });

  const f = (key: keyof Plan, val: any) => setForm((p) => ({ ...p, [key]: val }));

  // ── Feature-highlight editor helpers ──
  const highlights: Highlight[] = form.feature_highlights ?? [];
  const setHighlights = (next: Highlight[]) => f("feature_highlights", next);
  const addHighlight = () => setHighlights([...highlights, { text: "", included: true }]);
  const updateHighlight = (i: number, patch: Partial<Highlight>) =>
    setHighlights(highlights.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const removeHighlight = (i: number) => setHighlights(highlights.filter((_, idx) => idx !== i));
  const moveHighlight = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= highlights.length) return;
    const next = [...highlights];
    [next[i], next[j]] = [next[j], next[i]];
    setHighlights(next);
  };

  // ── AI copywriter: draft description + ✓/✗ bullets from the plan's context ──
  const [aiLoading, setAiLoading] = useState(false);
  const generateCopy = async () => {
    setAiLoading(true);
    try {
      const enabledLabels = ALL_MODULES
        .map((m) => ({ key: ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]], name: m.name }))
        .filter((m) => m.key && enabledKeys.has(m.key))
        .map((m) => m.name);
      const priceLine = form.is_custom_price ? "Custom / Contact Sales" : `₹${Number(form.price_monthly) || 0}/month`;
      const prompt = [
        `Plan name: ${form.name || "(unnamed)"}`,
        `Price: ${priceLine}`,
        `Max beds: ${form.max_beds ?? "unlimited"} · Max staff: ${form.max_staff ?? "unlimited"}`,
        `Included modules (${enabledLabels.length}): ${enabledLabels.join(", ") || "none specified"}`,
        "",
        "Write marketing copy for this hospital-software subscription plan's pricing card.",
      ].join("\n");
      const systemPrompt =
        "You are a SaaS pricing-page copywriter for a hospital management system sold in India. " +
        "Return ONLY valid minified JSON, no markdown fences, matching exactly: " +
        '{"description": string, "highlights": [{"text": string, "included": boolean}]}. ' +
        "description: one crisp sentence naming the ideal customer. " +
        "highlights: 6-9 short benefit bullets. Set included=true for capabilities this plan HAS " +
        "(base them on the included modules list); set included=false for 2-3 notable higher-tier " +
        "features this plan LACKS (upsell hints shown with a cross). Keep each text under 6 words.";
      const res = await callAIOrThrow({ featureKey: "plan_copywriter", prompt, systemPrompt, hospitalId: "", maxTokens: 800 });
      const raw = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(raw);
      const list: Highlight[] = Array.isArray(parsed?.highlights)
        ? parsed.highlights
            .filter((h: any) => h && typeof h.text === "string")
            .map((h: any) => ({ text: String(h.text), included: h.included !== false }))
        : [];
      if (!list.length) throw new Error("AI returned no usable highlights");
      setForm((p) => ({
        ...p,
        description: typeof parsed?.description === "string" && parsed.description ? parsed.description : p.description,
        feature_highlights: list,
      }));
      toast.success("AI draft ready — review and Save");
    } catch (e: any) {
      toast.error(getErrorMessage(e) || "AI generation failed");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-[15px] font-semibold text-foreground">Plans Manager</h1>
          <div className="flex gap-1">
            {(["plans", "leads"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              >
                {tab === "plans" ? "Subscription Plans" : (
                  <span className="flex items-center gap-1.5">
                    <Users size={11} /> Enterprise Leads
                    {leads && leads.filter(l => l.status === "new").length > 0 && (
                      <span className="bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">
                        {leads.filter(l => l.status === "new").length}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        {activeTab === "plans" && (
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors">
            <Plus size={12} /> New Plan
          </button>
        )}
      </div>

      {/* Enterprise Leads tab */}
      {activeTab === "leads" && (
        <div className="flex-1 overflow-auto p-6">
          {leadsLoading ? (
            <div className="flex items-center justify-center h-40"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
          ) : !leads || leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Users size={28} className="opacity-30" />
              <p className="text-sm">No enterprise leads yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {leads.map((lead) => (
                <div key={lead.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{lead.hospital_name}</p>
                      <p className="text-xs text-muted-foreground">{lead.contact_name} · {lead.email} {lead.phone ? `· ${lead.phone}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{lead.beds_range ?? "—"} beds · {lead.state ?? "—"}</p>
                      {lead.message && (
                        <p className="text-xs text-muted-foreground mt-1 italic">"{lead.message}"</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${LEAD_STATUS_COLORS[lead.status] ?? ""}`}>
                        {lead.status.replace("_", " ")}
                      </span>
                      <p className="text-[10px] text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-IN")}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground shrink-0">Move to:</span>
                    {LEAD_STATUSES.filter(s => s !== lead.status).map(s => (
                      <button
                        key={s}
                        onClick={() => updateLeadStatus.mutate({ id: lead.id, status: s })}
                        className={`text-[10px] px-2 py-0.5 rounded-md transition-colors border ${LEAD_STATUS_COLORS[s]} border-current/20 hover:opacity-80`}
                      >
                        {s.replace("_", " ")}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add internal notes..."
                      defaultValue={lead.notes ?? ""}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (lead.notes ?? "")) {
                          updateLeadStatus.mutate({ id: lead.id, status: lead.status, notes: val });
                        }
                      }}
                      className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                    />
                    <a
                      href={`mailto:${lead.email}?subject=Aumrti Enterprise HMS — Follow Up`}
                      className="h-7 px-3 flex items-center text-xs text-muted-foreground border border-border rounded hover:bg-muted transition-colors"
                    >
                      Email
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Plans tab */}
      {activeTab === "plans" && (
      <>
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {(data?.plans || []).map((plan) => {
              const features = data?.featureMap.get(plan.id) || new Map();
              // Same gate semantics as openEdit: missing row = disabled (unless zero rows = legacy all-open).
              const hasRows = features.size > 0;
              const enabledCount = ALL_KEYS.filter((k) => (hasRows ? features.get(k) === true : true)).length;
              return (
                <div key={plan.id} className={`bg-card border rounded-xl p-5 space-y-3 shadow-sm ${plan.is_active ? "border-border" : "border-border opacity-60"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-foreground">{plan.name}</p>
                      {plan.badge_text && (
                        <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full">{plan.badge_text}</span>
                      )}
                    </div>
                    <button onClick={() => openEdit(plan)} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Edit2 size={13} />
                    </button>
                  </div>
                  <p className="text-xl font-bold text-foreground font-mono">
                    {plan.is_custom_price ? "Custom" : `₹${plan.price_monthly.toLocaleString("en-IN")}/mo`}
                  </p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Max beds: {plan.max_beds ?? "Unlimited"}</p>
                    <p>Modules: {enabledCount} / {ALL_KEYS.length}</p>
                    <p>Trial: {plan.trial_days} days</p>
                    <p className={plan.razorpay_plan_id ? "text-emerald-600" : "text-amber-600"}>
                      {plan.razorpay_plan_id
                        ? `✓ Razorpay: ${plan.razorpay_plan_id}`
                        : "⚠ No Razorpay Plan ID"}
                    </p>
                  </div>
                  <button
                    onClick={() => togglePlanActive.mutate({ id: plan.id, is_active: !plan.is_active })}
                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${plan.is_active ? "bg-red-500/20 text-red-600 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/30"}`}
                  >
                    {plan.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit / Create drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setEditing(null)} />
          <div className="w-[560px] bg-card border-l border-border flex flex-col h-full overflow-auto">
            <div className="h-14 border-b border-border flex items-center justify-between px-5 shrink-0">
              <p className="text-sm font-semibold text-foreground">{isNew ? "Create Plan" : "Edit Plan"}</p>
              <button onClick={() => setEditing(null)}><X size={16} className="text-muted-foreground hover:text-foreground" /></button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Basic fields */}
              {[
                { label: "Plan Name", key: "name" as const, type: "text" },
                { label: "Slug (unique)", key: "slug" as const, type: "text" },
                { label: "Monthly Price (₹)", key: "price_monthly" as const, type: "number" },
                { label: "Yearly Price (₹)", key: "price_yearly" as const, type: "number" },
                { label: "Max Beds (blank = unlimited)", key: "max_beds" as const, type: "number" },
                { label: "Max Staff (blank = unlimited)", key: "max_staff" as const, type: "number" },
                { label: "Storage Included (GB, blank = unlimited)", key: "storage_included_gb" as const, type: "number" },
                { label: "Trial Days", key: "trial_days" as const, type: "number" },
                { label: "Badge Text (e.g. Most Popular)", key: "badge_text" as const, type: "text" },
                { label: "Description", key: "description" as const, type: "text" },
                { label: "Razorpay Plan ID (from Razorpay Dashboard → Products → Plans)", key: "razorpay_plan_id" as const, type: "text" },
                { label: "AI Budget Included (USD/month, blank = not metered)", key: "ai_included_budget_usd" as const, type: "number" },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    type={type}
                    value={(form[key] as any) ?? ""}
                    onChange={(e) => f(key, type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              ))}

              {/* Feature highlights (marketing bullets with ✓/✗) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Feature Highlights</p>
                  <button
                    onClick={generateCopy}
                    disabled={aiLoading}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 bg-primary/10 text-primary rounded font-semibold hover:bg-primary/20 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {aiLoading ? "Generating…" : "Generate with AI"}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">Shown on the plan card. Toggle the tick/cross per bullet.</p>
                <div className="space-y-1.5">
                  {highlights.map((h, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateHighlight(i, { included: !h.included })}
                        title={h.included ? "Included (✓) — click to mark not included" : "Not included (✗) — click to mark included"}
                        className={`w-6 h-7 shrink-0 rounded border flex items-center justify-center ${h.included ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600" : "bg-muted border-border text-muted-foreground"}`}
                      >
                        {h.included ? <Check size={13} /> : <X size={13} />}
                      </button>
                      <input
                        value={h.text}
                        onChange={(e) => updateHighlight(i, { text: e.target.value })}
                        placeholder="e.g. Insurance / TPA"
                        className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                      />
                      <button onClick={() => moveHighlight(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"><ArrowUp size={13} /></button>
                      <button onClick={() => moveHighlight(i, 1)} disabled={i === highlights.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"><ArrowDown size={13} /></button>
                      <button onClick={() => removeHighlight(i)} className="text-muted-foreground hover:text-red-600 p-0.5"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={addHighlight} className="mt-2 flex items-center gap-1 text-[11px] px-2 py-1 bg-muted text-foreground rounded hover:bg-muted/70">
                  <Plus size={11} /> Add bullet
                </button>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={form.is_custom_price ?? false} onChange={(e) => f("is_custom_price", e.target.checked)} />
                  Show "Contact Sales" instead of price
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => f("is_active", e.target.checked)} />
                  Active (visible to hospitals)
                </label>
              </div>

              {/* AI Features master (pseudo-module ai_suite) */}
              {(() => {
                const aiOn = enabledKeys.has("ai_suite");
                const d = planDetails.get("ai_suite");
                const aiWithheld = d ? Object.values(d.actions || {}).filter((v) => v === false).length : 0;
                return (
                  <div className="mb-5">
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">Artificial Intelligence</p>
                    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${aiOn ? "bg-violet-50 border-violet-300/60" : "bg-muted/40 border-border/60"}`}>
                      <label className="flex items-center gap-2 cursor-pointer flex-1 text-xs">
                        <input type="checkbox" className="sr-only" checked={aiOn} onChange={() => toggleKey("ai_suite")} />
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${aiOn ? "bg-violet-500 border-violet-500" : "border-border"}`}>
                          {aiOn && <Check size={8} className="text-white" />}
                        </div>
                        <Sparkles size={13} className={aiOn ? "text-violet-600" : "text-muted-foreground"} />
                        <span className="font-medium text-foreground">AI Features</span>
                        <span className="text-[10px] text-muted-foreground truncate">— master switch for all AI</span>
                      </label>
                      {aiOn && (
                        <button
                          type="button"
                          onClick={() => setCustomiseKey("ai_suite")}
                          title="Customise individual AI features for this plan"
                          className={`relative flex items-center justify-center h-6 w-6 rounded-md border shrink-0 transition-colors ${aiWithheld > 0 ? "bg-amber-100 border-amber-400/70 text-amber-700" : "bg-background border-border/70 text-muted-foreground hover:text-foreground"}`}
                        >
                          <SlidersHorizontal size={12} />
                          {aiWithheld > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[8px] font-bold leading-[13px] text-center">{aiWithheld}</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Module checklist grouped by category */}
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-3">Module Access</p>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setEnabledKeys(new Set(ALL_KEYS))} className="text-[10px] px-2 py-1 bg-primary/10 text-primary rounded">Select All</button>
                  <button onClick={() => setEnabledKeys(new Set())} className="text-[10px] px-2 py-1 bg-muted text-muted-foreground rounded">Clear All</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_MODULES.map((m) => {
                    const key = ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]];
                    if (!key) return null;
                    const on = enabledKeys.has(key);
                    const customisable = (MODULE_TABS[key]?.length ?? 0) > 0 || (MODULE_ACTIONS[key]?.length ?? 0) > 0;
                    const d = planDetails.get(key);
                    const withheld = d
                      ? Object.values(d.tabs || {}).filter((v) => v === false).length +
                        Object.values(d.actions || {}).filter((v) => v === false).length
                      : 0;
                    return (
                      <div key={key} className="flex items-center gap-1">
                        <label className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={on}
                            onChange={() => toggleKey(key)}
                          />
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? "bg-primary border-primary" : "border-border"}`}>
                            {on && <Check size={8} className="text-primary-foreground" />}
                          </div>
                          <span className="truncate">{m.name}</span>
                        </label>
                        {customisable && (
                          <button
                            type="button"
                            onClick={() => setCustomiseKey(key)}
                            title="Customise tabs & buttons for this plan"
                            className={`relative flex items-center justify-center h-6 w-6 rounded-md border shrink-0 transition-colors ${withheld > 0 ? "bg-amber-100 border-amber-400/70 text-amber-700" : "bg-background border-border/70 text-muted-foreground hover:text-foreground"}`}
                          >
                            <SlidersHorizontal size={12} />
                            {withheld > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[8px] font-bold leading-[13px] text-center">
                                {withheld}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border shrink-0 space-y-3">
              <FormError message={planError} />
              <button
                onClick={() => savePlan.mutate()}
                disabled={!form.name || !form.slug || savePlan.isPending}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {savePlan.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isNew ? "Create Plan" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Customise a module's tabs/buttons for THIS plan (default for its hospitals) ── */}
      {customiseKey && (
        <ModuleAccessDrawer
          moduleKey={customiseKey}
          moduleLabel={customiseKey === "ai_suite" ? "AI Features" : (ALL_MODULES.find((m) => (ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]]) === customiseKey)?.name || customiseKey)}
          subtitle={customiseKey === "ai_suite" ? "Default AI features for hospitals on this plan. A hospital can override these per-hospital." : "Default tabs & buttons for hospitals on this plan. A hospital can override these per-hospital."}
          initialTabs={Object.fromEntries((MODULE_TABS[customiseKey] ?? []).map((t) => [t.key, planDetails.get(customiseKey)?.tabs?.[t.key] !== false]))}
          initialActions={Object.fromEntries((MODULE_ACTIONS[customiseKey] ?? []).map((a) => [a.key, planDetails.get(customiseKey)?.actions?.[a.key] !== false]))}
          saving={false}
          onClose={() => setCustomiseKey(null)}
          onSave={(tabs, actions) => {
            const tabsOff = Object.fromEntries(Object.entries(tabs).filter(([, v]) => v === false));
            const actionsOff = Object.fromEntries(Object.entries(actions).filter(([, v]) => v === false));
            const mk = customiseKey;
            setPlanDetails((prev) => {
              const next = new Map(prev);
              if (Object.keys(tabsOff).length === 0 && Object.keys(actionsOff).length === 0) next.delete(mk);
              else next.set(mk, { tabs: tabsOff, actions: actionsOff });
              return next;
            });
            setCustomiseKey(null);
          }}
        />
      )}
      </>
      )}
    </div>
  );
}
