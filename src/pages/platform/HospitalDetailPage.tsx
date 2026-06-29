import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, Save, Loader2, Trash2, AlertTriangle, X, Activity } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { PLATFORM_STATUS_PILL } from "@/lib/platform-utils";

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
  const [hRes, sRes, overRes, pricRes, plansRes] = await Promise.all([
    (supabase as any).from("hospitals").select("*").eq("id", id).maybeSingle(),
    (supabase as any).from("hospital_subscriptions")
      .select("*, subscription_plans(id,name,slug,price_monthly,price_yearly)")
      .eq("hospital_id", id).maybeSingle(),
    (supabase as any).from("hospital_feature_overrides")
      .select("module_key, is_enabled, reason").eq("hospital_id", id),
    (supabase as any).from("hospital_pricing_overrides")
      .select("*").eq("hospital_id", id).maybeSingle(),
    (supabase as any).from("subscription_plans")
      .select("id, name, slug, price_monthly").eq("is_active", true).order("sort_order"),
  ]);
  return {
    hospital: hRes.data,
    subscription: sRes.data,
    overrides: (overRes.data || []) as Array<{ module_key: string; is_enabled: boolean; reason: string | null }>,
    pricing: pricRes.data,
    plans: (plansRes.data || []) as Array<{ id: string; name: string; slug: string; price_monthly: number }>,
  };
}

async function fetchPlanFeatures(planId: string) {
  const { data } = await (supabase as any).from("plan_features")
    .select("module_key, is_enabled").eq("plan_id", planId);
  return new Map<string, boolean>((data || []).map((f: any) => [f.module_key, f.is_enabled]));
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
  const [subError, setSubError] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);

  const updateSub = useMutation({
    mutationFn: async () => {
      const payload: any = { notes: subNotes || data?.subscription?.notes };
      if (selPlan) payload.plan_id = selPlan;
      if (selStatus) payload.status = selStatus;
      if (data?.subscription) {
        await (supabase as any).from("hospital_subscriptions")
          .update(payload).eq("hospital_id", id);
      } else {
        await (supabase as any).from("hospital_subscriptions")
          .insert({ hospital_id: id, ...payload, status: selStatus || "trial" });
      }
    },
    onSuccess: () => { setSubError(null); toast.success("Subscription updated"); invalidate(); setSelPlan(""); setSelStatus(""); },
    onError: (e: any) => { const m = getErrorMessage(e); setSubError(m); toast.error(m); },
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

  // ── Pricing override ──
  const [pMonthly, setPMonthly] = useState("");
  const [pYearly, setPYearly] = useState("");
  const [pReason, setPReason] = useState("");

  // ── Delete hospital ──
  // Step 0 = closed, Step 1 = warning modal, Step 2 = type-name confirmation
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteNameInput, setDeleteNameInput] = useState("");

  const deleteHospital = useMutation({
    mutationFn: async () => {
      // Calls the delete-hospital edge function (service-role key).
      // It handles: auth.users deletion, storage cleanup, then
      // hospital row delete (which CASCADE-removes all clinical/financial/
      // operational data via ON DELETE CASCADE on all 79+ hospital tables).
      const { data: result, error } = await (supabase as any).functions.invoke(
        "delete-hospital",
        { body: { hospital_id: id } },
      );
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      // Surface any non-fatal warnings (e.g. storage bucket missing)
      if (result?.warnings?.length) {
        console.warn("Hospital delete warnings:", result.warnings);
      }
      return result;
    },
    onSuccess: (result: any) => {
      const staffMsg = result?.deleted_auth_users > 0
        ? ` · ${result.deleted_auth_users} staff account${result.deleted_auth_users > 1 ? "s" : ""} removed`
        : "";
      toast.success(`${hospital?.name ?? "Hospital"} permanently deleted${staffMsg}`);
      qc.invalidateQueries({ queryKey: ["platform-hospitals"] });
      qc.invalidateQueries({ queryKey: ["platform-dash"] });
      qc.invalidateQueries({ queryKey: ["platform-churn-radar"] });
      qc.invalidateQueries({ queryKey: ["platform-briefing"] });
      navigate("/platform/hospitals", { replace: true });
    },
    onError: (e: any) => {
      toast.error(getErrorMessage(e) || "Delete failed — see console for details.");
      setDeleteStep(0);
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

  const { hospital, subscription, overrides, pricing, plans } = data!;
  if (!hospital) return <div className="p-6 text-muted-foreground text-sm">Hospital not found.</div>;

  const overrideMap = new Map(overrides.map((o) => [o.module_key, o.is_enabled]));
  const categories = [...new Set(CANONICAL_MODULE_KEYS.map((k) => MODULE_CATEGORY[k]).filter(Boolean))];

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
        {subscription && (
          <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[subscription.status] || STATUS_PILL.no_subscription}`}>
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
              <p className="text-xs text-muted-foreground leading-relaxed">
                Permanently delete this hospital and <strong className="text-foreground">all its data</strong> — patients,
                appointments, bills, lab results, prescriptions, staff accounts, and every other record.
                This action <strong className="text-red-600">cannot be undone</strong>.
              </p>
              <button
                onClick={() => setDeleteStep(1)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-400 hover:text-red-300 text-xs font-semibold rounded-lg transition-colors"
              >
                <Trash2 size={13} />
                Delete Hospital Permanently
              </button>
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
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Current</p>
                <p className="text-lg font-bold text-foreground">{subscription.subscription_plans?.name ?? "Unknown Plan"}</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-muted-foreground">Status</p><p className="text-foreground font-medium">{subscription.status}</p></div>
                  <div><p className="text-muted-foreground">Razorpay Sub ID</p><p className="text-muted-foreground font-mono text-[10px]">{subscription.razorpay_subscription_id || "—"}</p></div>
                  {subscription.trial_ends_at && <div><p className="text-muted-foreground">Trial ends</p><p className="text-foreground">{new Date(subscription.trial_ends_at).toLocaleDateString("en-IN")}</p></div>}
                  {subscription.current_period_end && <div><p className="text-muted-foreground">Next billing</p><p className="text-foreground">{new Date(subscription.current_period_end).toLocaleDateString("en-IN")}</p></div>}
                </div>
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
                  <option value="">Keep current</option>
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
                  <option value="">Keep current</option>
                  {["trial","active","past_due","suspended","cancelled"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
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
            {categories.map((cat) => {
              const keys = CANONICAL_MODULE_KEYS.filter((k) => MODULE_CATEGORY[k] === cat);
              if (!keys.length) return null;
              return (
                <div key={cat}>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-3">{cat}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {keys.map((key) => {
                      const planDefault = planFeatureMap?.get(key) ?? true;
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
                          <div className={`w-7 h-3.5 rounded-full relative shrink-0 ml-2 transition-colors ${effective ? hasOverride ? "bg-amber-500" : "bg-blue-500" : "bg-muted"}`}>
                            <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${effective ? "translate-x-3.5" : "translate-x-0.5"}`} />
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
              <p className="text-sm text-muted-foreground">
                You are about to permanently delete{" "}
                <span className="font-bold text-foreground">{hospital.name}</span>.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                  The following will be permanently deleted:
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
                This action is irreversible. There is no way to recover this data.
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
                  <><Loader2 size={14} className="animate-spin" /> Purging all data…</>
                ) : (
                  <><Trash2 size={14} /> DELETE ALL DATA PERMANENTLY</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
