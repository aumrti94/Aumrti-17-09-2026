import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { IndianRupee, Percent } from "lucide-react";
import { APP_ROLES } from "@/lib/appRoles";
import { cn } from "@/lib/utils";

const SettingsApprovalsPage: React.FC = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  const [t1Amount, setT1Amount] = useState(500);
  const [t1Pct, setT1Pct] = useState(5);
  const [t2Amount, setT2Amount] = useState(2000);
  const [t2Pct, setT2Pct] = useState(15);
  // Roles authorized to approve each tier (Tier 1 needs none). Admin / Super Admin always
  // retain override authority (see DISCOUNT_OVERRIDE_ROLES) — not shown here.
  const [t2Roles, setT2Roles] = useState<string[]>(["billing_executive"]);
  const [t3Roles, setT3Roles] = useState<string[]>(["cfo"]);

  const [restrictedAbx, setRestrictedAbx] = useState(true);
  const [bloodTx, setBloodTx] = useState(true);
  const [lama, setLama] = useState(true);

  const toggleRole = (
    tier: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    role: string
  ) => {
    setter(tier.includes(role) ? tier.filter((r) => r !== role) : [...tier, role]);
  };

  useEffect(() => {
    (async () => {
      const { data: hid } = await (supabase as any).rpc("get_user_hospital_id");
      if (!hid) return;
      setHospitalId(hid);
      const { data: setting } = await (supabase as any)
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hid)
        .eq("key", "discount_approval_rules")
        .maybeSingle();
      if (setting?.value) {
        const rules = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
        if (rules.t1_amount != null) setT1Amount(rules.t1_amount);
        if (rules.t1_pct != null) setT1Pct(rules.t1_pct);
        if (rules.t2_amount != null) setT2Amount(rules.t2_amount);
        if (rules.t2_pct != null) setT2Pct(rules.t2_pct);
        if (Array.isArray(rules.t2_roles)) setT2Roles(rules.t2_roles);
        if (Array.isArray(rules.t3_roles)) setT3Roles(rules.t3_roles);
      }
      // Clinical approval policy intent — see KNOWN-BUG-140. Loaded separately from the
      // discount rules above; they are two unrelated settings that happened to share a page.
      const { data: clinicalSetting } = await (supabase as any)
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hid)
        .eq("key", "clinical_approval_policy")
        .maybeSingle();
      if (clinicalSetting?.value) {
        const policy = typeof clinicalSetting.value === "string" ? JSON.parse(clinicalSetting.value) : clinicalSetting.value;
        if (typeof policy.restricted_abx === "boolean") setRestrictedAbx(policy.restricted_abx);
        if (typeof policy.blood_tx === "boolean") setBloodTx(policy.blood_tx);
        if (typeof policy.lama === "boolean") setLama(policy.lama);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const rules = {
      t1_amount: t1Amount, t1_pct: t1Pct,
      t2_amount: t2Amount, t2_pct: t2Pct,
      t2_roles: t2Roles, t3_roles: t3Roles,
    };
    await (supabase as any).from("hospital_settings").upsert(
      { hospital_id: hospitalId, key: "discount_approval_rules", value: JSON.stringify(rules) },
      { onConflict: "hospital_id,key" }
    );
    // The three Clinical Approvals switches below were previously local-only React state —
    // "Save" persisted the discount rules above but silently discarded these three, so a
    // hospital believing it had turned on e.g. mandatory Blood Bank MO sign-off had actually
    // configured nothing at all. They are now at least persisted as stated POLICY INTENT.
    // They still gate no real workflow — no blocking antibiotic-approval check, Blood Bank MO
    // sign-off step, or LAMA CMO/witness step exists anywhere in this codebase today (confirmed
    // by investigation, not assumed). Building those is a genuine new clinical-safety feature
    // each, not a wiring fix, and needs clinical-pod/Nalini's sign-off on the actual approval
    // workflow (who approves, what blocks, what the override path is) before code is written —
    // see KNOWN-BUG-140. Persisting the intent now means that work has a real starting value to
    // build against instead of also needing to invent where a hospital's preference is stored.
    await (supabase as any).from("hospital_settings").upsert(
      {
        hospital_id: hospitalId,
        key: "clinical_approval_policy",
        value: JSON.stringify({ restricted_abx: restrictedAbx, blood_tx: bloodTx, lama }),
      },
      { onConflict: "hospital_id,key" }
    );
    toast({ title: "Approval rules saved" });
    setSaving(false);
  };

  return (
    <SettingsPageWrapper title="Approval Rules" onSave={handleSave} saving={saving}>
      <div className="space-y-8">

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-1">Discount Approval Rules</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Discounts trigger approval if they exceed the <span className="font-medium">amount</span> OR the <span className="font-medium">percentage</span> at each tier.
          </p>
          <div className="space-y-3">

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Tier 1</span>
                <span className="text-sm font-semibold text-emerald-800">No approval needed</span>
              </div>
              <p className="text-xs text-emerald-700 mb-3">Discounts within these limits are auto-approved and applied immediately.</p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-[11px] text-emerald-600 font-medium block mb-1">Maximum Amount (₹)</label>
                  <div className="relative">
                    <IndianRupee size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" min={0} value={t1Amount} onChange={(e) => setT1Amount(Number(e.target.value))}
                      className="w-full pl-7 pr-3 h-9 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white" />
                  </div>
                </div>
                <span className="text-muted-foreground text-sm mt-4">or</span>
                <div className="flex-1">
                  <label className="text-[11px] text-emerald-600 font-medium block mb-1">Maximum Percentage (%)</label>
                  <div className="relative">
                    <Percent size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" min={0} max={100} value={t1Pct} onChange={(e) => setT1Pct(Number(e.target.value))}
                      className="w-full pl-7 pr-3 h-9 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white" />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">Tier 2</span>
                <span className="text-sm font-semibold text-amber-800">Billing Supervisor approval</span>
              </div>
              <p className="text-xs text-amber-700 mb-3">Discounts above Tier 1 up to these limits require Billing Supervisor sign-off.</p>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-[11px] text-amber-600 font-medium block mb-1">Maximum Amount (₹)</label>
                  <div className="relative">
                    <IndianRupee size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" min={0} value={t2Amount} onChange={(e) => setT2Amount(Number(e.target.value))}
                      className="w-full pl-7 pr-3 h-9 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white" />
                  </div>
                </div>
                <span className="text-muted-foreground text-sm mt-4">or</span>
                <div className="flex-1">
                  <label className="text-[11px] text-amber-600 font-medium block mb-1">Maximum Percentage (%)</label>
                  <div className="relative">
                    <Percent size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" min={0} max={100} value={t2Pct} onChange={(e) => setT2Pct(Number(e.target.value))}
                      className="w-full pl-7 pr-3 h-9 text-sm border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white" />
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <label className="text-[11px] text-amber-600 font-medium block mb-1.5">Who can approve this tier</label>
                <div className="flex flex-wrap gap-1.5">
                  {APP_ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => toggleRole(t2Roles, setT2Roles, r.value)}
                      className={cn(
                        "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                        t2Roles.includes(r.value)
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white text-amber-700 border-amber-200 hover:bg-amber-100"
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {t2Roles.length === 0 && (
                  <p className="text-[11px] text-red-600 mt-1.5">Select at least one role, or only Admin/Super Admin will be able to approve.</p>
                )}
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700">Tier 3</span>
                <span className="text-sm font-semibold text-red-800">High-value approval</span>
              </div>
              <p className="text-xs text-red-700 mb-3">
                Discounts exceeding Tier 2 (above ₹{t2Amount.toLocaleString("en-IN")} or {t2Pct}%) require sign-off from a role below.
              </p>
              <div>
                <label className="text-[11px] text-red-600 font-medium block mb-1.5">Who can approve this tier</label>
                <div className="flex flex-wrap gap-1.5">
                  {APP_ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => toggleRole(t3Roles, setT3Roles, r.value)}
                      className={cn(
                        "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                        t3Roles.includes(r.value)
                          ? "bg-red-500 text-white border-red-500"
                          : "bg-white text-red-700 border-red-200 hover:bg-red-100"
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {t3Roles.length === 0 && (
                  <p className="text-[11px] text-red-600 mt-1.5">Select at least one role, or only Admin/Super Admin will be able to approve.</p>
                )}
              </div>
              <p className="text-[11px] text-red-500 mt-3">Admin and Super Admin can always approve any tier.</p>
            </div>

          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-1">Clinical Approvals</h2>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Records your hospital's policy intent — saved, but not yet enforced anywhere in the
            app. No screen currently blocks prescribing, dispensing, blood issue, or discharge
            on these switches. Treat this as a documented policy decision, not an active
            safeguard, until the corresponding workflow gate ships.
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div>
                <Label>Restricted Antibiotics</Label>
                <p className="text-xs text-muted-foreground">Require Microbiologist approval for restricted antibiotics</p>
              </div>
              <Switch checked={restrictedAbx} onCheckedChange={setRestrictedAbx} />
            </div>
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div>
                <Label>Blood Transfusion</Label>
                <p className="text-xs text-muted-foreground">Require Blood Bank MO sign-off for unusual requests</p>
              </div>
              <Switch checked={bloodTx} onCheckedChange={setBloodTx} />
            </div>
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div>
                <Label>LAMA (Left Against Medical Advice)</Label>
                <p className="text-xs text-muted-foreground">Require CMO approval + witness documentation</p>
              </div>
              <Switch checked={lama} onCheckedChange={setLama} />
            </div>
          </div>
        </section>

      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsApprovalsPage;
