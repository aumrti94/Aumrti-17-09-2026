import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useToast } from "@/hooks/use-toast";
import { Brain, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  hospitalId: string;
  onClose: () => void;
}

interface Recommendation {
  itemId: string;
  itemName: string;
  currentStock: number;
  reorderLevel: number;
  forecastQty: number;
  reasoning: string;
  priority: string;
  selected: boolean;
}

const InventoryDemandReview: React.FC<Props> = ({ hospitalId, onClose }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recs, setRecs] = useState<Recommendation[]>([]);

  const runReview = async () => {
    setLoading(true);
    try {
      const { data: lowStock } = await (supabase as any)
        .from("inventory_items")
        .select("id, item_name, category, reorder_level, max_stock_level")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true);

      const { data: stockData } = await (supabase as any)
        .from("inventory_stock")
        .select("item_id, quantity_available");

      const stockMap: Record<string, number> = {};
      (stockData || []).forEach((s: any) => {
        stockMap[s.item_id] = (stockMap[s.item_id] || 0) + (s.quantity_available || 0);
      });

      const needsReorder = (lowStock || []).filter((item: any) => {
        const stock = stockMap[item.id] || 0;
        return stock <= item.reorder_level;
      });

      if (needsReorder.length === 0) {
        setRecs([]);
        setLoading(false);
        return;
      }

      const itemSummary = needsReorder.slice(0, 20).map((item: any) => {
        const stock = stockMap[item.id] || 0;
        return `${item.item_name}: stock=${stock}, reorder_level=${item.reorder_level}, max=${item.max_stock_level}`;
      });

      const response = await callAI({
        featureKey: "ai_digest",
        hospitalId,
        prompt: `Review inventory items below reorder level and recommend order quantities.

Items needing reorder:
${itemSummary.join("\n")}

For each item, recommend order quantity (up to max stock level).
Return ONLY JSON array:
[{"item_name": "...", "recommended_qty": 100, "priority": "urgent", "reasoning": "..."}]`,
        maxTokens: 400,
      });

      let aiRecs: any[] = [];
      try {
        aiRecs = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { /* use defaults */ }

      const results: Recommendation[] = needsReorder.slice(0, 20).map((item: any) => {
        const stock = stockMap[item.id] || 0;
        const aiRec = aiRecs.find((r: any) => r.item_name === item.item_name);
        return {
          itemId: item.id,
          itemName: item.item_name,
          currentStock: stock,
          reorderLevel: item.reorder_level,
          forecastQty: aiRec?.recommended_qty || (item.max_stock_level - stock),
          reasoning: aiRec?.reasoning || "Stock below reorder level",
          priority: stock === 0 ? "urgent" : "normal",
          selected: true,
        };
      });

      setRecs(results);
    } catch {
      toast({ title: "Failed to run AI demand review", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = (idx: number) => {
    setRecs((prev) => prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)));
  };

  const createIndents = async () => {
    setCreating(true);
    const selected = recs.filter((r) => r.selected);
    let created = 0;
    for (const rec of selected) {
      const { error } = await (supabase as any).from("purchase_indents").insert({
        hospital_id: hospitalId,
        item_id: rec.itemId,
        quantity_requested: rec.forecastQty,
        priority: rec.priority,
        reason: `AI Demand Review: ${rec.reasoning}`,
        status: "pending",
      });
      if (!error) created++;
    }
    toast({ title: `${created} purchase indents created` });
    setCreating(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" /> AI Inventory Demand Review
          </DialogTitle>
        </DialogHeader>

        {recs.length === 0 && !loading && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground">
              Scan inventory for items below reorder level and get AI-recommended order quantities.
            </p>
            <Button onClick={runReview}>
              <Brain className="h-4 w-4 mr-2" /> Run Demand Analysis
            </Button>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Analysing stock levels and forecasting demand...</p>
          </div>
        )}

        {recs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{recs.filter((r) => r.selected).length} of {recs.length} items selected</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setRecs((p) => p.map((r) => ({ ...r, selected: true })))}>
                  Select All
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {recs.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 border border-border rounded-lg p-3">
                  <Checkbox checked={rec.selected} onCheckedChange={() => toggleItem(i)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{rec.itemName}</span>
                      <Badge variant={rec.priority === "urgent" ? "destructive" : "secondary"} className="text-[9px]">
                        {rec.priority}
                      </Badge>
                    </div>
                    <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                      <span>Stock: <b className={rec.currentStock === 0 ? "text-destructive" : "text-amber-600"}>{rec.currentStock}</b></span>
                      <span>Reorder: {rec.reorderLevel}</span>
                      <span>Order: <b className="text-primary">{rec.forecastQty}</b></span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 italic">{rec.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full" onClick={createIndents} disabled={creating || recs.filter((r) => r.selected).length === 0}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Create {recs.filter((r) => r.selected).length} Purchase Indents
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InventoryDemandReview;
