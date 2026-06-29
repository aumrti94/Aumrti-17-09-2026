import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Send, UserCheck } from "lucide-react";
import { formatINR, roundCurrency } from "@/lib/currency";

interface Props {
  hospitalId: string;
  admissionId: string;
  preAuthId: string;
  preAuthNumber: string | null;
  tpaName: string | null;
  currentApproved: number;
  runningTotal: number;
  serviceName: string;
  serviceAmount: number;
  onMarkPatientPayable: () => void;
  onClose: () => void;
}

const EnhancementRequestModal: React.FC<Props> = ({
  hospitalId,
  admissionId,
  preAuthId,
  preAuthNumber,
  tpaName,
  currentApproved,
  runningTotal,
  serviceName,
  serviceAmount,
  onMarkPatientPayable,
  onClose,
}) => {
  const { toast } = useToast();
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const additionalNeeded = roundCurrency(Math.max(0, runningTotal + serviceAmount - currentApproved));
  const newRequestedTotal = roundCurrency(currentApproved + additionalNeeded);
  const usedPct = Math.round((runningTotal / currentApproved) * 100);

  const handleSubmit = async () => {
    if (!justification.trim()) {
      toast({ title: "Clinical justification is required before submitting to TPA", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await (supabase as any)
      .from("users")
      .select("id")
      .eq("auth_user_id", user?.id)
      .maybeSingle();

    const { error } = await (supabase as any)
      .from("insurance_enhancement_requests")
      .insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        pre_auth_id: preAuthId,
        current_approved_amount: currentApproved,
        new_service_description: serviceName,
        service_amount: serviceAmount,
        additional_amount_requested: additionalNeeded,
        new_requested_total: newRequestedTotal,
        clinical_justification: justification.trim(),
        status: "pending",
        submitted_by: userData?.id ?? null,
      });

    setSubmitting(false);

    if (error) {
      toast({ title: "Failed to submit enhancement request", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Enhancement request submitted",
      description: `Routed to Insurance Executive. ${tpaName || "TPA"} must approve before this service can be added to the insurance claim.`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={18} />
            Pre-Auth Ceiling Exceeded
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ceiling breakdown */}
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">TPA Approved Ceiling</span>
              <span className="font-semibold">{formatINR(currentApproved)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Bill Total</span>
              <span>
                {formatINR(runningTotal)}
                <span className="text-muted-foreground text-xs ml-1">({usedPct}% used)</span>
              </span>
            </div>
            <div className="border-t border-destructive/20 pt-2 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Service Being Added</span>
                <span className="font-medium text-foreground">{serviceName}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Service Amount</span>
                <span>{formatINR(serviceAmount)}</span>
              </div>
            </div>
            <div className="flex justify-between font-bold text-destructive border-t border-destructive/20 pt-2">
              <span>Additional Amount Needed</span>
              <span>{formatINR(additionalNeeded)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Enhancement Total Requested</span>
              <span>{formatINR(newRequestedTotal)}</span>
            </div>
            {preAuthNumber && (
              <p className="text-xs text-muted-foreground">Pre-Auth Ref: {preAuthNumber}</p>
            )}
          </div>

          {/* Clinical justification */}
          <div>
            <Label className="text-sm font-semibold">
              Clinical Justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              className="mt-1 text-sm min-h-[80px]"
              placeholder="Document the clinical necessity — this text is sent to the TPA as the enhancement justification..."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This request will be queued for the Insurance Executive to submit to{" "}
            {tpaName || "the TPA"}. The service is blocked from the insurance claim
            until the enhancement is approved.
          </p>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full gap-2"
            >
              <Send size={14} />
              {submitting ? "Submitting..." : "Submit Enhancement Request"}
            </Button>

            <Button
              variant="outline"
              onClick={onMarkPatientPayable}
              className="w-full gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              <UserCheck size={14} />
              Mark as Patient Payable (Exclude from TPA Claim)
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="w-full text-muted-foreground text-xs"
            >
              Cancel — Do Not Add This Service
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EnhancementRequestModal;
