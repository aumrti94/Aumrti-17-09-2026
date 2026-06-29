import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface Props { hospitalId: string; onClose: () => void; }

const BMWEntryModal: React.FC<Props> = ({ hospitalId, onClose }) => {
  const [wardId, setWardId] = useState("");
  const [wards, setWards] = useState<any[]>([]);
  const [yellow, setYellow] = useState(""); const [red, setRed] = useState("");
  const [blue, setBlue] = useState(""); const [white, setWhite] = useState("");
  const [black, setBlack] = useState(""); const [cytotoxic, setCytotoxic] = useState("");
  const [agency, setAgency] = useState(""); const [manifest, setManifest] = useState("");

  useEffect(() => {
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).then(({ data }) => setWards(data || []));
  }, [hospitalId]);

  const total = [yellow, red, blue, white, black, cytotoxic].reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const save = async () => {
    if (!wardId) { toast.error("Select a ward"); return; }
    const wardName = wards.find(w => w.id === wardId)?.name || "";
    const { error } = await supabase.from("bmw_records").insert({
      hospital_id: hospitalId, ward_id: wardId, ward_name: wardName,
      yellow_bag_kg: parseFloat(yellow) || 0, red_bag_kg: parseFloat(red) || 0,
      blue_bag_kg: parseFloat(blue) || 0, white_bag_kg: parseFloat(white) || 0,
      black_bag_kg: parseFloat(black) || 0, cytotoxic_kg: parseFloat(cytotoxic) || 0,
      total_kg: Math.round(total * 100) / 100,
      disposal_agency: agency || null, cpcb_manifest_no: manifest || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("BMW record saved");
    const recordDate = new Date().toLocaleDateString("en-IN");
    logNABHEvidence(hospitalId, "HIC.8",
      `BMW log: ${recordDate}, Yellow: ${parseFloat(yellow) || 0}kg, Red: ${parseFloat(red) || 0}kg, White: ${parseFloat(white) || 0}kg, Agency: ${agency || "N/A"}`);
    onClose();
  };

  const bags = [
    { label: "🟡 Yellow (Anatomical)", value: yellow, set: setYellow },
    { label: "🔴 Red (Contaminated)", value: red, set: setRed },
    { label: "🔵 Blue (Glass/metals)", value: blue, set: setBlue },
    { label: "⚪ White (Sharps)", value: white, set: setWhite },
    { label: "⚫ Black (General)", value: black, set: setBlack },
    { label: "🧪 Cytotoxic", value: cytotoxic, set: setCytotoxic },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">BMW Daily Entry</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={wardId} onValueChange={setWardId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select Ward" /></SelectTrigger>
            <SelectContent>{wards.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>)}</SelectContent>
          </Select>
          {bags.map(b => (
            <div key={b.label} className="flex items-center gap-2">
              <span className="text-xs w-44">{b.label}</span>
              <Input type="number" step="0.01" placeholder="kg" value={b.value} onChange={e => b.set(e.target.value)} className="h-8 text-xs w-24" />
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-2">
            <span className="text-xs font-bold w-44">Total</span>
            <span className="text-sm font-bold font-mono">{total.toFixed(2)} kg</span>
          </div>
          <Input placeholder="Disposal agency" value={agency} onChange={e => setAgency(e.target.value)} className="h-8 text-xs" />
          <Input placeholder="CPCB Manifest No." value={manifest} onChange={e => setManifest(e.target.value)} className="h-8 text-xs" />
        </div>
        <DialogFooter><Button size="sm" className="text-xs" onClick={save}>Save BMW Record</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BMWEntryModal;
