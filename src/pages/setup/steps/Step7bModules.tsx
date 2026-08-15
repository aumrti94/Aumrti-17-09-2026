import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LayoutGrid } from "lucide-react";

interface Module {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_MODULES: Module[] = [
  { key: "opd",         label: "OPD",                description: "Outpatient tokens, consultation, prescriptions",  enabled: true },
  { key: "ipd",         label: "IPD",                description: "Admissions, wards, ward rounds, discharge",        enabled: true },
  { key: "emergency",   label: "Emergency",          description: "ED triage, emergency tokens, MLC",                enabled: true },
  { key: "ot",          label: "OT",                 description: "Operation theatre scheduling and WHO checklist",   enabled: true },
  { key: "pharmacy",    label: "Pharmacy",           description: "Drug dispensing, inventory, prescriptions",        enabled: true },
  { key: "lab",         label: "Laboratory (LIS)",   description: "Lab orders, results, sample tracking",            enabled: true },
  { key: "radiology",   label: "Radiology (RIS)",    description: "Imaging orders, reports, PACS integration",       enabled: true },
  { key: "billing",     label: "Billing",            description: "OPD/IPD bills, payments, GST, receipts",          enabled: true },
  { key: "insurance",   label: "Insurance / TPA",    description: "Payer billing, claim management, approvals",      enabled: true },
  { key: "hr",          label: "HR & Payroll",       description: "Staff records, attendance, leave, credentialing", enabled: true },
  { key: "inventory",   label: "Inventory",          description: "Stores, purchase orders, consumption tracking",   enabled: true },
  { key: "quality",     label: "Quality & NABH",     description: "NABH matrix, audits, incidents, quality metrics", enabled: true },
  { key: "analytics",   label: "Analytics",          description: "Revenue, clinical, and operational dashboards",   enabled: true },
  { key: "patient_portal", label: "Patient Portal",  description: "Patient login, reports, appointment booking",     enabled: true },
  { key: "telemedicine",label: "Telemedicine",       description: "Video consultations and online OPD",             enabled: false },
  { key: "hod_dashboard", label: "HOD Control Tower", description: "Department-wise real-time dashboards for HODs", enabled: true },
  { key: "inbox",       label: "Inbox",              description: "Internal messaging and clinical notifications",   enabled: true },
];

// Sensible starting module sets keyed by the hospital_category captured at signup.
// These are DEFAULTS the user can still toggle — full hospitals (Private/Government/
// Trust/Corporate/Other) fall through to "all modules on".
const CATEGORY_PRESETS: Record<string, string[]> = {
  "Clinic":           ["opd", "pharmacy", "lab", "billing", "inventory", "patient_portal", "inbox"],
  "Dental Clinic":    ["opd", "pharmacy", "billing", "inventory", "patient_portal", "inbox"],
  "AYUSH Center":     ["opd", "pharmacy", "billing", "inventory", "patient_portal", "inbox"],
  "Specialty Center": ["opd", "lab", "radiology", "pharmacy", "billing", "insurance", "inventory", "analytics", "patient_portal", "inbox"],
  "Nursing Home":     ["opd", "ipd", "pharmacy", "lab", "billing", "inventory", "hr", "patient_portal", "inbox"],
};

interface Props {
  hospitalId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const Step7bModules: React.FC<Props> = ({ hospitalId, onComplete, onSkip }) => {
  const { toast } = useToast();
  const [modules, setModules] = useState<Module[]>(DEFAULT_MODULES);
  const [presetCategory, setPresetCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Preset the module selection from the hospital category chosen at registration.
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("hospitals")
        .select("hospital_category")
        .eq("id", hospitalId)
        .maybeSingle();
      if (cancelled) return;
      const category = (data as any)?.hospital_category as string | null;
      const preset = category ? CATEGORY_PRESETS[category] : undefined;
      if (preset) {
        setPresetCategory(category);
        setModules((prev) => prev.map((m) => ({ ...m, enabled: preset.includes(m.key) })));
      }
    })();
    return () => { cancelled = true; };
  }, [hospitalId]);

  const toggle = (key: string) =>
    setModules((prev) => prev.map((m) => m.key === key ? { ...m, enabled: !m.enabled } : m));

  const handleSave = async () => {
    setSaving(true);
    try {
      const enabledKeys = modules.filter((m) => m.enabled).map((m) => m.key);

      const { data: existing } = await supabase
        .from("product_modes")
        .select("id")
        .eq("hospital_id", hospitalId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("product_modes")
          .update({ enabled_modules: enabledKeys } as any)
          .eq("hospital_id", hospitalId);
      } else {
        await supabase
          .from("product_modes")
          .insert({ hospital_id: hospitalId, mode: "hospital", enabled_modules: enabledKeys } as any);
      }

      toast({ title: "Modules configured!" });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed to save modules", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = modules.filter((m) => m.enabled).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <LayoutGrid size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 13 · Modules</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Enable Hospital Modules</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        {presetCategory
          ? `We've pre-selected the modules a ${presetCategory} typically needs. Adjust anything below.`
          : "All modules are on by default. Turn off what your hospital doesn't need yet."}
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-[13px] text-blue-700 mb-5">
        Hiding a module only removes it from the sidebar — your data is never deleted. You can re-enable anytime from <strong>Settings → Modules</strong>.
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">{enabledCount} of {modules.length} modules enabled</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {modules.map((m) => (
            <div
              key={m.key}
              onClick={() => toggle(m.key)}
              className={`relative flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                m.enabled
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/20 opacity-60"
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                m.enabled ? "bg-primary border-primary" : "border-muted-foreground"
              }`}>
                {m.enabled && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{m.label}</p>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{m.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip for now →
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step7bModules;
