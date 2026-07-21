import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";

const BILL_TYPES = [
  { value: "opd", label: "OPD Visit" },
  { value: "ipd", label: "IPD Discharge" },
  { value: "emergency", label: "Emergency" },
  { value: "daycare", label: "Day Care" },
];

interface Props {
  hospitalId: string;
  onClose: () => void;
  onCreated: (billId: string) => void;
}

const NewBillModal: React.FC<Props> = ({ hospitalId, onClose, onCreated }) => {
  const { toast } = useToast();
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [billType, setBillType] = useState("opd");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2) { setPatients([]); return; }
    const { data } = await supabase
      .from("patients")
      .select("id, full_name, uhid, phone")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setPatients(data || []);
  };

  const handleCreate = async () => {
    if (!selectedPatient) { toast({ title: "Select a patient", variant: "destructive" }); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", user?.id || "")
        .maybeSingle();

      // No bill_number here on purpose. The BEFORE INSERT trigger (20261008000161) mints it
      // inside THIS transaction, so a failed or cancelled save rolls the counter back
      // instead of burning a number. Pre-generating it client-side committed the increment
      // first and left a permanent hole in the series on every failure.
      // It also picks the prefix from bill_type, so an OPD bill lands on the OPD series
      // rather than the generic BILL one this screen used to stamp on everything.
      const { data, error } = await supabase.from("bills").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient.id,
        bill_type: billType,
        bill_status: "draft",
        created_by: userData?.id || null,
      } as any).select("id, bill_number").maybeSingle();

      if (error || !data) {
        const msg = error ? getErrorMessage(error) : "No data returned";
        setFormError(msg);
        toast({ title: "Error creating bill", description: msg, variant: "destructive" });
        return;
      }

      toast({ title: `Bill #${(data as any).bill_number} created` });
      onCreated(data.id);
    } catch (err: any) {
      const msg = getErrorMessage(err);
      setFormError(msg);
      toast({ title: "Error creating bill", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Bill</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Patient search */}
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Patient *</label>
            {selectedPatient ? (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg mt-1">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  {selectedPatient.full_name.charAt(0)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{selectedPatient.full_name}</p>
                  <p className="text-[10px] text-muted-foreground">{selectedPatient.uhid}</p>
                </div>
                <button onClick={() => setSelectedPatient(null)} className="text-muted-foreground text-xs">Change</button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Search name, phone, or UHID..."
                  value={patientSearch}
                  onChange={(e) => searchPatients(e.target.value)}
                  className="h-9 text-sm mt-1"
                  autoFocus
                />
                {patients.length > 0 && (
                  <div className="border border-border rounded-lg bg-card shadow-lg mt-1 max-h-40 overflow-y-auto">
                    {patients.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPatient(p); setPatients([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm border-b border-border last:border-0"
                      >
                        {p.full_name} · <span className="text-muted-foreground">{p.uhid}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bill type */}
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Bill Type</label>
            <div className="flex gap-2 mt-1">
              {BILL_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setBillType(t.value)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                    billType === t.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-muted/50"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <FormError message={formError} />

          <Button onClick={handleCreate} disabled={submitting} className="w-full h-12 text-sm font-bold">
            {submitting ? "Creating..." : "Create Bill →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NewBillModal;
