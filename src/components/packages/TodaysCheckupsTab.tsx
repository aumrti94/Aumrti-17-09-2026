import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, Circle, PlayCircle, Stethoscope, FlaskConical, Activity } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';
import { getCurrentUserRowId } from "@/lib/currentUser";
import { parseComponents, componentsOfType } from "@/lib/packageComponents";
import { resolveComponentNames, stationKeys, readStagedOrders } from "@/lib/packageOrders";

const STATIONS = ["Reception", "Vitals", "Lab", "ECG", "X-Ray", "USG", "Doctor", "Report"];

interface Props { onRefreshKPIs: () => void; }

interface VitalsForm {
  bp_systolic: string; bp_diastolic: string; pulse: string;
  spo2: string; temperature: string; height_cm: string; weight_kg: string;
}

export default function TodaysCheckupsTab({ onRefreshKPIs }: Props) {
  const { hospitalId } = useHospitalId();
  // lab_orders.ordered_by FKs to public.users.id, which is NOT the auth uid. This used to be
  // passed the hospital id, putting a hospital in a user column.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUserRowId().then(setUserId); }, []);
  const [bookings, setBookings] = useState<any[]>([]);
  const [vitalsModal, setVitalsModal] = useState<any | null>(null);
  const [stationModal, setStationModal] = useState<{ booking: any; station: string } | null>(null);
  const [stationNotes, setStationNotes] = useState("");
  const [vitals, setVitals] = useState<VitalsForm>({
    bp_systolic: "", bp_diastolic: "", pulse: "", spo2: "", temperature: "", height_cm: "", weight_kg: "",
  });

  const load = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("package_bookings")
      .select("*, health_packages(package_name, components, total_components), patients(full_name, uhid, dob, gender)")
      .eq("hospital_id", hospitalId)
      .eq("scheduled_date", today)
      .order("created_at");
    setBookings(data || []);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const statusColors: Record<string, string> = {
    booked: "bg-slate-100 text-slate-700",
    checked_in: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    awaiting_report: "bg-purple-100 text-purple-700",
    completed: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-red-100 text-red-700",
  };

  const checkIn = async (id: string) => {
    const { error } = await supabase.from("package_bookings").update({
      status: "checked_in", current_station: "Vitals",
    }).eq("id", id);
    if (error) { toast.error("Failed to check in"); return; }
    toast.success("Patient checked in");
    load(); onRefreshKPIs();
  };

  const handleStationClick = (booking: any) => {
    const station = booking.current_station || "Reception";
    if (station === "Vitals") {
      setVitals({ bp_systolic: "", bp_diastolic: "", pulse: "", spo2: "", temperature: "", height_cm: "", weight_kg: "" });
      setVitalsModal(booking);
    } else if (station === "Lab") {
      createLabOrders(booking);
    } else {
      setStationNotes("");
      setStationModal({ booking, station });
    }
  };

  const bmi = () => {
    const h = parseFloat(vitals.height_cm);
    const w = parseFloat(vitals.weight_kg);
    if (h > 0 && w > 0) return (w / ((h / 100) ** 2)).toFixed(1);
    return "";
  };

  const saveVitals = async () => {
    if (!vitalsModal) return;
    const vitalsData = {
      bp_systolic: vitals.bp_systolic ? +vitals.bp_systolic : null,
      bp_diastolic: vitals.bp_diastolic ? +vitals.bp_diastolic : null,
      pulse: vitals.pulse ? +vitals.pulse : null,
      spo2: vitals.spo2 ? +vitals.spo2 : null,
      temperature: vitals.temperature ? +vitals.temperature : null,
      height_cm: vitals.height_cm ? +vitals.height_cm : null,
      weight_kg: vitals.weight_kg ? +vitals.weight_kg : null,
      bmi: bmi() ? +bmi() : null,
      recorded_at: new Date().toISOString(),
    };
    await advanceStation(vitalsModal, { vitals: vitalsData });
    setVitalsModal(null);
  };

  const createLabOrders = async (booking: any) => {
    // Components are stored as objects ({name, type, source_id, …}). This used to test
    // `typeof c === "string"` and keyword-match the text, so it matched nothing and always
    // reported "No lab components found" — the tests were never ordered from this station.
    const components = parseComponents(booking.health_packages?.components);
    const labComponents = componentsOfType(components, "lab_test");

    if (labComponents.length === 0) {
      toast.info("No lab components in this package — marking station complete");
      await advanceStation(booking, { lab_orders_created: 0 });
      return;
    }

    // Booking already staged these orders. syncLabOrders only dedupes against an encounter or
    // an admission (a package has neither), so calling it again here would create a SECOND set
    // of orders for the same tests. Advance the station instead.
    const alreadyStaged = readStagedOrders(booking.components_done).lab;
    if (alreadyStaged.length > 0) {
      toast.info(`${alreadyStaged.length} lab order(s) already raised for this package`);
      await advanceStation(booking, { lab_orders_created: 0 });
      return;
    }

    let created = 0;
    try {
      // Fallback for bookings made before orders were staged at booking time.
      //
      // syncLabOrders resolves against lab_test_master, creates header + item + sample
      // atomically through the create_lab_order_with_items RPC, and logs NABH evidence. The
      // hand-rolled inserts this replaces bypassed the RPC, skipped billing, and wrote the
      // hospital id into lab_orders.ordered_by (a users column).
      const names = await resolveComponentNames(
        hospitalId, labComponents, "lab_test_master", "test_name");
      const { syncLabOrders } = await import("@/lib/investigationSync");
      const res = await syncLabOrders({
        hospitalId,
        patientId: booking.patient_id,
        orderedBy: userId || "",
        encounterId: null,
        admissionId: null,
        items: names.map((n) => ({
          test_name: n,
          urgency: "routine",
          clinical_indication: `Health Package: ${booking.health_packages?.package_name || ""}`,
        })),
      });
      created = res.created;
      if (res.unmatched.length > 0) {
        toast.warning(`Not in test master (order manually): ${res.unmatched.join(", ")}`);
      }
      toast.success(`${created} lab order(s) created`);
    } catch (e) {
      console.error("Package lab order creation failed:", e);
      toast.error("Could not create lab orders");
      return;
    }

    await advanceStation(booking, { lab_orders_created: created });
  };

  const saveStationNotes = async () => {
    if (!stationModal) return;
    await advanceStation(stationModal.booking, { notes: stationNotes, station: stationModal.station });
    setStationModal(null);
  };

  const advanceStation = async (booking: any, extraData?: Record<string, any>) => {
    const done = booking.components_done || {};
    const currentIdx = STATIONS.indexOf(booking.current_station || "Reception");
    const nextStation = STATIONS[currentIdx + 1] || "Report";
    const newDone = {
      ...done,
      [booking.current_station || "Reception"]: {
        completed_at: new Date().toISOString(),
        ...extraData,
      },
    };
    const isLast = nextStation === "Report" || currentIdx + 1 >= STATIONS.length - 1;

    const { error } = await supabase.from("package_bookings").update({
      components_done: newDone,
      current_station: nextStation,
      status: isLast ? "awaiting_report" : "in_progress",
    }).eq("id", booking.id);
    if (error) { toast.error("Failed to update station"); return; }
    toast.success(`${booking.current_station} complete → ${nextStation}`);
    load(); onRefreshKPIs();
  };

  return (
    <div className="space-y-3">
      {bookings.length === 0 && <p className="text-center text-muted-foreground py-8">No checkups scheduled for today</p>}
      {bookings.map((b) => {
        const done = b.components_done || {};
        // stationKeys drops reserved "__"-prefixed entries (the staged order ids the booking
        // records), so they never count as a completed station.
        const doneCount = stationKeys(done).length;
        const totalStations = STATIONS.length;
        const pct = Math.round((doneCount / totalStations) * 100);
        const patient = b.patients;
        const pkg = b.health_packages;

        return (
          <Card key={b.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                   <p className="font-semibold">{patient?.full_name}</p>
                   <p className="text-xs text-muted-foreground">UHID: {patient?.uhid} • {patient?.gender}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{pkg?.package_name}</Badge>
                  <Badge className={statusColors[b.status] || ""}>{b.status.replace("_", " ")}</Badge>
                </div>
              </div>

              <div className="flex items-center gap-1 mb-3 overflow-x-auto">
                {STATIONS.map((st, i) => {
                  const isDone = !!done[st];
                  const isCurrent = b.current_station === st;
                  return (
                    <div key={st} className="flex items-center">
                      {i > 0 && <div className={`w-4 h-px ${isDone ? "bg-emerald-500" : "bg-border"}`} />}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap ${
                        isDone ? "bg-emerald-50 text-emerald-700" : isCurrent ? "bg-blue-50 text-blue-700 font-medium" : "text-muted-foreground"
                      }`}>
                        {isDone ? <CheckCircle2 className="h-3 w-3" /> : isCurrent ? <PlayCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                        {st}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <Progress value={pct} className="flex-1 h-2" />
                <span className="text-xs font-medium">{pct}%</span>
                {b.status === "booked" && <Button size="sm" onClick={() => checkIn(b.id)}>Check In</Button>}
                {(b.status === "checked_in" || b.status === "in_progress") && (
                  <Button size="sm" variant="outline" onClick={() => handleStationClick(b)}>
                    {b.current_station === "Vitals" && <Activity className="h-4 w-4 mr-1" />}
                    {b.current_station === "Lab" && <FlaskConical className="h-4 w-4 mr-1" />}
                    {b.current_station === "Doctor" && <Stethoscope className="h-4 w-4 mr-1" />}
                    Complete {b.current_station} →
                  </Button>
                )}
              </div>

              {/* Show recorded vitals if available */}
              {done["Vitals"]?.vitals && (
                <div className="mt-2 p-2 bg-muted/50 rounded text-xs grid grid-cols-4 gap-2">
                  {done["Vitals"].vitals.bp_systolic && <span>BP: {done["Vitals"].vitals.bp_systolic}/{done["Vitals"].vitals.bp_diastolic}</span>}
                  {done["Vitals"].vitals.pulse && <span>Pulse: {done["Vitals"].vitals.pulse}</span>}
                  {done["Vitals"].vitals.spo2 && <span>SpO2: {done["Vitals"].vitals.spo2}%</span>}
                  {done["Vitals"].vitals.bmi && <span>BMI: {done["Vitals"].vitals.bmi}</span>}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Vitals Modal */}
      <Dialog open={!!vitalsModal} onOpenChange={() => setVitalsModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Vitals</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>BP Systolic</Label>
              <Input type="number" placeholder="120" value={vitals.bp_systolic} onChange={e => setVitals({...vitals, bp_systolic: e.target.value})} />
            </div>
            <div>
              <Label>BP Diastolic</Label>
              <Input type="number" placeholder="80" value={vitals.bp_diastolic} onChange={e => setVitals({...vitals, bp_diastolic: e.target.value})} />
            </div>
            <div>
              <Label>Pulse (bpm)</Label>
              <Input type="number" placeholder="72" value={vitals.pulse} onChange={e => setVitals({...vitals, pulse: e.target.value})} />
            </div>
            <div>
              <Label>SpO2 (%)</Label>
              <Input type="number" placeholder="98" value={vitals.spo2} onChange={e => setVitals({...vitals, spo2: e.target.value})} />
            </div>
            <div>
              <Label>Temp (°F)</Label>
              <Input type="number" placeholder="98.6" value={vitals.temperature} onChange={e => setVitals({...vitals, temperature: e.target.value})} />
            </div>
            <div>
              <Label>Height (cm)</Label>
              <Input type="number" placeholder="170" value={vitals.height_cm} onChange={e => setVitals({...vitals, height_cm: e.target.value})} />
            </div>
            <div>
              <Label>Weight (kg)</Label>
              <Input type="number" placeholder="70" value={vitals.weight_kg} onChange={e => setVitals({...vitals, weight_kg: e.target.value})} />
            </div>
            <div>
              <Label>BMI (auto)</Label>
              <Input readOnly value={bmi()} className="bg-muted" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setVitalsModal(null)}>Cancel</Button>
            <Button onClick={saveVitals}>Save Vitals & Advance</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generic Station Modal (ECG, X-Ray, USG, Doctor) */}
      <Dialog open={!!stationModal} onOpenChange={() => setStationModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete {stationModal?.station}</DialogTitle></DialogHeader>
          <div>
            <Label>Findings / Notes (optional)</Label>
            <Textarea value={stationNotes} onChange={e => setStationNotes(e.target.value)} placeholder={`Enter ${stationModal?.station} findings...`} rows={4} />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setStationModal(null)}>Cancel</Button>
            <Button onClick={saveStationNotes}>Mark Complete & Advance</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
