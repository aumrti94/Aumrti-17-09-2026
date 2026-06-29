import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoChargeService, MODULE_MENTAL_HEALTH } from "@/lib/serviceBilling";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, CheckCircle2 } from "lucide-react";

const THERAPY_TYPES = ["CBT", "DBT", "Supportive", "Family", "Group", "EMDR", "Mindfulness-Based", "Psychodynamic"];

interface Props {
  patientId: string;
  hospitalId: string;
}

const MHTherapyTab: React.FC<Props> = ({ patientId, hospitalId }) => {
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<any | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);

  // New plan form
  const [therapyType, setTherapyType] = useState("CBT");
  const [plannedSessions, setPlannedSessions] = useState(10);
  const [goals, setGoals] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);

  // New session form
  const [sessionNotes, setSessionNotes] = useState("");
  const [techniques, setTechniques] = useState("");
  const [patientResponse, setPatientResponse] = useState("");
  const [homework, setHomework] = useState("");
  const [nextGoals, setNextGoals] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchPlans(); }, [patientId]);

  const fetchPlans = async () => {
    const { data } = await (supabase as any)
      .from("therapy_plans")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setPlans(data || []);
    if (data?.[0]) { setSelectedPlan(data[0]); fetchSessions(data[0].id); }
  };

  const fetchSessions = async (planId: string) => {
    const { data } = await (supabase as any)
      .from("therapy_sessions")
      .select("*")
      .eq("plan_id", planId)
      .order("session_date", { ascending: false });
    setSessions(data || []);
  };

  const createPlan = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await (supabase as any).from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();
    const { error } = await (supabase as any).from("therapy_plans").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      therapy_type: therapyType,
      start_date: startDate,
      planned_sessions: plannedSessions,
      goals: goals ? goals.split("\n").filter(Boolean) : [],
      status: "active",
      therapist_id: userData?.id || null,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Therapy plan created");
    setShowNewPlan(false);
    setGoals(""); setTechniques("");
    setSaving(false);
    fetchPlans();
  };

  const addSession = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    const { error } = await (supabase as any).from("therapy_sessions").insert({
      hospital_id: hospitalId,
      plan_id: selectedPlan.id,
      patient_id: patientId,
      session_date: new Date().toISOString().split("T")[0],
      session_notes: sessionNotes,
      techniques_used: techniques ? techniques.split(",").map(t => t.trim()).filter(Boolean) : [],
      patient_response: patientResponse,
      homework_assigned: homework,
      next_session_goals: nextGoals,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }

    // Increment completed sessions
    const { data: newSession } = await (supabase as any)
      .from("therapy_sessions")
      .select("id")
      .eq("plan_id", selectedPlan.id)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await (supabase as any).from("therapy_plans").update({
      completed_sessions: (selectedPlan.completed_sessions || 0) + 1,
    }).eq("id", selectedPlan.id);

    // Auto-bill the therapy session
    if (newSession?.id) {
      autoChargeService({
        hospitalId,
        patientId,
        serviceName:   `Mental Health Therapy Session #${(selectedPlan.completed_sessions || 0) + 1}`,
        serviceModule: MODULE_MENTAL_HEALTH,
        sourceTable:   "therapy_sessions",
        sourceId:      newSession.id,
        serviceDate:   new Date().toISOString().split("T")[0],
      }).catch(() => {});
    }

    toast.success("Session recorded");
    setShowNewSession(false);
    setSessionNotes(""); setTechniques(""); setPatientResponse(""); setHomework(""); setNextGoals("");
    setSaving(false);
    fetchPlans();
    fetchSessions(selectedPlan.id);
  };

  return (
    <div className="flex gap-3 h-full">
      {/* Left: plan list */}
      <div className="w-[200px] flex flex-col gap-2">
        <div className="border rounded-lg bg-card overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
            <p className="text-xs font-semibold">Therapy Plans</p>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowNewPlan(v => !v)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ScrollArea className="max-h-48">
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No plans yet</p>
            ) : plans.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedPlan(p); fetchSessions(p.id); }}
                className={cn("w-full text-left px-3 py-2 border-b hover:bg-muted/50 transition-colors text-xs",
                  selectedPlan?.id === p.id && "bg-muted")}
              >
                <div className="font-semibold">{p.therapy_type}</div>
                <div className="text-[10px] text-muted-foreground">{p.completed_sessions}/{p.planned_sessions} sessions</div>
                <Badge variant="secondary" className={cn("text-[9px] mt-0.5",
                  p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                )}>
                  {p.status}
                </Badge>
              </button>
            ))}
          </ScrollArea>
        </div>
      </div>

      {/* Right: plan detail or new form */}
      <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
        {showNewPlan ? (
          <>
            <div className="px-4 py-3 border-b bg-muted/30">
              <h3 className="text-sm font-semibold">New Therapy Plan</h3>
            </div>
            <ScrollArea className="flex-1 px-4 py-3">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Therapy Type</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {THERAPY_TYPES.map(t => (
                      <button key={t} onClick={() => setTherapyType(t)}
                        className={cn("px-2 py-1 rounded text-xs border transition-colors",
                          therapyType === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Start Date</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">Planned Sessions</Label>
                    <Input type="number" value={plannedSessions} onChange={e => setPlannedSessions(parseInt(e.target.value) || 10)} className="mt-1 h-8 text-xs" min="1" max="100" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Goals (one per line)</Label>
                  <Textarea value={goals} onChange={e => setGoals(e.target.value)} rows={3} className="mt-1 text-xs resize-none" placeholder="Reduce depressive symptoms&#10;Improve sleep hygiene&#10;Develop coping strategies..." />
                </div>
              </div>
            </ScrollArea>
            <div className="px-4 py-3 border-t flex gap-2">
              <Button size="sm" onClick={createPlan} disabled={saving} className="flex-1">Create Plan</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewPlan(false)}>Cancel</Button>
            </div>
          </>
        ) : selectedPlan ? (
          <>
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{selectedPlan.therapy_type} Therapy</h3>
                <p className="text-[11px] text-muted-foreground">{selectedPlan.completed_sessions}/{selectedPlan.planned_sessions} sessions completed · Started {new Date(selectedPlan.start_date).toLocaleDateString("en-IN")}</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewSession(v => !v)}>
                + Add Session
              </Button>
            </div>

            <ScrollArea className="flex-1 px-4 py-3">
              {showNewSession && (
                <div className="border rounded-lg p-3 space-y-3 mb-4 bg-blue-50/40 border-blue-200">
                  <h4 className="text-xs font-semibold">Session #{(selectedPlan.completed_sessions || 0) + 1}</h4>
                  <div>
                    <Label className="text-[10px]">Session Notes</Label>
                    <Textarea value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} rows={3} className="mt-0.5 text-xs resize-none" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Techniques Used (comma separated)</Label>
                    <Input value={techniques} onChange={e => setTechniques(e.target.value)} className="mt-0.5 h-7 text-xs" placeholder="Thought records, Behavioural activation..." />
                  </div>
                  <div>
                    <Label className="text-[10px]">Patient Response</Label>
                    <Textarea value={patientResponse} onChange={e => setPatientResponse(e.target.value)} rows={2} className="mt-0.5 text-xs resize-none" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Homework Assigned</Label>
                    <Input value={homework} onChange={e => setHomework(e.target.value)} className="mt-0.5 h-7 text-xs" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={addSession} disabled={saving} className="flex-1 h-7 text-xs">Save Session</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewSession(false)} className="h-7 text-xs">Cancel</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No sessions recorded yet</p>
                ) : sessions.map((s, i) => (
                  <div key={s.id} className="border rounded-lg p-3 bg-card space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Session #{sessions.length - i}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(s.session_date).toLocaleDateString("en-IN")}</span>
                    </div>
                    {s.session_notes && <p className="text-xs text-muted-foreground">{s.session_notes}</p>}
                    {s.techniques_used?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.techniques_used.map((t: string, j: number) => (
                          <Badge key={j} variant="secondary" className="text-[9px] bg-blue-50 text-blue-700">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {s.homework_assigned && <p className="text-[10px] text-muted-foreground italic">HW: {s.homework_assigned}</p>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">No therapy plan selected</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowNewPlan(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create Plan
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MHTherapyTab;
