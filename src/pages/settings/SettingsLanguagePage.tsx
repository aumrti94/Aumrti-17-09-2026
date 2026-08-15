/**
 * Language & Region — interface language, and the date / time / number / currency
 * conventions every printed document and screen in the hospital inherits.
 *
 * HISTORY: until Phase 2 QA this screen persisted nothing at all. It had no target table,
 * and "Save" ran a 500ms setTimeout before showing a green toast — so a hospital in Hyderabad
 * could set Telugu and 24-hour time, see it confirmed, and find English and 12-hour back
 * after a reload. Logged as BUG-P2-004, fixed here.
 *
 * Stored in the key/value `hospital_settings` table under `language_region`, the same
 * pattern `discount_approval_rules` and `ipd_ancillary_payment` use — no new table, no new
 * RLS policy.
 *
 * NOTE ON DEFAULTS: these must stay Indian — DD/MM/YYYY, ₹ INR, Asia/Kolkata and Indian
 * digit grouping (1,00,000 not 100,000). A hospital that never opens this screen must still
 * print dates a patient in Hyderabad can read.
 */
import React, { useEffect, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  LANGUAGE_REGION_KEY, DEFAULT_LANGUAGE_REGION, type LanguageRegionConfig,
} from "@/lib/languageRegion";

const SettingsLanguagePage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [config, setConfig] = useState<LanguageRegionConfig>(DEFAULT_LANGUAGE_REGION);

  const { data: stored } = useQuery({
    queryKey: ["language-region", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return null;
      const { data, error } = await supabase
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hospitalId)
        .eq("key", LANGUAGE_REGION_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? null) as Partial<LanguageRegionConfig> | null;
    },
    enabled: !!hospitalId,
  });

  useEffect(() => {
    if (stored) setConfig({ ...DEFAULT_LANGUAGE_REGION, ...stored });
  }, [stored]);

  const save = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital context.");
      const { error } = await supabase.from("hospital_settings").upsert(
        {
          hospital_id: hospitalId,
          key: LANGUAGE_REGION_KEY,
          value: config as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "hospital_id,key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Language & region settings saved" });
      qc.invalidateQueries({ queryKey: ["language-region"] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save language settings", description: e.message, variant: "destructive" }),
  });

  return (
    <SettingsPageWrapper title="Language & Region" onSave={() => save.mutate()} saving={save.isPending}>
      <div className="space-y-8">
        <section className="space-y-4">
          <div>
            <Label>Interface Language</Label>
            <Select value={config.language} onValueChange={(v) => setConfig({ ...config, language: v })}>
              <SelectTrigger className="mt-1.5" aria-label="Interface Language"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi (हिन्दी)</SelectItem>
                <SelectItem value="te">Telugu (తెలుగు)</SelectItem>
                <SelectItem value="ta">Tamil (தமிழ்)</SelectItem>
                <SelectItem value="kn">Kannada (ಕನ್ನಡ)</SelectItem>
                <SelectItem value="ml">Malayalam (മലയാളം)</SelectItem>
                <SelectItem value="mr">Marathi (मराठी)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Interface language affects all menus and labels</p>
          </div>

          <div>
            <Label>Date Format</Label>
            <RadioGroup value={config.dateFormat} onValueChange={(v) => setConfig({ ...config, dateFormat: v })} className="flex gap-4 mt-1.5">
              {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <RadioGroupItem value={f} id={`df-${f}`} />
                  <Label htmlFor={`df-${f}`} className="font-normal">{f}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label>Time Format</Label>
            <RadioGroup value={config.timeFormat} onValueChange={(v) => setConfig({ ...config, timeFormat: v })} className="flex gap-4 mt-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="12" id="tf-12" />
                <Label htmlFor="tf-12" className="font-normal">12-hour (2:30 PM)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="24" id="tf-24" />
                <Label htmlFor="tf-24" className="font-normal">24-hour (14:30)</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label>Currency</Label>
            <Select value={config.currency} onValueChange={(v) => setConfig({ ...config, currency: v })}>
              <SelectTrigger className="mt-1.5" aria-label="Currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INR">₹ Indian Rupee (INR)</SelectItem>
                <SelectItem value="AED">AED (UAE)</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Timezone</Label>
            <Select value={config.timezone} onValueChange={(v) => setConfig({ ...config, timezone: v })}>
              <SelectTrigger className="mt-1.5" aria-label="Timezone"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Number Format</Label>
            <RadioGroup value={config.numberFormat} onValueChange={(v) => setConfig({ ...config, numberFormat: v })} className="flex gap-4 mt-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="indian" id="nf-in" />
                <Label htmlFor="nf-in" className="font-normal">Indian (1,00,000)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="international" id="nf-intl" />
                <Label htmlFor="nf-intl" className="font-normal">International (100,000)</Label>
              </div>
            </RadioGroup>
          </div>
        </section>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsLanguagePage;
