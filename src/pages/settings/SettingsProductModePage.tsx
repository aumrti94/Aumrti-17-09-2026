import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Check, Info, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useProductMode } from "@/contexts/ProductModeContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Module catalogue ─────────────────────────────────────────────────────────

interface ModuleEntry {
  key: string;
  label: string;
  group: string;
  emoji: string;
}

const ALL_MODULES: ModuleEntry[] = [
  { key: "opd",          label: "OPD / Outpatient",           group: "Clinical",       emoji: "🩺" },
  { key: "ipd",          label: "IPD / Inpatient",            group: "Clinical",       emoji: "🛏️" },
  { key: "emergency",    label: "Emergency",                  group: "Clinical",       emoji: "🚨" },
  { key: "ot",           label: "Operation Theatre",          group: "Clinical",       emoji: "⚕️" },
  { key: "nursing",      label: "Nursing",                    group: "Clinical",       emoji: "💉" },
  { key: "lab",          label: "Laboratory",                 group: "Diagnostics",    emoji: "🔬" },
  { key: "radiology",    label: "Radiology / Imaging",        group: "Diagnostics",    emoji: "🩻" },
  { key: "pharmacy",     label: "Pharmacy",                   group: "Pharmacy",       emoji: "💊" },
  { key: "inventory",    label: "Inventory & Stores",         group: "Pharmacy",       emoji: "📦" },
  { key: "billing",      label: "Billing & Payments",         group: "Finance",        emoji: "💰" },
  { key: "insurance",    label: "Insurance / TPA",            group: "Finance",        emoji: "🛡️" },
  { key: "accounts",     label: "Accounts & Ledgers",         group: "Finance",        emoji: "📒" },
  { key: "hr",           label: "HR & Staff",                 group: "Administration", emoji: "👥" },
  { key: "assets",       label: "Asset Management",           group: "Administration", emoji: "🏢" },
  { key: "analytics",    label: "Analytics & BI",             group: "Administration", emoji: "📈" },
  { key: "quality",      label: "Quality / NABH Compliance",  group: "Quality",        emoji: "✅" },
  { key: "ipc",          label: "IPC Surveillance",           group: "Quality",        emoji: "🦠" },
  { key: "fms",          label: "Facility & Safety",          group: "Quality",        emoji: "🔧" },
  { key: "telemedicine", label: "Telemedicine / Video",       group: "Digital",        emoji: "📱" },
  { key: "mrd",          label: "Medical Records (MRD)",      group: "Digital",        emoji: "📁" },
  { key: "crm",          label: "CRM / Patient Engagement",   group: "Digital",        emoji: "💬" },
  { key: "lms",          label: "LMS / Staff Training",       group: "Digital",        emoji: "📚" },
  { key: "patients",     label: "Patient Registry",           group: "Digital",        emoji: "👤" },
];

const GROUPS = ["Clinical", "Diagnostics", "Pharmacy", "Finance", "Administration", "Quality", "Digital"];

// ── Mode definitions ─────────────────────────────────────────────────────────

interface ModeDefinition {
  key: string;
  label: string;
  emoji: string;
  desc: string;
  color: string;
  modules: string[];
}

const MODES: ModeDefinition[] = [
  {
    key: "hospital",
    label: "Full Hospital",
    emoji: "🏥",
    desc: "All modules — Multi-specialty hospital, nursing home",
    color: "border-blue-400 bg-blue-50",
    modules: ["opd", "ipd", "emergency", "ot", "nursing", "lab", "radiology", "pharmacy", "inventory",
              "billing", "insurance", "accounts", "hr", "assets", "analytics", "quality", "ipc", "fms",
              "telemedicine", "mrd", "crm", "patients"],
  },
  {
    key: "clinic",
    label: "Clinic / Polyclinic",
    emoji: "🩺",
    desc: "OPD-focused — Small clinic, specialist centre, polyclinic",
    color: "border-emerald-400 bg-emerald-50",
    modules: ["opd", "pharmacy", "billing", "analytics", "patients", "lab", "telemedicine", "crm"],
  },
  {
    key: "diagnostic",
    label: "Diagnostic Centre",
    emoji: "🔬",
    desc: "Lab + Radiology — Standalone lab, scan centre, imaging",
    color: "border-violet-400 bg-violet-50",
    modules: ["lab", "radiology", "billing", "analytics", "patients", "crm", "inventory"],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / Retail",
    emoji: "💊",
    desc: "Dispensing-first — Pharmacy chain, medical shop",
    color: "border-amber-400 bg-amber-50",
    modules: ["pharmacy", "inventory", "billing", "analytics", "patients"],
  },
  {
    key: "institute",
    label: "Medical Institute",
    emoji: "🎓",
    desc: "Teaching + patient care — Medical college, training hospital",
    color: "border-rose-400 bg-rose-50",
    modules: ["opd", "ipd", "lab", "pharmacy", "billing", "analytics", "hr", "lms", "patients", "mrd", "quality"],
  },
];

// ── Component ────────────────────────────────────────────────────────────────

