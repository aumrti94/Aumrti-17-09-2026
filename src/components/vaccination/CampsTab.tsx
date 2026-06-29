import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props { hospitalId: string; }

const CampsTab: React.FC<Props> = ({ hospitalId }) => {
  const [camps, setCamps] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [campDate, setCampDate] = useState("");
  const [location, setLocation] = useState("");
  const [target, setTarget] = useState("");
  const [targetCount, setTargetCount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCamps(); }, []);

  const loadCamps = async () => {
    const { data } = await supabase.from("vaccine_camps")
      .select("*").eq("hospital_id", hospitalId)
      .order("camp_date", { ascending: false }).limit(50);
    setCamps(data || []);
  };

  const handleSave = async () => {
    if (!name || !campDate || !location) { toast.error("Fill required fields"); return; }
    setSaving(true);
    const { error } = await supabase.from("vaccine_camps").insert({
      hospital_id: hospitalId,
      camp_name: name,
      camp_date: campDate,
      location,
      target_population: target || null,
      target_count: targetCount ? parseInt(targetCount) : null,
      notes: notes || null,
    });
    if (error) { toast.error("Failed to save"); setSaving(false); return; }
    toast.success("Camp planned!");
    setShowAdd(false);
    setName(""); setCampDate(""); setLocation(""); setTarget(""); setTargetCount(""); setNotes("");
    loadCamps();
    setSaving(false);
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "default";
    if (s === "ongoing") return "secondary";
    if (s === "cancelled") return "destructive";
    return "outline";
  };

  return (
    <div className="space-y-3 pb-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Vaccination Camps</h3>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Plan Camp</Button>
      </div>

      <div className="border rounded-lg overflow-auto max-h-[calc(100vh-340px)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Camp Name</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {camps.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-sm">{c.camp_name}</TableCell>
                <TableCell className="text-sm">{new Date(c.camp_date).toLocaleDateString("en-IN")}</TableCell>
                <TableCell className="text-sm">{c.location}</TableCell>
                <TableCell className="font-mono text-sm">{c.target_count || "—"}</TableCell>
                <TableCell className="font-mono text-sm">{c.actual_count}</TableCell>
                <TableCell><Badge variant={statusColor(c.status)} className="text-xs capitalize">{c.status}</Badge></TableCell>
              </TableRow>
            ))}
            {camps.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No camps planned yet</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Plan Vaccination Camp</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Camp Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. School Immunization Drive" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Date</Label>
                <Input type="date" value={campDate} onChange={(e) => setCampDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm">Target Count</Label>
                <Input type="number" value={targetCount} onChange={(e) => setTargetCount(e.target.value)} placeholder="e.g. 200" />
              </div>
            </div>
            <div>
              <Label className="text-sm">Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Govt Primary School, Block A" />
            </div>
            <div>
              <Label className="text-sm">Target Population</Label>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. School children 5-12 years" />
            </div>
            <div>
              <Label className="text-sm">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save Camp"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CampsTab;
