import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, HeartHandshake, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";

const SUPPORT_TYPES = ["peer_support", "counselling", "leave", "debriefing"];
const SESSION_TYPES = ["peer_support", "counselling", "debriefing", "follow_up"];

const STATUS_FLOW: Record<string, string> = {
  identified: "support_initiated", support_initiated: "counselling_in_progress",
  counselling_in_progress: "returned_to_duty", returned_to_duty: "closed",
};

const STATUS_LABELS: Record<string, string> = {
  identified: "Identified", support_initiated: "Support Initiated",
  counselling_in_progress: "Counselling", returned_to_duty: "Returned to Duty", closed: "Closed",
};

const STATUS_COLORS: Record<string, string> = {
  identified: "bg-amber-100 text-amber-800", support_initiated: "bg-blue-100 text-blue-800",
  counselling_in_progress: "bg-purple-100 text-purple-800", returned_to_duty: "bg-green-100 text-green-800",
  closed: "bg-gray-100 text-gray-600",
};

interface Case {
  id: string; staff_id: string; event_date: string; support_type: string[];
  status: string; sessions_count: number; is_confidential: boolean;
  staff_name?: string;
}
interface StaffOption { id: string; full_name: string; }
interface Session { id: string; session_date: string; session_type: string; counsellor: string | null; duration_min: number | null; }

const SecondVictimTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [cases, setCases] = useState<Case[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showSession, setShowSession] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [form, setForm] = useState({
    staff_id: "", event_date: new Date().toISOString().split("T")[0],
    event_description: "", support_type: [] as string[], support_assigned_to: "",
  });
  const [sessionForm, setSessionForm] = useState({
    session_date: new Date().toISOString().split("T")[0],
    session_type: "counselling", counsellor: "", duration_min: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("second_victim_cases")
      .select("*, users!second_victim_cases_staff_id_fkey(full_name)")
      .eq("hospital_id", hospitalId).eq("is_deleted", false).order("event_date", { ascending: false });
    setCases((data || []).map((c: any) => ({ ...c, staff_name: c.users?.full_name || "—" })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    const loadStaff = async () => {
      if (!hospitalId) return;
      const { data } = await supabase.from("users").select("id, full_name")
        .eq("hospital_id", hospitalId).eq("is_active", true).order("full_name");
      setStaff(data || []);
    };
    load(); loadStaff();
  }, [load, hospitalId]);

  const loadSessions = async (caseId: string) => {
    const { data } = await (supabase as any)
      .from("second_victim_sessions").select("*")
      .eq("hospital_id", hospitalId).eq("case_id", caseId).eq("is_deleted", false)
      .order("session_date");
    setSessions(data || []);
  };

  const toggleExpand = (caseId: string) => {
    if (expandedCase === caseId) { setExpandedCase(null); }
    else { setExpandedCase(caseId); loadSessions(caseId); }
  };

  const toggleSupport = (s: string) => {
    setForm(f => ({
      ...f,
      support_type: f.support_type.includes(s) ? f.support_type.filter(x => x !== s) : [...f.support_type, s],
    }));
  };

  const saveCase = async () => {
    if (!form.staff_id || !form.event_date || !hospitalId) {
      toast({ title: "Staff and event date are required", variant: "destructive" }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("second_victim_cases").insert({
      hospital_id: hospitalId, staff_id: form.staff_id, event_date: form.event_date,
      event_description: form.event_description || null, support_type: form.support_type,
      support_assigned_to: form.support_assigned_to || null,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); }
    else {
      await logNABHEvidence(hospitalId, "HRM.9", `Second victim support case opened for staff member`);
      toast({ title: "Support case opened ✓" });
      setShowForm(false); setForm({ staff_id: "", event_date: new Date().toISOString().split("T")[0], event_description: "", support_type: [], support_assigned_to: "" });
      load();
    }
    setSaving(false);
  };

  const advanceStatus = async (c: Case) => {
    const next = STATUS_FLOW[c.status];
    if (!next) return;
    await (supabase as any).from("second_victim_cases").update({ status: next }).eq("id", c.id);
    load();
  };

  const addSession = async () => {
    if (!expandedCase || !hospitalId) return;
    setSessionSaving(true);
    await (supabase as any).from("second_victim_sessions").insert({
      hospital_id: hospitalId, case_id: expandedCase,
      session_date: sessionForm.session_date, session_type: sessionForm.session_type,
      counsellor: sessionForm.counsellor || null,
      duration_min: sessionForm.duration_min ? Number(sessionForm.duration_min) : null,
      notes: sessionForm.notes || null,
    });
    await (supabase as any).from("second_victim_cases")
      .update({ sessions_count: (cases.find(c => c.id === expandedCase)?.sessions_count || 0) + 1 })
      .eq("id", expandedCase);
    toast({ title: "Session logged ✓" });
    setShowSession(false);
    setSessionForm({ session_date: new Date().toISOString().split("T")[0], session_type: "counselling", counsellor: "", duration_min: "", notes: "" });
    loadSessions(expandedCase); load();
    setSessionSaving(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b">
        <HeartHandshake className="h-4 w-4 text-purple-500" />
        <span className="text-sm font-semibold">Second Victim Support</span>
        <span className="text-xs text-muted-foreground ml-2">— Confidential</span>
        <Button size="sm" className="ml-auto" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Open Support Case
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            {cases.map(c => (
              <div key={c.id} className="border rounded-lg bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{c.staff_name}</p>
                      {c.is_confidential && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Event: {c.event_date} | Support: {c.support_type.join(", ") || "—"} | Sessions: {c.sessions_count}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[c.status] || "")}>{STATUS_LABELS[c.status]}</Badge>
                  {STATUS_FLOW[c.status] && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advanceStatus(c)}>
                      → {STATUS_LABELS[STATUS_FLOW[c.status]]}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleExpand(c.id)}>
                    {expandedCase === c.id ? "Hide" : "Sessions"}
                  </Button>
                </div>

                {expandedCase === c.id && (
                  <div className="border-t bg-muted/20 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground">Support Sessions</p>
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShowSession(true)}>
                        + Add Session
                      </Button>
                    </div>
                    {sessions.map(s => (
                      <div key={s.id} className="text-xs p-2 border rounded mb-1 bg-card">
                        <span className="font-medium">{s.session_date}</span>
                        <span className="ml-2 text-muted-foreground">{s.session_type.replace("_", " ")}</span>
                        {s.counsellor && <span className="ml-2">by {s.counsellor}</span>}
                        {s.duration_min && <span className="ml-2 text-muted-foreground">{s.duration_min} min</span>}
                      </div>
                    ))}
                    {sessions.length === 0 && <p className="text-xs text-muted-foreground">No sessions logged.</p>}
                  </div>
                )}
              </div>
            ))}
            {cases.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <HeartHandshake className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No second victim cases. Support is available when needed.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Case */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Open Support Case <Lock className="inline h-3.5 w-3.5 ml-1 text-muted-foreground" /></DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Staff Member *</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}>
                <option value="">— Select —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Event Date *</label><Input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} /></div>
            <div>
              <label className="text-xs font-medium">Event Description (optional)</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
                placeholder="Brief description of the adverse event (confidential)…"
                value={form.event_description} onChange={e => setForm(f => ({ ...f, event_description: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Support Needed</label>
              <div className="flex flex-wrap gap-2">
                {SUPPORT_TYPES.map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={form.support_type.includes(s)} onChange={() => toggleSupport(s)} />
                    {s.replace("_", " ")}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Support Assigned To</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={form.support_assigned_to} onChange={e => setForm(f => ({ ...f, support_assigned_to: e.target.value }))}>
                <option value="">— HR / Counsellor —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveCase} disabled={saving}>{saving ? "Saving…" : "Open Case"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Session */}
      <Dialog open={showSession} onOpenChange={setShowSession}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log Support Session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium">Session Date</label><Input type="date" value={sessionForm.session_date} onChange={e => setSessionForm(f => ({ ...f, session_date: e.target.value }))} /></div>
            <div>
              <label className="text-xs font-medium">Session Type</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
                value={sessionForm.session_type} onChange={e => setSessionForm(f => ({ ...f, session_type: e.target.value }))}>
                {SESSION_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Counsellor / Peer</label><Input placeholder="Name" value={sessionForm.counsellor} onChange={e => setSessionForm(f => ({ ...f, counsellor: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Duration (min)</label><Input type="number" placeholder="60" value={sessionForm.duration_min} onChange={e => setSessionForm(f => ({ ...f, duration_min: e.target.value }))} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowSession(false)}>Cancel</Button>
              <Button size="sm" onClick={addSession} disabled={sessionSaving}>{sessionSaving ? "Saving…" : "Log Session"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SecondVictimTab;