const SettingsProductModePage: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const { refreshMode } = useProductMode();
  const { toast } = useToast();

  const [selectedMode, setSelectedMode] = useState("hospital");
  const [enabledModules, setEnabledModules] = useState<Set<string>>(
    new Set(MODES[0].modules)
  );
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("product_modes")
        .select("id, mode, enabled_modules")
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (data) {
        setExistingId(data.id);
        setSelectedMode(data.mode || "hospital");
        setEnabledModules(new Set((data.enabled_modules as string[]) || MODES[0].modules));
      } else {
        setSelectedMode("hospital");
        setEnabledModules(new Set(MODES[0].modules));
      }
      setLoading(false);
    })();
  }, [hospitalId]);

  const handleModeSelect = (modeKey: string) => {
    setSelectedMode(modeKey);
    const modeDef = MODES.find((m) => m.key === modeKey)!;
    setEnabledModules(new Set(modeDef.modules));
  };

  const toggleModule = (key: string) => {
    setEnabledModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      mode: selectedMode,
      enabled_modules: Array.from(enabledModules),
      updated_at: new Date().toISOString(),
    };
    if (existingId) {
      await (supabase as any).from("product_modes").update(payload).eq("id", existingId);
    } else {
      const { data } = await (supabase as any)
        .from("product_modes").insert(payload).select("id").maybeSingle();
      if (data) setExistingId(data.id);
    }
    refreshMode();
    setSaving(false);
    toast({ title: "Product mode saved — sidebar updated immediately" });
  };

  const selectedModeDef = MODES.find((m) => m.key === selectedMode)!;
  const defaultModules = new Set(selectedModeDef?.modules || []);
  const customisedCount = [...enabledModules].filter((m) => !defaultModules.has(m)).length
    + [...defaultModules].filter((m) => !enabledModules.has(m)).length;

  if (loading) return null;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-14 flex items-center px-8 border-b border-border bg-card">
        <button onClick={() => navigate("/settings")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Settings</button>
        <ChevronRight size={14} className="mx-2 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Product Mode</span>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-7 max-w-[860px]">
        {/* Mode Selector */}
        <div className="mb-8">
          <h2 className="text-base font-bold text-foreground mb-1">Choose Deployment Mode</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Selecting a mode pre-fills the module list below. You can fine-tune individual modules after.
          </p>
          <div className="grid grid-cols-5 gap-3">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => handleModeSelect(m.key)}
                className={cn(
                  "flex flex-col items-center text-center p-4 rounded-xl border-2 transition-all",
                  selectedMode === m.key
                    ? m.color + " border-opacity-100 shadow-sm"
                    : "border-border bg-card hover:border-muted-foreground/40"
                )}
              >
                <span className="text-2xl mb-1.5">{m.emoji}</span>
                <p className="text-xs font-bold text-foreground leading-tight">{m.label}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{m.desc.split(" — ")[0]}</p>
                {selectedMode === m.key && (
                  <div className="mt-2 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Check size={10} className="text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            <strong>{selectedModeDef?.desc}</strong>
            {customisedCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                {customisedCount} module{customisedCount > 1 ? "s" : ""} customised from default
              </span>
            )}
          </div>
        </div>

        {/* Module Checklist */}
        <div className="mb-8">
          <h2 className="text-base font-bold text-foreground mb-1">Enabled Modules</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Only enabled modules appear in the navigation sidebar and are accessible to staff.
            Admin and Super Admin always retain access to Settings regardless of module config.
          </p>

          <div className="space-y-5">
            {GROUPS.map((group) => {
              const groupModules = ALL_MODULES.filter((m) => m.group === group);
              return (
                <div key={group}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    {group}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {groupModules.map((mod) => {
                      const checked = enabledModules.has(mod.key);
                      const isDefault = defaultModules.has(mod.key);
                      return (
                        <button
                          key={mod.key}
                          onClick={() => toggleModule(mod.key)}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                            checked
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-80"
                          )}
                        >
                          <div className={cn(
                            "h-4 w-4 rounded flex items-center justify-center shrink-0 border",
                            checked ? "bg-primary border-primary" : "border-muted-foreground/30"
                          )}>
                            {checked && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-base leading-none shrink-0">{mod.emoji}</span>
                          <div className="min-w-0">
                            <p className={cn("text-xs font-medium leading-tight truncate", checked ? "text-foreground" : "text-muted-foreground")}>
                              {mod.label}
                            </p>
                            {!isDefault && checked && (
                              <span className="text-[9px] text-amber-600 font-medium">+ added</span>
                            )}
                            {isDefault && !checked && (
                              <span className="text-[9px] text-destructive font-medium">removed</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Info box */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
          <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-700 leading-relaxed">
            <strong>How module control works:</strong> Enabled modules appear in the sidebar for all staff.
            Disabled modules are hidden but their routes still exist — staff with a direct URL or bookmark
            will see an "Access Denied" screen instead (controlled by role permissions).
            This setting takes effect immediately for new logins; existing sessions see changes on next page refresh.
          </div>
        </div>

        {/* Save */}
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save size={14} />
          {saving ? "Saving…" : "Save Product Mode"}
        </Button>
      </div>
    </div>
  );
};

export default SettingsProductModePage;
