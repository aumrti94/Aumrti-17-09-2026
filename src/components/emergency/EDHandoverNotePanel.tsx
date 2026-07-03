import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, ClipboardList } from "lucide-react";

interface NoteRow {
  id: string;
  note: string;
  created_at: string;
  outgoing_nurse_id: string;
  incoming_nurse_id: string | null;
}

interface Nurse { id: string; full_name: string; }

interface Props {
  hospitalId: string;
  userId: string | null;
  edVisitId: string;
  patientId: string;
  patientName: string;
  onClose: () => void;
}

/**
 * ED nursing handover note — nursing module completion plan, Phase 5.
 * Intentionally light (a note + optional named incoming nurse, not full SBAR parity) since ED
 * encounters are short-lived and the existing IPD nursing_handovers machinery takes over once a
 * patient is actually admitted. Kept as its own table rather than reusing nursing_handovers,
 * whose ward_id is required and unavailable pre-admission.
 */
const EDHandoverNotePanel: React.FC<Props> = ({ hospitalId, userId, edVisitId, patientId, patientName, onClose }) => {
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [incomingNurse, setIncomingNurse] = useState("");

  const loadRows = useCallback(async () => {
    const { data } = await (supabase as any).from("ed_handover_notes")
      .select("id, note, created_at, outgoing_nurse_id, incoming_nurse_id")
      .eq("ed_visit_id", edVisitId)
      .order("created_at", { ascending: false });
    setRows((data as NoteRow[]) || []);
    setLoading(false);
  }, [edVisitId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("users").select("id, full_name")
      .eq("hospital_id", hospitalId).eq("is_active", true)
      .in("role", ["nurse", "sr_nurse", "charge_nurse", "nursing_supervisor", "head_nurse"])
      .order("full_name")
      .then(({ data }) => setNurses(data || []));
  }, [hospitalId]);

  const nurseName = useMemo(() => {
    const map = new Map(nurses.map((n) => [n.id, n.full_name]));
    return (id: string | null) => (id ? map.get(id) || "—" : null);
  }, [nurses]);

  const save = async () => {
    if (!note.trim() || !userId) return;
    setSaving(true);
    const { error } = await (supabase as any).from("ed_handover_notes").insert({
      hospital_id: hospitalId,
      ed_visit_id: edVisitId,
      patient_id: patientId,
      outgoing_nurse_id: userId,
      incoming_nurse_id: incomingNurse || null,
      note: note.trim(),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save handover note", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Handover note saved" });
    setNote("");
    setIncomingNurse("");
    await loadRows();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Nursing Handover — {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Handover Note *</label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-[90px]"
                placeholder="Condition, pending investigations/results, what the next nurse needs to watch for…" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Incoming Nurse (optional)</label>
              <Select value={incomingNurse} onValueChange={setIncomingNurse}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="— Select nurse —" /></SelectTrigger>
                <SelectContent>
                  {nurses.map((n) => <SelectItem key={n.id} value={n.id}>{n.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving || !note.trim()} className="h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save Handover Note
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground mb-1.5">Prior notes for this visit</p>
            {loading ? (
              <p className="text-xs text-muted-foreground py-3 text-center">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">No handover notes recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-md border border-border/50 p-2.5 text-xs">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{nurseName(r.outgoing_nurse_id) || "—"}{r.incoming_nurse_id ? ` → ${nurseName(r.incoming_nurse_id)}` : ""}</span>
                      <span>{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-foreground whitespace-pre-wrap">{r.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EDHandoverNotePanel;
