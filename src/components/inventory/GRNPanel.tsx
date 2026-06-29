import React, { useState, useEffect } from "react";
import { Plus, X, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { autoPostJournalEntry } from "@/lib/accounting";
import { cn } from "@/lib/utils";
import InvoiceScanZone, { type ExtractedInvoiceData } from "./InvoiceScanZone";

const qcColors: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-700",
  fail: "bg-red-100 text-red-700",
  conditional: "bg-amber-100 text-amber-700",
};

const GRNPanel: React.FC = () => {
  const { toast } = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [grnItems, setGrnItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [fromPO, setFromPO] = useState(true);
  const [pos, setPOs] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selectedPO, setSelectedPO] = useState("");
  const [newGRN, setNewGRN] = useState({ vendor_id: "", invoice_number: "", invoice_date: "", quality_check: "pass", is_consignment: false, consignment_vendor_id: "" });
  const [newGRNItems, setNewGRNItems] = useState<any[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanImageFile, setScanImageFile] = useState<File | null>(null);
  const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);
  const [itemsExtractedCount, setItemsExtractedCount] = useState(0);

  const handleInvoiceExtracted = async (data: ExtractedInvoiceData, imageFile: File) => {
    setScanImageFile(imageFile);
    setExtractionConfidence(data.confidence);
    setItemsExtractedCount(data.items?.length || 0);
    setFromPO(false);

    // Fill header
    if (data.vendor_name) {
      const matchedVendor = vendors.find(v => v.vendor_name.toLowerCase().includes(data.vendor_name!.toLowerCase().split(' ')[0]));
      if (matchedVendor) setNewGRN(prev => ({ ...prev, vendor_id: matchedVendor.id }));
    }
    if (data.invoice_number) setNewGRN(prev => ({ ...prev, invoice_number: data.invoice_number! }));
    if (data.invoice_date) setNewGRN(prev => ({ ...prev, invoice_date: data.invoice_date! }));

    // Match items to inventory
    const mapped = await Promise.all((data.items || []).map(async (item) => {
      const searchWord = item.name.split(' ')[0];
      const { data: matches } = await (supabase as any)
        .from("inventory_items")
        .select("id, item_name")
        .ilike("item_name", `%${searchWord}%`)
        .eq("is_active", true)
        .limit(3);

      const match = matches?.length === 1 ? matches[0] : null;
      return {
        item_id: match?.id || "",
        item_name: match?.item_name || item.name,
        extracted_name: item.name,
        match_status: match ? "matched" : "unmatched",
        po_qty: 0,
        already_received: 0,
        quantity_received: item.quantity || 0,
        batch_number: item.batch_number || "",
        expiry_date: item.expiry_date || "",
        unit_rate: item.unit_rate || 0,
        po_item_id: null,
      };
    }));

    setNewGRNItems(mapped);
    toast({ title: `Auto-filled ${mapped.length} items — please review` });
  };

  const loadRecords = async () => {
    const { data } = await (supabase as any)
      .from("grn_records")
      .select("*, vendors(vendor_name), users!grn_records_received_by_fkey(full_name)")
      .order("created_at", { ascending: false });
    setRecords(data || []);
  };

  const loadMaster = async () => {
    const [poRes, vendorRes, itemRes] = await Promise.all([
      (supabase as any).from("purchase_orders").select("id, po_number, vendor_id, vendors(vendor_name)").in("status", ["approved", "sent", "partial_grn"]),
      (supabase as any).from("vendors").select("id, vendor_name").eq("is_active", true),
      (supabase as any).from("inventory_items").select("id, item_name, category").eq("is_active", true),
    ]);
    setPOs(poRes.data || []);
    setVendors(vendorRes.data || []);
    setItems(itemRes.data || []);
  };

  useEffect(() => { loadRecords(); loadMaster(); }, []);

  const loadGrnItems = async (grnId: string) => {
    const { data } = await (supabase as any)
      .from("grn_items")
      .select("*, inventory_items(item_name)")
      .eq("grn_id", grnId);
    setGrnItems(data || []);
  };

  const selectGRN = (grn: any) => { setSelected(grn); loadGrnItems(grn.id); };

  const loadPOItems = async (poId: string) => {
    const po = pos.find((p) => p.id === poId);
    if (po) setNewGRN({ ...newGRN, vendor_id: po.vendor_id });
    const { data } = await (supabase as any)
      .from("po_items")
      .select("*, inventory_items(item_name)")
      .eq("po_id", poId);
    setNewGRNItems((data || []).map((pi: any) => ({
      item_id: pi.item_id,
      item_name: pi.inventory_items?.item_name || "",
      po_qty: pi.quantity_ordered,
      already_received: pi.quantity_received || 0,
      quantity_received: pi.quantity_ordered - (pi.quantity_received || 0),
      batch_number: "",
      expiry_date: "",
      unit_rate: pi.unit_rate,
      po_item_id: pi.id,
    })));
  };

  const addManualItem = (itemId: string) => {
    if (newGRNItems.find((n: any) => n.item_id === itemId)) return;
    const item = items.find((i) => i.id === itemId);
    setNewGRNItems([...newGRNItems, {
      item_id: itemId,
      item_name: item?.item_name || "",
      po_qty: 0,
      already_received: 0,
      quantity_received: 1,
      batch_number: "",
      expiry_date: "",
      unit_rate: 0,
      po_item_id: null,
    }]);
    setItemSearch("");
  };

  const submitGRN = async () => {
    const validItems = newGRNItems.filter((gi: any) => gi.quantity_received > 0);
    if (validItems.length === 0) { toast({ title: "Add items to GRN", variant: "destructive" }); return; }
    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!userData) { setSaving(false); return; }

    const vendorId = newGRN.vendor_id || (fromPO && selectedPO ? pos.find((p) => p.id === selectedPO)?.vendor_id : null);
    if (!vendorId) { toast({ title: "Select vendor", variant: "destructive" }); setSaving(false); return; }

    const grnNumber = `GRN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
    const totalAmount = validItems.reduce((s: number, i: any) => s + (i.quantity_received * i.unit_rate), 0);

    const { data: grn, error } = await (supabase as any).from("grn_records").insert({
      hospital_id: userData.hospital_id,
      grn_number: grnNumber,
      po_id: fromPO ? selectedPO || null : null,
      vendor_id: vendorId,
      invoice_number: newGRN.invoice_number || null,
      invoice_date: newGRN.invoice_date || null,
      total_amount: totalAmount,
      quality_check: newGRN.quality_check,
      received_by: userData.id,
    }).select().maybeSingle();

    if (error || !grn) { toast({ title: "Failed to save GRN", variant: "destructive" }); setSaving(false); return; }

    // Bulk insert all GRN items
    await (supabase as any).from("grn_items").insert(
      validItems.map((gi: any) => ({
        hospital_id: userData.hospital_id,
        grn_id: grn.id,
        item_id: gi.item_id,
        po_item_id: gi.po_item_id || null,
        batch_number: gi.batch_number || null,
        expiry_date: gi.expiry_date || null,
        quantity_received: gi.quantity_received,
        unit_rate: gi.unit_rate,
        total_amount: gi.quantity_received * gi.unit_rate,
      }))
    );

    // Parallel: stock updates, transaction logs, PO item updates
    await Promise.all(validItems.map(async (gi: any) => {
      const { data: existingStock } = await (supabase as any)
        .from("inventory_stock")
        .select("id, quantity_available")
        .eq("item_id", gi.item_id)
        .eq("hospital_id", userData.hospital_id)
        .limit(1)
        .maybeSingle();

      const consignmentFields = newGRN.is_consignment ? {
        is_consignment: true,
        consignment_vendor_id: newGRN.consignment_vendor_id || vendorId || null,
      } : {};

      const stockOp = existingStock
        ? (supabase as any).from("inventory_stock").update({
            quantity_available: existingStock.quantity_available + gi.quantity_received,
            last_received_date: new Date().toISOString().slice(0, 10),
            cost_price: gi.unit_rate,
            batch_number: gi.batch_number || existingStock.batch_number,
            expiry_date: gi.expiry_date || existingStock.expiry_date,
            ...consignmentFields,
          }).eq("id", existingStock.id)
        : (supabase as any).from("inventory_stock").insert({
            hospital_id: userData.hospital_id,
            item_id: gi.item_id,
            quantity_available: gi.quantity_received,
            cost_price: gi.unit_rate,
            batch_number: gi.batch_number || null,
            expiry_date: gi.expiry_date || null,
            last_received_date: new Date().toISOString().slice(0, 10),
            ...consignmentFields,
          });

      const txOp = (supabase as any).from("stock_transactions").insert({
        hospital_id: userData.hospital_id,
        item_id: gi.item_id,
        transaction_type: "grn",
        quantity: gi.quantity_received,
        unit_rate: gi.unit_rate,
        reference_id: grn.id,
        reference_type: "grn",
        created_by: userData.id,
        notes: `GRN ${grnNumber}`,
      });

      const poOp = gi.po_item_id
        ? (supabase as any).from("po_items").update({
            quantity_received: (gi.already_received || 0) + gi.quantity_received,
          }).eq("id", gi.po_item_id)
        : Promise.resolve();

      await Promise.all([stockOp, txOp, poOp]);
    }));

    // Update PO status
    if (fromPO && selectedPO) {
      const { data: poItemsData } = await (supabase as any).from("po_items").select("quantity_ordered, quantity_received").eq("po_id", selectedPO);
      const allComplete = (poItemsData || []).every((pi: any) => (pi.quantity_received || 0) >= pi.quantity_ordered);
      await (supabase as any).from("purchase_orders").update({ status: allComplete ? "completed" : "partial_grn" }).eq("id", selectedPO);
    }

    // Save AI log if scan was used
    if (scanImageFile && extractionConfidence !== null) {
      let invoiceImageUrl: string | null = null;
      const filePath = `${userData.hospital_id}/${grnNumber}.${scanImageFile.name.split('.').pop()}`;
      const { data: uploadData } = await supabase.storage.from("grn-invoices").upload(filePath, scanImageFile);
      if (uploadData?.path) {
        const { data: urlData } = supabase.storage.from("grn-invoices").getPublicUrl(uploadData.path);
        invoiceImageUrl = urlData?.publicUrl || null;
        await (supabase as any).from("grn_records").update({ invoice_image_url: invoiceImageUrl }).eq("id", grn.id);
      }
      await (supabase as any).from("grn_ai_log").insert({
        hospital_id: userData.hospital_id,
        grn_id: grn.id,
        invoice_image_url: invoiceImageUrl,
        extraction_confidence: extractionConfidence,
        items_extracted: itemsExtractedCount,
        items_matched: validItems.filter((i: any) => i.match_status === "matched").length,
        items_unmatched: validItems.filter((i: any) => i.match_status === "unmatched").length,
        processing_time_ms: 0,
        model_used: "gemini-2.5-flash",
      });
    }

    toast({ title: `GRN ${grnNumber} saved — stock updated` });

    // Auto-post journal entry for GRN
    const vendorName = vendors.find(v => v.id === vendorId)?.vendor_name || "Vendor";
    await autoPostJournalEntry({
      triggerEvent: "grn_received",
      sourceModule: "inventory",
      sourceId: grn.id,
      amount: totalAmount,
      description: `GRN ${grnNumber} - ${vendorName}`,
      hospitalId: userData.hospital_id,
      postedBy: userData.id,
    });
    setShowNew(false);
    setNewGRNItems([]);
    setSelectedPO("");
    setScanImageFile(null);
    setExtractionConfidence(null);
    setNewGRN({ vendor_id: "", invoice_number: "", invoice_date: "", quality_check: "pass", is_consignment: false, consignment_vendor_id: "" });
    loadRecords();
    loadMaster();
    setSaving(false);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT — GRN List */}
      <div className="w-[340px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">GRN Records ({records.length})</span>
          <Button size="sm" className="text-[10px] h-6 gap-1" onClick={() => setShowNew(true)}>
            <Plus className="h-3 w-3" /> New GRN
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {records.map((grn) => (
            <div
              key={grn.id}
              onClick={() => selectGRN(grn)}
              className={cn(
                "px-4 py-3 border-b border-border/50 cursor-pointer transition-colors",
                selected?.id === grn.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">{grn.grn_number}</p>
                  <p className="text-xs font-semibold text-foreground">{grn.vendors?.vendor_name || "—"}</p>
                  <p className="text-[10px] text-muted-foreground">{grn.grn_date} • ₹{(grn.total_amount || 0).toLocaleString("en-IN")}</p>
                </div>
                <span className={cn("text-[9px] px-2 py-0.5 rounded-full capitalize font-medium", qcColors[grn.quality_check] || "bg-muted text-muted-foreground")}>
                  QC: {grn.quality_check}
                </span>
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-xs">No GRN records.</div>
          )}
        </div>
      </div>

      {/* RIGHT — GRN Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-foreground">{selected.grn_number}</p>
                  <p className="text-[10px] text-muted-foreground">{selected.vendors?.vendor_name} • {selected.grn_date} • Invoice: {selected.invoice_number || "—"}</p>
                </div>
                <span className={cn("text-[10px] px-2.5 py-0.5 rounded-full capitalize font-medium", qcColors[selected.quality_check])}>
                  QC: {selected.quality_check}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Batch</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Expiry</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Rate</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {grnItems.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="px-4 py-2 font-medium text-foreground">{item.inventory_items?.item_name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono">{item.batch_number || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.expiry_date || "—"}</td>
                      <td className="px-3 py-2 text-right">{item.quantity_received}</td>
                      <td className="px-3 py-2 text-right">₹{(item.unit_rate || 0).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right font-semibold">₹{(item.total_amount || 0).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex-shrink-0 border-t border-border bg-card px-4 py-2.5 text-right text-xs font-bold">
              Total: ₹{(selected.total_amount || 0).toLocaleString("en-IN")}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
            Select a GRN to view details
          </div>
        )}
      </div>

      {/* New GRN Modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle className="text-sm">New Goods Received Note</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* AI Invoice Scanner */}
            <InvoiceScanZone onExtracted={handleInvoiceExtracted} />

            {extractionConfidence !== null && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                <span>✓ Extracted {itemsExtractedCount} items (confidence: {Math.round(extractionConfidence * 100)}%)</span>
                <span className="text-emerald-500">— Please review each item before saving</span>
              </div>
            )}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Against PO?</span>
                <Switch checked={fromPO} onCheckedChange={setFromPO} />
                <span className="font-medium">{fromPO ? "Yes" : "No (Direct GRN)"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Consignment?</span>
                <Switch checked={newGRN.is_consignment} onCheckedChange={(v) => setNewGRN(g => ({ ...g, is_consignment: v }))} />
                {newGRN.is_consignment && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">C — Consignment</span>
                )}
              </div>
            </div>

            {fromPO ? (
              <Select value={selectedPO} onValueChange={(v) => { setSelectedPO(v); loadPOItems(v); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Purchase Order" /></SelectTrigger>
                <SelectContent>
                  {pos.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.po_number} — {p.vendors?.vendor_name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Select value={newGRN.vendor_id} onValueChange={(v) => setNewGRN({ ...newGRN, vendor_id: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id} className="text-xs">{v.vendor_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Invoice Number" value={newGRN.invoice_number} onChange={(e) => setNewGRN({ ...newGRN, invoice_number: e.target.value })} className="h-8 text-xs" />
              <Input type="date" value={newGRN.invoice_date} onChange={(e) => setNewGRN({ ...newGRN, invoice_date: e.target.value })} className="h-8 text-xs" />
              <Select value={newGRN.quality_check} onValueChange={(v) => setNewGRN({ ...newGRN, quality_check: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass" className="text-xs">✓ Pass</SelectItem>
                  <SelectItem value="fail" className="text-xs">✗ Fail</SelectItem>
                  <SelectItem value="conditional" className="text-xs">⚠ Conditional</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 py-1">
              <Switch checked={newGRN.is_consignment} onCheckedChange={(v) => setNewGRN({ ...newGRN, is_consignment: v })} />
              <span className="text-xs font-medium">Consignment Stock</span>
              {newGRN.is_consignment && (
                <Select value={newGRN.consignment_vendor_id} onValueChange={(v) => setNewGRN({ ...newGRN, consignment_vendor_id: v })}>
                  <SelectTrigger className="h-7 text-xs w-48"><SelectValue placeholder="Consignment Vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id} className="text-xs">{v.vendor_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {newGRN.is_consignment && <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-semibold">C — Consignment</span>}
            </div>

            {!fromPO && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search items to add..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                {itemSearch && (
                  <div className="absolute top-9 left-0 right-0 max-h-28 overflow-auto border border-border rounded bg-card z-20">
                    {items.filter((i) => i.item_name.toLowerCase().includes(itemSearch.toLowerCase())).map((i) => (
                      <div key={i.id} onClick={() => addManualItem(i.id)} className="px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer">{i.item_name}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {newGRNItems.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Item</th>
                      {fromPO && <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">PO Qty</th>}
                      <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Recv Qty</th>
                      <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Batch</th>
                      <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Expiry</th>
                      <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Rate</th>
                      <th className="px-1 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGRNItems.map((gi: any, idx: number) => (
                      <tr key={idx} className={cn("border-b border-border/50", gi.match_status === "matched" ? "border-l-2 border-l-emerald-500" : gi.match_status === "unmatched" ? "border-l-2 border-l-amber-500" : "")}>
                        <td className="px-3 py-1.5 truncate max-w-[140px]">
                          <span>{gi.item_name}</span>
                          {gi.extracted_name && gi.extracted_name !== gi.item_name && (
                            <span className="block text-[10px] italic text-muted-foreground">Scanned: {gi.extracted_name}</span>
                          )}
                          {gi.match_status === "unmatched" && <span className="block text-[10px] text-amber-600">⚠️ Not in master</span>}
                        </td>
                        {fromPO && <td className="px-2 py-1.5 text-right text-muted-foreground">{gi.po_qty}</td>}
                        <td className="px-2 py-1.5 text-right">
                          <Input type="number" min={0} value={gi.quantity_received} onChange={(e) => { const c = [...newGRNItems]; c[idx].quantity_received = parseInt(e.target.value) || 0; setNewGRNItems(c); }} className="h-6 w-14 text-xs text-right" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={gi.batch_number} onChange={(e) => { const c = [...newGRNItems]; c[idx].batch_number = e.target.value; setNewGRNItems(c); }} className="h-6 w-20 text-xs" placeholder="Batch" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input type="date" value={gi.expiry_date} onChange={(e) => { const c = [...newGRNItems]; c[idx].expiry_date = e.target.value; setNewGRNItems(c); }} className="h-6 w-28 text-xs" />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Input type="number" min={0} value={gi.unit_rate} onChange={(e) => { const c = [...newGRNItems]; c[idx].unit_rate = parseFloat(e.target.value) || 0; setNewGRNItems(c); }} className="h-6 w-16 text-xs text-right" />
                        </td>
                        <td className="px-1 py-1.5">
                          {!fromPO && (
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => setNewGRNItems(newGRNItems.filter((_: any, i: number) => i !== idx))}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowNew(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={submitGRN} disabled={saving} className="text-xs gap-1.5">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save GRN
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GRNPanel;
