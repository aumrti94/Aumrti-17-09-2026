import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Printer } from "lucide-react";
import { printDocument, printHeader } from "@/lib/printUtils";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId?: string | null;
}

// Simple local-only notes for now (will be backed by a notes table in Phase 5)
const IPDNotesTab: React.FC<Props> = ({ admissionId, hospitalId, userId, patientId }) => {
  const [notes, setNotes] = useState<{ id: string; text: string; time: string; role: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchNotes = React.useCallback(async () => {
    if (!admissionId) return;
    // @ts-ignore - ipd_nursing_notes is a new table not yet in generated types
    const { data, error } = await (supabase as any).from("ipd_nursing_notes")
      .select("*, recorder:users!recorded_by(full_name, role)")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch notes:", error);
      return;
    }

    setNotes(((data as any[]) || []).map(n => ({
      id: n.id,
      text: n.note_text,
      time: new Date(n.recorded_at).toLocaleString("en-IN", { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      role: (n.recorder as any)?.role || "Staff"
    })));
  }, [admissionId]);

  React.useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = async () => {
    if (!draft.trim() || !hospitalId || !userId) return;
    setLoading(true);
    
    // @ts-ignore - ipd_nursing_notes is a new table
    const { error } = await (supabase as any).from("ipd_nursing_notes").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId || null,
      recorded_by: userId,
      note_text: draft,
    });

    setLoading(false);
    if (error) {
      toast({ title: "Error saving note", description: error.message, variant: "destructive" });
      return;
    }

    setDraft("");
    setShowForm(false);
    toast({ title: "Note added" });
    fetchNotes();
  };

  const handlePrint = () => {
    if (notes.length === 0) return;
    const body = `
      ${printHeader("Nursing & Misc Notes", `Admission ID: ${admissionId.slice(0, 8)}`)}
      <table>
        <tr><th>Time</th><th>Role</th><th>Note</th></tr>
        ${notes.map(n => `<tr><td>${n.time}</td><td><span class="badge">${n.role}</span></td><td>${n.text}</td></tr>`).join("")}
      </table>
    `;
    printDocument("NursingNotes", body);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-[13px] font-bold text-slate-900">Nursing & Misc Notes</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handlePrint} className="h-7 w-8 p-0 border-slate-200 text-slate-500 hover:text-[#1A2F5A]">
            <Printer className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)} className="bg-[#1A2F5A] hover:bg-[#152647] text-xs h-7">
            {showForm ? "Cancel" : "+ Add Note"}
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="flex-shrink-0 bg-white border border-slate-200 rounded-lg p-3 mb-3">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your note..." className="h-20 text-xs resize-none" />
          <div className="flex justify-end mt-2">
            <Button size="sm" onClick={addNote} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-xs h-7">
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2">
        {notes.map((n) => (
          <div key={n.id} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-400">{n.time}</span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-px rounded">{n.role}</span>
            </div>
            <p className="text-xs text-slate-700">{n.text}</p>
          </div>
        ))}
        {notes.length === 0 && !showForm && (
          <div className="text-center py-12 text-sm text-slate-400">No notes yet. Click "+ Add Note" to begin.</div>
        )}
      </div>
    </div>
  );
};

export default IPDNotesTab;
