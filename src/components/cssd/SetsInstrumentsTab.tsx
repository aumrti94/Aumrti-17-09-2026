import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus } from "lucide-react";

interface Props { onRefresh: () => void }

const statusColor: Record<string, string> = {
  sterile: "bg-green-100 text-green-700",
  dirty: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  in_use: "bg-purple-100 text-purple-700",
  quarantine: "bg-red-100 text-red-700",
  in_sterilizer: "bg-blue-100 text-blue-700",
  condemned: "bg-muted text-muted-foreground",
};

const SetsInstrumentsTab: React.FC<Props> = ({ onRefresh }) => {
  const { toast } = useToast();
  const [sets, setSets] = useState<any[]>([]);
  const [instruments, setInstruments] = useState<any[]>([]);
  const [selectedSet, setSelectedSet] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAddInstrument, setShowAddInstrument] = useState(false);
  const [showAddSet, setShowAddSet] = useState(false);
  const [instForm, setInstForm] = useState({ instrument_name: "", barcode: "", category: "surgical", material: "stainless_steel", max_reprocessing: 0 });
  const [setForm, setSetForm] = useState({ set_name: "", set_code: "", specialty: "" });

  const fetchData = async () => {
    const [setsRes, instRes] = await Promise.all([
      supabase.from("instrument_sets").select("*").order("set_name"),
      supabase.from("instruments").select("*").order("instrument_name"),
    ]);
    if (setsRes.data) setSets(setsRes.data);
    if (instRes.data) setInstruments(instRes.data);
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = sets.filter(s =>
    (s.set_name.toLowerCase().includes(search.toLowerCase()) || s.set_code.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === "all" || s.status === statusFilter)
  );

  const setInstrumentsForSet = selectedSet ? instruments.filter(i => i.set_id === selectedSet.id) : [];

  const addInstrument = async () => {
    if (!instForm.instrument_name || !instForm.barcode) {
      toast({ title: "Name and barcode required", variant: "destructive" });
      return;
    }
    const { data: user } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!user) return;
    await supabase.from("instruments").insert({
      hospital_id: user.hospital_id,
      barcode: instForm.barcode,
      instrument_name: instForm.instrument_name,
      category: instForm.category,
      material: instForm.material,
      max_reprocessing: instForm.max_reprocessing,
      set_id: selectedSet?.id || null,
    });
    if (selectedSet) {
      await supabase.from("instrument_sets").update({ instrument_count: setInstrumentsForSet.length + 1 }).eq("id", selectedSet.id);
    }
    toast({ title: "Instrument added" });
    setShowAddInstrument(false);
    setInstForm({ instrument_name: "", barcode: "", category: "surgical", material: "stainless_steel", max_reprocessing: 0 });
    fetchData();
  };

  const addSet = async () => {
    if (!setForm.set_name || !setForm.set_code) {
      toast({ title: "Name and code required", variant: "destructive" });
      return;
    }
    const { data: user } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!user) return;
    await supabase.from("instrument_sets").insert({
      hospital_id: user.hospital_id,
      set_name: setForm.set_name,
      set_code: setForm.set_code,
      specialty: setForm.specialty || null,
    });
    toast({ title: "Set created" });
    setShowAddSet(false);
    setSetForm({ set_name: "", set_code: "", specialty: "" });
    fetchData();
    onRefresh();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Sets List */}
      <div className="w-[320px] border-r border-border overflow-y-auto p-3 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sets..." className="h-8 pl-8 text-xs" />
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowAddSet(true)}><Plus className="w-4 h-4" /></Button>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="sterile">Sterile</SelectItem>
            <SelectItem value="dirty">Dirty</SelectItem>
            <SelectItem value="quarantine">Quarantined</SelectItem>
          </SelectContent>
        </Select>

        {filtered.map(s => (
          <button key={s.id} onClick={() => setSelectedSet(s)}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedSet?.id === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{s.set_name}</span>
              <Badge className={`text-[10px] ${statusColor[s.status] || ""}`}>{s.status}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">{s.set_code} · {s.specialty}</p>
            <p className="text-[10px] text-muted-foreground">{s.instrument_count} instruments</p>
          </button>
        ))}
      </div>

      {/* Right: Set Detail */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedSet ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">{selectedSet.set_name}</h3>
                <p className="text-xs text-muted-foreground">{selectedSet.set_code} · {selectedSet.specialty}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAddInstrument(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Instrument
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Barcode</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Material</TableHead>
                  <TableHead className="text-xs">Cycles</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setInstrumentsForSet.map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs font-mono">{i.barcode}</TableCell>
                    <TableCell className="text-xs">{i.instrument_name}</TableCell>
                    <TableCell className="text-xs capitalize">{i.category?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs capitalize">{i.material?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{i.reprocessing_count}{i.max_reprocessing > 0 ? `/${i.max_reprocessing}` : ""}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${statusColor[i.status] || ""}`}>{i.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {setInstrumentsForSet.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No instruments in this set. Add some above.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">Select a set to view its instruments</p>
        )}
      </div>

      {/* Add Instrument Modal */}
      <Dialog open={showAddInstrument} onOpenChange={setShowAddInstrument}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Instrument</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name *</Label><Input value={instForm.instrument_name} onChange={e => setInstForm(f => ({ ...f, instrument_name: e.target.value }))} className="h-9" /></div>
            <div><Label className="text-xs">Barcode *</Label><Input value={instForm.barcode} onChange={e => setInstForm(f => ({ ...f, barcode: e.target.value }))} className="h-9" placeholder="Scan or type" /></div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={instForm.category} onValueChange={v => setInstForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["surgical","endoscope","implant","electrical","container","other"].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g," ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Max Reprocessing (0=unlimited)</Label><Input type="number" value={instForm.max_reprocessing} onChange={e => setInstForm(f => ({ ...f, max_reprocessing: parseInt(e.target.value) || 0 }))} className="h-9" /></div>
            <Button className="w-full" onClick={addInstrument}>Add Instrument</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Set Modal */}
      <Dialog open={showAddSet} onOpenChange={setShowAddSet}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Instrument Set</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Set Name *</Label><Input value={setForm.set_name} onChange={e => setSetForm(f => ({ ...f, set_name: e.target.value }))} className="h-9" /></div>
            <div><Label className="text-xs">Set Code *</Label><Input value={setForm.set_code} onChange={e => setSetForm(f => ({ ...f, set_code: e.target.value }))} className="h-9" placeholder="SET-XXX-001" /></div>
            <div><Label className="text-xs">Specialty</Label><Input value={setForm.specialty} onChange={e => setSetForm(f => ({ ...f, specialty: e.target.value }))} className="h-9" /></div>
            <Button className="w-full" onClick={addSet}>Create Set</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SetsInstrumentsTab;
