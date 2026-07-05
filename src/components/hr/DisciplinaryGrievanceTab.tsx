import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Gavel, MessageSquareWarning, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DISC_TYPES = ["verbal_warning", "written_warning", "counselling", "suspension", "termination"];
const SEVERITY = ["minor", "major", "critical"];
const DISC_STATUS = ["open", "under_review", "closed"];
const GRV_CATEGORIES = ["workplace", "harassment", "payroll", "facilities", "other"];
const GRV_STATUS = ["open", "under_review", "resolved", "closed"];

const label = (s: string) => s.replace(/_/g, " ");
const STATUS_COLOR: Record<string, string> = {
  open: "bg-amber-100 text-amber-800", under_review: "bg-blue-100 text-blue-800",
  resolved: "bg-emerald-100 text-emerald-800", closed: "bg-slate-100 text-slate-600",
};
const SEV_COLOR: Record<string, string> = {
  minor: "bg-slate-100 text-slate-700", major: "bg-amber-100 text-amber-800", critical: "bg-red-100 text-red-800",
};

interface Disc { id: string; user_id: string; staff_name?: string; action_type: string; severity: string; incident_date: string | null; description: string; action_taken: string | null; status: string; }
interface Grv { id: string; raised_by: string | null; raiser_name?: string; against_text: string | null; category: string; description: string; status: string; resolution: string | null; }

const DisciplinaryGrievanceTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [view, setView] = useState<"disciplinary" | "grievances">("disciplinary");
  const [disc, setDisc] = useState<Disc[]>([]);
  const [grv, setGrv] = useState<Grv[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [showDisc, setShowDisc] = useState(false);
  const [discForm, setDiscForm] = useState({ user_id: "", action_type: "verbal_warning", severity: "minor", incident_date: "", description: "", action_taken: "" });
  const [showGrv, setShowGrv] = useState(false);
  const [grvForm, setGrvForm] = useState({ raised_by: "", against_text: "", category: "workplace", description: "" });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [discRes, grvRes, staffRes] = await Promise.all([
      (supabase as any).from("disciplinary_actions").select("*, users!disciplinary_actions_user_id_fkey(full_name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("staff_grievances").select("*, users!staff_grievances_raised_by_fkey(full_name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setDisc((discRes.data || []).map((d: any) => ({ ...d, staff_name: d.users?.full_name })));
    setGrv((grvRes.data || []).map((g: any) => ({ ...g, raiser_name: g.users?.full_name })));
    setStaff(staffRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const saveDisc = async () => {
    if (!discForm.user_id || !discForm.description.trim()) { toast({ title: "Staff and description required", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("disciplinary_actions").insert({
      hospital_id: hospitalId, user_id: discForm.user_id, action_type: discForm.action_type, severity: discForm.severity,
      incident_date: discForm.incident_date || null, description: discForm.description.trim(), action_taken: discForm.action_taken || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Disciplinary action recorded" });
    setShowDisc(false);
    setDiscForm({ user_id: "", action_type: "verbal_warning", severity: "minor", incident_date: "", description: "", action_taken: "" });
    load();
  };

  const saveGrv = async () => {
    if (!grvForm.description.trim()) { toast({ title: "Description required", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("staff_grievances").insert({
      hospital_id: hospitalId, raised_by: grvForm.raised_by || null, against_text: grvForm.against_text || null,
      category: grvForm.category, description: grvForm.description.trim(),
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Grievance logged" });
    setShowGrv(false);
    setGrvForm({ raised_by: "", against_text: "", category: "workplace", description: "" });
    load();
  };

  const updateDiscStatus = async (id: string, status: string) => {
    await (supabase as any).from("disciplinary_actions").update({ status }).eq("id", id);
    setDisc((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
  };
  const updateGrvStatus = async (id: string, status: string, resolution?: string) => {
    await (supabase as any).from("staff_grievances").update({ status, ...(resolution !== undefined ? { resolution } : {}) }).eq("id", id);
    setGrv((prev) => prev.map((g) => (g.id === id ? { ...g, status, ...(resolution !== undefined ? { resolution } : {}) } : g)));
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-12 flex-shrink-0 border-b border-border flex items-center gap-3 px-5">
        <div className="flex items-center border border-border rounded-md overflow-hidden h-8">
          <button onClick={() => setView("disciplinary")} className={cn("flex items-center gap-1.5 px-3 h-full text-xs", view === "disciplinary" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}>
            <Gavel className="h-3.5 w-3.5" /> Disciplinary
          </button>
          <button onClick={() => setView("grievances")} className={cn("flex items-center gap-1.5 px-3 h-full text-xs", view === "grievances" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}>
            <MessageSquareWarning className="h-3.5 w-3.5" /> Grievances
          </button>
        </div>
        <Button size="sm" className="ml-auto text-xs gap-1.5" onClick={() => (view === "disciplinary" ? setShowDisc(true) : setShowGrv(true))}>
          <Plus className="h-3 w-3" /> {view === "disciplinary" ? "New Action" : "Log Grievance"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {view === "disciplinary" ? (
          disc.length === 0 ? <div className="text-center py-16 text-muted-foreground text-sm">No disciplinary actions recorded.</div> :
          disc.map((d) => (
            <div key={d.id} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{d.staff_name}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{label(d.action_type)}</Badge>
                <Badge className={cn("text-[10px] capitalize", SEV_COLOR[d.severity])}>{d.severity}</Badge>
                <select value={d.status} onChange={(e) => updateDiscStatus(d.id, e.target.value)}
                  className={cn("ml-auto text-[10px] rounded px-1.5 py-0.5 border-0 capitalize", STATUS_COLOR[d.status])}>
                  {DISC_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{d.description}</p>
              {d.action_taken && <p className="text-[11px] mt-1"><span className="text-muted-foreground">Action:</span> {d.action_taken}</p>}
              {d.incident_date && <p className="text-[10px] text-muted-foreground mt-0.5">Incident: {d.incident_date}</p>}
            </div>
          ))
        ) : (
          grv.length === 0 ? <div className="text-center py-16 text-muted-foreground text-sm">No grievances logged.</div> :
          grv.map((g) => (
            <div key={g.id} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{g.raiser_name || "Anonymous"}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{g.category}</Badge>
                {g.against_text && <span className="text-[10px] text-muted-foreground">re: {g.against_text}</span>}
                <select value={g.status} onChange={(e) => updateGrvStatus(g.id, e.target.value)}
                  className={cn("ml-auto text-[10px] rounded px-1.5 py-0.5 border-0 capitalize", STATUS_COLOR[g.status])}>
                  {GRV_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{g.description}</p>
              <div className="mt-1.5">
                <Textarea className="text-[11px] h-14" placeholder="Resolution notes…" defaultValue={g.resolution || ""}
                  onBlur={(e) => e.target.value !== (g.resolution || "") && updateGrvStatus(g.id, g.status, e.target.value)} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Disciplinary dialog */}
      <Dialog open={showDisc} onOpenChange={setShowDisc}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">New Disciplinary Action</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Staff</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background" value={discForm.user_id} onChange={(e) => setDiscForm((f) => ({ ...f, user_id: e.target.value }))}>
                <option value="">Select staff…</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Action Type</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background capitalize" value={discForm.action_type} onChange={(e) => setDiscForm((f) => ({ ...f, action_type: e.target.value }))}>
                  {DISC_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Severity</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background capitalize" value={discForm.severity} onChange={(e) => setDiscForm((f) => ({ ...f, severity: e.target.value }))}>
                  {SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Incident Date</Label>
              <Input type="date" className="h-8 text-xs mt-1" value={discForm.incident_date} onChange={(e) => setDiscForm((f) => ({ ...f, incident_date: e.target.value }))} />
            </div>
            <Textarea className="text-xs" placeholder="Description of incident" value={discForm.description} onChange={(e) => setDiscForm((f) => ({ ...f, description: e.target.value }))} />
            <Textarea className="text-xs" placeholder="Action taken (optional)" value={discForm.action_taken} onChange={(e) => setDiscForm((f) => ({ ...f, action_taken: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDisc(false)}>Cancel</Button>
            <Button size="sm" onClick={saveDisc}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grievance dialog */}
      <Dialog open={showGrv} onOpenChange={setShowGrv}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Log Grievance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Raised By</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background" value={grvForm.raised_by} onChange={(e) => setGrvForm((f) => ({ ...f, raised_by: e.target.value }))}>
                <option value="">Anonymous</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Category</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background capitalize" value={grvForm.category} onChange={(e) => setGrvForm((f) => ({ ...f, category: e.target.value }))}>
                  {GRV_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Against (optional)</Label>
                <Input className="h-8 text-xs mt-1" value={grvForm.against_text} onChange={(e) => setGrvForm((f) => ({ ...f, against_text: e.target.value }))} placeholder="Person / dept" />
              </div>
            </div>
            <Textarea className="text-xs" placeholder="Describe the grievance" value={grvForm.description} onChange={(e) => setGrvForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowGrv(false)}>Cancel</Button>
            <Button size="sm" onClick={saveGrv}>Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DisciplinaryGrievanceTab;
