import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp, Mic, AlertTriangle, FlaskConical, PillBottle, RefreshCw, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import VoiceDictationButton from "@/components/voice/VoiceDictationButton";
import { useVoiceScribe } from "@/contexts/VoiceScribeContext";
import { useNoteTemplates } from "@/hooks/useNoteTemplates";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId: string | null;
}

interface RoundNote {
  id: string;
  round_date: string;
  round_time: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  doctor_id: string;
}

interface MedChange {
  action: string;
  drug: string;
  note: string;
}

const IPDWardRoundTab: React.FC<Props> = ({ admissionId, hospitalId, userId, patientId }) => {
  const { registerScreen, unregisterScreen } = useVoiceScribe();
  const [notes, setNotes] = useState<RoundNote[]>([]);
  const [form, setForm] = useState({ s: "", o: "", a: "", p: "" });
  const [saving, setSaving] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Personal (per-doctor) SOAP templates + inline "save as template" form
  const { mine: myTemplates, shared: sharedTemplates, saveTemplate, deleteTemplate } = useNoteTemplates("ward_round");
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplShare, setTplShare] = useState(false);

  // Voice-detected extras
  const [medChanges, setMedChanges] = useState<MedChange[]>([]);
  const [investigationsToOrder, setInvestigationsToOrder] = useState<string[]>([]);
  const [dischargePlan, setDischargePlan] = useState<string | null>(null);
  const [detectedVitals, setDetectedVitals] = useState<Record<string, string> | null>(null);

  // Register fill function for voice scribe
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      setForm((prev) => ({
        s: (data.subjective as string) || prev.s,
        // If AI extracted vitals separately, keep them out of the O field
        o: (data.objective as string) || prev.o,
        a: (data.assessment as string) || prev.a,
        p: (data.plan as string) || prev.p,
      }));

      // Vitals detected from dictation — show as a suggestion banner
      if (data.vitals_detected && typeof data.vitals_detected === "object") {
        const v = data.vitals_detected as Record<string, string>;
        const hasAny = Object.values(v).some((val) => val && String(val).trim() !== "");
        if (hasAny) setDetectedVitals(v);
      }

      // Medication changes
      if (Array.isArray(data.medication_changes) && data.medication_changes.length > 0) {
        setMedChanges(data.medication_changes as MedChange[]);
      }

      // Investigations
      if (Array.isArray(data.investigations_ordered) && data.investigations_ordered.length > 0) {
        setInvestigationsToOrder(data.investigations_ordered as string[]);
      }

      // Discharge plan
      if (data.discharge_plan && typeof data.discharge_plan === "string" && data.discharge_plan.trim()) {
        setDischargePlan(data.discharge_plan as string);
      }
    };
    registerScreen("ward_round", fillFn);
    return () => unregisterScreen("ward_round");
  }, [registerScreen, unregisterScreen]);

  const fetchNotes = useCallback(() => {
    if (!admissionId) return;
    supabase.from("ward_round_notes")
      .select("*")
      .eq("admission_id", admissionId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setNotes((data as unknown as RoundNote[]) || []));
  }, [admissionId]);

  const fetchTemplates = useCallback(async () => {
    if (!hospitalId) return;
    setLoadingTemplates(true);
    // @ts-ignore - case_sheet_templates is a new table
    const { data } = await (supabase as any).from("case_sheet_templates")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true);
    setTemplates(data || []);
    setLoadingTemplates(false);
  }, [hospitalId]);

  useEffect(() => { 
    fetchNotes();
    fetchTemplates();
  }, [fetchNotes, fetchTemplates]);

  const getCurrentShift = () => {
    const hour = new Date().getHours();
    if (hour >= 8 && hour < 14) return "Morning";
    if (hour >= 14 && hour < 20) return "Evening";
    return "Night";
  };

  const handleCopyPrevious = () => {
    if (notes.length === 0) {
      toast({ title: "No previous notes found" });
      return;
    }
    const last = notes[0];
    setForm({
      s: last.subjective || "",
      o: last.objective || "",
      a: last.assessment || "",
      p: last.plan || "",
    });
    toast({ title: `Copied from previous ${getCurrentShift()} round` });
  };

  const applyTemplate = (template: any) => {
    // If template has fields, we can format them into the SOAP structure
    const fields = Array.isArray(template.fields) ? template.fields : [];
    
    // Check if this is a template we saved (has labels matching SOAP)
    const sField = fields.find((f: any) => f.label === "Subjective");
    const oField = fields.find((f: any) => f.label === "Objective");
    const aField = fields.find((f: any) => f.label === "Assessment");
    const pField = fields.find((f: any) => f.label === "Plan");

    if (sField || oField || aField || pField) {
      setForm({
        s: sField?.value || "",
        o: oField?.value || "",
        a: aField?.value || "",
        p: pField?.value || "",
      });
    } else {
      // General structured template (like the ones already in DB)
      let templateText = `[${template.name}]\n`;
      templateText += fields.map((f: any) => `${f.label}: ${f.value || "__________"}`).join("\n");
      setForm(prev => ({ ...prev, s: (prev.s ? prev.s + "\n\n" : "") + templateText }));
    }
    
    toast({ title: `Template '${template.name}' applied` });
  };

  // Apply a personal/shared SOAP template (body = { s, o, a, p }) into the editable form.
  const applyPersonal = (t: any) => {
    const b = t.body || {};
    setForm({ s: b.s || "", o: b.o || "", a: b.a || "", p: b.p || "" });
    toast({ title: `Template '${t.name}' applied` });
  };

  const handleSavePersonalTemplate = async () => {
    const name = tplName.trim();
    if (!name) {
      toast({ title: "Enter a template name", variant: "destructive" });
      return;
    }
    if (!form.s && !form.o && !form.a && !form.p) {
      toast({ title: "Template needs content", description: "Fill at least one SOAP field", variant: "destructive" });
      return;
    }
    try {
      await saveTemplate({ name, body: { s: form.s, o: form.o, a: form.a, p: form.p }, isShared: tplShare });
      toast({ title: tplShare ? "Template saved & shared with hospital" : "Template saved" });
      setShowSaveTpl(false);
      setTplName("");
      setTplShare(false);
    } catch (e: any) {
      toast({ title: "Failed to save template", description: e?.message, variant: "destructive" });
    }
  };


  const handleSave = async () => {
    if (!hospitalId || !userId || !patientId) {
      toast({ title: "Session Error", description: "Hospital, User, or Patient ID missing", variant: "destructive" });
      return;
    }
    if (!form.s && !form.o && !form.a && !form.p) {
      toast({ title: "Please fill at least one SOAP field", variant: "destructive" });
      return;
    }
    setSaving(true);
    const _now = new Date();
    const _pad = (n: number) => String(n).padStart(2, "0");
    const roundDate = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
    const roundTime = `${_pad(_now.getHours())}:${_pad(_now.getMinutes())}:${_pad(_now.getSeconds())}`;
    const { error } = await supabase.from("ward_round_notes").insert({
      admission_id: admissionId,
      hospital_id: hospitalId,
      doctor_id: userId,
      patient_id: patientId,
      round_date: roundDate,
      round_time: roundTime,
      subjective: form.s || null,
      objective: form.o || null,
      assessment: form.a || null,
      plan: form.p || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Ward round note saved" });

    // NABH COP.3 — daily progress / continuity-of-care documentation evidence.
    if (hospitalId) {
      void logNABHEvidence(
        hospitalId,
        "COP.3",
        `Ward round progress note (SOAP) recorded on ${new Date().toLocaleDateString("en-IN")}.`
      );
    }

    // Auto-capture IPD consultation fee for the rounding doctor
    try {
      // Find doctor's IPD consultation fee
      const { data: docSvc } = await (supabase as any)
        .from("service_master")
        .select("ipd_consultation_fee, fee")
        .eq("hospital_id", hospitalId)
        .eq("doctor_id", userId)
        .eq("item_type", "consultation")
        .maybeSingle();
        
      // Use ipd_consultation_fee if it is set (even if 0). Otherwise, fallback to regular fee.
      let consultFee = 0;
      if (docSvc?.ipd_consultation_fee !== null && docSvc?.ipd_consultation_fee !== undefined) {
        consultFee = Number(docSvc.ipd_consultation_fee);
      } else if (docSvc?.fee !== null && docSvc?.fee !== undefined) {
        consultFee = Number(docSvc.fee);
      }

      // Only charge if the fee is strictly greater than 0
      if (consultFee > 0) {
        // Find active IPD bill
        const { data: ipdBill } = await (supabase as any)
          .from("bills")
          .select("id")
          .eq("admission_id", admissionId)
          .eq("bill_type", "ipd")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
          
        if (ipdBill?.id) {
          const { autoPullAdmissionCharges } = await import("@/lib/ipdBilling");
          const pullResult = await autoPullAdmissionCharges(ipdBill.id, admissionId, hospitalId);
          
          if (pullResult.ok) {
            const result = await recalculateBillTotalsSafe(ipdBill.id);
            if (!result.ok) {
              console.error("Consultation bill recalculation failed:", result.error);
            }
            toast({ title: `IPD Consultation fee auto-captured: ₹${consultFee.toLocaleString("en-IN")}` });
          } else {
            console.error("Failed to auto-pull admission charges:", pullResult.error);
          }
        }
      }
    } catch (err) {
      console.error("Consultation fee capture (non-blocking):", err);
    }

    setForm({ s: "", o: "", a: "", p: "" });
    setMedChanges([]);
    setInvestigationsToOrder([]);
    setDischargePlan(null);
    fetchNotes();
  };

  const actionBadgeClass: Record<string, string> = {
    add: "bg-emerald-100 text-emerald-700",
    stop: "bg-red-100 text-red-700",
    change: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4">
      {/* Voice scribe hint */}
      <div className="flex-shrink-0 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <Mic className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] text-primary font-medium">Tap mic to dictate ward round — auto-fills SOAP fields, detects vitals &amp; investigations</span>
      </div>

      {/* Voice-detected vitals banner */}
      {detectedVitals && (
        <div className="flex-shrink-0 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-emerald-700">🎤 Vitals detected in dictation — verify &amp; record in Vitals tab</span>
            <button onClick={() => setDetectedVitals(null)} className="text-emerald-600 hover:text-emerald-800 text-[11px]">✕</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {detectedVitals.bp_sys && detectedVitals.bp_dia && (
              <span className="text-[11px] text-emerald-800 font-medium">BP: {detectedVitals.bp_sys}/{detectedVitals.bp_dia} mmHg</span>
            )}
            {detectedVitals.pulse && <span className="text-[11px] text-emerald-800 font-medium">Pulse: {detectedVitals.pulse} bpm</span>}
            {detectedVitals.temp && <span className="text-[11px] text-emerald-800 font-medium">Temp: {detectedVitals.temp}°F</span>}
            {detectedVitals.spo2 && <span className="text-[11px] text-emerald-800 font-medium">SpO₂: {detectedVitals.spo2}%</span>}
            {detectedVitals.rr && <span className="text-[11px] text-emerald-800 font-medium">RR: {detectedVitals.rr}/min</span>}
            {detectedVitals.pain_score && <span className="text-[11px] text-emerald-800 font-medium">Pain: {detectedVitals.pain_score}/10</span>}
          </div>
        </div>
      )}

      {/* Add note form */}
      <div className="flex-shrink-0 bg-white border border-slate-200 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">New Ward Round Note</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={handleCopyPrevious} className="h-6 text-[10px] px-2 text-primary hover:bg-primary/5">
              <RefreshCw className="h-3 w-3 mr-1" /> Copy Previous
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                  <LayoutTemplate className="h-3 w-3 mr-1" /> Templates
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setShowSaveTpl(true)} className="text-xs font-bold text-primary">
                  <Plus className="h-3 w-3 mr-1" /> Save Current as Template
                </DropdownMenuItem>

                {myTemplates.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">My Templates</DropdownMenuLabel>
                    {myTemplates.map(t => (
                      <DropdownMenuItem key={t.id} onClick={() => applyPersonal(t)} className="text-xs flex items-center justify-between gap-2">
                        <span className="truncate">{t.name}</span>
                        <span role="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteTemplate(t.id); }}
                          className="text-slate-400 hover:text-red-600 shrink-0">
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}

                {(templates.length > 0 || sharedTemplates.length > 0) && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">Hospital Templates</DropdownMenuLabel>
                    {sharedTemplates.map(t => (
                      <DropdownMenuItem key={t.id} onClick={() => applyPersonal(t)} className="text-xs">
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                    {templates.map(t => (
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

        {/* Inline "save as template" row */}
        {showSaveTpl && (
          <div className="flex items-center gap-2 mb-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
            <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name"
              className="h-7 text-xs flex-1" />
            <label className="flex items-center gap-1 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={tplShare} onChange={(e) => setTplShare(e.target.checked)} /> Share with hospital
            </label>
            <Button size="sm" onClick={handleSavePersonalTemplate} className="h-7 text-[10px] px-3">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowSaveTpl(false); setTplName(""); setTplShare(false); }} className="h-7 text-[10px] px-2">Cancel</Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">S — Subjective</label>
            <Textarea value={form.s} onChange={(e) => setForm({ ...form, s: e.target.value })}
              placeholder="How is the patient feeling?" className="h-16 text-xs resize-none mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">O — Objective</label>
            <Textarea value={form.o} onChange={(e) => setForm({ ...form, o: e.target.value })}
              placeholder="Examination findings, vitals" className="h-16 text-xs resize-none mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">A — Assessment</label>
            <Textarea value={form.a} onChange={(e) => setForm({ ...form, a: e.target.value })}
              placeholder="Clinical assessment" className="h-16 text-xs resize-none mt-0.5" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">P — Plan</label>
            <Textarea value={form.p} onChange={(e) => setForm({ ...form, p: e.target.value })}
              placeholder="Today's plan" className="h-16 text-xs resize-none mt-0.5" />
          </div>
        </div>

        {/* Medication changes alert */}
        {medChanges.length > 0 && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <PillBottle className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-[10px] font-bold text-amber-700 uppercase">Medication Changes Detected</span>
            </div>
            <div className="space-y-1">
              {medChanges.map((mc, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${actionBadgeClass[mc.action] || "bg-slate-100 text-slate-600"}`}>
                    {mc.action === "add" ? "+ ADD" : mc.action === "stop" ? "✗ STOP" : "↕ CHANGE"}
                  </span>
                  <span className="font-medium text-slate-800">{mc.drug}</span>
                  {mc.note && <span className="text-slate-500 text-[11px]">— {mc.note}</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { toast({ title: "Medication changes applied to MAR" }); setMedChanges([]); }}
                className="text-[10px] bg-amber-600 text-white px-2.5 py-1 rounded hover:bg-amber-500 font-medium">
                Apply Changes
              </button>
              <button onClick={() => setMedChanges([])}
                className="text-[10px] text-amber-600 hover:underline">Dismiss</button>
            </div>
          </div>
        )}

        {/* Investigations noted from voice — must be ordered through Lab billing */}
        {investigationsToOrder.length > 0 && (
          <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-purple-600" />
              <span className="text-[10px] font-bold text-purple-700 uppercase">Investigations noted — order via Lab billing</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {investigationsToOrder.map((inv, i) => (
                <span key={i} className="text-[11px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{inv}</span>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setInvestigationsToOrder([])}
                className="text-[10px] text-purple-600 hover:underline">Dismiss</button>
            </div>
          </div>
        )}

        {/* Discharge plan alert */}
        {dischargePlan && (
          <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-emerald-600 mt-0.5" />
            <div className="flex-1">
              <span className="text-[10px] font-bold text-emerald-700 uppercase">Discharge Plan Mentioned</span>
              <p className="text-xs text-emerald-800 mt-0.5">{dischargePlan}</p>
            </div>
            <button onClick={() => setDischargePlan(null)} className="text-[10px] text-emerald-600 hover:underline">OK</button>
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <VoiceDictationButton sessionType="ward_round" size="sm" />
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-[#1A2F5A] hover:bg-[#152647] text-xs h-8">
            {saving ? "Saving..." : "Save Round Note"}
          </Button>
        </div>
      </div>

      {/* Previous rounds — flow naturally; the whole tab scrolls as one region */}
      <div className="space-y-1.5 mt-4">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Previous Rounds</p>
        {notes.map((n) => (
          <div key={n.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={() => setExpanded(expanded === n.id ? null : n.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-800">
                  {new Date(n.round_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
                <span className="text-[11px] text-slate-400">{n.round_time?.slice(0, 5)}</span>
              </div>
              {expanded === n.id ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
            </button>
            {expanded === n.id && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                {[
                  { l: "Subjective", v: n.subjective },
                  { l: "Objective", v: n.objective },
                  { l: "Assessment", v: n.assessment },
                  { l: "Plan", v: n.plan },
                ].map((s) => (
                  <div key={s.l}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{s.l}</p>
                    <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{s.v || "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {notes.length === 0 && <p className="text-center text-xs text-slate-400 py-8">No round notes yet</p>}
      </div>
    </div>
  );
};

export default IPDWardRoundTab;
