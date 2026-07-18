import React, { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GatedTabsTrigger, GatedAction } from "@/components/access/GatedTabsTrigger";
import { cn } from "@/lib/utils";
import {
  Video, Phone, Plus, Monitor, Square, ClipboardList,
  User, Clock, Send, CheckCircle2, X
} from "lucide-react";
import ScheduleTeleconsultModal from "@/components/telemedicine/ScheduleTeleconsultModal";

interface RxItem { drug: string; dose: string; frequency: string; days: string; }

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  waiting: "bg-amber-100 text-amber-700",
  in_progress: "bg-emerald-100 text-emerald-700",
  completed: "bg-muted text-muted-foreground",
  missed: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

const TelemedicinePage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [sessions, setSessions] = useState<any[]>([]);
  const [tab, setTab] = useState("waiting");
  const [activeSession, setActiveSession] = useState<any>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [rx, setRx] = useState<RxItem[]>([]);
  const [rxDrug, setRxDrug] = useState("");
  const [rxDose, setRxDose] = useState("");
  const [rxFreq, setRxFreq] = useState("");
  const [rxDays, setRxDays] = useState("");

  const fetchSessions = useCallback(async () => {
    if (!hospitalId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data } = await supabase
      .from("teleconsult_sessions")
      .select("*, patients(full_name, uhid, phone, gender)")
      .eq("hospital_id", hospitalId)
      .gte("scheduled_at", today.toISOString())
      .lt("scheduled_at", tomorrow.toISOString())
      .order("scheduled_at", { ascending: true });
    setSessions(data || []);
  }, [hospitalId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Real-time: refresh queue when any session changes (e.g. patient joins → status = "waiting")
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel("teleconsult-realtime")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "teleconsult_sessions",
        filter: `hospital_id=eq.${hospitalId}`,
      }, () => fetchSessions())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, fetchSessions]);

  // Duration timer
  useEffect(() => {
    if (!activeSession || activeSession.status !== "in_progress") return;
    const iv = setInterval(() => setCallSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [activeSession]);

  const formatTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const joinCall = async (session: any) => {
    await supabase.from("teleconsult_sessions").update({
      status: "in_progress",
      doctor_joined_at: new Date().toISOString(),
    }).eq("id", session.id);
    setActiveSession({ ...session, status: "in_progress" });
    setCallSeconds(0);
    setChiefComplaint("");
    setDiagnosis("");
    setNotes(session.notes || "");
    setRx([]);
    fetchSessions();
  };

  const endCall = async () => {
    if (!activeSession) return;
    const durationMin = Math.ceil(callSeconds / 60);

    // 1. Mark session completed
    await supabase.from("teleconsult_sessions").update({
      status: "completed",
      ended_at: new Date().toISOString(),
      actual_duration: callSeconds,
      notes,
    }).eq("id", activeSession.id);

    // 2. Create OPD encounter + prescription if session is linked to a token
    const opdTokenId = (activeSession as any).opd_token_id;
    if (opdTokenId && hospitalId && activeSession.patient_id) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const { data: doctorRow } = await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", authData?.user?.id || "")
          .maybeSingle();
        const doctorId = doctorRow?.id;

        if (doctorId) {
          const { data: encounter } = await (supabase as any)
            .from("opd_encounters")
            .insert({
              hospital_id: hospitalId,
              token_id: opdTokenId,
              patient_id: activeSession.patient_id,
              doctor_id: doctorId,
              visit_date: new Date().toISOString().split("T")[0],
              chief_complaint: chiefComplaint || undefined,
              diagnosis: diagnosis || undefined,
              soap_plan: notes || undefined,
              visit_mode: "teleconsult",
            })
            .select("id")
            .maybeSingle();

          if (encounter?.id && rx.length > 0) {
            await (supabase as any).from("prescriptions").insert({
              hospital_id: hospitalId,
              encounter_id: encounter.id,
              patient_id: activeSession.patient_id,
              doctor_id: doctorId,
              drugs: rx.map(r => ({ drug: r.drug, dose: r.dose, frequency: r.frequency, days: r.days })),
              advice_notes: notes || undefined,
              is_signed: true,
              signed_at: new Date().toISOString(),
              whatsapp_sent: activeSession.prescription_sent || false,
              source: "teleconsult",
            });
          }
        }
      } catch {
        // encounter/prescription save failure is non-fatal — billing still proceeds
      }
    }

    // 2. Auto-bill teleconsultation
    try {
      if (hospitalId && activeSession.patient_id) {
        // Smart fee lookup: tele-specific → generic consultation → fallback ₹300
        let fee = 300;
        const { data: teleService } = await (supabase as any)
          .from("service_master")
          .select("rate")
          .eq("hospital_id", hospitalId)
          .eq("item_type", "consultation")
          .ilike("name", "%tele%")
          .maybeSingle();

        if (teleService?.rate) {
          fee = teleService.rate;
        } else {
          const { data: genericConsult } = await (supabase as any)
            .from("service_master")
            .select("rate")
            .eq("hospital_id", hospitalId)
            .eq("item_type", "consultation")
            .limit(1)
            .maybeSingle();
          if (genericConsult?.rate) fee = genericConsult.rate;
        }

        const billNumber = await generateBillNumber(hospitalId, "TELE");
        const patientName = activeSession.patients?.full_name || "Patient";

        const { data: bill } = await (supabase as any)
          .from("bills")
          .insert({
            hospital_id: hospitalId,
            patient_id: activeSession.patient_id,
            bill_number: billNumber,
            bill_date: new Date().toISOString().split("T")[0],
            bill_type: "opd",
            bill_status: "final",
            payment_status: "unpaid",
            subtotal: fee,
            gst_amount: 0,
            total_amount: fee,
            patient_payable: fee,
            paid_amount: 0,
            balance_due: fee,
          })
          .select()
          .maybeSingle();

        if (bill) {
          // Guard: never insert a second consultation line if one already exists
          const { data: existingConsult } = await (supabase as any)
            .from("bill_line_items")
            .select("id")
            .eq("bill_id", bill.id)
            .eq("item_type", "consultation")
            .maybeSingle();

          if (!existingConsult) {
            await (supabase as any).from("bill_line_items").insert({
              hospital_id: hospitalId,
              bill_id: bill.id,
              item_type: "consultation",
              description: `Teleconsultation - ${patientName} - ${durationMin}min`,
              quantity: 1,
              unit_rate: fee,
              taxable_amount: fee,
              gst_percent: 0,
              gst_amount: 0,
              total_amount: fee,
              source_module: "telemedicine",
            });
          }

          await recalculateBillTotalsSafe(bill.id);

          // Link bill to session
          await supabase.from("teleconsult_sessions").update({
            bill_generated: true,
            bill_id: bill.id,
          } as any).eq("id", activeSession.id);

          // Post journal entry
          const { data: authData } = await supabase.auth.getUser();
          await autoPostJournalEntry({
            triggerEvent: "bill_created",
            sourceModule: "telemedicine",
            sourceId: bill.id,
            amount: fee,
            description: `Teleconsultation bill ${billNumber}`,
            hospitalId,
            postedBy: authData?.user?.id || "system",
          });

          toast({ title: `Teleconsultation billed: ₹${fee.toLocaleString("en-IN")}` });
        } else {
          toast({ title: "Call ended" });
        }
      } else {
        toast({ title: "Call ended" });
      }
    } catch (err) {
      console.error("Teleconsult billing failed:", err);
      toast({ title: "Call ended (billing skipped)" });
    }

    setActiveSession(null);
    setCallSeconds(0);
    fetchSessions();
  };

  const addRx = () => {
    if (!rxDrug) return;
    setRx([...rx, { drug: rxDrug, dose: rxDose, frequency: rxFreq, days: rxDays }]);
    setRxDrug(""); setRxDose(""); setRxFreq(""); setRxDays("");
  };

  const sendRxWhatsApp = async () => {
    if (!activeSession?.patient_phone || rx.length === 0) return;
    const lines = rx.map((r, i) => `${i + 1}. ${r.drug} ${r.dose} — ${r.frequency} × ${r.days} days`).join("\n");
    const msg = `💊 Prescription\n\n${lines}\n\n— From your teleconsult`;
    const clean = activeSession.patient_phone.replace(/\D/g, "");
    const intl = clean.startsWith("91") ? clean : `91${clean}`;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    supabase.from("teleconsult_sessions").update({ prescription_sent: true }).eq("id", activeSession.id);
    toast({ title: "Prescription sent via WhatsApp" });
  };

  const filtered = sessions.filter(s => {
    if (tab === "waiting") return s.status === "waiting" || s.status === "in_progress";
    if (tab === "scheduled") return s.status === "scheduled";
    return s.status === "completed" || s.status === "missed" || s.status === "cancelled";
  });

  const patient = activeSession?.patients;

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* LEFT — Queue */}
      <div className="w-[300px] shrink-0 bg-background border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Teleconsults</h2>
            <p className="text-xs text-muted-foreground">{format(new Date(), "dd MMM yyyy")}</p>
          </div>
          <GatedAction module="telemedicine" action="schedule_consult">
            <Button size="sm" variant="outline" onClick={() => setShowSchedule(true)} className="gap-1">
              <Plus size={14} /> Schedule
            </Button>
          </GatedAction>
        </div>

        {/* Today's stats strip */}
        <div className="grid grid-cols-3 border-b border-border">
          {[
            { label: "Waiting", value: sessions.filter(s => s.status === "waiting").length, color: "text-amber-600" },
            { label: "Done",    value: sessions.filter(s => s.status === "completed").length, color: "text-emerald-600" },
            { label: "Missed",  value: sessions.filter(s => s.status === "missed").length,    color: "text-red-500" },
          ].map(stat => (
            <div key={stat.label} className="py-2 text-center border-r border-border last:border-r-0">
              <p className={`text-base font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="px-2 pt-2">
          <TabsList className="w-full">
            <GatedTabsTrigger module="telemedicine" value="waiting" className="flex-1 text-xs">Waiting</GatedTabsTrigger>
            <GatedTabsTrigger module="telemedicine" value="scheduled" className="flex-1 text-xs">Scheduled</GatedTabsTrigger>
            <GatedTabsTrigger module="telemedicine" value="completed" className="flex-1 text-xs">Done</GatedTabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No sessions</p>
          )}
          {filtered.map(s => (
            <div
              key={s.id}
              onClick={() => s.status !== "completed" && joinCall(s)}
              className={cn(
                "rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                activeSession?.id === s.id && "border-primary bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium truncate">{s.patients?.full_name || "Patient"}</span>
                <Badge variant="secondary" className={cn("text-[10px]", statusColors[s.status])}>
                  {s.status === "waiting" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 animate-pulse" />}
                  {s.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {format(new Date(s.scheduled_at), "hh:mm a")} · {s.duration_minutes} min
              </p>
              {(s.status === "waiting" || s.status === "scheduled") && (
                <Button size="sm" className="mt-2 w-full gap-1 h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={e => { e.stopPropagation(); joinCall(s); }}>
                  <Video size={12} /> Join Call
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CENTER — Video */}
      <div className="flex-1 bg-[#0F172A] flex flex-col">
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Video size={48} className="text-muted-foreground/40" />
            <p className="text-base text-white/80">No active call</p>
            <p className="text-sm text-muted-foreground">Select a patient from the queue to join</p>
          </div>
        ) : (
          <>
            <iframe
              src={`https://meet.jit.si/HMS-${activeSession.room_id}?userDisplayName=Doctor`}
              allow="camera; microphone; fullscreen; display-capture"
              className="flex-1 w-full border-none"
            />
            <div className="h-12 bg-black/60 flex items-center px-4 gap-4">
              <User size={14} className="text-white/70" />
              <span className="text-sm text-white">{patient?.full_name}</span>
              <Clock size={14} className="text-white/70 ml-auto" />
              <span className="text-sm text-white font-mono font-bold">{formatTimer(callSeconds)}</span>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 gap-1" onClick={() => {}}>
                <ClipboardList size={14} /> Rx
              </Button>
              <Button size="sm" variant="destructive" className="gap-1" onClick={endCall}>
                <Square size={14} /> End Call
              </Button>
            </div>
          </>
        )}
      </div>

      {/* RIGHT — Patient + Rx */}
      <div className="w-[320px] shrink-0 bg-background border-l border-border flex flex-col overflow-y-auto">
        {!activeSession ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Join a call to see patient details</p>
          </div>
        ) : (
          <>
            {/* Patient card */}
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-bold">{patient?.full_name}</h3>
              <p className="text-xs text-muted-foreground">{patient?.uhid} · {patient?.gender}</p>
              {activeSession.patient_phone && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone size={10} /> {activeSession.patient_phone}
                </p>
              )}
            </div>

            {/* SOAP */}
            <div className="p-4 border-b border-border space-y-3">
              <h4 className="text-xs font-bold uppercase text-muted-foreground">SOAP Notes</h4>
              <Input
                placeholder="Chief complaint…"
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                className="text-xs h-8"
              />
              <Input
                placeholder="Diagnosis…"
                value={diagnosis}
                onChange={e => setDiagnosis(e.target.value)}
                className="text-xs h-8"
              />
            </div>

            {/* Quick Rx */}
            <div className="p-4 border-b border-border space-y-3">
              <h4 className="text-xs font-bold uppercase text-muted-foreground">Quick Prescription</h4>
              <div className="grid grid-cols-[1fr_60px_70px_50px_28px] gap-1.5">
                <Input placeholder="Drug" value={rxDrug} onChange={e => setRxDrug(e.target.value)} className="text-xs h-8" />
                <Input placeholder="Dose" value={rxDose} onChange={e => setRxDose(e.target.value)} className="text-xs h-8" />
                <Input placeholder="Freq" value={rxFreq} onChange={e => setRxFreq(e.target.value)} className="text-xs h-8" />
                <Input placeholder="Days" value={rxDays} onChange={e => setRxDays(e.target.value)} className="text-xs h-8" />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={addRx}><Plus size={14} /></Button>
              </div>
              {rx.length > 0 && (
                <div className="space-y-1">
                  {rx.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted rounded px-2 py-1">
                      <span className="flex-1">{r.drug} {r.dose} — {r.frequency} × {r.days}d</span>
                      <button onClick={() => setRx(rx.filter((_, j) => j !== i))}><X size={12} className="text-muted-foreground" /></button>
                    </div>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" className="w-full gap-1 text-emerald-600 border-emerald-300" onClick={sendRxWhatsApp} disabled={rx.length === 0}>
                <Send size={12} /> Send Rx on WhatsApp
              </Button>
            </div>

            {/* Notes */}
            <div className="p-4 border-b border-border space-y-2">
              <h4 className="text-xs font-bold uppercase text-muted-foreground">Consultation Notes</h4>
              <Textarea
                rows={3}
                placeholder="Notes..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => activeSession && supabase.from("teleconsult_sessions").update({ notes }).eq("id", activeSession.id)}
                className="text-xs"
              />
            </div>

            {/* Complete */}
            <div className="p-4">
              <Button className="w-full gap-2" onClick={endCall}>
                <CheckCircle2 size={16} /> Complete & End
              </Button>
            </div>
          </>
        )}
      </div>

      <ScheduleTeleconsultModal open={showSchedule} onOpenChange={setShowSchedule} onCreated={fetchSessions} />
    </div>
  );
};

export default TelemedicinePage;
