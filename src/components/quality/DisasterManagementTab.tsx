import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { activateProtocol, deactivateProtocol } from "@/lib/disaster-mode";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { ShieldAlert, Plus, CheckCircle, AlertTriangle } from "lucide-react";

const DRILL_TYPES = ["fire","mass_casualty","earthquake","chemical","flood","epidemic","code_pink","code_black"];
const DRILL_TYPE_LABELS: Record<string,string> = {
  fire:"Fire","mass_casualty":"Mass Casualty","earthquake":"Earthquake","chemical":"Chemical","flood":"Flood","epidemic":"Epidemic","code_pink":"Code Pink","code_black":"Code Black",
};

interface Protocol {
  id: string; protocol_name: string; is_active: boolean; triage_mode: string;
  ppe_level: string; isolation_beds: number | null; visitor_policy: string | null;
  activated_at: string | null; notes: string | null;
}
interface Drill {
  id: string; drill_date: string; drill_type: string; coordinator: string | null;
  duration_min: number | null; gaps_identified: string | null; actions_taken: string | null;
  status: string; next_drill_date: string | null;
}

const DisasterManagementTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProtocolForm, setShowProtocolForm] = useState(false);
  const [showDrillForm, setShowDrillForm] = useState(false);
  const [showDebrief, setShowDebrief] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pForm, setPForm] = useState({
    protocol_name: "", triage_mode: "standard", ppe_level: "standard",
    isolation_beds: "", visitor_policy: "", notes: "",
  });
  const [dForm, setDForm] = useState({
    drill_type: "fire", drill_date: new Date().toISOString().split("T")[0],
    coordinator: "", participants: "", duration_min: "", gaps_identified: "", actions_taken: "", next_drill_date: "",
  });
  const [debriefForm, setDebriefForm] = useState({ gaps_identified: "", actions_taken: "" });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [pRes, dRes] = await Promise.all([
      (supabase as any).from("epidemic_protocols").select("*").eq("hospital_id", hospitalId).eq("is_deleted", false).order("created_at", { ascending: false }),
      (supabase as any).from("disaster_drills").select("*").eq("hospital_id", hospitalId).eq("is_deleted", false).order("drill_date", { ascending: false }),
    ]);
    setProtocols(pRes.data || []);
    setDrills(dRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const saveProtocol = async () => {
    if (!hospitalId || !pForm.protocol_name) return;
    setSaving(true);
    await (supabase as any).from("epidemic_protocols").insert({
      hospital_id: hospitalId, protocol_name: pForm.protocol_name,
      triage_mode: pForm.triage_mode, ppe_level: pForm.ppe_level,
      isolation_beds: pForm.isolation_beds ? Number(pForm.isolation_beds) : null,
      visitor_policy: pForm.visitor_policy || null, notes: pForm.notes || null,
    });
    toast({ title: "Protocol created ✓" });
    setShowProtocolForm(false);
    setPForm({ protocol_name: "", triage_mode: "standard", ppe_level: "standard", isolation_beds: "", visitor_policy: "", notes: "" });
    load();
    setSaving(false);
  };

  const saveDrill = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    await (supabase as any).from("disaster_drills").insert({
      hospital_id: hospitalId, drill_type: dForm.drill_type, drill_date: dForm.drill_date,
      coordinator: dForm.coordinator || null,
      participants: dForm.participants ? dForm.participants.split(",").map(s => s.trim()) : [],
      duration_min: dForm.duration_min ? Number(dForm.duration_min) : null,
      gaps_identified: dForm.gaps_identified || null, actions_taken: dForm.actions_taken || null,
      next_drill_date: dForm.next_drill_date || null, status: "planned",
      approved_by: userData.user?.id,
    });
    toast({ title: "Drill logged ✓" });
    setShowDrillForm(false);
    setDForm({ drill_type: "fire", drill_date: new Date().toISOString().split("T")[0], coordinator: "", participants: "", duration_min: "", gaps_identified: "", actions_taken: "", next_drill_date: "" });
    load();
    setSaving(false);
  };

  const completeDrill = async (drillId: string) => {
    if (!hospitalId) return;
    setSaving(true);
    await (supabase as any).from("disaster_drills").update({
      status: "completed",
      gaps_identified: debriefForm.gaps_identified || null,
      actions_taken: debriefForm.actions_taken || null,
    }).eq("id", drillId);
    await logNABHEvidence(hospitalId, "COP.4", `Disaster drill completed. Gaps: ${debriefForm.gaps_identified || "none identified"}`);
    toast({ title: "Drill marked complete ✓" });
    setShowDebrief(null);
    setDebriefForm({ gaps_identified: "", actions_taken: "" });
    load();
    setSaving(false);
  };

  const handleActivate = async (protocolId: string) => {
    if (!hospitalId) return;
    const { data: userData } = await supabase.auth.getUser();
    await activateProtocol(hospitalId, protocolId, userData.user?.id || "");
    toast({ title: "Epidemic protocol activated" });
    load();
  };

  const handleDeactivate = async () => {
    if (!hospitalId) return;
    const { data: userData } = await supabase.auth.getUser();
    await deactivateProtocol(hospitalId, userData.user?.id || "");
    toast({ title: "Epidemic protocol deactivated" });
    load();
  };

  const activeProtocol = protocols.find(p => p.is_active);

  const drillStatusColors: Record<string,string> = {
    planned: "bg-blue-100 text-blue-800", completed: "bg-green-100 text-green-800",
    debrief_pending: "bg-amber-100 text-amber-800",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b">
        <ShieldAlert className="h-4 w-4 text-red-500" />
        <span className="text-sm font-semibold">Disaster & Epidemic Management</span>
        <span className="text-xs text-muted-foreground">— NABH COP.4</span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-5">
        {/* Epidemic Protocol Panel */}
        <div className="border rounded-xl p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Epidemic / Emergency Protocols</p>
            <div className="flex gap-2">
              {activeProtocol && (
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleDeactivate}>
                  Deactivate Protocol
                </Button>
              )}
              <Button size="sm" onClick={() => setShowProtocolForm(true)} className="h-7 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Create Protocol
              </Button>
            </div>
          </div>

          {activeProtocol && (
            <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-lg flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-800">ACTIVE: {activeProtocol.protocol_name}</p>
                <p className="text-xs text-red-700">Triage: {activeProtocol.triage_mode} | PPE: {activeProtocol.ppe_level} | Since: {activeProtocol.activated_at ? new Date(activeProtocol.activated_at).toLocaleString() : "—"}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {protocols.filter(p => !p.is_active).map(p => (
              <div key={p.id} className="flex items-center gap-3 p-2 border rounded-lg text-sm">
                <div className="flex-1">
                  <span className="font-medium">{p.protocol_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">Triage: {p.triage_mode} | PPE: {p.ppe_level}</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleActivate(p.id)}>
                  Activate
                </Button>
              </div>
            ))}
            {protocols.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground">No protocols created. Add one to be prepared.</p>
            )}
          </div>
        </div>

        {/* Drill Log */}
        <div className="border rounded-xl p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">Disaster Drill Log</p>
            <Button size="sm" onClick={() => setShowDrillForm(true)} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Log Drill
            </Button>
          </div>
          <div className="space-y-2">
            {drills.map(d => (
              <div key={d.id} className="flex items-center gap-3 p-2 border rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium">{DRILL_TYPE_LABELS[d.drill_type] || d.drill_type} Drill</p>
                  <p className="text-xs text-muted-foreground">
                    {d.drill_date} | {d.coordinator || "—"} | {d.duration_min ? `${d.duration_min} min` : "—"}
                  </p>
                </div>
                <Badge className={cn("text-xs", drillStatusColors[d.status] || "")}>
                  {d.status.replace("_", " ")}
                </Badge>
                {d.status === "planned" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { setShowDebrief(d.id); setDebriefForm({ gaps_identified: d.gaps_identified || "", actions_taken: d.actions_taken || "" }); }}>
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Complete
                  </Button>
                )}
              </div>
            ))}
            {drills.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground">No drills logged yet. NABH requires bi-annual drills.</p>
            )}
          </div>
        </div>
      </div>

      {/* Create Protocol Dialog */}
      <Dialog open={showProtocolForm} onOpenChange={setShowProtocolForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Epidemic Protocol</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium">Protocol Name *</label><Input placeholder="COVID-19 Response, Influenza Outbreak…" value={pForm.protocol_name} onChange={e => setPForm(f => ({ ...f, protocol_name: e.target.value }))} /></div>
            <div>
              <label className="text-xs font-medium">Triage Mode</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" value={pForm.triage_mode} onChange={e => setPForm(f => ({ ...f, triage_mode: e.target.value }))}>
                <option value="standard">Standard</option><option value="mass_casualty">Mass Casualty</option><option value="epidemic">Epidemic</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">PPE Level</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" value={pForm.ppe_level} onChange={e => setPForm(f => ({ ...f, ppe_level: e.target.value }))}>
                <option value="standard">Standard</option><option value="enhanced">Enhanced</option><option value="full">Full</option>
              </select>
            </div>
            <div><label className="text-xs font-medium">Isolation Beds</label><Input type="number" value={pForm.isolation_beds} onChange={e => setPForm(f => ({ ...f, isolation_beds: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Visitor Policy</label><Input placeholder="No visitors / Restricted…" value={pForm.visitor_policy} onChange={e => setPForm(f => ({ ...f, visitor_policy: e.target.value }))} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowProtocolForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveProtocol} disabled={!pForm.protocol_name || saving}>{saving ? "Saving…" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Drill Dialog */}
      <Dialog open={showDrillForm} onOpenChange={setShowDrillForm}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Log Disaster Drill</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Drill Type</label>
              <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background" value={dForm.drill_type} onChange={e => setDForm(f => ({ ...f, drill_type: e.target.value }))}>
                {DRILL_TYPES.map(t => <option key={t} value={t}>{DRILL_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Drill Date</label><Input type="date" value={dForm.drill_date} onChange={e => setDForm(f => ({ ...f, drill_date: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Coordinator</label><Input value={dForm.coordinator} onChange={e => setDForm(f => ({ ...f, coordinator: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Participants (comma-separated)</label><Input placeholder="Dr. Smith, Nurse Mary…" value={dForm.participants} onChange={e => setDForm(f => ({ ...f, participants: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Duration (min)</label><Input type="number" value={dForm.duration_min} onChange={e => setDForm(f => ({ ...f, duration_min: e.target.value }))} /></div>
            <div><label className="text-xs font-medium">Next Drill Date</label><Input type="date" value={dForm.next_drill_date} onChange={e => setDForm(f => ({ ...f, next_drill_date: e.target.value }))} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowDrillForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveDrill} disabled={saving}>{saving ? "Saving…" : "Log Drill"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Debrief Dialog */}
      <Dialog open={!!showDebrief} onOpenChange={() => setShowDebrief(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Drill Debrief & Completion</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Gaps Identified</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={3}
                value={debriefForm.gaps_identified} onChange={e => setDebriefForm(f => ({ ...f, gaps_identified: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium">Actions Taken / Planned</label>
              <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={3}
                value={debriefForm.actions_taken} onChange={e => setDebriefForm(f => ({ ...f, actions_taken: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowDebrief(null)}>Cancel</Button>
              <Button size="sm" onClick={() => showDebrief && completeDrill(showDebrief)} disabled={saving}>
                {saving ? "Saving…" : "Mark Complete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DisasterManagementTab;
