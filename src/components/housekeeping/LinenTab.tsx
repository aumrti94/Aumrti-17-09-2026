import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props { hospitalId: string | null; }

const LINEN_TYPES = ["bed_sheet", "pillow_cover", "blanket", "patient_gown", "surgical_drape", "curtain", "towel"];

const LinenTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<any[]>([]);
  const [wards, setWards] = useState<any[]>([]);
  const [wardId, setWardId] = useState("");
  const [linenType, setLinenType] = useState("bed_sheet");
  const [sentLaundry, setSentLaundry] = useState("");
  const [receivedBack, setReceivedBack] = useState("");
  const [condemned, setCondemned] = useState("");

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("linen_records").select("*, wards(name)").eq("hospital_id", hospitalId)
      .order("record_date", { ascending: false }).limit(50)
      .then(({ data }) => setRecords(data || []));
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).then(({ data }) => setWards(data || []));
  }, [hospitalId]);

  const saveEntry = async () => {
    if (!hospitalId || !wardId) { toast.error("Select a ward"); return; }
    const { error } = await supabase.from("linen_records").insert({
      hospital_id: hospitalId, ward_id: wardId, linen_type: linenType,
      qty_sent_laundry: parseInt(sentLaundry) || 0,
      qty_received_back: parseInt(receivedBack) || 0,
      qty_condemned: parseInt(condemned) || 0,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Linen record saved");
    setSentLaundry(""); setReceivedBack(""); setCondemned("");
    const { data } = await supabase.from("linen_records").select("*, wards(name)").eq("hospital_id", hospitalId).order("record_date", { ascending: false }).limit(50);
    setRecords(data || []);
  };

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* Entry Form */}
      <div className="bg-card border border-border rounded-lg p-3">
        <p className="text-xs font-semibold mb-2">Daily Linen Entry</p>
        <div className="flex gap-2 items-end flex-wrap">
          <Select value={wardId} onValueChange={setWardId}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Ward" /></SelectTrigger>
            <SelectContent>{wards.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={linenType} onValueChange={setLinenType}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LINEN_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Sent" value={sentLaundry} onChange={e => setSentLaundry(e.target.value)} className="w-20 h-8 text-xs" type="number" />
          <Input placeholder="Received" value={receivedBack} onChange={e => setReceivedBack(e.target.value)} className="w-20 h-8 text-xs" type="number" />
          <Input placeholder="Condemned" value={condemned} onChange={e => setCondemned(e.target.value)} className="w-24 h-8 text-xs" type="number" />
          <Button size="sm" className="h-8 text-xs" onClick={saveEntry}>Save</Button>
        </div>
      </div>

      {/* Records */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Ward</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Sent</TableHead>
              <TableHead className="text-xs">Received</TableHead>
              <TableHead className="text-xs">Condemned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-mono">{format(new Date(r.record_date), "dd/MM/yyyy")}</TableCell>
                <TableCell className="text-xs">{r.wards?.name || "—"}</TableCell>
                <TableCell className="text-xs">{r.linen_type?.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-xs">{r.qty_sent_laundry}</TableCell>
                <TableCell className="text-xs">{r.qty_received_back}</TableCell>
                <TableCell className="text-xs">{r.qty_condemned}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">No records</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default LinenTab;
