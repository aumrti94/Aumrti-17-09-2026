import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useProductMode } from "@/contexts/ProductModeContext";
import { useSubscriptionConfig, CANONICAL_MODULE_KEYS } from "@/hooks/useSubscriptionConfig";

const MODULE_METADATA = [
  { key: "opd", icon: "🏥", name: "OPD", desc: "Outpatient visits" },
  { key: "ipd", icon: "🛏️", name: "IPD", desc: "Inpatient admissions" },
  { key: "emergency", icon: "🚨", name: "Emergency / Casualty", desc: "ER management" },
  { key: "ot", icon: "🔪", name: "Operation Theatre", desc: "Surgical scheduling" },
  { key: "pharmacy", icon: "💊", name: "Pharmacy", desc: "Drug dispensing" },
  { key: "lab", icon: "🔬", name: "Laboratory (LIS)", desc: "Lab orders & results" },
  { key: "radiology", icon: "🩻", name: "Radiology (RIS)", desc: "Imaging worklist" },
  { key: "billing", icon: "🧾", name: "Billing & Finance", desc: "Bills & payments" },
  { key: "insurance", icon: "🏥", name: "Insurance / TPA", desc: "Claims management" },
  { key: "hr", icon: "👥", name: "HR & Payroll", desc: "Staff management" },
  { key: "inventory", icon: "📦", name: "Inventory & Stores", desc: "Stock management" },
  { key: "quality", icon: "✅", name: "Quality & NABH", desc: "Audits & compliance" },
  { key: "analytics", icon: "📊", name: "Analytics & BI", desc: "Reports & dashboards" },
  { key: "patient_portal", icon: "🌐", name: "Patient Portal", desc: "Patient self-service" },
  { key: "telemedicine", icon: "📹", name: "Telemedicine", desc: "Video consultations" },
  { key: "hod_dashboard", icon: "🏢", name: "HOD Control Tower", desc: "Department head view" },
  { key: "inbox", icon: "📬", name: "Communication Inbox", desc: "Unified messaging" },
];

if (import.meta.env.DEV) {
  MODULE_METADATA.forEach((m) => {
    if (!CANONICAL_MODULE_KEYS.includes(m.key)) {
      console.warn(`SettingsModulesPage: "${m.key}" is not a canonical module key — entitlement check will never match.`);
    }
  });
}

const SettingsModulesPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const { enabledModules: productModeModules, loadingMode, refreshMode } = useProductMode();
  const { enabledModules: entitledModules, isLoading: entitlementLoading } = useSubscriptionConfig();
  const [toggledOn, setToggledOn] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  // Load the hospital's previously saved choice instead of resetting to defaults.
  // null from useProductMode means "no config saved yet" → everything on, matching isModuleEnabled().
  useEffect(() => {
    if (loadingMode || initialized) return;
    const initialSet = productModeModules
      ? new Set(productModeModules)
      : new Set(MODULE_METADATA.map((m) => m.key));
    setToggledOn(initialSet);
    setInitialized(true);
  }, [loadingMode, productModeModules, initialized]);

  const isEntitled = (key: string) => entitlementLoading || entitledModules.includes(key);

  const toggle = (key: string, value: boolean) => {
    if (value && !isEntitled(key)) return;
    if (!value) {
      setConfirm(key);
    } else {
      setToggledOn((prev) => new Set(prev).add(key));
    }
  };

  const confirmDisable = () => {
    if (confirm) {
      setToggledOn((prev) => {
        const next = new Set(prev);
        next.delete(confirm);
        return next;
      });
      setConfirm(null);
    }
  };

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    try {
      const enabledKeys = MODULE_METADATA
        .filter((m) => toggledOn.has(m.key) && isEntitled(m.key))
        .map((m) => m.key);
      const { error } = await (supabase as any)
        .from("product_modes")
        .upsert(
          { hospital_id: hospitalId, mode: "custom", enabled_modules: enabledKeys },
          { onConflict: "hospital_id" }
        );
      if (error) throw error;
      await refreshMode();
      toast({ title: "Module settings saved" });
    } catch (e: any) {
      toast({ title: "Error saving modules", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const mod = MODULE_METADATA.find((m) => m.key === confirm);

  if (loadingMode || entitlementLoading || !initialized) {
    return (
      <SettingsPageWrapper title="Modules On/Off" hideSave>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper title="Modules On/Off" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-6">Enable or disable modules for this hospital branch. When disabled, the module disappears from the sidebar entirely.</p>
      <div className="grid grid-cols-2 gap-3">
        {MODULE_METADATA.map((m) => {
          const entitled = isEntitled(m.key);
          return (
            <div key={m.key} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-lg">{m.icon}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                  {!entitled && (
                    <p className="text-[11px] text-amber-600 mt-1">Not included in your plan — contact Aumrti to upgrade</p>
                  )}
                </div>
              </div>
              <Switch checked={entitled && toggledOn.has(m.key)} disabled={!entitled} onCheckedChange={(v) => toggle(m.key, v)} />
            </div>
          );
        })}
      </div>

      <Dialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disable {mod?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Disabling {mod?.name} will hide it from all staff. Existing data is preserved.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDisable}>Confirm Disable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsModulesPage;
