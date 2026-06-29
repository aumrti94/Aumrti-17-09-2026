import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { calcGST, roundCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import { ChevronDown, AlertTriangle, X, Search, Syringe } from "lucide-react";

interface Props { hospitalId: string; onRecorded: () => void; }

interface SelectedVaccine {
  vaccineId: string;
  vaccineName: string;
  vaccineCode: string;
  doseNumber: number;
  site: string;
}

const RecordVaccineTab: React.FC<Props> = ({ hospitalId, onRecorded }) => {
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [vaccines, setVaccines] = useState<any[]>([]);
  const [selectedVaccines, setSelectedVaccines] = useState<SelectedVaccine[]>([]);
  const [vaccineSearch, setVaccineSearch] = useState("");
  const [vaccinePopoverOpen, setVaccinePopoverOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [vvmStatus, setVvmStatus] = useState("ok");
  const [aefiReported, setAefiReported] = useState(false);
  const [aefiDesc, setAefiDesc] = useState("");
  const [aefiSeverity, setAefiSeverity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("vaccine_master").select("*").eq("is_active", true).order("vaccine_name")
      .then(({ data }) => setVaccines(data || []));
  }, []);

  // Auto-determine dose numbers when patient changes
  useEffect(() => {
    if (patientId && selectedVaccines.length > 0) {
      updateDoseNumbers();
    }
  }, [patientId]);

  const updateDoseNumbers = async () => {
    if (!patientId) return;
    const updated = await Promise.all(selectedVaccines.map(async (sv) => {
      const { data } = await supabase.from("vaccination_records").select("dose_number")
        .eq("patient_id", patientId).eq("vaccine_id", sv.vaccineId).eq("hospital_id", hospitalId)
        .order("dose_number", { ascending: false }).limit(1);
      return { ...sv, doseNumber: (data?.[0]?.dose_number || 0) + 1 };
    }));
    setSelectedVaccines(updated);
  };

  const toggleVaccine = async (vaccine: any) => {
    const existing = selectedVaccines.find(sv => sv.vaccineId === vaccine.id);
    if (existing) {
      setSelectedVaccines(prev => prev.filter(sv => sv.vaccineId !== vaccine.id));
    } else {
      let doseNumber = 1;
      if (patientId) {
        const { data } = await supabase.from("vaccination_records").select("dose_number")
          .eq("patient_id", patientId).eq("vaccine_id", vaccine.id).eq("hospital_id", hospitalId)
          .order("dose_number", { ascending: false }).limit(1);
        doseNumber = (data?.[0]?.dose_number || 0) + 1;
      }
      setSelectedVaccines(prev => [...prev, {
        vaccineId: vaccine.id,
        vaccineName: vaccine.vaccine_name,
        vaccineCode: vaccine.vaccine_code,
        doseNumber,
        site: vaccine.site || "",
      }]);
    }
  };

  const removeVaccine = (vaccineId: string) => {
    setSelectedVaccines(prev => prev.filter(sv => sv.vaccineId !== vaccineId));
  };

  const updateVaccineDose = (vaccineId: string, dose: number) => {
    setSelectedVaccines(prev => prev.map(sv => sv.vaccineId === vaccineId ? { ...sv, doseNumber: dose } : sv));
  };

  const updateVaccineSite = (vaccineId: string, site: string) => {
    setSelectedVaccines(prev => prev.map(sv => sv.vaccineId === vaccineId ? { ...sv, site } : sv));
  };

  const filteredVaccines = vaccines.filter(v =>
    !vaccineSearch ||
    v.vaccine_name.toLowerCase().includes(vaccineSearch.toLowerCase()) ||
    v.vaccine_code.toLowerCase().includes(vaccineSearch.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!patientId || selectedVaccines.length === 0) {
      toast.error("Select patient and at least one vaccine");
      return;
    }
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    const { data: userRow } = await supabase.from("users").select("id").eq("auth_user_id", userId).maybeSingle();
    const administeredBy = userRow?.id || patientId;

    let successCount = 0;
    let failCount = 0;

    for (const sv of selectedVaccines) {
      const { error } = await supabase.from("vaccination_records").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        vaccine_id: sv.vaccineId,
        dose_number: sv.doseNumber,
        administered_at: date,
        administered_by: administeredBy,
        batch_number: batchNumber || null,
        expiry_date: expiryDate || null,
        site: sv.site || null,
        vvm_status: vvmStatus,
        aefi_reported: aefiReported,
        aefi_description: aefiReported ? aefiDesc : null,
        aefi_severity: aefiReported && aefiSeverity ? aefiSeverity : null,
      });

      if (error) { failCount++; console.error(`Failed ${sv.vaccineCode}:`, error.message); continue; }
      successCount++;

      // Update vaccination_due
      await supabase.from("vaccination_due")
        .update({ status: "given" })
        .eq("patient_id", patientId).eq("vaccine_id", sv.vaccineId)
        .eq("dose_number", sv.doseNumber).eq("hospital_id", hospitalId);

      // Deduct stock
      const { data: stock } = await supabase.from("vaccine_stock")
        .select("id, quantity_used").eq("vaccine_id", sv.vaccineId).eq("hospital_id", hospitalId)
        .gt("quantity_balance", 0).order("expiry_date").limit(1);
      if (stock && stock.length > 0) {
        await supabase.from("vaccine_stock").update({ quantity_used: stock[0].quantity_used + 1 }).eq("id", stock[0].id);
      }

      // Auto-schedule next dose
      const selectedVaccine = vaccines.find((v) => v.id === sv.vaccineId);
      if (selectedVaccine && selectedVaccine.doses > sv.doseNumber) {
        const nextDoseNum = sv.doseNumber + 1;
        const { data: existing } = await supabase.from("vaccination_due")
          .select("id").eq("patient_id", patientId).eq("vaccine_id", sv.vaccineId)
          .eq("dose_number", nextDoseNum).eq("hospital_id", hospitalId).limit(1);
        if (!existing || existing.length === 0) {
          const nextDue = new Date(date);
          nextDue.setDate(nextDue.getDate() + 28);
          await supabase.from("vaccination_due").insert({
            hospital_id: hospitalId,
            patient_id: patientId,
            vaccine_id: sv.vaccineId,
            dose_number: nextDoseNum,
            due_date: nextDue.toISOString().split("T")[0],
            status: "due",
          });
        }
      }
    }

    // Auto-bill vaccination
    if (successCount > 0) {
      const { data: vaccRate } = await (supabase as any)
        .from("service_master")
        .select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId)
        .ilike("name", "%vaccination%")
        .maybeSingle();

      const fee = vaccRate?.fee ? Number(vaccRate.fee) : 150;
      const gstPct = vaccRate?.gst_applicable ? (Number(vaccRate.gst_percent) || 0) : 0;
      const gst = calcGST(fee, gstPct);
      const totalFee = roundCurrency((fee + gst) * successCount);

      const today = new Date().toISOString().split("T")[0];
      const billNum = await generateBillNumber(hospitalId, "VACC");

      const { data: vaccBill } = await supabase.from("bills").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        bill_number: billNum,
        bill_type: "opd",
        bill_date: today,
        bill_status: "final",
        payment_status: "unpaid",
        total_amount: totalFee,
        balance_due: totalFee,
        subtotal: fee * successCount, gst_amount: gst * successCount,
        taxable_amount: fee * successCount, patient_payable: totalFee,
      }).select("id").maybeSingle();

      if (vaccBill) {
        await autoPostJournalEntry({
          triggerEvent: "bill_finalized_vaccination",
          sourceModule: "vaccination",
          sourceId: vaccBill.id,
          amount: totalFee,
          description: `Vaccination Revenue - Bill ${billNum}`,
          hospitalId,
          postedBy: userId || "",
        });
      }
    }

    if (successCount > 0) toast.success(`${successCount} vaccination${successCount > 1 ? "s" : ""} recorded`);
    if (failCount > 0) toast.error(`${failCount} failed to record`);

    onRecorded();
    setPatientId(""); setPatientName(""); setSelectedVaccines([]); setBatchNumber(""); setExpiryDate("");
    setAefiReported(false); setAefiDesc(""); setAefiSeverity("");
    setSaving(false);
  };

  return (
    <Card className="p-4 max-w-2xl space-y-4">
      <div>
        <Label className="text-sm font-medium mb-1 block">Patient</Label>
        <PatientSearchPicker hospitalId={hospitalId} value={patientId} selectedLabel={patientName}
          onChange={(id) => { setPatientId(id); }} />
      </div>

      {/* Multi-select vaccine picker */}
      <div>
        <Label className="text-sm font-medium mb-1 block">Vaccines</Label>
        <Popover open={vaccinePopoverOpen} onOpenChange={setVaccinePopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-between h-auto min-h-10 py-2">
              <span className="text-muted-foreground text-sm">
                {selectedVaccines.length === 0 ? "Select vaccines..." : `${selectedVaccines.length} vaccine${selectedVaccines.length > 1 ? "s" : ""} selected`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <div className="p-2 border-b">
              <div className="flex items-center gap-2 px-2 py-1 rounded-md border bg-background">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                  placeholder="Search vaccines..."
                  value={vaccineSearch}
                  onChange={(e) => setVaccineSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-60 overflow-auto p-1">
              {filteredVaccines.map((v) => {
                const isSelected = selectedVaccines.some(sv => sv.vaccineId === v.id);
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent text-sm"
                    onClick={() => toggleVaccine(v)}
                  >
                    <Checkbox checked={isSelected} className="pointer-events-none" />
                    <span className="font-mono text-xs text-muted-foreground w-12">{v.vaccine_code}</span>
                    <span className="flex-1 truncate">{v.vaccine_name}</span>
                  </div>
                );
              })}
              {filteredVaccines.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">No vaccines found</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Selected vaccines list */}
      {selectedVaccines.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Selected Vaccines ({selectedVaccines.length})</Label>
          {selectedVaccines.map((sv) => (
            <div key={sv.vaccineId} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
              <Syringe className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sv.vaccineCode} — {sv.vaccineName}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-xs">Dose</Label>
                <Input
                  type="number" min={1} className="w-16 h-7 text-xs"
                  value={sv.doseNumber}
                  onChange={(e) => updateVaccineDose(sv.vaccineId, Number(e.target.value))}
                />
                <Input
                  className="w-28 h-7 text-xs" placeholder="Site"
                  value={sv.site}
                  onChange={(e) => updateVaccineSite(sv.vaccineId, e.target.value)}
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeVaccine(sv.vaccineId)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label className="text-sm">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-sm">Batch Number</Label>
          <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
        </div>
        <div>
          <Label className="text-sm">Expiry Date</Label>
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </div>
      </div>

      <div>
        <Label className="text-sm">VVM Status</Label>
        <Select value={vvmStatus} onValueChange={setVvmStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ok">OK ✅</SelectItem>
            <SelectItem value="stage1">Stage 1</SelectItem>
            <SelectItem value="stage2">Stage 2 ⚠️</SelectItem>
            <SelectItem value="discarded">Discarded ❌</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            <AlertTriangle className="h-4 w-4" /> Adverse Event (AEFI) <ChevronDown className="h-3 w-3" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2 pl-2 border-l-2 border-amber-300">
          <div className="flex items-center gap-2">
            <Switch checked={aefiReported} onCheckedChange={setAefiReported} />
            <Label className="text-sm">AEFI observed</Label>
          </div>
          {aefiReported && (
            <>
              <Textarea placeholder="Describe adverse event" value={aefiDesc} onChange={(e) => setAefiDesc(e.target.value)} />
              <Select value={aefiSeverity} onValueChange={setAefiSeverity}>
                <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mild">Mild</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="severe">Severe</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-amber-600">⚠️ Observe patient for 30 minutes post-vaccination</p>
            </>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Button onClick={handleSubmit} disabled={saving || selectedVaccines.length === 0} className="w-full">
        {saving ? "Recording..." : `Record ${selectedVaccines.length || ""} Vaccination${selectedVaccines.length > 1 ? "s" : ""}`}
      </Button>
    </Card>
  );
};

export default RecordVaccineTab;
