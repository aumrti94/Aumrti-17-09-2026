import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Stethoscope, ClipboardList, MessageSquare } from "lucide-react";

interface PatientInfo {
  full_name: string;
  uhid: string;
  gender?: string;
  dob?: string;
  blood_group?: string;
  phone?: string;
  allergies?: string;
  ward_name?: string;
  bed_number?: string;
  admitted_at?: string;
}

interface StockItem {
  drug_name: string;
  available: number;
  nearest_expiry?: string;
}

interface Props {
  patient: PatientInfo | null;
  stockItems: StockItem[];
  todayDispensed: { drug_name: string; quantity: number }[];
  todayTotal: number;
}

const PatientStockPanel: React.FC<Props> = ({ patient, stockItems, todayDispensed, todayTotal }) => {
  if (!patient) {
    return (
      <div className="w-[280px] flex-shrink-0 bg-card border-l border-border flex items-center justify-center">
        <div className="text-center space-y-2">
          <Stethoscope size={36} className="mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Select a prescription</p>
        </div>
      </div>
    );
  }

  const age = patient.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000)
    : null;

  const daysSinceAdmission = patient.admitted_at
    ? Math.floor((Date.now() - new Date(patient.admitted_at).getTime()) / 86400000)
    : null;

  const allergyList = patient.allergies?.split(",").map(a => a.trim()).filter(Boolean) || [];

  return (
    <div className="w-[280px] flex-shrink-0 bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Patient Card */}
      <div className="p-3.5 border-b border-border/50">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
            {patient.full_name.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{patient.full_name}</p>
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{patient.uhid}</Badge>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-0.5 mt-2">
          <p>{age != null ? `${age}y` : ""}{patient.gender ? ` · ${patient.gender}` : ""}
            {patient.blood_group && (
              <span className="ml-1 text-destructive font-medium">{patient.blood_group}</span>
            )}
          </p>
          {patient.ward_name && <p>Ward: {patient.ward_name} · Bed {patient.bed_number}</p>}
          {daysSinceAdmission != null && <p>Admission: Day {daysSinceAdmission + 1}</p>}
        </div>
        {allergyList.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {allergyList.map((a, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">{a}</span>
            ))}
          </div>
        )}
      </div>

      {/* Today's Dispensing */}
      <div className="p-3 border-b border-border/50">
        <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1.5">Today's Dispensing</p>
        {todayDispensed.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No drugs dispensed today</p>
        ) : (
          <>
            {todayDispensed.map((d, i) => (
              <div key={i} className="flex justify-between text-[11px] text-foreground">
                <span className="truncate">{d.drug_name}</span>
                <span className="text-muted-foreground ml-2">×{d.quantity}</span>
              </div>
            ))}
            <p className="text-xs font-bold mt-1">Total: ₹{todayTotal.toFixed(0)}</p>
          </>
        )}
      </div>

      {/* Stock Status */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <p className="text-[11px] font-bold uppercase text-muted-foreground px-3 pt-3 pb-1.5">Stock Status</p>
        <ScrollArea className="flex-1 px-3 pb-2">
          <div className="space-y-2">
            {stockItems.map((s, i) => (
              <div key={i}>
                <p className="text-xs font-semibold text-foreground">{s.drug_name}</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={cn(
                    "font-medium",
                    s.available > 20 ? "text-green-600" : s.available >= 5 ? "text-amber-600" : "text-destructive"
                  )}>
                    {s.available > 0 ? `${s.available} left` : "❌ No stock"}
                  </span>
                  {s.nearest_expiry && (
                    <span className="text-muted-foreground">
                      Exp: {new Date(s.nearest_expiry).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {stockItems.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Select a prescription to view stock</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-t border-border/50 space-y-1.5">
        <Button variant="ghost" size="sm" className="w-full justify-start h-9 text-xs">
          <ClipboardList size={14} className="mr-2" /> View Prescription History
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start h-9 text-xs"
          onClick={() => {
            if (patient.phone) {
              const msg = `Medicines for ${patient.full_name}:\n${stockItems.map(s => `• ${s.drug_name}`).join("\n")}`;
              window.open(`https://wa.me/91${patient.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
            }
          }}
        >
          <MessageSquare size={14} className="mr-2" /> WhatsApp Medication List
        </Button>
      </div>
    </div>
  );
};

export default PatientStockPanel;
