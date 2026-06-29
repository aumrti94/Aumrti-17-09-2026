import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { hospitalId: string; }

const StockTab: React.FC<Props> = ({ hospitalId }) => {
  const [stock, setStock] = useState<any[]>([]);
  const [vaccines, setVaccines] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [vaccineId, setVaccineId] = useState("");
  const [stockType, setStockType] = useState("purchased");
  const [batchNumber, setBatchNumber] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split("T")[0]);
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadStock();
    supabase.from("vaccine_master").select("id, vaccine_name, vaccine_code").eq("is_active", true).order("vaccine_name")
      .then(({ data }) => setVaccines(data || []));
  }, []);

  const loadStock = async () => {
    const { data } = await supabase.from("vaccine_stock")
      .select("*, vaccine_master(vaccine_name, vaccine_code)")
      .eq("hospital_id", hospitalId).order("expiry_date");
    setStock(data || []);
  };

  const handleSave = async () => {
    if (!vaccineId || !batchNumber || !manufacturer || !expiryDate || !quantity) {
      toast.error("Fill all required fields"); return;
    }
    setSaving(true);
    const { error } = await supabase.from("vaccine_stock").insert({
      hospital_id: hospitalId,
      vaccine_id: vaccineId,
      stock_type: stockType,
      batch_number: batchNumber,
      manufacturer,
      received_date: receivedDate,
      expiry_date: expiryDate,
      quantity_received: parseInt(quantity),
      storage_location: storageLocation || null,
    });
    if (error) { toast.error("Failed: " + error.message); setSaving(false); return; }
    toast.success("Stock received!");
    setShowAdd(false);
    setVaccineId(""); setBatchNumber(""); setManufacturer(""); setExpiryDate(""); setQuantity(""); setStorageLocation("");
    loadStock();
    setSaving(false);
  };

  const isExpiringSoon = (d: string) => {
    const diff = (new Date(d).getTime() - Date.now()) / 86400000;
    return diff < 30 && diff > 0;
  };
  const isExpired = (d: string) => new Date(d) < new Date();

  return (
    <div className="space-y-3 pb-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Vaccine Stock (FEFO)</h3>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Receive Stock</Button>
      </div>

      <div className="border rounded-lg overflow-auto max-h-[calc(100vh-340px)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vaccine</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Manufacturer</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Wasted</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.map((s) => (
              <TableRow key={s.id} className={isExpired(s.expiry_date) ? "bg-destructive/5" : isExpiringSoon(s.expiry_date) ? "bg-amber-50" : ""}>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{(s as any).vaccine_master?.vaccine_code}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.batch_number}</TableCell>
                <TableCell className="text-xs capitalize">{s.stock_type?.replace("_", " ")}</TableCell>
                <TableCell className="text-xs">{s.manufacturer}</TableCell>
                <TableCell className="text-xs">
                  {new Date(s.expiry_date).toLocaleDateString("en-IN")}
                  {isExpired(s.expiry_date) && <Badge variant="destructive" className="ml-1 text-[9px]">EXPIRED</Badge>}
                  {isExpiringSoon(s.expiry_date) && <Badge variant="secondary" className="ml-1 text-[9px]">EXPIRING</Badge>}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{s.quantity_received}</TableCell>
                <TableCell className="text-right font-mono text-sm">{s.quantity_used}</TableCell>
                <TableCell className="text-right font-mono text-sm">{s.quantity_wasted}</TableCell>
                <TableCell className="text-right font-mono text-sm font-bold">{s.quantity_balance}</TableCell>
              </TableRow>
            ))}
            {stock.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No stock entries</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive Vaccine Stock</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Vaccine</Label>
              <Select value={vaccineId} onValueChange={setVaccineId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {vaccines.map((v) => <SelectItem key={v.id} value={v.id}>{v.vaccine_code} — {v.vaccine_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Stock Type</Label>
                <Select value={stockType} onValueChange={setStockType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchased">Purchased</SelectItem>
                    <SelectItem value="government_supplied">Government Supplied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Batch Number</Label>
                <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Manufacturer</Label>
                <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm">Quantity</Label>
                <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Received Date</Label>
                <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm">Expiry Date</Label>
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-sm">Storage Location</Label>
              <Input value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} placeholder="e.g. Vaccine Fridge 1" />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Receive Stock"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockTab;
