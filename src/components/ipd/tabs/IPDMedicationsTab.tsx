import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Copy, Pencil, Trash2, CheckCircle2, XCircle, RotateCcw,
  ChevronDown, ChevronRight, Loader2, AlertTriangle,
} from "lucide-react";
import { checkDrugSafety, type DrugSafetyResult } from "@/lib/drugSafetyCheck";
import DrugSafetyAlertModal from "@/components/opd/DrugSafetyAlertModal";
import { isAntibioticByName } from "@/lib/high-alert-meds";
import AntibioticJustificationModal from "@/components/quality/AntibioticJustificationModal";
import { differenceInDays } from "date-fns";
import { useConfigValues } from "@/hooks/useConfigValues";

interface Props {
  admissionId: string;
  patientId?: string;
  hospitalId: string | null;
  userId: string | null;
  patientAllergies?: string[];
}

interface Med {
  id: string;
  drug_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  instructions: string | null;
  created_at: string;
}

interface CopyCandidate {
  drug_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  source: string;
  selected: boolean;
}

const today = () => new Date().toISOString().split("T")[0];

const IPDMedicationsTab: React.FC<Props> = ({
  admissionId, patientId, hospitalId, userId, patientAllergies = [],
}) => {
  const routeOptions     = useConfigValues("drug_routes");
  const frequencyOptions = useConfigValues("drug_frequencies");

  const [meds, setMeds]             = useState<Med[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showStopped, setShowStopped] = useState(false);

  // ── Add form ──
  const [showAdd, setShowAdd]       = useState(false);
  const [drugSearch, setDrugSearch] = useState("");
  const [drugResults, setDrugResults] = useState<any[]>([]);
  const [form, setForm] = useState({
    drug_name: "", dose: "", route: "Oral", frequency: "BD",
    start_date: today(), end_date: "", instructions: "",
  });
  const [saving, setSaving]         = useState(false);
  const [checking, setChecking]     = useState(false);

  // ── Drug safety ──
  const [safetyResult, setSafetyResult] = useState<DrugSafetyResult | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showAntibioticModal, setShowAntibioticModal] = useState(false);
  const [antibioticJustified, setAntibioticJustified] = useState(false);

  // ── Inline edit ──
  const [editId, setEditId]   = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Med>>({});

  // ── Copy from previous modal ──
  const [showCopy, setShowCopy]       = useState(false);
  const [copyList, setCopyList]       = useState<CopyCandidate[]>([]);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copying, setCopying]         = useState(false);

  // ── Fetch meds ──
  const fetchMeds = useCallback(() => {
    if (!admissionId) return;
    setLoading(true);
    supabase.from("ipd_medications")
      .select("*")
      .eq("admission_id", admissionId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMeds((data as unknown as Med[]) || []);
        setLoading(false);
      });
  }, [admissionId]);

  useEffect(() => { fetchMeds(); }, [fetchMeds]);

  // Drug search autocomplete
  useEffect(() => {
    if (drugSearch.length < 2 || !hospitalId) { setDrugResults([]); return; }
    const t = setTimeout(() => {
      supabase.from("drug_master")
        .select("drug_name, generic_name")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", `%${drugSearch}%`)
        .limit(8)
        .then(({ data }) => setDrugResults(data || []));
    }, 200);
    return () => clearTimeout(t);
  }, [drugSearch, hospitalId]);

  // ── Insert new med ──
  const insertMed = async () => {
    if (!form.drug_name || !hospitalId || !userId) return;
    setSaving(true);
    const payload: Record<string, any> = {
      admission_id: admissionId,
      hospital_id:  hospitalId,
      ordered_by:   userId,
      drug_name:    form.drug_name,
      dose:         form.dose || null,
      route:        form.route,
      frequency:    form.frequency,
      start_date:   form.start_date || today(),
      end_date:     form.end_date   || null,
      instructions: form.instructions || null,
      is_active:    true,
    };
    let { error } = await supabase.from("ipd_medications").insert(payload);
    // Graceful fallback: if instructions column not yet migrated, retry without it
    if (error?.message?.includes("instructions")) {
      const { instructions: _i, ...fallback } = payload;
      ({ error } = await supabase.from("ipd_medications").insert(fallback));
    }
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${form.drug_name} added` });
    setForm({ drug_name: "", dose: "", route: "Oral", frequency: "BD", start_date: today(), end_date: "", instructions: "" });
    setDrugSearch("");
    setAntibioticJustified(false);
    setShowAdd(false);
    fetchMeds();
  };

  const handleAdd = async () => {
    if (!form.drug_name) return;
    if (isAntibioticByName(form.drug_name) && !antibioticJustified) {
      setShowAntibioticModal(true);
      return;
    }
    setChecking(true);
    const activeDrugNames = meds.filter(m => m.is_active).map(m => m.drug_name);
    try {
      const result = await checkDrugSafety(form.drug_name, activeDrugNames, patientAllergies);
      if (result.hasIssues) {
        setSafetyResult(result);
        setShowSafetyModal(true);
      } else {
        await insertMed();
      }
    } catch {
      await insertMed();
    } finally {
      setChecking(false);
    }
  };

  // ── Stop med ──
  const stopMed = async (id: string) => {
    await supabase.from("ipd_medications")
      .update({ is_active: false, end_date: today() })
      .eq("id", id);
    toast({ title: "Medication stopped" });
    fetchMeds();
  };

  // ── Re-activate stopped med ──
  const reactivateMed = async (id: string) => {
    await supabase.from("ipd_medications")
      .update({ is_active: true, end_date: null, start_date: today() })
      .eq("id", id);
    toast({ title: "Medication reactivated" });
    fetchMeds();
  };

  // ── Delete med permanently ──
  const deleteMed = async (id: string) => {
    await supabase.from("ipd_medications").delete().eq("id", id);
    toast({ title: "Medication deleted" });
    fetchMeds();
  };

  // ── Inline edit save ──
  const saveEdit = async () => {
    if (!editId) return;
    const updatePayload: Record<string, any> = {
      dose:         editForm.dose        || null,
      route:        editForm.route       || null,
      frequency:    editForm.frequency   || null,
      end_date:     editForm.end_date    || null,
      instructions: editForm.instructions || null,
    };
    let { error } = await supabase.from("ipd_medications").update(updatePayload).eq("id", editId);
    if (error?.message?.includes("instructions")) {
      const { instructions: _i, ...fallback } = updatePayload;
      ({ error } = await supabase.from("ipd_medications").update(fallback).eq("id", editId));
    }
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Medication updated" });
    setEditId(null);
    fetchMeds();
  };

  // ── Load copy candidates ──
  const loadCopyCandidates = async () => {
    setCopyLoading(true);
    setShowCopy(true);
    const candidates: CopyCandidate[] = [];

    // 1. Stopped meds from this admission
    const { data: stopped } = await supabase.from("ipd_medications")
      .select("drug_name, dose, route, frequency")
      .eq("admission_id", admissionId)
      .eq("is_active", false)
      .order("end_date", { ascending: false });

    (stopped || []).forEach((m: any) => {
      if (!candidates.find(c => c.drug_name === m.drug_name)) {
        candidates.push({ ...m, source: "Stopped (this admission)", selected: false });
      }
    });

    // 2. Meds from previous admissions for the same patient (last 90 days)
    if (patientId) {
      const { data: prevAdms } = await supabase.from("admissions")
        .select("id")
        .eq("patient_id", patientId)
        .neq("id", admissionId)
        .order("admitted_at", { ascending: false })
        .limit(3);

      if (prevAdms && prevAdms.length > 0) {
        const prevIds = prevAdms.map((a: any) => a.id);
        const { data: prevMeds } = await supabase.from("ipd_medications")
          .select("drug_name, dose, route, frequency")
          .in("admission_id", prevIds)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        (prevMeds || []).forEach((m: any) => {
          if (!candidates.find(c => c.drug_name === m.drug_name)) {
            candidates.push({ ...m, source: "Previous admission", selected: false });
          }
        });
      }
    }

    setCopyList(candidates);
    setCopyLoading(false);
  };

  // ── Copy selected meds ──
  const handleCopySelected = async () => {
    const selected = copyList.filter(c => c.selected);
    if (!selected.length || !hospitalId || !userId) return;
    setCopying(true);

    // Skip any drug already active
    const activeNames = new Set(meds.filter(m => m.is_active).map(m => m.drug_name));
    const toInsert = selected.filter(c => !activeNames.has(c.drug_name));

    if (toInsert.length === 0) {
      toast({ title: "All selected drugs are already active" });
      setCopying(false);
      setShowCopy(false);
      return;
    }

    const rows = toInsert.map(c => ({
      admission_id: admissionId,
      hospital_id:  hospitalId,
      ordered_by:   userId,
      drug_name:    c.drug_name,
      dose:         c.dose    || null,
      route:        c.route   || "Oral",
      frequency:    c.frequency || "BD",
      start_date:   today(),
      is_active:    true,
    }));

    const { error } = await supabase.from("ipd_medications").insert(rows);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${toInsert.length} medication${toInsert.length > 1 ? "s" : ""} added` });
      setShowCopy(false);
      fetchMeds();
    }
    setCopying(false);
  };

  const activeMeds  = meds.filter(m => m.is_active);
  const stoppedMeds = meds.filter(m => !m.is_active);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-[13px] font-bold text-foreground">
          Active Medications
          <Badge variant="secondary" className="ml-2 text-xs">{activeMeds.length}</Badge>
        </span>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline" className="text-xs h-7"
            onClick={loadCopyCandidates}
          >
            <Copy className="h-3 w-3 mr-1" /> Copy from Previous
          </Button>
          <Button
            size="sm" className="bg-primary hover:bg-primary/90 text-xs h-7"
            onClick={() => { setShowAdd(!showAdd); setAntibioticJustified(false); }}
          >
            {showAdd ? <><XCircle className="h-3 w-3 mr-1" /> Cancel</> : <><Plus className="h-3 w-3 mr-1" /> Add Drug</>}
          </Button>
        </div>
      </div>

      {/* ── Add form ── */}
      {showAdd && (
        <div className="flex-shrink-0 bg-muted/30 border border-border rounded-lg p-3 mb-3 space-y-2">
          {/* Drug search */}
          <div className="relative">
            <Input
              value={drugSearch}
              onChange={e => { setDrugSearch(e.target.value); setForm({ ...form, drug_name: e.target.value }); }}
              placeholder="Search or type drug name…"
              className="h-8 text-xs"
              autoFocus
            />
            {drugResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 bg-background border border-border rounded-md shadow-lg mt-1 max-h-40 overflow-y-auto">
                {drugResults.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => { setForm({ ...form, drug_name: d.drug_name }); setDrugSearch(d.drug_name); setDrugResults([]); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted border-b border-border/50 last:border-0"
                  >
                    <span className="font-medium">{d.drug_name}</span>
                    {d.generic_name && <span className="text-muted-foreground ml-1">({d.generic_name})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dose / Route / Frequency */}
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={form.dose}
              onChange={e => setForm({ ...form, dose: e.target.value })}
              placeholder="Dose (e.g. 500mg)"
              className="h-8 text-xs"
            />
            <select
              value={form.route}
              onChange={e => setForm({ ...form, route: e.target.value })}
              className="h-8 text-xs border rounded-md px-2 bg-background text-foreground"
            >
              {routeOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select
              value={form.frequency}
              onChange={e => setForm({ ...form, frequency: e.target.value })}
              className="h-8 text-xs border rounded-md px-2 bg-background text-foreground"
            >
              {frequencyOptions.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
            </select>
          </div>

          {/* Start / End dates + instructions */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Start Date</label>
              <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">End Date (optional)</label>
              <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Instructions</label>
              <Input value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="e.g. after meals" className="h-8 text-xs" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={saving || checking || !form.drug_name}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              {checking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Checking…</> :
               saving   ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</> :
               <><CheckCircle2 className="h-3 w-3 mr-1" />Add Medication</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Active medications list ── */}
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : activeMeds.length === 0 && !showAdd ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No active medications
          </div>
        ) : (
          activeMeds.map(m => (
            <div key={m.id} className={cn(
              "bg-background border border-border rounded-lg p-3",
              editId === m.id && "border-primary ring-1 ring-primary/30"
            )}>
              {editId === m.id ? (
                /* ── Inline edit mode ── */
                <div className="space-y-2">
                  <p className="text-xs font-bold text-foreground">{m.drug_name}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={editForm.dose ?? ""}
                      onChange={e => setEditForm({ ...editForm, dose: e.target.value })}
                      placeholder="Dose"
                      className="h-7 text-xs"
                    />
                    <select
                      value={editForm.route ?? "Oral"}
                      onChange={e => setEditForm({ ...editForm, route: e.target.value })}
                      className="h-7 text-xs border rounded-md px-2 bg-background text-foreground"
                    >
                      {routeOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <select
                      value={editForm.frequency ?? "BD"}
                      onChange={e => setEditForm({ ...editForm, frequency: e.target.value })}
                      className="h-7 text-xs border rounded-md px-2 bg-background text-foreground"
                    >
                      {frequencyOptions.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-0.5">End Date</label>
                      <Input
                        type="date"
                        value={editForm.end_date ?? ""}
                        onChange={e => setEditForm({ ...editForm, end_date: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-0.5">Instructions</label>
                      <Input
                        value={editForm.instructions ?? ""}
                        onChange={e => setEditForm({ ...editForm, instructions: e.target.value })}
                        placeholder="e.g. after meals"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={saveEdit}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Normal view ── */
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{m.drug_name}</span>
                      {m.route && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-px rounded">{m.route}</span>
                      )}
                      {/* Antibiotic duration alert */}
                      {isAntibioticByName(m.drug_name) && m.start_date && (() => {
                        const days = differenceInDays(new Date(), new Date(m.start_date));
                        if (days >= 5) return (
                          <span className={cn("text-[10px] px-1.5 py-px rounded font-medium border flex items-center gap-1", days >= 7 ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200")}>
                            <AlertTriangle className="h-2.5 w-2.5" />Day {days} — Review?
                          </span>
                        );
                        return null;
                      })()}
                      {/* IV-to-oral switch prompt */}
                      {isAntibioticByName(m.drug_name) && m.route && ["IV","iv","Intravenous","intravenous"].some(r => (m.route || "").includes(r)) && m.start_date && differenceInDays(new Date(), new Date(m.start_date)) >= 3 && (
                        <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-px rounded font-medium">Consider IV→Oral</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {m.dose || "—"} · {m.frequency || "—"}
                      {m.start_date && ` · From ${new Date(m.start_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                      {m.end_date   && ` → ${new Date(m.end_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                      {m.instructions && ` · ${m.instructions}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditId(m.id); setEditForm({ dose: m.dose ?? "", route: m.route ?? "Oral", frequency: m.frequency ?? "BD", end_date: m.end_date ?? "", instructions: (m as any).instructions ?? "" }); }}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => stopMed(m.id)}
                      className="p-1 rounded text-amber-600 hover:bg-amber-50 transition-colors text-[11px] font-medium"
                      title="Stop medication"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete ${m.drug_name}? This cannot be undone.`)) deleteMed(m.id);
                      }}
                      className="p-1 rounded text-destructive hover:bg-red-50 transition-colors"
                      title="Delete permanently"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* ── Stopped medications ── */}
        {stoppedMeds.length > 0 && (
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors mb-1.5"
              onClick={() => setShowStopped(v => !v)}
            >
              {showStopped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Stopped ({stoppedMeds.length})
            </button>

            {showStopped && (
              <div className="space-y-1.5">
                {stoppedMeds.map(m => (
                  <div key={m.id} className="bg-muted/40 border border-border/50 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground line-through">{m.drug_name}</span>
                      <span className="text-[11px] text-muted-foreground ml-2">
                        {m.dose} · {m.frequency}
                        {m.end_date && ` · Stopped ${new Date(m.end_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => reactivateMed(m.id)}
                        className="flex items-center gap-1 text-[10px] text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded transition-colors"
                        title="Re-activate"
                      >
                        <RotateCcw className="h-3 w-3" /> Re-activate
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${m.drug_name}?`)) deleteMed(m.id);
                        }}
                        className="p-1 rounded text-destructive hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Copy from Previous modal ── */}
      <Dialog open={showCopy} onOpenChange={setShowCopy}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Copy from Previous</DialogTitle>
          </DialogHeader>

          {copyLoading ? (
            <div className="flex-1 flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : copyList.length === 0 ? (
            <div className="flex-1 py-10 text-center text-sm text-muted-foreground">
              No previous medications found
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {/* Group by source */}
                {["Stopped (this admission)", "Previous admission"].map(src => {
                  const group = copyList.filter(c => c.source === src);
                  if (!group.length) return null;
                  return (
                    <div key={src}>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 mt-3 first:mt-0">
                        {src}
                      </p>
                      {group.map((c, i) => {
                        const globalIdx = copyList.indexOf(c);
                        const isActive = meds.find(m => m.is_active && m.drug_name === c.drug_name);
                        return (
                          <label
                            key={i}
                            className={cn(
                              "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                              c.selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                              isActive && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <Checkbox
                              checked={c.selected}
                              disabled={!!isActive}
                              onCheckedChange={v => {
                                const next = [...copyList];
                                next[globalIdx] = { ...c, selected: !!v };
                                setCopyList(next);
                              }}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground">{c.drug_name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {c.dose || "—"} · {c.route || "—"} · {c.frequency || "—"}
                              </p>
                              {isActive && (
                                <p className="text-[10px] text-emerald-600 mt-0.5">Already active</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border mt-2 flex-shrink-0">
                <p className="text-xs text-muted-foreground">
                  {copyList.filter(c => c.selected).length} selected
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowCopy(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={handleCopySelected}
                    disabled={copying || copyList.filter(c => c.selected).length === 0}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {copying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    Copy {copyList.filter(c => c.selected).length > 0
                      ? `${copyList.filter(c => c.selected).length} Med${copyList.filter(c => c.selected).length > 1 ? "s" : ""}`
                      : "Selected"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Drug safety modal */}
      {showSafetyModal && safetyResult && (
        <DrugSafetyAlertModal
          open={showSafetyModal}
          drugName={form.drug_name}
          result={safetyResult}
          hospitalId={hospitalId ?? undefined}
          onClose={() => { setShowSafetyModal(false); setSafetyResult(null); }}
          onAddAnyway={async () => { setShowSafetyModal(false); setSafetyResult(null); await insertMed(); }}
          onOverride={async (reason) => {
            if (hospitalId) {
              await supabase.from("clinical_alerts").insert({
                hospital_id: hospitalId,
                alert_type: "drug_override",
                severity: "critical",
                alert_message: `IPD drug safety override: ${form.drug_name} added despite ${safetyResult?.worstSeverity} alert. Reason: ${reason}`,
              });
            }
            setShowSafetyModal(false);
            setSafetyResult(null);
            await insertMed();
          }}
        />
      )}

      <AntibioticJustificationModal
        open={showAntibioticModal}
        drugName={form.drug_name}
        hospitalId={hospitalId ?? ""}
        admissionId={admissionId}
        onSaved={() => {
          setShowAntibioticModal(false);
          setAntibioticJustified(true);
          handleAdd();
        }}
        onCancel={() => setShowAntibioticModal(false)}
      />
    </div>
  );
};

export default IPDMedicationsTab;
