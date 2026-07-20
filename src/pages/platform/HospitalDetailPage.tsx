import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, Save, Loader2, Trash2, AlertTriangle, X, Activity, Eye, SlidersHorizontal, Sparkles } from "lucide-react";
import { MODULE_TABS, MODULE_ACTIONS } from "@/lib/tabPermissions";
import { ModuleAccessDrawer } from "@/components/access/ModuleAccessDrawer";
import { toast } from "sonner";
import { getErrorMessage, getInvokeError } from "@/lib/errorMessage";
import { deleteHospitalStream, checkDeletePrerequisites, type DeletePreflightResult } from "@/lib/deleteHospitalStream";
import { Progress } from "@/components/ui/progress";
import { FormError } from "@/components/ui/FormError";
import { PLATFORM_STATUS_PILL } from "@/lib/platform-utils";
import { formatINRExact } from "@/lib/currency";
import { logAdminAction } from "@/lib/adminAudit";
import { startImpersonation } from "@/lib/impersonation";

// ── Usage tab data fetcher ────────────────────────────────────────────────────
interface UsageData {
  opd: number; billing: number; ipd: number; lab: number;
  radiology: number; er: number; ot: number; insurance: number;
  pharmacy: number; hr: number;
}

async function fetchHospitalUsage(hospitalId: string): Promise<UsageData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const hid = hospitalId;

  const [opd, billing, ipd, lab, radiology, er, ot, insurance, pharmacy, hr] = await Promise.all([
    (supabase as any).from("opd_tokens").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("bills").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("admissions").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("admitted_at", thirtyDaysAgo),
    (supabase as any).from("lab_orders").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("radiology_orders").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("ed_visits").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("arrival_time", thirtyDaysAgo),
    (supabase as any).from("ot_schedules").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("insurance_claims").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("pharmacy_dispenses").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("created_at", thirtyDaysAgo),
    (supabase as any).from("staff_attendance").select("id", { count: "exact", head: true })
      .eq("hospital_id", hid).gte("date", thirtyDaysAgo.substring(0, 10)),
  ]);

  return {
    opd:       opd.count       || 0,
    billing:   billing.count   || 0,
    ipd:       ipd.count       || 0,
    lab:       lab.count       || 0,
    radiology: radiology.count || 0,
    er:        er.count        || 0,
    ot:        ot.count        || 0,
    insurance: insurance.count || 0,
    pharmacy:  pharmacy.count  || 0,
    hr:        hr.count        || 0,
  };
}
import { ALL_MODULES } from "@/lib/modules";
import { CANONICAL_MODULE_KEYS } from "@/hooks/useSubscriptionConfig";

// ── Users tab data fetcher ────────────────────────────────────────────────────
interface HospitalUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  designation: string | null;
  is_active: boolean;
  last_login: string | null;
  employee_id: string | null;
}

async function fetchHospitalUsers(hospitalId: string): Promise<HospitalUser[]> {
  const { data } = await (supabase as any)
    .from("users")
    .select("id, full_name, email, phone, role, designation, is_active, last_login, employee_id")
    .eq("hospital_id", hospitalId)
    .order("is_active", { ascending: false })
    .order("full_name");
  return (data || []) as HospitalUser[];
}

// ── helpers ──────────────────────────────────────────────────

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
const MODULE_NAME: Record<string, string> = Object.fromEntries(
  ALL_MODULES.map((m) => [ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]], m.name])
);
const MODULE_CATEGORY: Record<string, string> = Object.fromEntries(
  ALL_MODULES.map((m) => [ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]], m.category])
);

const STATUS_PILL = PLATFORM_STATUS_PILL;

// ── data fetchers ─────────────────────────────────────────────

async function fetchHospitalDetail(id: string) {
  const [hRes, sRes, overRes, pricRes, plansRes, entRes] = await Promise.all([
    (supabase as any).from("hospitals").select("*").eq("id", id).maybeSingle(),
    (supabase as any).from("hospital_subscriptions")
      .select("*, subscription_plans(id,name,slug,price_monthly,price_yearly,max_beds,max_staff,storage_included_gb,trial_days,description)")
      .eq("hospital_id", id).maybeSingle(),
    (supabase as any).from("hospital_feature_overrides")
      .select("module_key, is_enabled, reason").eq("hospital_id", id),
    (supabase as any).from("hospital_pricing_overrides")
      .select("*").eq("hospital_id", id).maybeSingle(),
    (supabase as any).from("subscription_plans")
      .select("id, name, slug, price_monthly").eq("is_active", true).order("sort_order"),
    (supabase as any).from("hospital_module_entitlements")
      .select("module_key, tabs, actions").eq("hospital_id", id),
  ]);
  return {
    hospital: hRes.data,
    subscription: sRes.data,
    overrides: (overRes.data || []) as Array<{ module_key: string; is_enabled: boolean; reason: string | null }>,
    pricing: pricRes.data,
    plans: (plansRes.data || []) as Array<{ id: string; name: string; slug: string; price_monthly: number }>,
    entitlements: (entRes.data || []) as Array<{ module_key: string; tabs: Record<string, boolean>; actions: Record<string, boolean> }>,
  };
}

async function fetchPlanFeatures(planId: string) {
  const { data } = await (supabase as any).from("plan_features")
    .select("module_key, is_enabled, tabs, actions").eq("plan_id", planId);
  const enabled = new Map<string, boolean>((data || []).map((f: any) => [f.module_key, f.is_enabled]));
  const details = new Map<string, { tabs: Record<string, boolean>; actions: Record<string, boolean> }>(
    (data || []).map((f: any) => [f.module_key, { tabs: f.tabs || {}, actions: f.actions || {} }])
  );
  return { enabled, details };
}

// ── component ─────────────────────────────────────────────────

const TABS = ["Overview", "Users", "Subscription", "Modules", "Pricing", "Notes", "Usage"];

