/**
 * DayCareRescheduleModal — move a booking to another date/time.
 *
 * No money moves. Rescheduling keeps the same admission row, so any deposit already
 * collected stays with it — which is exactly why "same patient, later date" is a reschedule
 * and not a cancel-and-rebook.
 */

import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatINRExact } from "@/lib/currency";
import { formatDateIST } from "@/lib/dateUtils";
import { rescheduleDayCareBooking } from "@/lib/dayCareCancel";
import { CalendarClock, ArrowRight } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  admissionId: string;
  patientName: string;
  procedureName: string;
  currentScheduledAt: string | null;
  onDone: (newScheduledDate: string) => void;
}

const DayCareRescheduleModal: React.FC<Props> = ({
  open, onClose, hospitalId, admissionId, patientName, procedureName, currentScheduledAt, onDone,
}) => {
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWhen(""); setNote("");
    (supabase as any)
      .from("ipd_advance_balances")
      .select("balance")
      .eq("admission_id", admissionId)
      .maybeSingle()
      .then(({ data }: any) => setBalance(Math.max(0, Number(data?.balance) || 0)));
  }, [open, admissionId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const next = new Date(when);
      await rescheduleDayCareBooking({ hospitalId, admissionId, newScheduledAt: next, note });
      toast({
        title: "Procedure rescheduled",
        description: `${patientName} — now ${formatDateIST(next.toISOString())}`,
      });
      onDone(next.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
      onClose();
    } catch (e: any) {
      toast({ title: "Could not reschedule", description: e?.message || "Unknown error", variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock size={18} className="text-teal-600" />
            Reschedule Procedure
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm">
            <span className="font-medium">{patientName}</span>
            <div className="text-xs text-muted-foreground">{procedureName}</div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border text-sm">
            <span className="text-muted-foreground">
              {currentScheduledAt ? formatDateIST(currentScheduledAt) : "—"}
            </span>
            <ArrowRight size={14} className="text-muted-foreground shrink-0" />
            <span className="font-medium">{when ? formatDateIST(new Date(when).toISOString()) : "new date"}</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">New date &amp; time *</label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} autoFocus />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Note</label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — why it moved…" />
          </div>

          {balance > 0 && (
            <p className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded p-2">
              The {formatINRExact(balance)} deposit stays with this booking — nothing is refunded
              or re-collected.
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={handleSubmit}
              disabled={submitting || !when}
            >
              {submitting ? "Moving…" : "Reschedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DayCareRescheduleModal;
