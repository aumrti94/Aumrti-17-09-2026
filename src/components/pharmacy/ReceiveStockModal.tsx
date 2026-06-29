import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import InvoiceScanZone, { type ExtractedInvoiceData } from "@/components/inventory/InvoiceScanZone";

interface Props {
  hospitalId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface GRNItem {
  drugId: string;
  drugName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice: number;
  mrp: number;
  gstPercent: number;
  matchStatus?: string;
  extractedName?: string;
}

interface DrugOption {
  id: string;
  drug_name: string;
}

const emptyItem = (): GRNItem => ({
  drugId: "", drugName: "", batchNumber: "", expiryDate: "",
  quantity: 0, costPrice: 0, mrp: 0, gstPercent: 12,
});

const ReceiveStockModal: React.FC<Props> = ({ hospitalId, onClose, onSaved }) => {
  const { toast } = useToast();
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [items, setItems] = useState<GRNItem[]>([emptyItem()]);
  const [drugs, setDrugs] = useState<DrugOption[]>([]);
  const [drugSearch, setDrugSearch] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);

  const handleInvoiceExtracted = async (data: ExtractedInvoiceData) => {
    if (data.vendor_name) setSupplierName(data.vendor_name);
    if (data.invoice_number) setInvoiceNumber(data.invoice_number);
    if (data.invoice_date) setInvoiceDate(data.invoice_date);
    setExtractionConfidence(data.confidence);

    const mapped = await Promise.all((data.items || []).map(async (item) => {
      // Step 1: exact case-insensitive match on full name
      const { data: exact } = await supabase
        .from("drug_master").select("id, drug_name")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", item.name)
        .eq("is_active", true).limit(1);

      if (exact?.length === 1) {
        return {
          drugId: exact[0].id, drugName: exact[0].drug_name,
          extractedName: item.name, matchStatus: "matched",
          batchNumber: item.batch_number || "", expiryDate: item.expiry_date || "",
          quantity: item.quantity || 0, costPrice: item.unit_rate || 0,
          mrp: item.mrp || 0, gstPercent: item.gst_percent || 12,
        };
      }

      // Step 2: partial match on full name (unique result only)
      const { data: partial } = await supabase
        .from("drug_master").select("id, drug_name")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", `%${item.name}%`)
        .eq("is_active", true).limit(3);

      if (partial?.length === 1) {
        return {
          drugId: partial[0].id, drugName: partial[0].drug_name,
          extractedName: item.name, matchStatus: "matched",
          batchNumber: item.batch_number || "", expiryDate: item.expiry_date || "",
          quantity: item.quantity || 0, costPrice: item.unit_rate || 0,
          mrp: item.mrp || 0, gstPercent: item.gst_percent || 12,
        };
      }

      // Step 3: partial match on first word only (existing fallback)
      const searchWord = item.name.split(' ')[0];
      const { data: word } = await supabase
        .from("drug_master").select("id, drug_name")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", `%${searchWord}%`)
        .eq("is_active", true).limit(3);

      const match = word?.length === 1 ? word[0] : null;
      return {
        drugId: match?.id || "",
        drugName: match?.drug_name || item.name,
        extractedName: item.name,
        matchStatus: match ? "matched" : "unmatched",
        batchNumber: item.batch_number || "",
        expiryDate: item.expiry_date || "",
        quantity: item.quantity || 0,
        costPrice: item.unit_rate || 0,
        mrp: item.mrp || 0,
        gstPercent: item.gst_percent || 12,
      };
    }));

    setItems(mapped.length > 0 ? mapped : [emptyItem()]);
    toast({ title: `Auto-filled ${mapped.length} drugs — please review` });
  };