export default function HospitalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("Overview");

  const { data, isLoading } = useQuery({
    queryKey: ["platform-hospital", id],
    queryFn: () => fetchHospitalDetail(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const planId = data?.subscription?.plan_id;
  const { data: planFeatureMap } = useQuery({
    queryKey: ["plan-features", planId],
    queryFn: () => fetchPlanFeatures(planId!),
    enabled: !!planId,
    staleTime: 5 * 60_000,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ["platform-hospital-usage", id],
    queryFn: () => fetchHospitalUsage(id!),
    enabled: !!id && tab === "Usage",
    staleTime: 5 * 60_000,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["platform-hospital-users", id],
    queryFn: () => fetchHospitalUsers(id!),
    enabled: !!id && tab === "Users",
    staleTime: 5 * 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["platform-hospital", id] });

  // ── Subscription actions ──
  const [selPlan, setSelPlan] = useState("");
  const [selStatus, setSelStatus] = useState("");
  const [subNotes, setSubNotes] = useState("");
  // Manual trial-end override (yyyy-mm-dd, "" = leave to the plan's trial_days).
  const [selTrialEnd, setSelTrialEnd] = useState("");
  const [selConvMode, setSelConvMode] = useState("conversion_date");

  // The Plan / Status dropdowns show the hospital's CURRENT plan and status as the
  // selected value (no "Keep current" placeholder). Re-sync whenever the underlying
  // subscription changes (initial load, or after a save + refetch); the deps stay
  // stable while the admin is mid-edit, so an in-progress selection is never clobbered.
  useEffect(() => {
    if (!data) return;
    if (data.subscription) {
      setSelPlan(data.subscription.plan_id || "");
      setSelStatus(data.subscription.status || "trial");
      setSelTrialEnd(data.subscription.trial_ends_at ? String(data.subscription.trial_ends_at).slice(0, 10) : "");
      setSelConvMode(data.subscription.conversion_period_start_mode || "conversion_date");
    } else {
      setSelPlan(data.plans?.[0]?.id || "");
      setSelStatus("trial");
    }
  }, [data?.subscription?.plan_id, data?.subscription?.status, data?.subscription?.trial_ends_at, data?.plans]);
  const [subError, setSubError] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);

  const updateSub = useMutation({
    mutationFn: async () => {
      const payload: any = { notes: subNotes || data?.subscription?.notes };
      if (selPlan) payload.plan_id = selPlan;
      if (selStatus) payload.status = selStatus;
      payload.conversion_period_start_mode = selConvMode;
      // Only send trial_ends_at when the admin actually edited it. Sending it
      // unchanged would read as a manual override and suppress the plan rebase.
      const currentTrialEnd = data?.subscription?.trial_ends_at
        ? String(data.subscription.trial_ends_at).slice(0, 10) : "";
      if (selTrialEnd && selTrialEnd !== currentTrialEnd) {
        payload.trial_ends_at = new Date(`${selTrialEnd}T23:59:59`).toISOString();
      }
      if (data?.subscription) {
        const { error } = await (supabase as any).from("hospital_subscriptions")
          .update(payload).eq("hospital_id", id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("hospital_subscriptions")
          .insert({ hospital_id: id, ...payload, status: selStatus || "trial" });
        if (error) throw error;
      }
    },
    onSuccess: () => { setSubError(null); toast.success("Subscription updated"); invalidate(); qc.invalidateQueries({ queryKey: ["subscription-config", id] }); },
    onError: (e: any) => { const m = getErrorMessage(e); setSubError(m); toast.error(m); },
  });

  // Recompute trial_ends_at from the plan's CURRENT trial_days. Needed because
  // editing a plan's trial_days in Plans Manager does not touch live subscriptions.
  const resyncTrial = useMutation({
    mutationFn: async () => {
      const { data: newEnd, error } = await (supabase as any)
        .rpc("resync_trial_end", { p_hospital_id: id });
      if (error) throw error;
      return newEnd as string | null;
    },
    onSuccess: (newEnd) => {
      toast.success(newEnd
        ? `Trial resynced — now ends ${new Date(newEnd).toLocaleDateString("en-IN")}`
        : "No trial to resync (hospital is not on trial)");
      invalidate();
      qc.invalidateQueries({ queryKey: ["subscription-config", id] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  // ── Module override toggle ──
  const toggleModule = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      await (supabase as any).from("hospital_feature_overrides").upsert(
        { hospital_id: id, module_key: key, is_enabled: enabled },
        { onConflict: "hospital_id,module_key" }
      );
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-hospital", id] }); },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const removeOverride = useMutation({
    mutationFn: async (key: string) => {
      await (supabase as any).from("hospital_feature_overrides")
        .delete().eq("hospital_id", id).eq("module_key", key);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-hospital", id] }); },
  });

  // ── Per-module tab/action entitlement (Customise drawer) ──
  // The hospital layer stores overrides RELATIVE to the plan default: a tab/action
  // key is persisted only when the hospital's choice diverges from the plan default
  // (explicit `true` re-enables a plan-withheld tab; explicit `false` withholds one
  // the plan allows). A module row with no divergent keys is deleted → pure inherit.
  const [customiseKey, setCustomiseKey] = useState<string | null>(null);

  const saveEntitlement = useMutation({
    mutationFn: async ({ moduleKey, tabs, actions }: { moduleKey: string; tabs: Record<string, boolean>; actions: Record<string, boolean> }) => {
      const planDetail = planFeatureMap?.details.get(moduleKey);
      const diffVsPlan = (draft: Record<string, boolean>, planKind: Record<string, boolean> | undefined) => {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(draft)) {
          const planOn = planKind?.[k] !== false; // plan stores only false; absent = on
          if ((v !== false) !== planOn) out[k] = v; // keep only keys that diverge from the plan
        }
        return out;
      };
      const tabsOverride = diffVsPlan(tabs, planDetail?.tabs);
      const actionsOverride = diffVsPlan(actions, planDetail?.actions);

      if (Object.keys(tabsOverride).length === 0 && Object.keys(actionsOverride).length === 0) {
        // Matches the plan exactly → drop the row so the hospital purely inherits.
        await (supabase as any).from("hospital_module_entitlements")
          .delete().eq("hospital_id", id).eq("module_key", moduleKey);
        return;
      }
      const authUser = (await supabase.auth.getUser()).data.user;
      await (supabase as any).from("hospital_module_entitlements").upsert(
        {
          hospital_id: id,
          module_key: moduleKey,
          tabs: tabsOverride,
          actions: actionsOverride,
          updated_by: authUser?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "hospital_id,module_key" }
      );
    },
    onSuccess: (_r, vars) => {
      logAdminAction("hospital_module_entitlement_updated", { hospitalId: id, hospitalName: data?.hospital?.name, details: { module: vars.moduleKey } });
      toast.success("Module access customised");
      setCustomiseKey(null);
      qc.invalidateQueries({ queryKey: ["platform-hospital", id] });
      qc.invalidateQueries({ queryKey: ["subscription-config", id] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  // ── Pricing override ──
  const [pMonthly, setPMonthly] = useState("");
  const [pYearly, setPYearly] = useState("");
  const [pReason, setPReason] = useState("");

  // ── View as hospital (audited impersonation) ──
  const [impersonating, setImpersonating] = useState(false);
  const handleViewAsHospital = async () => {
    if (!id || !hospital) return;
    if (!window.confirm(`View the app as ${hospital.name}? This starts an audited impersonation session as one of their staff accounts.`)) return;
    setImpersonating(true);
    try {
      await startImpersonation(id);
      // Full navigation, not client-side routing — clears all React Query
      // cache and context state built for the admin's own (hospital-less)
      // session, so the impersonated view starts from a clean slate.
      window.location.href = "/opd";
    } catch (e) {
      toast.error(getErrorMessage(e) || "Failed to start impersonation.");
    } finally {
      setImpersonating(false);
    }
  };

  // ── Delete hospital ──
  // Step 0 = closed, Step 1 = warning modal, Step 2 = type-name confirmation
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteNameInput, setDeleteNameInput] = useState("");

  // Phase-2 streaming purge progress (real row counts from the edge function)
  const [isPurging, setIsPurging] = useState(false);
  const [purgeTotal, setPurgeTotal] = useState(0);
  const [purgeDone, setPurgeDone] = useState(0);
  const [purgeLabel, setPurgeLabel] = useState("");
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // Non-destructive delete prerequisite check (deploy / secret / admin)
  const [preflight, setPreflight] = useState<DeletePreflightResult | null>(null);

  const deleteHospital = useMutation({
    mutationFn: async () => {
      // delete-hospital is a two-phase soft-delete. Phase 1 (deleted_at null)
      // just marks the hospital and returns instantly. Phase 2 (grace elapsed)
      // streams a real progress bar via deleteHospitalStream. The helper always
      // surfaces the server's real error message.
      const isPurge = !!hospital?.deleted_at;
      if (isPurge) {
        // Open the progress modal and reset counters before the stream starts.
        setPurgeError(null);
        setPurgeTotal(0);
        setPurgeDone(0);
        setPurgeLabel("Preparing…");
        setIsPurging(true);
        setDeleteStep(0);
      }
      const result = await deleteHospitalStream(id!, {
        onTotal: (rows) => setPurgeTotal(rows),
        onPhase: (label, cumulative) => {
          setPurgeLabel(label);
          if (typeof cumulative === "number") setPurgeDone(cumulative);
        },
        onProgress: (p) => {
          setPurgeLabel(`Removing ${p.table}`);
          setPurgeDone(p.cumulative);
        },
      });
      if (result?.warnings?.length) {
        console.warn("Hospital delete warnings:", result.warnings);
      }
      return result;
    },
    onSuccess: (result) => {
      setDeleteNameInput("");
      if (result?.soft_deleted) {
        // Phase 1: marked for deletion, nothing purged yet.
        setDeleteStep(0);
        logAdminAction("hospital_delete_requested", { hospitalId: id, hospitalName: hospital?.name });
        toast.success(result.message || `${hospital?.name ?? "Hospital"} marked for deletion — 7-day grace period started.`);
        qc.invalidateQueries({ queryKey: ["platform-hospital", id] });
        return;
      }
      // Phase 2: the purge stream completed.
      setPurgeLabel("Done");
      setPurgeDone(result?.cumulative ?? purgeTotal);
      logAdminAction("hospital_purged", { hospitalId: id, hospitalName: hospital?.name, details: { deleted_auth_users: result?.deleted_auth_users } });
      const staffMsg = (result?.deleted_auth_users ?? 0) > 0
        ? ` · ${result!.deleted_auth_users} staff account${result!.deleted_auth_users! > 1 ? "s" : ""} removed`
        : "";
      toast.success(`${hospital?.name ?? "Hospital"} permanently deleted${staffMsg}`);
      qc.invalidateQueries({ queryKey: ["platform-hospitals"] });
      qc.invalidateQueries({ queryKey: ["platform-dash"] });
      qc.invalidateQueries({ queryKey: ["platform-churn-radar"] });
      qc.invalidateQueries({ queryKey: ["platform-briefing"] });
      setIsPurging(false);
      navigate("/platform/hospitals", { replace: true });
    },
    onError: (e: any) => {
      const msg = getErrorMessage(e) || "Delete failed — see console for details.";
      if (hospital?.deleted_at) {
        // A purge was in progress — keep the modal open and show the real error
        // inline so it's actually readable (no more opaque "non-2xx" toast).
        setPurgeError(msg);
      } else {
        toast.error(msg);
        setDeleteStep(0);
      }
    },
  });

  const preflightCheck = useMutation({
    mutationFn: () => checkDeletePrerequisites(id!),
    onSuccess: (result) => setPreflight(result),
    onError: (e: any) =>
      setPreflight({
        ok: false,
        checks: { deployed: false, service_role_key: false, authenticated: false, admin: false },
        error: getErrorMessage(e),
      }),
  });

  const restoreHospital = useMutation({
    mutationFn: async () => {
      const res = await (supabase as any).functions.invoke(
        "delete-hospital",
        { body: { hospital_id: id, action: "restore" } },
      );
      // getInvokeError unwraps the real message hidden in error.context, instead
      // of the generic "Edge Function returned a non-2xx status code".
      const msg = await getInvokeError(res);
      if (msg) throw new Error(msg);
      return res.data;
    },
    onSuccess: () => {
      logAdminAction("hospital_restored", { hospitalId: id, hospitalName: hospital?.name });
      toast.success(`${hospital?.name ?? "Hospital"} restored — deletion cancelled.`);
      qc.invalidateQueries({ queryKey: ["platform-hospital", id] });
    },
    onError: (e: any) => {
      toast.error(getErrorMessage(e) || "Restore failed — see console for details.");
    },
  });

  const savePricing = useMutation({
    mutationFn: async () => {
      const payload = {
        hospital_id: id,
        monthly_price: pMonthly ? Number(pMonthly) : null,
        yearly_price: pYearly ? Number(pYearly) : null,
        reason: pReason || null,
      };
      await (supabase as any).from("hospital_pricing_overrides")
        .upsert(payload, { onConflict: "hospital_id" });
    },
    onSuccess: () => { setPricingError(null); toast.success("Pricing override saved"); invalidate(); },
    onError: (e: any) => { const m = getErrorMessage(e); setPricingError(m); toast.error(m); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  const { hospital, subscription, overrides, pricing, plans, entitlements } = data!;

  // Trial maths for the Subscription card. `drift` is how far the stored trial end sits
  // from what the plan's CURRENT trial_days would produce — non-zero means someone edited
  // the plan (or moved the hospital) after signup and the stored date was never resynced.
  const trialInfo = (() => {
    const DAY = 24 * 60 * 60 * 1000;
    const endMs = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : null;
    const daysLeft = endMs === null ? null : Math.ceil((endMs - Date.now()) / DAY);
    const planDays = subscription?.subscription_plans?.trial_days;
    const planEnd = subscription?.created_at && planDays != null
      ? new Date(subscription.created_at).getTime() + (Number(planDays) + Number(subscription.trial_bonus_days ?? 0)) * DAY
      : null;
    return {
      daysLeft,
      expired: daysLeft !== null && daysLeft <= 0,
      planEnd,
      drift: planEnd !== null && endMs !== null
        ? Math.round((planEnd - endMs) / DAY)
        : null,
    };
  })();
  if (!hospital) return <div className="p-6 text-muted-foreground text-sm">Hospital not found.</div>;

  const overrideMap = new Map(overrides.map((o) => [o.module_key, o.is_enabled]));
  const entitlementMap = new Map(entitlements.map((e) => [e.module_key, e]));
  const categories = [...new Set(CANONICAL_MODULE_KEYS.map((k) => MODULE_CATEGORY[k]).filter(Boolean))];

  // A module can be fine-tuned only if we have a tab/action catalog for it.
  const isCustomisable = (key: string) =>
    (MODULE_TABS[key]?.length ?? 0) > 0 || (MODULE_ACTIONS[key]?.length ?? 0) > 0;
  // Effective on/off for a tab/action = hospitalExplicit ?? planDefault ?? on.
  const planDetails = planFeatureMap?.details;
  const effectiveOn = (moduleKey: string, kind: "tabs" | "actions", key: string): boolean => {
    const hosp = entitlementMap.get(moduleKey)?.[kind]?.[key];
    if (hosp !== undefined) return hosp;
    const plan = planDetails?.get(moduleKey)?.[kind]?.[key];
    if (plan !== undefined) return plan;
    return true;
  };
  // How many tabs+actions are effectively withheld (plan ∪ hospital) — drives the badge.
  const restrictionCount = (key: string) => {
    let n = 0;
    for (const t of MODULE_TABS[key] ?? []) if (!effectiveOn(key, "tabs", t.key)) n++;
    for (const a of MODULE_ACTIONS[key] ?? []) if (!effectiveOn(key, "actions", a.key)) n++;
    return n;
  };
  const openCustomise = (moduleKey: string) => setCustomiseKey(moduleKey);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0">
        <button onClick={() => navigate("/platform/hospitals")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-[14px] font-semibold text-foreground">{hospital.name}</h1>
          <p className="text-[11px] text-muted-foreground">{hospital.state || "India"} · {hospital.beds_count} beds</p>
        </div>
        <button
          onClick={handleViewAsHospital}
          disabled={impersonating}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-violet-300 text-violet-600 hover:bg-violet-50 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {impersonating ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
          View as Hospital
        </button>
        {subscription && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[subscription.status] || STATUS_PILL.no_subscription}`}>
            {subscription.status.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-6 shrink-0">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">

        {/* ── Overview ── */}
        {tab === "Overview" && (
          <div className="space-y-6 max-w-xl">
            {/* Hospital info */}
            <div className="space-y-4">
              {[
                ["Name", hospital.name],
                ["Category", hospital.hospital_category || hospital.type || "—"],
                ["State", hospital.state || "—"], ["City", hospital.city || "—"],
                ["Beds", hospital.beds_count],
                ["GSTIN", hospital.gstin || "—"], ["NABH Number", hospital.nabh_number || "—"],
                ["Address", hospital.address || "—"], ["Pincode", hospital.pincode || "—"],
                ["Established", hospital.established_year || "—"],
                ["Referral Code", hospital.referral_code || "—"],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex items-start gap-4">
                  <p className="text-xs text-muted-foreground w-32 shrink-0">{label}</p>
                  <p className="text-xs text-foreground">{String(val)}</p>
                </div>
              ))}
            </div>

            {/* Contact details */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Contact</p>
              {[
                ["Email", hospital.email, hospital.email ? `mailto:${hospital.email}` : null],
                ["Phone", hospital.phone, hospital.phone ? `tel:${hospital.phone}` : null],
                ["Emergency Phone", hospital.emergency_phone, hospital.emergency_phone ? `tel:${hospital.emergency_phone}` : null],
                ["Website", hospital.website, hospital.website || null],
                ["Subdomain", hospital.subdomain, null],
              ].map(([label, val, href]) => (
                <div key={String(label)} className="flex items-start gap-4">
                  <p className="text-xs text-muted-foreground w-32 shrink-0">{label}</p>
                  {val && href ? (
                    <a
                      href={href as string}
                      target={String(label) === "Website" ? "_blank" : undefined}
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-700 break-all"
                    >
                      {String(val)}
                    </a>
                  ) : (
                    <p className="text-xs text-foreground break-all">{val ? String(val) : "—"}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Danger zone */}
            <div className="border border-red-300 rounded-xl p-5 space-y-3 bg-red-50">
              <p className="text-xs font-bold uppercase tracking-wider text-red-600">Danger Zone</p>

              {/* Non-destructive prerequisite check — confirms delete will work */}
              <div className="space-y-2">
                <button
                  onClick={() => preflightCheck.mutate()}
                  disabled={preflightCheck.isPending}
                  className="flex items-center gap-2 px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-100 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
                >
                  {preflightCheck.isPending
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Activity size={12} />}
                  Check delete prerequisites
                </button>
                {preflight && (
                  <div className="bg-white/70 border border-red-200 rounded-lg p-3 space-y-1.5">
                    {([
                      ["deployed", "Edge function deployed", "Run: supabase functions deploy delete-hospital"],
                      ["service_role_key", "Service-role secret set", "Set the SUPABASE_SERVICE_ROLE_KEY secret on the function"],
                      ["authenticated", "Your session is valid", "Sign out and sign back in"],
                      ["admin", "You are an active platform admin", "Add an active row in aumrti_admins for your account"],
                    ] as const).map(([key, label, fix]) => {
                      const pass = preflight.checks[key];
                      return (
                        <div key={key} className="flex items-start gap-2 text-xs">
                          <span className={pass ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                            {pass ? "✓" : "✕"}
                          </span>
                          <div className="leading-tight">
                            <span className={pass ? "text-foreground" : "text-red-700 font-medium"}>{label}</span>
                            {!pass && <span className="block text-[11px] text-muted-foreground">{fix}</span>}
                          </div>
                        </div>
                      );
                    })}
                    <p className={`text-xs font-semibold pt-1 ${preflight.ok ? "text-green-600" : "text-red-600"}`}>
                      {preflight.ok
                        ? "All prerequisites met — delete will work."
                        : (preflight.error || "One or more prerequisites failed — fix the items marked ✕.")}
                    </p>
                  </div>
                )}
              </div>

              {hospital.deleted_at ? (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Marked for deletion on{" "}
                    <strong className="text-foreground">{new Date(hospital.deleted_at).toLocaleString("en-IN")}</strong>.
                    Will be <strong className="text-red-600">permanently purged</strong> 7 days after that unless restored.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => restoreHospital.mutate()}
                      disabled={restoreHospital.isPending}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600/10 hover:bg-green-600/20 border border-green-600/40 text-green-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
                    >
                      {restoreHospital.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                      Restore Hospital (cancel deletion)
                    </button>
                    <button
                      onClick={() => setDeleteStep(1)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-400 hover:text-red-300 text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Trash2 size={13} />
                      Purge Now (if grace period has elapsed)
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Delete this hospital and <strong className="text-foreground">all its data</strong> — patients,
                    appointments, bills, lab results, prescriptions, staff accounts, and every other record.
                    The hospital is marked for deletion first, with a{" "}
                    <strong className="text-foreground">7-day grace period</strong> to restore it before the purge
                    becomes <strong className="text-red-600">permanent and cannot be undone</strong>.
                  </p>
                  <button
                    onClick={() => setDeleteStep(1)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-400 hover:text-red-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete Hospital
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Users ── */}
        {tab === "Users" && (
          <div className="space-y-4 max-w-4xl">
            <p className="text-xs text-muted-foreground">
              Staff accounts for this hospital. Read-only — for support and account management.
            </p>
            {usersLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
                <Loader2 size={14} className="animate-spin" /> Loading users…
              </div>
            ) : usersData && usersData.length > 0 ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border bg-muted/40">
                      <th className="px-4 py-2.5 text-left">Name</th>
                      <th className="px-4 py-2.5 text-left">Email</th>
                      <th className="px-4 py-2.5 text-left">Phone</th>
                      <th className="px-4 py-2.5 text-left">Role</th>
                      <th className="px-4 py-2.5 text-left">Designation</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      <th className="px-4 py-2.5 text-left">Last Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersData.map((u) => (
                      <tr key={u.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-xs font-medium text-foreground">
                          {u.full_name}
                          {u.employee_id && <span className="text-muted-foreground font-mono ml-1.5">#{u.employee_id}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {u.email ? (
                            <a href={`mailto:${u.email}`} className="text-blue-600 hover:text-blue-700 break-all">{u.email}</a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {u.phone ? (
                            <a href={`tel:${u.phone}`} className="text-blue-600 hover:text-blue-700">{u.phone}</a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-foreground/80 capitalize">{u.role?.replace("_", " ") || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.designation || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${u.is_active ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                            {u.is_active ? "active" : "inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {u.last_login ? new Date(u.last_login).toLocaleDateString("en-IN") : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No user accounts found for this hospital.</p>
            )}
          </div>
        )}

        {/* ── Subscription ── */}
        {tab === "Subscription" && (
          <div className="space-y-6 max-w-lg">
            {subscription ? (
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Current plan</p>
                    <p className="text-lg font-bold text-foreground">{subscription.subscription_plans?.name ?? "Unknown Plan"}</p>
                    {subscription.subscription_plans?.description && (
                      <p className="text-xs text-muted-foreground">{subscription.subscription_plans.description}</p>
                    )}
                  </div>
                  {/* Status pill — mirrors what the hospital sees on Settings › Plan & Billing,
                      including the days-left counter that was only rendered hospital-side. */}
                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium ${
                    trialInfo.expired
                      ? "bg-red-50 text-red-700 border-red-200"
                      : subscription.status === "trial"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : subscription.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {subscription.status === "trial"
                      ? (trialInfo.expired
                          ? "Trial expired"
                          : `Free Trial — ${trialInfo.daysLeft}d left`)
                      : subscription.status}
                  </span>
                </div>

                {/* The trial end stored on the subscription can drift from what the plan now
                    says (plan trial_days edited later, or the hospital moved plans). Surface
                    the drift rather than letting it be invisible. */}
                {subscription.status === "trial" && trialInfo.drift !== null && trialInfo.drift !== 0 && (
                  <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
                    Out of sync with the plan: <strong>{subscription.subscription_plans?.name}</strong> grants{" "}
                    {subscription.subscription_plans?.trial_days}d
                    {Number(subscription.trial_bonus_days) > 0 ? ` + ${subscription.trial_bonus_days}d referral bonus` : ""},
                    which would end on {trialInfo.planEnd ? new Date(trialInfo.planEnd).toLocaleDateString("en-IN") : "—"}{" "}
                    ({trialInfo.drift > 0 ? `${trialInfo.drift}d later` : `${Math.abs(trialInfo.drift)}d earlier`} than the current date).
                    Use “Resync trial to plan” to apply it.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-muted-foreground">Monthly price</p><p className="text-foreground font-medium">{formatINRExact(Number(subscription.subscription_plans?.price_monthly ?? 0))}/mo</p></div>
                  {subscription.subscription_plans?.price_yearly != null && (
                    <div><p className="text-muted-foreground">Yearly price</p><p className="text-foreground font-medium">{formatINRExact(Number(subscription.subscription_plans.price_yearly))}/yr</p></div>
                  )}
                  <div><p className="text-muted-foreground">Bed limit</p><p className="text-foreground">{subscription.subscription_plans?.max_beds ?? "Unlimited"}</p></div>
                  <div><p className="text-muted-foreground">Staff limit</p><p className="text-foreground">{subscription.subscription_plans?.max_staff ?? "Unlimited"}</p></div>
                  <div><p className="text-muted-foreground">Storage</p><p className="text-foreground">{subscription.subscription_plans?.storage_included_gb != null ? `${subscription.subscription_plans.storage_included_gb} GB` : "Unlimited"}</p></div>
                  <div><p className="text-muted-foreground">Plan trial days</p><p className="text-foreground">{subscription.subscription_plans?.trial_days ?? "—"}d</p></div>
                  <div><p className="text-muted-foreground">Signed up</p><p className="text-foreground">{subscription.created_at ? new Date(subscription.created_at).toLocaleDateString("en-IN") : "—"}</p></div>
                  <div><p className="text-muted-foreground">Status</p><p className="text-foreground font-medium">{subscription.status}</p></div>
                  <div><p className="text-muted-foreground">Razorpay Sub ID</p><p className="text-muted-foreground font-mono text-[10px]">{subscription.razorpay_subscription_id || "—"}</p></div>
                  {subscription.trial_ends_at && (
                    <div>
                      <p className="text-muted-foreground">Trial ends</p>
                      <p className="text-foreground">
                        {new Date(subscription.trial_ends_at).toLocaleDateString("en-IN")}
                        {subscription.status === "trial" && (
                          <span className="text-muted-foreground"> · {trialInfo.expired ? "expired" : `${trialInfo.daysLeft}d left`}</span>
                        )}
                      </p>
                    </div>
                  )}
                  {subscription.current_period_start && <div><p className="text-muted-foreground">Billing period start</p><p className="text-foreground">{new Date(subscription.current_period_start).toLocaleDateString("en-IN")}</p></div>}
                  {subscription.current_period_end && <div><p className="text-muted-foreground">Next billing</p><p className="text-foreground">{new Date(subscription.current_period_end).toLocaleDateString("en-IN")}</p></div>}
                  {Number(subscription.discount_pct) > 0 && (
                    <div>
                      <p className="text-muted-foreground">Discount</p>
                      <p className="text-foreground">
                        {subscription.discount_pct}%{subscription.discount_code_applied ? ` (${subscription.discount_code_applied})` : ""}
                        <span className="text-muted-foreground">
                          {subscription.discount_expires_at
                            ? ` — until ${new Date(subscription.discount_expires_at).toLocaleDateString("en-IN")}`
                            : " — no expiry"}
                        </span>
                      </p>
                    </div>
                  )}
                  {Number(subscription.trial_bonus_days) > 0 && (
                    <div><p className="text-muted-foreground">Referral bonus</p><p className="text-foreground">+{subscription.trial_bonus_days} trial days</p></div>
                  )}
                </div>
                {subscription.status === "trial" && (
                  <button
                    onClick={() => resyncTrial.mutate()}
                    disabled={resyncTrial.isPending}
                    className="text-xs px-3 h-8 rounded-lg border border-border text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {resyncTrial.isPending ? "Resyncing…" : "Resync trial to plan"}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No subscription assigned yet.</p>
            )}

            <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Change Plan / Status</p>
              <div>
                <label className="text-xs text-muted-foreground">Plan</label>
                <select
                  value={selPlan}
                  onChange={(e) => setSelPlan(e.target.value)}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — ₹{p.price_monthly.toLocaleString("en-IN")}/mo</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <select
                  value={selStatus}
                  onChange={(e) => setSelStatus(e.target.value)}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                >
                  {["trial","active","past_due","suspended","cancelled"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {selStatus === "trial" && (
                <div>
                  <label className="text-xs text-muted-foreground">Trial ends (override)</label>
                  <input
                    type="date"
                    value={selTrialEnd}
                    onChange={(e) => setSelTrialEnd(e.target.value)}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Leave as-is to follow the plan's trial days. Changing the plan above recalculates
                    this from the signup date unless you set a date here.
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">On conversion, billing starts</label>
                <select
                  value={selConvMode}
                  onChange={(e) => setSelConvMode(e.target.value)}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="conversion_date">On the conversion date</option>
                  <option value="trial_end">When the trial would have ended</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Internal Notes</label>
                <textarea
                  defaultValue={subscription?.notes || ""}
                  onChange={(e) => setSubNotes(e.target.value)}
                  rows={2}
                  placeholder="CEO notes..."
                  className="w-full mt-1 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground resize-none focus:outline-none focus:border-primary"
                />
              </div>
              <FormError message={subError} />
              <button
                onClick={() => updateSub.mutate()}
                disabled={updateSub.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {updateSub.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* ── Modules ── */}
        {tab === "Modules" && (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Blue = enabled by plan · Amber = manually overridden · Grey = disabled.
              Click to override. Right-click toggle resets to plan default.
            </p>

            {/* ── AI Features master switch (pseudo-module ai_suite) ── */}
            {(() => {
              const aiPlanDefault = planFeatureMap?.enabled.get("ai_suite") ?? true;
              const aiHasOverride = overrideMap.has("ai_suite");
              const aiEffective = aiHasOverride ? overrideMap.get("ai_suite")! : aiPlanDefault;
              const aiWithheld = restrictionCount("ai_suite");
              return (
                <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${aiEffective ? aiHasOverride ? "bg-amber-50 border-amber-400/60" : "bg-violet-50 border-violet-300/60" : "bg-muted/40 border-border/60"}`}>
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={16} className={aiEffective ? "text-violet-600" : "text-muted-foreground"} />
                    <div>
                      <p className="text-sm font-semibold text-foreground">AI Features {aiEffective ? "" : "· disabled"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Master switch for all AI across the app.{" "}
                        {aiEffective
                          ? aiWithheld > 0
                            ? `${aiWithheld} AI feature${aiWithheld > 1 ? "s" : ""} individually off.`
                            : "Use the sliders to turn off individual AI features."
                          : "All AI is off for this hospital."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {aiEffective && (
                      <button
                        type="button"
                        onClick={() => openCustomise("ai_suite")}
                        title="Customise individual AI features"
                        className={`relative flex items-center justify-center h-6 w-6 rounded-md border transition-colors ${aiWithheld > 0 ? "bg-amber-100 border-amber-400/70 text-amber-700" : "bg-background border-border/70 text-muted-foreground hover:text-foreground"}`}
                      >
                        <SlidersHorizontal size={12} />
                        {aiWithheld > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[8px] font-bold leading-[13px] text-center">{aiWithheld}</span>
                        )}
                      </button>
                    )}
                    <div
                      onClick={() => toggleModule.mutate({ key: "ai_suite", enabled: !aiEffective })}
                      onContextMenu={(e) => { e.preventDefault(); if (aiHasOverride) removeOverride.mutate("ai_suite"); }}
                      title={aiHasOverride ? "Right-click to reset to plan default" : "Click to override"}
                      className="cursor-pointer"
                    >
                      <div className={`w-9 h-[18px] rounded-full relative transition-colors ${aiEffective ? aiHasOverride ? "bg-amber-500" : "bg-violet-500" : "bg-muted"}`}>
                        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${aiEffective ? "translate-x-4" : "translate-x-0.5"}`} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {categories.map((cat) => {
              const keys = CANONICAL_MODULE_KEYS.filter((k) => MODULE_CATEGORY[k] === cat);
              if (!keys.length) return null;
              return (
                <div key={cat}>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-3">{cat}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {keys.map((key) => {
                      const planDefault = planFeatureMap?.enabled.get(key) ?? true;
                      const hasOverride = overrideMap.has(key);
                      const effective = hasOverride ? overrideMap.get(key)! : planDefault;
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                            effective
                              ? hasOverride
                                ? "bg-amber-50 border-amber-400/60 text-amber-700"
                                : "bg-blue-50 border-blue-300/60 text-foreground"
                              : "bg-muted/40 border-border/60 text-muted-foreground"
                          }`}
                          onClick={() => toggleModule.mutate({ key, enabled: !effective })}
                          onContextMenu={(e) => { e.preventDefault(); if (hasOverride) removeOverride.mutate(key); }}
                          title={hasOverride ? "Right-click to reset to plan default" : "Click to override"}
                        >
                          <span className="truncate">{MODULE_NAME[key] || key}</span>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {effective && isCustomisable(key) && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openCustomise(key); }}
                                title="Customise tabs & buttons for this hospital"
                                className={`relative flex items-center justify-center h-5 w-5 rounded-md border transition-colors ${
                                  restrictionCount(key) > 0
                                    ? "bg-amber-100 border-amber-400/70 text-amber-700"
                                    : "bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:border-foreground/40"
                                }`}
                              >
                                <SlidersHorizontal size={11} />
                                {restrictionCount(key) > 0 && (
                                  <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-amber-500 text-white text-[8px] font-bold leading-[13px] text-center">
                                    {restrictionCount(key)}
                                  </span>
                                )}
                              </button>
                            )}
                            <div className={`w-7 h-3.5 rounded-full relative transition-colors ${effective ? hasOverride ? "bg-amber-500" : "bg-blue-500" : "bg-muted"}`}>
                              <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${effective ? "translate-x-3.5" : "translate-x-0.5"}`} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Pricing ── */}
        {tab === "Pricing" && (
          <div className="max-w-md space-y-6">
            {pricing && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-2 shadow-sm">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Active Override</p>
                <p className="text-xs text-muted-foreground">Monthly: <span className="text-foreground font-mono">₹{Number(pricing.monthly_price).toLocaleString("en-IN")}</span></p>
                {pricing.yearly_price && <p className="text-xs text-muted-foreground">Yearly: <span className="text-foreground font-mono">₹{Number(pricing.yearly_price).toLocaleString("en-IN")}</span></p>}
                {pricing.reason && <p className="text-xs text-muted-foreground italic">"{pricing.reason}"</p>}
                {pricing.valid_until && <p className="text-xs text-muted-foreground">Valid until: {new Date(pricing.valid_until).toLocaleDateString("en-IN")}</p>}
              </div>
            )}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                {pricing ? "Update Override" : "Set Custom Price"}
              </p>
              {[
                { label: "Custom Monthly Price (₹)", val: pMonthly, set: setPMonthly, placeholder: "e.g. 45000" },
                { label: "Custom Yearly Price (₹)", val: pYearly, set: setPYearly, placeholder: "e.g. 450000" },
                { label: "Reason (internal)", val: pReason, set: setPReason, placeholder: "e.g. Apollo negotiated deal" },
              ].map(({ label, val, set, placeholder }) => (
                <div key={label}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    placeholder={placeholder}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
              <FormError message={pricingError} />
              <button
                onClick={() => savePricing.mutate()}
                disabled={savePricing.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {savePricing.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Pricing Override
              </button>
            </div>
          </div>
        )}

        {/* ── Usage ── */}
        {tab === "Usage" && (
          <div className="space-y-5 max-w-2xl">
            <p className="text-xs text-muted-foreground">
              Module activity in the last 30 days. Shows which modules are actually being used.
            </p>
            {usageLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
                <Loader2 size={14} className="animate-spin" /> Loading usage data…
              </div>
            ) : usageData ? (() => {
              const modules = [
                { key: "opd",       label: "OPD Tokens",        count: usageData.opd,       unit: "tokens" },
                { key: "billing",   label: "Bills Generated",   count: usageData.billing,   unit: "bills" },
                { key: "ipd",       label: "IPD Admissions",    count: usageData.ipd,       unit: "admissions" },
                { key: "lab",       label: "Lab Orders",        count: usageData.lab,       unit: "orders" },
                { key: "radiology", label: "Radiology Orders",  count: usageData.radiology, unit: "orders" },
                { key: "er",        label: "ER Visits",         count: usageData.er,        unit: "visits" },
                { key: "ot",        label: "OT Cases",          count: usageData.ot,        unit: "cases" },
                { key: "insurance", label: "Insurance Claims",  count: usageData.insurance, unit: "claims" },
                { key: "pharmacy",  label: "Pharmacy Dispenses",count: usageData.pharmacy,  unit: "items" },
                { key: "hr",        label: "HR Attendance",     count: usageData.hr,        unit: "records" },
              ];
              const maxCount  = Math.max(...modules.map((m) => m.count), 1);
              const activeCount = modules.filter((m) => m.count > 0).length;
              const adoptionPct = Math.round((activeCount / modules.length) * 100);
              return (
                <div className="space-y-4">
                  {/* Adoption score */}
                  <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 shadow-sm">
                    <Activity size={18} className="text-blue-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Module Adoption</p>
                      <p className={`text-2xl font-bold font-mono ${adoptionPct >= 60 ? "text-emerald-600" : adoptionPct >= 30 ? "text-amber-600" : "text-red-500"}`}>
                        {adoptionPct}%
                      </p>
                    </div>
                    <div className="ml-2">
                      <p className="text-xs text-muted-foreground">{activeCount} of {modules.length} tracked modules active in last 30 days</p>
                      {adoptionPct < 40 && (
                        <p className="text-xs text-amber-600 mt-0.5">Low adoption — consider a training call</p>
                      )}
                    </div>
                  </div>

                  {/* Module activity bars */}
                  <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-sm">
                    {modules.map((m) => {
                      const pct = Math.round((m.count / maxCount) * 100);
                      const isActive = m.count > 0;
                      return (
                        <div key={m.key} className="flex items-center gap-3">
                          <span className={`text-[10px] w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                          <span className="text-xs text-muted-foreground w-40 shrink-0">{m.label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isActive ? "bg-blue-500" : "bg-muted-foreground/20"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-mono w-20 text-right shrink-0 ${isActive ? "text-foreground/70" : "text-muted-foreground"}`}>
                            {isActive ? `${m.count.toLocaleString()} ${m.unit}` : "No activity"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })() : (
              <p className="text-xs text-muted-foreground">No usage data available.</p>
            )}
          </div>
        )}

        {/* ── Notes ── */}
        {tab === "Notes" && (
          <div className="max-w-lg">
            <p className="text-xs text-muted-foreground mb-3">Internal notes are only visible to Aumrti admins.</p>
            <textarea
              defaultValue={subscription?.notes || ""}
              onChange={(e) => setSubNotes(e.target.value)}
              rows={8}
              placeholder="Add internal notes about this hospital..."
              className="w-full px-4 py-3 text-sm bg-background border border-border rounded-xl text-foreground resize-none focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => updateSub.mutate()}
              disabled={updateSub.isPending}
              className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {updateSub.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Notes
            </button>
          </div>
        )}

      </div>

      {/* ═══════════════════════════════════════════════════════
          DELETE CONFIRMATION — STEP 1: Warning
      ════════════════════════════════════════════════════════ */}
      {deleteStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
          <div className="bg-card border border-red-300 rounded-2xl w-[480px] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle size={16} className="text-red-600" />
                </div>
                <p className="text-sm font-bold text-foreground">Delete Hospital?</p>
              </div>
              <button onClick={() => setDeleteStep(0)} className="text-muted-foreground hover:text-foreground">
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {hospital.deleted_at ? (
                <p className="text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">{hospital.name}</span> is already past its 7-day grace
                  period. Proceeding now will <strong className="text-red-600">permanently and irreversibly purge</strong> all
                  of its data.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You are about to mark{" "}
                  <span className="font-bold text-foreground">{hospital.name}</span> for deletion. It gets a{" "}
                  <strong className="text-foreground">7-day grace period</strong> to be restored — after that, this data
                  is purged permanently.
                </p>
              )}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                  {hospital.deleted_at ? "The following will be permanently deleted now:" : "The following will eventually be permanently deleted:"}
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside leading-relaxed">
                  <li>All patient records, UHID history and medical data</li>
                  <li>All OPD, IPD, Emergency and OT records</li>
                  <li>All lab results, radiology reports and prescriptions</li>
                  <li>All bills, payments and financial records</li>
                  <li>All staff accounts and HR records</li>
                  <li>All settings, configurations and customisations</li>
                  <li>The subscription and all billing history</li>
                </ul>
              </div>
              <p className="text-xs text-red-600 font-medium">
                {hospital.deleted_at
                  ? "This action is irreversible. There is no way to recover this data."
                  : "After marking for deletion, use \"Restore Hospital\" on this page within 7 days to cancel."}
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setDeleteStep(0)}
                className="flex-1 py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setDeleteNameInput(""); setDeleteStep(2); }}
                className="flex-1 py-2.5 bg-red-50 hover:bg-red-100 border border-red-300 text-red-600 text-sm font-semibold rounded-lg transition-colors"
              >
                I understand, proceed →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          DELETE CONFIRMATION — STEP 2: Type hospital name
      ════════════════════════════════════════════════════════ */}
      {deleteStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-card border border-red-300 rounded-2xl w-[460px] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 size={15} className="text-red-600" />
                </div>
                <p className="text-sm font-bold text-red-600">Final Confirmation</p>
              </div>
              <button
                onClick={() => { setDeleteStep(0); setDeleteNameInput(""); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                To confirm deletion, type the hospital name exactly as shown below:
              </p>
              <div className="bg-muted rounded-lg px-4 py-2.5 text-center">
                <p className="text-sm font-mono font-bold text-foreground tracking-wide select-all">
                  {hospital.name}
                </p>
              </div>
              <input
                autoFocus
                value={deleteNameInput}
                onChange={(e) => setDeleteNameInput(e.target.value)}
                placeholder="Type hospital name here..."
                className="w-full h-10 px-3 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-red-500 font-mono"
              />
              {deleteNameInput && deleteNameInput !== hospital.name && (
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <AlertTriangle size={11} />
                  Name does not match — check spelling and capitalisation
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => { setDeleteStep(0); setDeleteNameInput(""); }}
                className="flex-1 py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteHospital.mutate()}
                disabled={deleteNameInput !== hospital.name || deleteHospital.isPending}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {deleteHospital.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> {hospital.deleted_at ? "Purging all data…" : "Marking for deletion…"}</>
                ) : hospital.deleted_at ? (
                  <><Trash2 size={14} /> DELETE ALL DATA PERMANENTLY</>
                ) : (
                  <><Trash2 size={14} /> MARK FOR DELETION (7-day grace)</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          DELETE — PHASE 2: Streaming purge progress
      ════════════════════════════════════════════════════════ */}
      {isPurging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
          <div className="bg-card border border-red-300 rounded-2xl w-[480px] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  {purgeError
                    ? <AlertTriangle size={16} className="text-red-600" />
                    : <Trash2 size={15} className="text-red-600" />}
                </div>
                <p className="text-sm font-bold text-foreground">
                  {purgeError ? "Purge failed" : `Purging ${hospital?.name ?? "hospital"}…`}
                </p>
              </div>
              {purgeError && (
                <button
                  onClick={() => { setIsPurging(false); setPurgeError(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {purgeError ? (
                <>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">Error</p>
                    <p className="text-sm text-red-700 break-words">{purgeError}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Some data may already have been removed. Re-run the purge to finish it, or check the edge-function logs.
                  </p>
                </>
              ) : (
                <>
                  <Progress
                    value={purgeLabel === "Done"
                      ? 100
                      : purgeTotal > 0
                        ? Math.min(99, Math.round((purgeDone / purgeTotal) * 100))
                        : 6}
                    className="h-3"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      {purgeLabel || "Working…"}
                    </span>
                    <span className="font-mono text-foreground">
                      {purgeTotal > 0
                        ? `${purgeDone.toLocaleString("en-IN")} / ${purgeTotal.toLocaleString("en-IN")} records`
                        : `${purgeDone.toLocaleString("en-IN")} records`}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Do not close this window. This permanently removes all data for this hospital.
                  </p>
                </>
              )}
            </div>

            {/* Footer — only on error */}
            {purgeError && (
              <div className="px-6 pb-5">
                <button
                  onClick={() => { setIsPurging(false); setPurgeError(null); }}
                  className="w-full py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-medium rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Customise tabs/buttons for this hospital (per-module entitlement) ── */}
      {customiseKey && (
        <ModuleAccessDrawer
          moduleKey={customiseKey}
          moduleLabel={customiseKey === "ai_suite" ? "AI Features" : (MODULE_NAME[customiseKey] || customiseKey)}
          subtitle="Toggle off what this hospital didn’t subscribe to. Overrides the plan default; applies to every user & role."
          initialTabs={Object.fromEntries((MODULE_TABS[customiseKey] ?? []).map((t) => [t.key, effectiveOn(customiseKey, "tabs", t.key)]))}
          initialActions={Object.fromEntries((MODULE_ACTIONS[customiseKey] ?? []).map((a) => [a.key, effectiveOn(customiseKey, "actions", a.key)]))}
          saving={saveEntitlement.isPending}
          onClose={() => setCustomiseKey(null)}
          onSave={(tabs, actions) => saveEntitlement.mutate({ moduleKey: customiseKey, tabs, actions })}
        />
      )}

    </div>
  );
}
