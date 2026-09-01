import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { createBedTurnoverTask } from "@/lib/bedTurnover";

interface Props {
  open: boolean;
  onClose: () => void;
  admissionId: string;
  hospitalId: string;
  patientId: string;
  currentWardId: string;
  currentBedId: string;
  patientName: string;
  userId: string | null;
  onSuccess: () => void;
}

const BedTransferModal: React.FC<Props> = ({ open, onClose, admissionId, hospitalId, patientId, currentWardId, currentBedId, patientName, userId, onSuccess }) => {
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [beds, setBeds] = useState<{ id: string; bed_number: string }[]>([]);
  const [selectedWard, setSelectedWard] = useState("");
  const [selectedBed, setSelectedBed] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !hospitalId) return;
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true)
      .then(({ data }) => setWards(data || []));
  }, [open, hospitalId]);

  useEffect(() => {
    if (!selectedWard) { setBeds([]); setSelectedBed(""); return; }
    supabase.from("beds").select("id, bed_number")
      .eq("ward_id", selectedWard).eq("status", "available").eq("is_active", true)
      .then(({ data }) => setBeds(data || []));
    setSelectedBed("");
  }, [selectedWard]);

  const handleTransfer = async () => {
    if (!selectedBed || !selectedWard) {
      toast({ title: "Select ward and bed", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // The vacated bed goes to "cleaning", not straight to "available" — same bed_turnover
      // housekeeping task a discharge opens (lib/bedTurnover.ts). It only flips back to
      // "available" once Housekeeping completes that task (TasksTab.tsx), so a transferred-
      // out bed can't be reassigned to the next patient before it's actually been cleaned.
      const turnover = await createBedTurnoverTask({
        hospitalId,
        wardId: currentWardId,
        bedId: currentBedId,
        triggeredBy: "transfer",
        triggerRefId: admissionId,
      });
      if (!turnover.ok) {
        // The bed was released rather than stranded, but nobody has been asked to clean it.
        toast({
          title: "Cleaning task not created",
          description: `Bed ${turnover.bedNumber || ""} was freed without a housekeeping task — arrange cleaning manually. (${turnover.error})`,
          variant: "destructive",
        });
      }
      // Occupy new bed
      await supabase.from("beds").update({ status: "occupied" as any }).eq("id", selectedBed);
      // Update admission
      await supabase.from("admissions").update({ ward_id: selectedWard, bed_id: selectedBed }).eq("id", admissionId);

      // Audit trail — this is what lets billing split room/nursing charges by segment
      // instead of pricing the whole stay at whatever ward the patient ends up in.
      const { error: transferLogError } = await (supabase as any).from("bed_transfers").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        from_ward_id: currentWardId || null,
        from_bed_id: currentBedId || null,
        to_ward_id: selectedWard,
        to_bed_id: selectedBed,
        reason: reason || null,
        transferred_by: userId || null,
      });
      if (transferLogError) {
        // The bed/admission moves already happened — do not roll those back, the patient
        // really did move. A missing audit row means this transfer will bill entirely to
        // the new ward retroactively to admission day on the next pull: a silent revenue
        // defect, not a cosmetic one, so surface it loudly rather than swallowing it.
        console.error("bed_transfers insert failed — billing split will be inaccurate for this transfer:", transferLogError.message);
        toast({ title: "Transfer recorded, but audit log failed", description: transferLogError.message, variant: "destructive" });
      }

      toast({ title: "Transfer complete", description: `${patientName} moved to new bed` });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Patient — {patientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Destination Ward</Label>
            <Select value={selectedWard} onValueChange={setSelectedWard}>
              <SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger>
              <SelectContent>
                {wards.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Available Bed</Label>
            <Select value={selectedBed} onValueChange={setSelectedBed} disabled={!selectedWard}>
              <SelectTrigger><SelectValue placeholder={selectedWard ? "Select bed" : "Select ward first"} /></SelectTrigger>
              <SelectContent>
                {beds.length === 0 && <SelectItem value="none" disabled>No available beds</SelectItem>}
                {beds.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.bed_number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason for Transfer</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Upgrade to ICU, step-down to general ward..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={saving || !selectedBed}>
            {saving ? "Transferring…" : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BedTransferModal;
