import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Edit2, Save, X, Loader2, Check, Users } from "lucide-react";
import { toast } from "sonner";
import { ALL_MODULES } from "@/lib/modules";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";

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
  trial_days: number; is_active: boolean;
  is_custom_price: boolean; sort_order: number;
  badge_text: string | null; description: string | null;
  razorpay_plan_id: string | null;
}

const ROUTE_KEY: Record<string, string> = {
  "/opd":"opd","/ipd":"ipd","/ipd/day-care":"day_care","/emergency":"emergency",
  "/ot":"ot","/nursing":"nursing","/telemedicine":"telemedicine","/packages":"health_packages",
  "/lab":"lab","/radiology":"radiology","/blood-bank":"blood_bank","/cssd":"cssd",
  "/pharmacy":"pharmacy","/pharmacy?mode=retail":"pharmacy_retail","/billing":"billing",
  "/billing/closure":"day_closure","/insurance":"insurance","/payments":"payments",
  "/accounts":"accounts","/assets":"assets","/pmjay":"pmjay","/hr":"hr",
  "/inventory":"inventory","/quality":"quality","/dialysis":"dialysis","/oncology":"oncology",
  "/physio":"physio","/mortuary":"mortuary","/vaccination":"vaccination","/ambulance":"ambulance",
  "/home-care":"home_care","/dental":"dental","/ayush":"ayush","/ivf":"ivf",
  "/specialty/anc":"obstetric_anc","/specialty/neonatal":"neonatal",
  "/specialty/anaesthesia":"anaesthesia","/specialty/ophthalmology":"ophthalmology",
  "/specialty/partograph":"partograph","/mental-health":"mental_health",
  "/chronic-disease":"chronic_disease","/mrd":"mrd","/biomedical":"biomedical",
  "/housekeeping":"housekeeping","/hmis":"hmis","/dietetics":"dietetics","/lms":"lms",
  "/crm":"crm","/abdm":"abdm","/portal":"patient_portal","/pro":"patient_relations",
  "/inbox":"inbox","/analytics":"analytics","/hod-dashboard":"hod_dashboard",
  "/tv-display":"tv_display","/settings":"settings",
};
const ALL_KEYS = [...new Set(Object.values(ROUTE_KEY))];

async function fetchPlans() {
  const [pRes, fRes] = await Promise.all([
    (supabase as any).from("subscription_plans").select("*").order("sort_order"),
    (supabase as any).from("plan_features").select("plan_id, module_key, is_enabled"),
  ]);
  const featureMap = new Map<string, Map<string, boolean>>();
  for (const f of (fRes.data || [])) {
    if (!featureMap.has(f.plan_id)) featureMap.set(f.plan_id, new Map());
    featureMap.get(f.plan_id)!.set(f.module_key, f.is_enabled);
  }
  return { plans: (pRes.data || []) as Plan[], featureMap };
}

const BLANK_PLAN: Partial<Plan> = {
  name: "", slug: "", price_monthly: 0, price_yearly: 0,
  max_beds: 50, max_staff: 20, trial_days: 30,
  is_active: true, is_custom_price: false, sort_order: 99,
  badge_text: null, description: null, razorpay_plan_id: null,
};

export default function PlansManagerPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"plans" | "leads">("plans");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Plan>>(BLANK_PLAN);
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [isNew, setIsNew] = useState(false);

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
    setForm({ ...plan });
    setIsNew(false);
    const planFeatures = data?.featureMap.get(plan.id) || new Map();
    // Mirror the app's gate exactly: with any feature rows, a module is enabled only when
    // its row is === true (missing row = disabled). Zero rows = legacy "all open".
    const hasRows = planFeatures.size > 0;
    setEnabledKeys(new Set(ALL_KEYS.filter((k) => (hasRows ? planFeatures.get(k) === true : true))));
    setEditing(plan.id);
  };

  const openNew = () => {
    setForm({ ...BLANK_PLAN });
    setIsNew(true);
    setEnabledKeys(new Set(ALL_KEYS));
    setEditing("new");
  };

  const [planError, setPlanError] = useState<string | null>(null);

  const savePlan = useMutation({
    mutationFn: async () => {
      let planId = editing === "new" ? null : editing!;
      if (isNew || editing === "new") {
        const { data: inserted, error } = await (supabase as any)
          .from("subscription_plans").insert([form]).select("id").maybeSingle();
        if (error) throw error;
        if (!inserted) throw new Error("No data returned from plan insertion");
        planId = inserted.id;
      } else {
        const { error } = await (supabase as any).from("subscription_plans").update(form).eq("id", planId);
        if (error) throw error;
      }
      // Upsert all plan_features
      const rows = ALL_KEYS.map((k) => ({ plan_id: planId, module_key: k, is_enabled: enabledKeys.has(k) }));
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
                { label: "Trial Days", key: "trial_days" as const, type: "number" },
                { label: "Badge Text (e.g. Most Popular)", key: "badge_text" as const, type: "text" },
                { label: "Description", key: "description" as const, type: "text" },
                { label: "Razorpay Plan ID (from Razorpay Dashboard → Products → Plans)", key: "razorpay_plan_id" as const, type: "text" },
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
                    return (
                      <label key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
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
      </>
      )}
    </div>
  );
}
