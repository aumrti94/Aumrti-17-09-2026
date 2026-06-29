import { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { calcGST } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, CheckCircle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  showNew: boolean;
  onShowNewDone: () => void;
}

const PROCEDURES = [
  { value: "abhyanga", label: "Abhyanga (Full body oil massage)" },
  { value: "shirodhara", label: "Shirodhara (Oil pouring on forehead)" },
  { value: "basti", label: "Basti (Medicated enema)" },
  { value: "virechana", label: "Virechana (Purgation therapy)" },
  { value: "vamana", label: "Vamana (Emesis therapy)" },
  { value: "nasya", label: "Nasya (Nasal instillation)" },
  { value: "raktamokshana", label: "Raktamokshana (Bloodletting)" },
  { value: "udvartana", label: "Udvartana (Herbal powder massage)" },
  { value: "pinda_sweda", label: "Pinda Sweda (Bolus massage)" },
  { value: "shastika_shali", label: "Shastika Shali (Rice bolus massage)" },
  { value: "netra_tarpana", label: "Netra Tarpana (Eye treatment)" },
  { value: "kati_basti", label: "Kati Basti (Lower back oil pool)" },
  { value: "other", label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  no_show: "bg-yellow-100 text-yellow-700",
};

export default function PanchakarmaTab({ showNew, onShowNewDone }: Props) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Search
  const [patientSearch, setPatientSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Form
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [procedureType, setProcedureType] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split("T")[0]);
  const [sessionTime, setSessionTime] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [oilMedicine, setOilMedicine] = useState("");
  const [oilQty, setOilQty] = useState("");

  // Complete form
  const [feedback, setFeedback] = useState("");
  const [observations, setObservations] = useState("");

  useEffect(() => {
    loadSchedules();
  }, []);

  useEffect(() => {
    if (showNew) { setShowModal(true); onShowNewDone(); }
  }, [showNew]);

  useEffect(() => {
    if (patientSearch.length >= 2) {
      supabase.from("patients").select("id, full_name, uhid, phone")
        .or(`full_name.ilike.%${patientSearch}%,uhid.ilike.%${patientSearch}%`)
        .limit(10)
        .then(({ data }) => { if (data) setSearchResults(data); });
    } else {
      setSearchResults([]);
    }
  }, [patientSearch]);

  const loadSchedules = async () => {
    const { data, error } = await supabase.from("panchakarma_schedules").select("*")
      .gte("scheduled_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0])
      .order("scheduled_date", { ascending: true }).order("session_time", { ascending: true });
    if (data) setSchedules(data);
    if (error) console.error(error);
  };

  const selectPatient = (p: any) => {
    setPatientId(p.id);
    setPatientName(p.full_name);
    setPatientSearch(p.full_name);
    setSearchResults([]);
  };

  const resetForm = () => {
    setPatientId(""); setPatientName(""); setPatientSearch("");
    setProcedureType(""); setScheduledDate(new Date().toISOString().split("T")[0]);
    setSessionTime("09:00"); setDuration("60"); setOilMedicine(""); setOilQty("");
  };

  const scheduleSession = async () => {
    if (!patientId || !procedureType) { toast.error("Select patient and procedure"); return; }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: userRow } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", userData?.user?.id).maybeSingle();
      if (!userRow) throw new Error("User not found");

      const { error } = await supabase.from("panchakarma_schedules").insert({
        hospital_id: userRow.hospital_id,
        patient_id: patientId,
        prescribed_by: userRow.id,
        procedure_type: procedureType,
        scheduled_date: scheduledDate,
        session_time: sessionTime,
        duration_minutes: parseInt(duration),
        oil_medicine: oilMedicine || null,
        oil_quantity_ml: oilQty ? parseFloat(oilQty) : null,
      });
      if (error) throw error;
      toast.success("Panchakarma scheduled");
      setShowModal(false);
      resetForm();
      loadSchedules();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const completeSession = async () => {
    if (!selectedSchedule) return;
    // Idempotency guard
    if ((selectedSchedule as any).billed) {
      toast.success("Session already completed & billed");
      setShowCompleteModal(false);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("panchakarma_schedules").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        patient_feedback: feedback || null,
        observations: observations || null,
        billed: true,
      }).eq("id", selectedSchedule.id);
      if (error) throw error;

      // Auto-bill panchakarma session
      const { data: session } = await (supabase as any)
        .from("panchakarma_schedules")
        .select("*, patient_id")
        .eq("id", selectedSchedule.id)
        .maybeSingle();

      if (session) {
        const { data: userData } = await supabase.auth.getUser();
        const { data: userRow } = await supabase.from("users").select("hospital_id").eq("auth_user_id", userData?.user?.id).maybeSingle();
        const hospitalId = userRow?.hospital_id;
        const dedupeKey = `ayush:session:${selectedSchedule.id}`;

        if (hospitalId) {
          const { data: rate } = await (supabase as any)
            .from("service_master")
            .select("fee, gst_percent, gst_applicable")
            .eq("hospital_id", hospitalId)
            .ilike("name", `%${session.procedure_type?.replace("_", " ") || "panchakarma"}%`)
            .maybeSingle();

          const fee = rate?.fee ? Number(rate.fee) : 800;
          const gstPct = rate?.gst_applicable ? (Number(rate.gst_percent) || 0) : 5;
          const gst = calcGST(fee, gstPct);

          const today = new Date().toISOString().split("T")[0];
          const billNum = await generateBillNumber(hospitalId, "AYSH");

          const { data: newBill } = await supabase.from("bills").insert({
            hospital_id: hospitalId,
            patient_id: session.patient_id,
            bill_number: billNum,
            bill_type: "opd",
            bill_date: today,
            bill_status: "final",
            payment_status: "unpaid",
            total_amount: fee + gst,
            balance_due: fee + gst,
            subtotal: fee, gst_amount: gst,
            taxable_amount: fee, patient_payable: fee + gst,
          }).select("id").maybeSingle();

          if (newBill) {
            // Check dedupe before inserting line item
            const { data: existingItem } = await (supabase as any)
              .from("bill_line_items").select("id")
              .eq("bill_id", newBill.id).eq("source_dedupe_key", dedupeKey).maybeSingle();

            if (!existingItem) {
              await (supabase as any).from("bill_line_items").insert({
                hospital_id: hospitalId, bill_id: newBill.id,
                item_type: "ayush",
                description: `AYUSH Panchakarma: ${session.procedure_type?.replace(/_/g, " ") || "Session"}`,
                quantity: 1, unit_rate: fee,
                taxable_amount: fee, gst_percent: gstPct,
                gst_amount: gst, total_amount: fee + gst,
                source_module: "ayush",
                source_record_id: selectedSchedule.id,
                source_dedupe_key: dedupeKey,
              });
            }

            await autoPostJournalEntry({
              triggerEvent: "bill_finalized_ayush",
              sourceModule: "ayush",
              sourceId: newBill.id,
              amount: fee + gst,
              description: `AYUSH Revenue - Bill ${billNum}`,
              hospitalId,
              postedBy: userData?.user?.id || "",
            });
          }
        }
      }

      toast.success("Session completed & billed");
      setShowCompleteModal(false);
      setFeedback(""); setObservations("");
      loadSchedules();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Today's Schedule */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Panchakarma Schedule</h2>
        <Button size="sm" onClick={() => setShowModal(true)}><Plus className="h-3 w-3 mr-1" /> Schedule</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Date</TableHead>
            <TableHead className="text-xs">Time</TableHead>
            <TableHead className="text-xs">Procedure</TableHead>
            <TableHead className="text-xs">Oil / Medicine</TableHead>
            <TableHead className="text-xs">Duration</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((s) => (
            <TableRow key={s.id} className={s.scheduled_date === today ? "bg-accent/20" : ""}>
              <TableCell className="text-xs">{new Date(s.scheduled_date).toLocaleDateString("en-IN")}</TableCell>
              <TableCell className="text-xs font-mono">{s.session_time?.slice(0, 5) || "–"}</TableCell>
              <TableCell className="text-xs">{PROCEDURES.find((p) => p.value === s.procedure_type)?.label.split("(")[0] || s.procedure_type}</TableCell>
              <TableCell className="text-xs">{s.oil_medicine || "–"} {s.oil_quantity_ml ? `(${s.oil_quantity_ml}ml)` : ""}</TableCell>
              <TableCell className="text-xs">{s.duration_minutes || "–"} min</TableCell>
              <TableCell><Badge variant="outline" className={`text-xs ${STATUS_COLORS[s.status] || ""}`}>{s.status}</Badge></TableCell>
              <TableCell>
                {s.status === "scheduled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSelectedSchedule(s); setShowCompleteModal(true); }}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Complete
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {schedules.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-xs py-8">No schedules found</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {/* Schedule Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Schedule Panchakarma</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient..." />
              </div>
              {searchResults.length > 0 && (
                <div className="border rounded mt-1 max-h-32 overflow-y-auto">
                  {searchResults.map((p) => (
                    <button key={p.id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent border-b last:border-0" onClick={() => selectPatient(p)}>
                      {p.full_name} <span className="text-xs text-muted-foreground">({p.uhid})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Procedure</Label>
              <Select value={procedureType} onValueChange={setProcedureType}>
                <SelectTrigger><SelectValue placeholder="Select procedure" /></SelectTrigger>
                <SelectContent>
                  {PROCEDURES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Time</Label>
                <Input type="time" value={sessionTime} onChange={(e) => setSessionTime(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Duration (min)</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="45">45 min</SelectItem>
                    <SelectItem value="60">60 min</SelectItem>
                    <SelectItem value="90">90 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Oil / Medicine</Label>
                <Input value={oilMedicine} onChange={(e) => setOilMedicine(e.target.value)} placeholder="e.g. Ksheerabala Tailam" />
              </div>
              <div>
                <Label className="text-xs">Quantity (ml)</Label>
                <Input type="number" value={oilQty} onChange={(e) => setOilQty(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" onClick={scheduleSession} disabled={saving}>{saving ? "Scheduling..." : "Schedule"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Complete Modal */}
      <Dialog open={showCompleteModal} onOpenChange={setShowCompleteModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Complete Session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient Feedback</Label>
              <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="How did the patient feel?" />
            </div>
            <div>
              <Label className="text-xs">Observations</Label>
              <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} placeholder="Clinical observations..." />
            </div>
            <Button className="w-full" onClick={completeSession} disabled={saving}>
              <CheckCircle className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Complete & Bill"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
