import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";

const SettingsLanguagePage: React.FC = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    language: "en",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12",
    currency: "INR",
    timezone: "Asia/Kolkata",
    numberFormat: "indian",
  });

  const handleSave = async () => {
    setSaving(true);
    setTimeout(() => {
      toast({ title: "Language & region settings saved" });
      setSaving(false);
    }, 500);
  };

  return (
    <SettingsPageWrapper title="Language & Region" onSave={handleSave} saving={saving}>
      <div className="space-y-8">
        <section className="space-y-4">
          <div>
            <Label>Interface Language</Label>
            <Select value={config.language} onValueChange={(v) => setConfig({ ...config, language: v })}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
