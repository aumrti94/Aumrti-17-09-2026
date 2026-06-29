import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const standardItems: Record<string, string[]> = {
  signin: [
    "Patient identity confirmed",
    "Site marked / not applicable",
    "Anaesthesia safety check completed",
    "Pulse oximeter functioning",
    "Known allergy? (Yes/No)",
    "Difficult airway risk? (Yes/No)",
    "Risk of blood loss > 500ml?",
  ],
  timeout: [
    "All team members introduced",
    "Surgeon confirms: patient name, procedure, incision site",
    "Anticipated critical events reviewed",
    "Antibiotic prophylaxis given within 60 min?",
    "Essential imaging displayed?",
  ],
  signout: [
    "Procedure name confirmed",
    "Instrument, sponge and needle counts correct",
    "Specimen labelled",
    "Equipment problems addressed",
    "Key concerns for recovery reviewed",
  ],
};

const SettingsOTChecklistPage: React.FC = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [customItems, setCustomItems] = useState<Record<string, string[]>>({ signin: [], timeout: [], signout: [] });
  const [newItem, setNewItem] = useState("");

  const addCustom = (phase: string) => {
    if (!newItem.trim()) return;
    setCustomItems({ ...customItems, [phase]: [...customItems[phase], newItem.trim()] });
    setNewItem("");
  };

  const removeCustom = (phase: string, idx: number) => {
    setCustomItems({ ...customItems, [phase]: customItems[phase].filter((_, i) => i !== idx) });
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => { toast({ title: "OT checklist saved" }); setSaving(false); }, 500);
  };

  return (
    <SettingsPageWrapper title="OT Checklist" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-4">Standard WHO items cannot be removed. Add hospital-specific items below each phase.</p>

      <Tabs defaultValue="signin">
        <TabsList>
          <TabsTrigger value="signin">Sign In</TabsTrigger>
          <TabsTrigger value="timeout">Time Out</TabsTrigger>
          <TabsTrigger value="signout">Sign Out</TabsTrigger>
        </TabsList>

        {(["signin", "timeout", "signout"] as const).map((phase) => (
          <TabsContent key={phase} value={phase} className="space-y-4 mt-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Standard Items (WHO)</h3>
              <div className="space-y-1.5">
                {standardItems[phase].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                    <Lock size={12} className="flex-shrink-0" />
                    <span>{item}</span>
                    <Badge variant="outline" className="ml-auto text-[10px]">WHO</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Custom Items (Hospital)</h3>
              <div className="space-y-1.5">
                {customItems[phase].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                    <span className="flex-1">{item}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCustom(phase, i)}><X size={12} /></Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add custom checklist item..." className="h-9" onKeyDown={(e) => e.key === "Enter" && addCustom(phase)} />
                <Button size="sm" onClick={() => addCustom(phase)} className="gap-1"><Plus size={14} /> Add</Button>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </SettingsPageWrapper>
  );
};

export default SettingsOTChecklistPage;
