import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Pill, Plus } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import SkeletonCard from "@/components/SkeletonCard";

interface PrescriptionItem {
  id: string;
  source: "dispensing" | "prescription";
  patient_name: string;
  uhid: string;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  status: string;
  drug_count: number;
  dispensed_count: number;
  patient_id: string;
  admission_id?: string;
  prescription_id?: string;
  drugs?: any;
  is_urgent?: boolean;
}

interface Props {
  hospitalId: string;
  selectedId: string | null;
  onSelect: (item: PrescriptionItem) => void;
  onManualDispense: () => void;
}

const PrescriptionQueue: React.FC<Props> = ({ hospitalId, selectedId, onSelect, onManualDispense }) => {
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [selectedWard, setSelectedWard] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    setLoading(true);

    // Fetch pending pharmacy_dispensing records for IP
    const { data: dispensings } = await supabase
      .from("pharmacy_dispensing")
      .select(`
        id, status, dispensed_at, patient_id, admission_id, prescription_id,
        patients!inner(full_name, uhid)
      `)
      .eq("hospital_id", hospitalId)
      .eq("dispensing_type", "ip")
      .in("status", ["pending", "partial"]);

    // Fetch signed prescriptions not yet linked to dispensing
    const { data: prescriptions } = await supabase
      .from("prescriptions")
      .select(`
        id, drugs, patient_id, doctor_id, created_at,
        patients!inner(full_name, uhid),
        users!prescriptions_doctor_id_fkey(full_name)
      `)
      .eq("hospital_id", hospitalId)
      .eq("is_signed", true)
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

    // Get existing prescription_ids in dispensing
    const linkedIds = new Set((dispensings || []).map(d => d.prescription_id).filter(Boolean));

    const result: PrescriptionItem[] = [];

    // Process dispensing records
    for (const d of dispensings || []) {
      const patient = d.patients as any;
      // Get admission info
      let ward_name = "";
      let bed_number = "";
      if (d.admission_id) {
        const { data: adm } = await supabase
          .from("admissions")
          .select("ward_id, bed_id, wards(name), beds(bed_number)")
          .eq("id", d.admission_id)
          .maybeSingle();
        if (adm) {
          ward_name = (adm.wards as any)?.name || "";
          bed_number = (adm.beds as any)?.bed_number || "";
        }
      }

      // Get item counts
      const { count: total } = await supabase
        .from("pharmacy_dispensing_items")
        .select("id", { count: "exact", head: true })
        .eq("dispensing_id", d.id);

      const { count: dispensed } = await supabase
        .from("pharmacy_dispensing_items")
        .select("id", { count: "exact", head: true })
        .eq("dispensing_id", d.id)
        .gt("quantity_dispensed", 0);

      result.push({
        id: d.id,
        source: "dispensing",
        patient_name: patient?.full_name || "",
        uhid: patient?.uhid || "",
        ward_name,
        bed_number,
        status: d.status || "pending",
        drug_count: total || 0,
        dispensed_count: dispensed || 0,
        patient_id: d.patient_id,
        admission_id: d.admission_id || undefined,
        prescription_id: d.prescription_id || undefined,
      });
    }

    // Process unlinked prescriptions
    for (const pr of prescriptions || []) {
      if (linkedIds.has(pr.id)) continue;
      const patient = pr.patients as any;
      const doctor = pr.users as any;
      const drugs = Array.isArray(pr.drugs) ? pr.drugs : [];

      result.push({
        id: pr.id,
        source: "prescription",
        patient_name: patient?.full_name || "",
        uhid: patient?.uhid || "",
        doctor_name: doctor?.full_name || "",
        status: "pending",
        drug_count: drugs.length,
        dispensed_count: 0,
        patient_id: pr.patient_id,
        prescription_id: pr.id,
        drugs: pr.drugs,
      });
    }

    setItems(result);
    setLoading(false);
  }, [hospitalId]);

  const fetchWards = useCallback(async () => {
    const { data } = await supabase
      .from("wards")
      .select("id, name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true);
    setWards(data || []);
  }, [hospitalId]);

  useEffect(() => { fetchQueue(); fetchWards(); }, [fetchQueue, fetchWards]);

  const filtered = selectedWard === "all" ? items : items.filter(i => i.ward_name === selectedWard);
  const pendingCount = items.filter(i => i.status === "pending").length;
  const partialCount = items.filter(i => i.status === "partial").length;
  const dispensedToday = 0; // Could query dispensed today

  return (
    <div className="w-[300px] flex-shrink-0 bg-card border-r border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 px-3.5 border-b border-border/50 flex flex-col justify-center">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-foreground">Pending Prescriptions</span>
          <Badge variant="secondary" className="text-[10px] px-2 py-0 h-5">{items.length}</Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedWard("all")}
            className={cn(
              "px-3 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
              selectedWard === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >All Wards</button>
          {wards.map(w => (
            <button
              key={w.id}
              onClick={() => setSelectedWard(w.name)}
              className={cn(
                "px-3 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
                selectedWard === w.name
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >{w.name}</button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="h-7 flex-shrink-0 bg-muted/30 border-b border-border/50 px-3.5 flex items-center gap-3.5 text-[11px]">
        <span>🟡 {pendingCount} Pending</span>
        <span>🔵 {partialCount} Partial</span>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-1.5">
          {loading && <SkeletonCard count={3} />}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon="💊"
              title="No pending prescriptions"
              description="IP prescriptions from admitted patients appear here"
            />
          )}
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className={cn(
                "w-full text-left p-2.5 rounded-lg border transition-all active:scale-[0.97]",
                selectedId === item.id
                  ? "bg-primary/5 border-primary"
                  : "border-border/50 hover:bg-muted/50",
                item.status === "pending" && "border-l-[3px] border-l-accent",
                item.status === "partial" && "border-l-[3px] border-l-blue-500"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-foreground truncate">{item.patient_name}</span>
                <Badge
                  variant={item.status === "partial" ? "default" : "secondary"}
                  className="text-[9px] px-1.5 py-0 h-4"
                >{item.status}</Badge>
              </div>
              {(item.ward_name || item.bed_number) && (
                <div className="mt-1">
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground">
                    {item.ward_name}{item.bed_number ? ` · Bed ${item.bed_number}` : ""}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">
                  {item.doctor_name ? `Dr. ${item.doctor_name}` : ""}
                </span>
                <span className="text-[10px] text-muted-foreground">{item.drug_count} drug(s)</span>
              </div>
              {item.status === "partial" && item.drug_count > 0 && (
                <div className="mt-1.5">
                  <div className="h-[3px] bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${(item.dispensed_count / item.drug_count) * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground mt-0.5">
                    {item.dispensed_count}/{item.drug_count} dispensed
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="h-[52px] flex-shrink-0 border-t border-border/50 p-2">
        <Button
          onClick={onManualDispense}
          className="w-full h-9 text-xs font-bold"
        >
          <Plus size={14} className="mr-1" /> Manual Dispense Request
        </Button>
      </div>
    </div>
  );
};

export type { PrescriptionItem };
export default PrescriptionQueue;
