import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { isFullyCompatible, formatBloodGroup, componentLabel } from "@/lib/bloodCompatibility";
import { AlertTriangle, ShieldX, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

interface Props { onRefresh: () => void }

const CrossMatchTab: React.FC<Props> = ({ onRefresh }) => {
  const { toast } = useToast();
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [unitData, setUnitData] = useState<any>(null);
  const [compatibility, setCompatibility] = useState<{ compatible: boolean; aboOk: boolean; rhOk: boolean } | null>(null);
  const [technique, setTechnique] = useState("immediate_spin");
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");
  const [recentRecords, setRecentRecords] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("patients").select("id, full_name, uhid, blood_group").limit(200).then(({ data }) => {
      if (data) setPatients(data);
    });
    fetchRecent();
  }, []);

  const fetchRecent = async () => {
    const { data } = await supabase.from("cross_match_records")
      .select("*, blood_units(unit_number, blood_group, rh_factor, component), patients(full_name, uhid)")
      .order("performed_at", { ascending: false })
      .limit(20);
    if (data) setRecentRecords(data);
  };

  const lookupUnit = async () => {
    if (!unitNumber.trim()) return;
    const { data } = await supabase.from("blood_units")
      .select("*")
      .eq("unit_number", unitNumber.trim())
      .maybeSingle();

    if (!data) {
      toast({ title: "Unit not found", variant: "destructive" });
      setUnitData(null);
      setCompatibility(null);
      return;
    }
    setUnitData(data);

    // Instant ABO/Rh compatibility check
    if (selectedPatient?.blood_group) {
      // Parse patient blood group (could be "A+", "O-", "B positive" etc)
      const pg = parseBloodGroup(selectedPatient.blood_group);
      if (pg) {
        const check = isFullyCompatible(pg.group as any, pg.rh as any, data.blood_group as any, data.rh_factor as any);
        setCompatibility(check);
      }
    }
  };

  const parseBloodGroup = (bg: string): { group: string; rh: string } | null => {
    if (!bg) return null;
    const clean = bg.toUpperCase().trim();
    const match = clean.match(/^(A|B|AB|O)\s*(\+|-|POSITIVE|NEGATIVE)?$/i);
    if (!match) return null;
    const group = match[1];
    const rhRaw = match[2] || '+';
    const rh = (rhRaw === '-' || rhRaw.toLowerCase() === 'negative') ? 'negative' : 'positive';
    return { group, rh };
  };

  const handlePatientChange = (patientId: string) => {
    const p = patients.find(pt => pt.id === patientId);
    setSelectedPatient(p || null);
    setCompatibility(null);
    setUnitData(null);
    setUnitNumber("");
    setResult("");
  };

  const saveCrossMatch = async () => {
    if (!selectedPatient || !unitData || !result) {
      toast({ title: "Complete all fields", variant: "destructive" });
      return;
    }

    // HARD BLOCK: Never allow saving compatible result if ABO/Rh is incompatible
    if (compatibility && !compatibility.compatible && result === "compatible") {
      toast({ title: "SAFETY BLOCK: Cannot record compatible result for ABO/Rh incompatible unit", variant: "destructive" });
      return;
    }

    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    await supabase.from("cross_match_records").insert({
      hospital_id: user.hospital_id,
      unit_id: unitData.id,
      patient_id: selectedPatient.id,
      technique,
      result,
      performed_by: user.id,
      notes: notes || null,
    });

    if (result === "incompatible") {
      // Auto-quarantine
      await supabase.from("blood_units").update({ status: "quarantine" }).eq("id", unitData.id);
      toast({ title: "Incompatible — unit quarantined", description: "This unit cannot be issued." });
    } else if (result === "compatible") {
      await supabase.from("blood_units").update({ status: "reserved", reserved_for: selectedPatient.id }).eq("id", unitData.id);
      toast({ title: "✓ Compatible — unit reserved", description: `Reserved for ${selectedPatient.full_name}` });
    } else {
      toast({ title: "Minor incompatibility recorded" });
    }

    // Reset form
    setUnitNumber("");
    setUnitData(null);
    setCompatibility(null);
    setResult("");
    setNotes("");
    fetchRecent();
    onRefresh();
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      {/* Cross-Match Form */}
      <div className="bg-background border border-border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-bold">🔬 Cross-Match Testing</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Patient</Label>
            <Select onValueChange={handlePatientChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Search patient..." /></SelectTrigger>
              <SelectContent>
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name} ({p.uhid}) {p.blood_group ? `— ${p.blood_group}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPatient?.blood_group && (
              <p className="text-xs mt-1 text-muted-foreground">Patient blood group: <span className="font-bold text-foreground">{selectedPatient.blood_group}</span></p>
            )}
          </div>
          <div>
            <Label className="text-xs">Unit Number (scan/type)</Label>
            <div className="flex gap-2">
              <Input value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="BU-xxxx-001" className="h-9" onKeyDown={e => e.key === 'Enter' && lookupUnit()} />
              <Button size="sm" variant="outline" onClick={lookupUnit}>Lookup</Button>
            </div>
            {unitData && (
              <p className="text-xs mt-1">{componentLabel(unitData.component)} · <span className="font-bold">{formatBloodGroup(unitData.blood_group, unitData.rh_factor)}</span> · {unitData.volume_ml}ml</p>
            )}
          </div>
        </div>

        {/* COMPATIBILITY CHECK - HARD BLOCK */}
        {compatibility && !compatibility.compatible && (
          <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-700">
              <ShieldX className="w-6 h-6" />
              <span className="text-base font-bold">🔴 ABO INCOMPATIBILITY DETECTED</span>
            </div>
            <p className="text-sm text-red-700 mt-2">
              Patient is <strong>{selectedPatient?.blood_group}</strong>. Selected unit is <strong>{formatBloodGroup(unitData?.blood_group, unitData?.rh_factor)}</strong>.
            </p>
            {!compatibility.aboOk && <p className="text-sm text-red-700 font-semibold">ABO groups are NOT compatible.</p>}
            {!compatibility.rhOk && <p className="text-sm text-red-700 font-semibold">Rh factor is NOT compatible (Rh- patient cannot receive Rh+ blood).</p>}
            <p className="text-sm text-red-600 mt-2 font-bold">Select a compatible unit. This unit CANNOT be issued to this patient.</p>
          </div>
        )}

        {compatibility && compatibility.compatible && (
          <div className="bg-green-50 border border-green-300 rounded-lg p-3 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-700 font-semibold">✓ ABO & Rh compatible — proceed with lab cross-match</span>
          </div>
        )}

        {/* Lab technique & result - only if ABO compatible */}
        {unitData && (!compatibility || compatibility.compatible) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Technique</Label>
                <Select value={technique} onValueChange={setTechnique}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate_spin">Immediate Spin (IS)</SelectItem>
                    <SelectItem value="albumin">Albumin</SelectItem>
                    <SelectItem value="antiglobulin">Indirect Antiglobulin (IAT)</SelectItem>
                    <SelectItem value="electronic">Electronic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Result</Label>
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant={result === "compatible" ? "default" : "outline"} className={result === "compatible" ? "bg-green-600 hover:bg-green-700" : ""} onClick={() => setResult("compatible")}>✓ Compatible</Button>
                  <Button size="sm" variant={result === "incompatible" ? "default" : "outline"} className={result === "incompatible" ? "bg-red-600 hover:bg-red-700" : ""} onClick={() => setResult("incompatible")}>✗ Incompatible</Button>
                  <Button size="sm" variant={result === "minor_incompatible" ? "default" : "outline"} className={result === "minor_incompatible" ? "bg-amber-600 hover:bg-amber-700" : ""} onClick={() => setResult("minor_incompatible")}>⚠️ Minor</Button>
                </div>
              </div>
            </div>

            {result === "incompatible" && (
              <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                <p className="text-sm text-red-700 font-semibold">Incompatible result — this unit will be quarantined and CANNOT be issued.</p>
              </div>
            )}

            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
            </div>
            <Button onClick={saveCrossMatch} disabled={!result}>Save Cross-Match Result</Button>
          </>
        )}
      </div>

      {/* Recent cross-match log */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Recent Cross-Match Log</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Unit #</TableHead>
              <TableHead className="text-xs">Patient</TableHead>
              <TableHead className="text-xs">Result</TableHead>
              <TableHead className="text-xs">Technique</TableHead>
              <TableHead className="text-xs">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentRecords.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-mono">{r.blood_units?.unit_number}</TableCell>
                <TableCell className="text-xs">{r.patients?.full_name} ({r.patients?.uhid})</TableCell>
                <TableCell>
                  {r.result === "compatible" && <Badge className="bg-green-100 text-green-700 text-[10px]">Compatible</Badge>}
                  {r.result === "incompatible" && <Badge className="bg-red-100 text-red-700 text-[10px]">Incompatible</Badge>}
                  {r.result === "minor_incompatible" && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Minor</Badge>}
                </TableCell>
                <TableCell className="text-xs capitalize">{r.technique?.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-xs">{format(new Date(r.performed_at), "dd/MM/yyyy HH:mm")}</TableCell>
              </TableRow>
            ))}
            {recentRecords.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No cross-match records yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default CrossMatchTab;
