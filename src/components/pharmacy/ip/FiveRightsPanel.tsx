import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Check, AlertTriangle } from "lucide-react";
import { validateNDPSDispense } from "@/lib/compliance-checks";

interface DrugInfo {
  drug_name: string;
  generic_name?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  is_ndps?: boolean;
}

interface PatientInfo {
  full_name: string;
  uhid: string;
  address?: string;
}

interface Props {
  drug: DrugInfo;
  patient: PatientInfo;
  hospitalId: string;
  currentUserId?: string;
  onConfirm: (secondPharmacistId?: string) => void;
  onClose: () => void;
}

const FiveRightsPanel: React.FC<Props> = ({ drug, patient, hospitalId, currentUserId, onConfirm, onClose }) => {
  const [rights, setRights] = useState([false, false, false, false, false]);
  const [pharmacists, setPharmacists] = useState<{ id: string; full_name: string }[]>([]);
  const [secondPharmacist, setSecondPharmacist] = useState("");
  const [ndpsError, setNdpsError] = useState<string | null>(null);

  useEffect(() => {
    if (drug.is_ndps) {
      supabase
        .from("users")
        .select("id, full_name")
        .eq("hospital_id", hospitalId)
        .eq("role", "pharmacist")
        .then(({ data }) => setPharmacists(data || []));
    }
  }, [drug.is_ndps, hospitalId]);

  const toggleRight = (i: number) => {
    const next = [...rights];
    next[i] = !next[i];
    setRights(next);
  };

  const allVerified = rights.every(Boolean);
  const canConfirm = allVerified && (!drug.is_ndps || secondPharmacist);

  const handleConfirm = () => {
    if (drug.is_ndps) {
      const result = validateNDPSDispense({
        secondPharmacistId: secondPharmacist || undefined,
        currentUserId: currentUserId || "",
        patientAddress: patient.address,
      });
      if (!result.ok) {
        setNdpsError(`NDPS compliance failed: ${result.reason}. Cannot dispense.`);
        return;
      }
    }
    setNdpsError(null);
    onConfirm(secondPharmacist || undefined);
  };

  const rightCards = [
    { label: "PATIENT", value: patient.full_name, sub: `UHID: ${patient.uhid}`, action: "Confirm patient verbally or by wristband" },
    { label: "DRUG", value: drug.drug_name, sub: drug.generic_name || "", action: "Check label matches prescription" },
    { label: "DOSE", value: drug.dose || "As prescribed", sub: "", action: "Confirm dose on the packaging" },
    { label: "ROUTE", value: drug.route || "Oral", sub: "", action: "Check administration route" },
    { label: "TIME", value: drug.frequency || "As directed", sub: "", action: "Check scheduled time with MAR" },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[280px] bg-card border-t-2 border-primary z-20 flex flex-col">
      <div className="flex items-center justify-between px-5 py-2 border-b border-border/50">
        <span className="text-sm font-bold text-foreground">✅ 5-Rights Verification — {drug.drug_name}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted active:scale-95"><X size={16} /></button>
      </div>

      <div className="flex-1 flex items-stretch gap-2 px-4 py-3 overflow-x-auto">
        {rightCards.map((r, i) => (
          <button
            key={i}
            onClick={() => toggleRight(i)}
            className={cn(
              "flex-1 min-w-[140px] rounded-lg border p-3 text-left transition-all active:scale-[0.97]",
              rights[i]
                ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                : "border-border hover:border-primary/30"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">Right {r.label}</span>
              {rights[i] && <Check size={14} className="text-green-600" />}
            </div>
            <p className="text-sm font-bold text-foreground leading-tight">{r.value}</p>
            {r.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{r.sub}</p>}
            <p className="text-[10px] text-muted-foreground/70 mt-1.5">{r.action}</p>
          </button>
        ))}
      </div>

      {/* NDPS compliance error */}
      {ndpsError && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center gap-2">
          <AlertTriangle size={14} className="text-destructive shrink-0" />
          <span className="text-[11px] text-destructive font-medium">{ndpsError}</span>
        </div>
      )}

      <div className="px-4 pb-3 flex items-center gap-3">
        <div className="flex items-center gap-1">
          {rights.map((r, i) => (
            <div key={i} className={cn("w-2 h-2 rounded-full", r ? "bg-green-500" : "bg-muted")} />
          ))}
          <span className="text-[11px] text-muted-foreground ml-1">{rights.filter(Boolean).length}/5 verified</span>
        </div>

        {drug.is_ndps && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-destructive font-medium">⚠️ NDPS — 2nd Pharmacist:</span>
            <Select value={secondPharmacist} onValueChange={(v) => { setSecondPharmacist(v); setNdpsError(null); }}>
              <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {pharmacists.filter(p => p.id !== currentUserId).map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          className="ml-auto h-9 text-xs"
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          <Check size={14} className="mr-1" />
          All 5 Rights Verified{drug.is_ndps ? " + 2nd Pharmacist" : ""}
        </Button>
      </div>
    </div>
  );
};

export default FiveRightsPanel;