  const fetchDrugs = useCallback(async () => {
    const { data } = await supabase
      .from("drug_master")
      .select("id, drug_name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("drug_name");
    setDrugs(data || []);
  }, [hospitalId]);

  useEffect(() => { fetchDrugs(); }, [fetchDrugs]);

  const updateItem = (idx: number, field: keyof GRNItem, value: any) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalValue = items.reduce((s, it) => s + it.quantity * it.costPrice, 0);

  const handleSave = async () => {
    if (!supplierName.trim() || !invoiceNumber.trim()) {
      toast({ title: "Please fill supplier name and invoice number", variant: "destructive" });
      return;
    }

    // Accept items that have a name (even unlinked) + batch + expiry + qty
    const saveableItems = items.filter((it) => {
      const hasName = it.drugId || (it.drugName || it.extractedName || "").trim();
      return hasName && it.batchNumber && it.expiryDate && it.quantity > 0;
    });

    if (saveableItems.length === 0) {
      toast({ title: "Add at least one valid drug item", variant: "destructive" });
      return;
    }

    setSaving(true);

    // For unmatched items: check exact match first, then auto-create only if truly missing
    const resolvedItems = await Promise.all(saveableItems.map(async (it) => {
      if (it.drugId) return it;

      const drugName = (it.drugName || it.extractedName || "").trim();

      // Check if drug already exists (exact name match) before creating
      const { data: exactExisting } = await (supabase as any)
        .from("drug_master")
        .select("id")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", drugName)
        .maybeSingle();

      if (exactExisting) return { ...it, drugId: exactExisting.id };

      // Truly new drug — create it
      const { data: newDrug } = await (supabase as any)
        .from("drug_master")
        .insert({ hospital_id: hospitalId, drug_name: drugName, is_active: true, gst_percent: it.gstPercent || 12 })
        .select("id")
        .maybeSingle();

      return { ...it, drugId: newDrug?.id || "" };
    }));

    const validResolved = resolvedItems.filter((it) => it.drugId);
    if (validResolved.length === 0) {
      setSaving(false);
      toast({ title: "Could not resolve drug entries. Please try again.", variant: "destructive" });
      return;
    }

    const newDrugsCreated = resolvedItems.filter((it) => {
      const original = saveableItems.find((s) => (s.drugName || s.extractedName) === (it.drugName || it.extractedName));
      return original && !original.drugId && it.drugId;
    }).length;

    // Check for already-existing (drug_id, batch_number) pairs to skip duplicates
    const drugIds = validResolved.map((i) => i.drugId);
    const batchNums = validResolved.map((i) => i.batchNumber).filter(Boolean);
    const { data: existingBatches } = await supabase
      .from("drug_batches")
      .select("drug_id, batch_number")
      .eq("hospital_id", hospitalId)
      .in("drug_id", drugIds)
      .in("batch_number", batchNums);

    const toInsert = validResolved.filter(
      (it) => !existingBatches?.some((b) => b.drug_id === it.drugId && b.batch_number === it.batchNumber)
    );
    const skippedCount = validResolved.length - toInsert.length;

    if (toInsert.length === 0) {
      setSaving(false);
      toast({ title: "All batches already exist in stock — no new stock added.", description: "This invoice may have already been entered." });
      return;
    }

    const batches = toInsert.map((it) => ({
      hospital_id: hospitalId,
      drug_id: it.drugId,
      batch_number: it.batchNumber,
      manufacturer: null,
      supplier_name: supplierName,
      purchase_date: invoiceDate,
      expiry_date: it.expiryDate,
      quantity_received: it.quantity,
      quantity_available: it.quantity,
      cost_price: it.costPrice,
      mrp: it.mrp,
      sale_price: Math.round(it.mrp * 0.95 * 100) / 100,
      gst_percent: it.gstPercent,
    }));

    const { error } = await supabase.from("drug_batches").insert(batches as any);
    setSaving(false);

    if (error) {
      toast({ title: "Error saving stock", description: error.message, variant: "destructive" });
    } else {
      const parts: string[] = [`${toInsert.length} item${toInsert.length !== 1 ? "s" : ""} saved`];
      if (newDrugsCreated > 0) parts.push(`${newDrugsCreated} new drug${newDrugsCreated > 1 ? "s" : ""} added to master`);
      if (skippedCount > 0) parts.push(`${skippedCount} duplicate batch${skippedCount > 1 ? "es" : ""} skipped`);
      toast({ title: `GRN saved — ${parts.join(", ")}` });
      onSaved();
    }
  };

  const filteredDrugs = (idx: number) => {
    const q = (drugSearch[idx] || "").toLowerCase();
    if (!q) return drugs.slice(0, 15);
    return drugs.filter((d) => d.drug_name.toLowerCase().includes(q)).slice(0, 10);
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Receive Stock (GRN)</h2>
            <p className="text-xs text-muted-foreground">Record stock received from supplier</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded transition-colors active:scale-95">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* AI Invoice Scanner */}
          <InvoiceScanZone onExtracted={handleInvoiceExtracted} />

          {extractionConfidence !== null && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ Extracted {items.length} drugs (confidence: {Math.round(extractionConfidence * 100)}%) — Please review before saving
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Supplier Name *</Label>
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="h-9 text-sm mt-1" placeholder="Supplier name" />
            </div>
            <div>
              <Label className="text-xs">Invoice Number *</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="h-9 text-sm mt-1" placeholder="INV-001" />
            </div>
            <div>
              <Label className="text-xs">Invoice Date *</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-9 text-sm mt-1" />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Items</Label>
            <div className="mt-2 space-y-3">
              {items.map((it, idx) => (
                <div key={idx} className={`p-3 border rounded-lg space-y-2 ${it.matchStatus === "matched" ? "border-l-2 border-l-emerald-500 border-border" : it.matchStatus === "unmatched" ? "border-l-2 border-l-amber-500 border-border" : "border-border"}`}>
                  {it.extractedName && it.extractedName !== it.drugName && (
                    <p className="text-[10px] italic text-muted-foreground">Scanned: {it.extractedName}</p>
                  )}
                  {it.matchStatus === "unmatched" && <p className="text-[10px] text-amber-600">⚠️ Not in drug master — will be added as new drug on save</p>}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="relative">
                      <Input
                        value={it.drugName || drugSearch[idx] || ""}
                        onChange={(e) => {
                          setDrugSearch((p) => ({ ...p, [idx]: e.target.value }));
                          if (it.drugId) updateItem(idx, "drugId", "");
                          updateItem(idx, "drugName", "");
                        }}
                        placeholder="Search drug..."
                        className="h-8 text-xs"
                      />
                      {(drugSearch[idx] || "") && !it.drugId && (
                        <div className="absolute top-full left-0 right-0 z-20 bg-background border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {filteredDrugs(idx).map((d) => (
                            <button
                              key={d.id}
                              onClick={() => {
                                updateItem(idx, "drugId", d.id);
                                updateItem(idx, "drugName", d.drug_name);
                                setDrugSearch((p) => ({ ...p, [idx]: "" }));
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                            >
                              {d.drug_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeItem(idx)} className="p-1 text-muted-foreground hover:text-destructive active:scale-95">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div>
                      <Label className="text-[10px]">Batch #</Label>
                      <Input value={it.batchNumber} onChange={(e) => updateItem(idx, "batchNumber", e.target.value)} className="h-7 text-xs mt-0.5" />
                    </div>
                    <div>
                      <Label className="text-[10px]">Expiry</Label>
                      <Input type="date" value={it.expiryDate} onChange={(e) => updateItem(idx, "expiryDate", e.target.value)} className="h-7 text-xs mt-0.5" />
                    </div>
                    <div>
                      <Label className="text-[10px]">Qty</Label>
                      <Input type="number" value={it.quantity || ""} onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value) || 0)} className="h-7 text-xs mt-0.5" />
                    </div>
                    <div>
                      <Label className="text-[10px]">Cost ₹</Label>
                      <Input type="number" step="0.01" value={it.costPrice || ""} onChange={(e) => updateItem(idx, "costPrice", parseFloat(e.target.value) || 0)} className="h-7 text-xs mt-0.5" />
                    </div>
                    <div>
                      <Label className="text-[10px]">MRP ₹</Label>
                      <Input type="number" step="0.01" value={it.mrp || ""} onChange={(e) => updateItem(idx, "mrp", parseFloat(e.target.value) || 0)} className="h-7 text-xs mt-0.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setItems((p) => [...p, emptyItem()])}>
              <Plus size={14} className="mr-1" /> Add Another Drug
            </Button>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 flex justify-between text-sm">
            <span>Total Items: <strong>{items.filter((i) => i.drugId || (i.drugName || i.extractedName || "").trim()).length}</strong></span>
            <span>Total Value: <strong className="tabular-nums">₹{totalValue.toFixed(2)}</strong></span>
          </div>
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? "Saving..." : "Save GRN"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ReceiveStockModal;
