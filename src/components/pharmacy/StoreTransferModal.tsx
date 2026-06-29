import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StoreLocation {
  id: string;
  name: string;
  type: string;
}

interface DrugBatch {
  id: string;
  batch_number: string;
  drug_name: string;
  quantity_available: number;
  expiry_date: string;
  store_location_id: string | null;
}

interface Props {
  hospitalId: string;
  currentStoreId: string | null;
  onClose: () => void;
  onTransferred: () => void;
}

const StoreTransferModal: React.FC<Props> = ({ hospitalId, currentStoreId, onClose, onTransferred }) => {
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [batches, setBatches] = useState<DrugBatch[]>([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [destinationStoreId, setDestinationStoreId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      setUserId(data?.id || null);
    })();

    (async () => {
      const { data } = await (supabase as any)
        .from("store_locations")
        .select("id, name, type")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .order("name");
      setStores(data || []);
    })();
  }, [hospitalId]);

  useEffect(() => {
    if (!drugSearch.trim()) { setBatches([]); return; }
    const t = setTimeout(async () => {
      setLoadingBatches(true);
      let query = (supabase as any)
        .from("drug_batches")
        .select("id, batch_number, quantity_available, expiry_date, store_location_id, drug_master(drug_name)")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .gt("quantity_available", 0)
        .neq("status", "quarantined")
        .neq("status", "destroyed")
        .ilike("drug_master.drug_name", `%${drugSearch}%`)
        .limit(10);

      if (currentStoreId) {
        query = query.eq("store_location_id", currentStoreId);
      } else {
        query = query.is("store_location_id", null);
      }

      const { data } = await query;
      setBatches(
        (data || [])
          .filter((b: any) => b.drug_master?.drug_name)
          .map((b: any) => ({
            id: b.id,
            batch_number: b.batch_number,
            drug_name: b.drug_master?.drug_name || "Unknown",
            quantity_available: b.quantity_available,
            expiry_date: b.expiry_date,
            store_location_id: b.store_location_id,
          }))
      );
      setLoadingBatches(false);
    }, 300);
    return () => clearTimeout(t);
  }, [drugSearch, hospitalId, currentStoreId]);

  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const destStoreName = stores.find(s => s.id === destinationStoreId)?.name;

  const handleTransfer = async () => {
    if (!selectedBatchId || !destinationStoreId) {
      toast({ title: "Select a batch and destination store", variant: "destructive" });
      return;
    }
    if (destinationStoreId === (currentStoreId || "")) {
      toast({ title: "Source and destination stores cannot be the same", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("drug_batches")
        .update({ store_location_id: destinationStoreId })
        .eq("id", selectedBatchId);
      if (error) throw error;

      // Record movement in store_stock_movements
      await (supabase as any).from("store_stock_movements").insert({
        hospital_id: hospitalId,
        store_id: destinationStoreId,
        item_name: selectedBatch?.drug_name || "",
        item_code: selectedBatch?.batch_number || "",
        movement_type: "receipt",
        quantity: selectedBatch?.quantity_available || 0,
        unit: "units",
        moved_by: userId,
        notes: `Transferred from ${currentStoreId ? stores.find(s => s.id === currentStoreId)?.name || "store" : "Central Pharmacy"}`,
      });

      toast({ title: `${selectedBatch?.drug_name} transferred to ${destStoreName}` });
      onTransferred();
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-primary" />
            Transfer Stock to Store
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
            <b>From:</b> {currentStoreId ? stores.find(s => s.id === currentStoreId)?.name || "Store" : "Central Pharmacy"}
          </div>

          <div>
            <Label className="text-xs">Search Drug / Batch</Label>
            <div className="relative mt-1">
              <Input
                value={drugSearch}
                onChange={e => { setDrugSearch(e.target.value); setSelectedBatchId(""); }}
                placeholder="Type drug name..."
                className="h-8 text-sm"
              />
              {loadingBatches && (
                <Loader2 size={12} className="animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            {batches.length > 0 && !selectedBatchId && (
              <div className="mt-1 border rounded-md bg-background shadow-sm max-h-40 overflow-y-auto">
                {batches.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b last:border-0 transition-colors"
                  >
                    <div className="font-medium">{b.drug_name}</div>
                    <div className="text-muted-foreground">
                      Batch: {b.batch_number} · Qty: {b.quantity_available} · Exp: {b.expiry_date}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedBatch && (
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 rounded-lg px-3 py-2 text-xs space-y-1">
              <div className="font-medium text-blue-800">{selectedBatch.drug_name}</div>
              <div className="text-blue-700">
                Batch: {selectedBatch.batch_number} · Qty: <strong>{selectedBatch.quantity_available}</strong> units · Exp: {selectedBatch.expiry_date}
              </div>
              <Badge variant="outline" className="text-[10px]">Full batch will be transferred</Badge>
            </div>
          )}

          <div>
            <Label className="text-xs">Destination Store *</Label>
            <select
              value={destinationStoreId}
              onChange={e => setDestinationStoreId(e.target.value)}
              className="mt-1 w-full h-8 text-sm border border-input rounded px-2 bg-background"
            >
              <option value="">Select destination…</option>
              {stores
                .filter(s => s.id !== currentStoreId)
                .map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                ))
              }
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={saving || !selectedBatchId || !destinationStoreId} className="gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
            Transfer Stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StoreTransferModal;
