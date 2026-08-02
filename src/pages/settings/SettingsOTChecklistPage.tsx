import React, { useEffect, useState, useCallback } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, Plus, X, ListPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";
import { SIGNIN_ITEMS, TIMEOUT_ITEMS, SIGNOUT_ITEMS } from "@/lib/whoChecklistItems";
import BulkPasteAddModal from "@/components/settings/BulkPasteAddModal";

type Phase = "signin" | "timeout" | "signout";

// Single source of truth for the standard WHO items — same arrays WHOChecklistTab actually uses.
const STANDARD_ITEMS: Record<Phase, string[]> = {
  signin: SIGNIN_ITEMS.map((i) => i.label),
  timeout: TIMEOUT_ITEMS.map((i) => i.label),
  signout: SIGNOUT_ITEMS.map((i) => i.label),
};

interface CustomItem {
  id: string;
  item_text: string;
}

const SettingsOTChecklistPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [customItems, setCustomItems] = useState<Record<Phase, CustomItem[]>>({ signin: [], timeout: [], signout: [] });
  const [newItem, setNewItem] = useState("");
  const [bulkPhase, setBulkPhase] = useState<Phase | null>(null);

  const fetchCustomItems = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("ot_checklist_custom_items")
      .select("id, phase, item_text")
      .eq("hospital_id", hospitalId)
      .eq("active", true)
      .order("created_at");
    const grouped: Record<Phase, CustomItem[]> = { signin: [], timeout: [], signout: [] };
    (data || []).forEach((row: any) => {
      if (grouped[row.phase as Phase]) grouped[row.phase as Phase].push({ id: row.id, item_text: row.item_text });
    });
    setCustomItems(grouped);
  }, [hospitalId]);

  useEffect(() => { fetchCustomItems(); }, [fetchCustomItems]);

  const addCustom = async (phase: Phase) => {
    if (!newItem.trim() || !hospitalId) return;
    const { error } = await (supabase as any).from("ot_checklist_custom_items").insert({
      hospital_id: hospitalId,
      phase,
      item_text: newItem.trim(),
    });
    if (error) {
      toast({ title: "Failed to add item", description: error.message, variant: "destructive" });
      return;
    }
    setNewItem("");
    fetchCustomItems();
  };

  const removeCustom = async (id: string) => {
    await (supabase as any).from("ot_checklist_custom_items").delete().eq("id", id);
    fetchCustomItems();
  };

  const addCustomBulk = async (phase: Phase, bulkRows: Record<string, string>[]) => {
    if (!hospitalId) return { error: "No hospital context" };
    const payload = bulkRows.map((r) => ({
      hospital_id: hospitalId,
      phase,
      item_text: r.item_text.trim(),
    }));
    const { error } = await (supabase as any).from("ot_checklist_custom_items").insert(payload);
    if (error) return { error: error.message };
    fetchCustomItems();
  };

  return (
    <SettingsPageWrapper title="OT Checklist" hideSave>
      <p className="text-sm text-muted-foreground mb-4">Standard WHO items cannot be removed. Hospital-specific items you add below save immediately and are shown to staff as reference — the WHO Sign In / Time Out / Sign Out phases themselves stay fixed to the NABH-mandated items.</p>

      <Tabs defaultValue="signin">
        <TabsList>
          <TabsTrigger value="signin">Sign In</TabsTrigger>
          <TabsTrigger value="timeout">Time Out</TabsTrigger>
          <TabsTrigger value="signout">Sign Out</TabsTrigger>
        </TabsList>

        {(["signin", "timeout", "signout"] as Phase[]).map((phase) => (
          <TabsContent key={phase} value={phase} className="space-y-4 mt-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Standard Items (WHO)</h3>
              <div className="space-y-1.5">
                {STANDARD_ITEMS[phase].map((item, i) => (
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
                {customItems[phase].map((item) => (
                  <div key={item.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                    <span className="flex-1">{item.item_text}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCustom(item.id)}><X size={12} /></Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add custom checklist item..." className="h-9" onKeyDown={(e) => e.key === "Enter" && addCustom(phase)} />
                <Button size="sm" onClick={() => addCustom(phase)} className="gap-1"><Plus size={14} /> Add</Button>
                <Button size="sm" variant="outline" onClick={() => setBulkPhase(phase)} className="gap-1"><ListPlus size={14} /> Bulk Add</Button>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <BulkPasteAddModal
        open={bulkPhase !== null}
        onOpenChange={(v) => !v && setBulkPhase(null)}
        title={`Bulk Add Checklist Items — ${bulkPhase ?? ""}`}
        columns={[{ key: "item_text", label: "Checklist item", required: true }]}
        existingKeys={new Set((bulkPhase ? customItems[bulkPhase] : []).map((i) => i.item_text.toLowerCase()))}
        onSubmit={(rows) => addCustomBulk(bulkPhase as Phase, rows)}
      />
    </SettingsPageWrapper>
  );
};

export default SettingsOTChecklistPage;
