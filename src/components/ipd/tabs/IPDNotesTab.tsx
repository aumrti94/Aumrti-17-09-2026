import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useVoiceScribe } from "@/hooks/useVoiceScribe";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Printer, RefreshCw, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { printDocument, printHeader } from "@/lib/printUtils";
import { useNoteTemplates } from "@/hooks/useNoteTemplates";

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

  // Personal (per-nurse) note templates + inline "save as template" form
  const { mine: myTemplates, shared: sharedTemplates, saveTemplate, deleteTemplate } = useNoteTemplates("nursing");
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplShare, setTplShare] = useState(false);

  // Voice scribe. The bottom-bar mic is mounted on this tab, so dictation must land here
  // rather than in Rx & Orders. The scribe's shape varies by session type, so take the
  // narrative fields it does return and append them — never overwrite what is being typed.
  const { registerScreen, unregisterScreen } = useVoiceScribe();
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
      const narrative = [
        str(data.note),
        str(data.narrative),
        str(data.subjective),
        str(data.objective),
        str(data.assessment),
        str(data.plan),
        str(data.advice_notes),
      ].filter(Boolean).join("\n");
      if (!narrative) return;
      setShowForm(true);
      setDraft((prev) => (prev.trim() ? `${prev.trimEnd()}\n${narrative}` : narrative));
      toast({ title: "Voice scribe added to the note" });
    };
    registerScreen("ipd_notes", fillFn);
    return () => unregisterScreen("ipd_notes");
  }, [registerScreen, unregisterScreen]);

  // Copy Previous — pre-fill the draft from the most recent note (a fresh, editable note).
  const handleCopyPrevious = () => {
    if (notes.length === 0) {
      toast({ title: "No previous notes found" });
      return;
    }
    setShowForm(true);
    setDraft(notes[0].text || "");
    toast({ title: "Copied from previous note" });
  };

  const applyTemplate = (t: any) => {
    setShowForm(true);
    setDraft(t.body?.text || "");
    toast({ title: `Template '${t.name}' applied` });
  };

  const handleSaveTemplate = async () => {
    const name = tplName.trim();
    if (!name) {
      toast({ title: "Enter a template name", variant: "destructive" });
      return;
    }
    if (!draft.trim()) {
      toast({ title: "Template needs content", description: "Type a note first", variant: "destructive" });
      return;
    }
    try {
      await saveTemplate({ name, body: { text: draft }, isShared: tplShare });
      toast({ title: tplShare ? "Template saved & shared with hospital" : "Template saved" });
      setShowSaveTpl(false);
      setTplName("");
      setTplShare(false);
    } catch (e: any) {
      toast({ title: "Failed to save template", description: e?.message, variant: "destructive" });
    }
  };

  const fetchNotes = React.useCallback(async () => {
    if (!admissionId) return;
    // ipd_nursing_notes is a new table not yet in generated types — hence the `as any`.
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
    
    // ipd_nursing_notes is a new table not yet in generated types — hence the `as any`.
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
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">New Note</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={handleCopyPrevious} className="h-6 text-[10px] px-2 text-[#1A2F5A] hover:bg-[#1A2F5A]/5">
                <RefreshCw className="h-3 w-3 mr-1" /> Copy Previous
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                    <LayoutTemplate className="h-3 w-3 mr-1" /> Templates
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setShowSaveTpl(true)} className="text-xs font-bold text-[#1A2F5A]">
                    <Plus className="h-3 w-3 mr-1" /> Save Current as Template
                  </DropdownMenuItem>
                  {myTemplates.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">My Templates</DropdownMenuLabel>
                      {myTemplates.map(t => (
                        <DropdownMenuItem key={t.id} onClick={() => applyTemplate(t)} className="text-xs flex items-center justify-between gap-2">
                          <span className="truncate">{t.name}</span>
                          <span role="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteTemplate(t.id); }}
                            className="text-slate-400 hover:text-red-600 shrink-0">
                            <Trash2 className="h-3 w-3" />
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  {sharedTemplates.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">Hospital Templates</DropdownMenuLabel>
                      {sharedTemplates.map(t => (
                        <DropdownMenuItem key={t.id} onClick={() => applyTemplate(t)} className="text-xs">
                          {t.name}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {showSaveTpl && (
            <div className="flex items-center gap-2 mb-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name" className="h-7 text-xs flex-1" />
              <label className="flex items-center gap-1 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer">
                <input type="checkbox" checked={tplShare} onChange={(e) => setTplShare(e.target.checked)} /> Share with hospital
              </label>
              <Button size="sm" onClick={handleSaveTemplate} className="h-7 text-[10px] px-3">Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowSaveTpl(false); setTplName(""); setTplShare(false); }} className="h-7 text-[10px] px-2">Cancel</Button>
            </div>
          )}

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
            <p className="text-xs text-slate-700 whitespace-pre-wrap break-words">{n.text}</p>
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
