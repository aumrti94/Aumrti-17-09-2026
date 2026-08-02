import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Plus, X, Star, Search, Loader2, Pencil } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";

interface Diagnosis {
  id?: string;
  diagnosis_text: string;
  icd10_code: string;
  icd10_description: string;
  is_primary: boolean;
  diagnosis_type: "working" | "confirmed" | "differential" | "chronic" | "comorbid";
  /**
   * The AI inferred this from the symptoms; nobody said it aloud.
   *
   * Such an entry is NEVER primary and is excluded from ICD coding and billing until the
   * doctor accepts it, so an unreviewed machine inference can't end up on a coded record.
   */
  is_ai_suggested?: boolean;
  /** Findings the model cited for a suggestion — shown so the doctor can judge it. */
  ai_basis?: string;
}

interface IcdResult {
  code: string;
  description: string;
  category?: string;
}

interface Props {
  encounterId: string | null;
  hospitalId: string | null;
  patientId: string | null;
  userId: string | null;
  onPrimaryChange: (diagnosis: string, icd10_code: string) => void;
  /** Voice/AI-extracted diagnosis to inject as a working diagnosis chip. nonce changes per apply. */
  seedDiagnosis?: { text: string; icd10_code: string; nonce: number; isAiSuggested?: boolean; basis?: string } | null;
}

const DIAG_TYPES: { value: Diagnosis["diagnosis_type"]; label: string; color: string }[] = [
  { value: "working", label: "Working", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "confirmed", label: "Confirmed", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "differential", label: "Differential", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "chronic", label: "Chronic", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { value: "comorbid", label: "Comorbid", color: "bg-slate-50 text-slate-700 border-slate-200" },
];

const DiagnosisPanel: React.FC<Props> = ({ encounterId, hospitalId, patientId, userId, onPrimaryChange, seedDiagnosis }) => {
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [diagnosesLoaded, setDiagnosesLoaded] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [pendingDiagnoses, setPendingDiagnoses] = useState<Diagnosis[]>([]);
  const [showDiagManager, setShowDiagManager] = useState(false);

  const { items: quickDiag, isLoading: diagLoading, save: saveDiag, reset: resetDiag } =
    useDoctorQuickPicks<string>("diagnoses");

  // Add row state
  const [addText, setAddText] = useState("");
  const [addIcd, setAddIcd] = useState("");
  const [addIcdDesc, setAddIcdDesc] = useState("");
  const [addType, setAddType] = useState<Diagnosis["diagnosis_type"]>("working");
  const [icdResults, setIcdResults] = useState<IcdResult[]>([]);
  const [icdLoading, setIcdLoading] = useState(false);
  const [showIcdDropdown, setShowIcdDropdown] = useState(false);
  const icdDropdownRef = useRef<HTMLDivElement>(null);

  const debouncedText = useDebounce(addText, 400);

  // Load existing diagnoses when encounterId is available
  useEffect(() => {
    if (!encounterId) { setDiagnosesLoaded(true); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from("opd_diagnoses")
        .select("id, diagnosis_text, icd10_code, icd10_description, is_primary, diagnosis_type, is_ai_suggested")
        .eq("encounter_id", encounterId)
        .order("created_at");
      if (data) setDiagnoses(data);
      // Gates the voice/AI seed below. The seed effect used to race this load and decide
      // dedupe and is_primary against an empty list, so a seeded diagnosis could duplicate
      // an existing one or wrongly claim primary.
      setDiagnosesLoaded(true);
    })();
  }, [encounterId]);

  // Flush pending diagnoses when encounterId becomes available
  useEffect(() => {
    if (!encounterId || !hospitalId || pendingDiagnoses.length === 0) return;
    (async () => {
      for (const d of pendingDiagnoses) {
        await saveDiagnosis(d, encounterId);
      }
      setPendingDiagnoses([]);
    })();
  }, [encounterId, hospitalId]);

  // ICD search
  useEffect(() => {
    if (!debouncedText || debouncedText.length < 3) { setIcdResults([]); return; }
    (async () => {
      setIcdLoading(true);
      try {
        const terms = debouncedText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 4).join(" | ");
        const { data } = await (supabase as any)
          .from("icd10_codes")
          .select("code, description, category")
          .eq("is_billable", true)
          .textSearch("description", terms, { type: "websearch", config: "english" })
          .order("common_india", { ascending: false })
          .order("use_count", { ascending: false })
          .limit(8);
        if (data && data.length > 0) {
          setIcdResults(data);
          setShowIcdDropdown(true);
        } else {
          // Fallback: ilike search
          const { data: fallback } = await (supabase as any)
            .from("icd10_codes")
            .select("code, description")
            .eq("is_billable", true)
            .ilike("description", `%${debouncedText.split(" ")[0]}%`)
            .order("use_count", { ascending: false })
            .limit(6);
          setIcdResults(fallback || []);
          setShowIcdDropdown((fallback || []).length > 0);
        }
      } catch {
        setIcdResults([]);
      }
      setIcdLoading(false);
    })();
  }, [debouncedText]);

  // Close ICD dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (icdDropdownRef.current && !icdDropdownRef.current.contains(e.target as Node)) {
        setShowIcdDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const saveDiagnosis = useCallback(async (d: Diagnosis, eid: string): Promise<string | null> => {
    if (!hospitalId) return null;
    const payload = {
      hospital_id: hospitalId,
      encounter_id: eid,
      patient_id: patientId || null,
      diagnosis_text: d.diagnosis_text,
      icd10_code: d.icd10_code || null,
      icd10_description: d.icd10_description || null,
      is_primary: d.is_primary,
      diagnosis_type: d.diagnosis_type,
      is_ai_suggested: d.is_ai_suggested === true,
      created_by: userId || null,
    };
    if (d.id) {
      await (supabase as any).from("opd_diagnoses").update(payload).eq("id", d.id);
      return d.id;
    } else {
      const { data } = await (supabase as any).from("opd_diagnoses").insert(payload).select("id").maybeSingle();
      return data?.id || null;
    }
  }, [hospitalId, patientId, userId]);

  const syncPrimary = (list: Diagnosis[]) => {
    // AI suggestions are excluded from every fallback: the primary diagnosis flows into the
    // encounter record, ICD coding and billing, so an unreviewed inference must never reach it.
    const human = list.filter(d => !d.is_ai_suggested);
    const primary = human.find(d => d.is_primary) || human.find(d => d.diagnosis_type === "confirmed") || human[0];
    if (primary) onPrimaryChange(primary.diagnosis_text, primary.icd10_code);
    else onPrimaryChange("", "");
  };

  // Add a fully-formed diagnosis (used by manual add row and by voice/AI seeding)
  const addDiagnosis = async (newDiag: Diagnosis) => {
    if (encounterId) {
      const savedId = await saveDiagnosis(newDiag, encounterId);
      const saved = { ...newDiag, id: savedId || undefined };
      setDiagnoses(prev => {
        const next = [...prev, saved];
        syncPrimary(next);
        return next;
      });
    } else {
      setPendingDiagnoses(prev => [...prev, newDiag]);
      setDiagnoses(prev => {
        const next = [...prev, newDiag];
        syncPrimary(next);
        return next;
      });
    }
  };

  const handleAdd = async () => {
    if (!addText.trim()) return;
    await addDiagnosis({
      diagnosis_text: addText.trim(),
      icd10_code: addIcd,
      icd10_description: addIcdDesc,
      is_primary: diagnoses.length === 0,
      diagnosis_type: addType,
    });
    setAddText(""); setAddIcd(""); setAddIcdDesc(""); setAddType("working");
    setIcdResults([]); setShowAddRow(false);
  };

  // Seed a voice/AI-extracted diagnosis as a "working" chip (deduped, once per nonce)
  const diagnosesRef = useRef(diagnoses);
  diagnosesRef.current = diagnoses;
  const lastSeedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!seedDiagnosis || !seedDiagnosis.text.trim()) return;
    // Wait for the DB load, otherwise dedupe and is_primary are decided against an
    // empty list while the real diagnoses are still in flight.
    if (!diagnosesLoaded) return;
    if (lastSeedNonce.current === seedDiagnosis.nonce) return;
    lastSeedNonce.current = seedDiagnosis.nonce;
    const text = seedDiagnosis.text.trim();
    const cur = diagnosesRef.current;
    if (cur.some(d => d.diagnosis_text.trim().toLowerCase() === text.toLowerCase())) return;
    const aiSuggested = seedDiagnosis.isAiSuggested === true;
    void addDiagnosis({
      diagnosis_text: text,
      icd10_code: seedDiagnosis.icd10_code || "",
      icd10_description: "",
      // An AI suggestion is NEVER primary, even on an otherwise empty list — the primary
      // diagnosis drives coding and billing and must be a human decision.
      is_primary: aiSuggested ? false : cur.length === 0,
      diagnosis_type: "working",
      is_ai_suggested: aiSuggested,
      ai_basis: seedDiagnosis.basis || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedDiagnosis, diagnosesLoaded]);

  /** Doctor accepts an AI suggestion: it becomes an ordinary diagnosis. */
  const acceptSuggestion = async (idx: number) => {
    const d = diagnoses[idx];
    if (!d?.is_ai_suggested) return;
    if (d.id) {
      await (supabase as any).from("opd_diagnoses")
        .update({ is_ai_suggested: false }).eq("id", d.id);
    }
    setDiagnoses(prev => {
      const next = prev.map((x, i) => (i === idx ? { ...x, is_ai_suggested: false } : x));
      // Only now can it be primary, and only if nothing else already is.
      if (!next.some(x => x.is_primary && !x.is_ai_suggested)) {
        next[idx] = { ...next[idx], is_primary: true };
        if (next[idx].id) {
          void (supabase as any).from("opd_diagnoses")
            .update({ is_primary: true }).eq("id", next[idx].id);
        }
      }
      syncPrimary(next);
      return next;
    });
  };

  const handleRemove = async (idx: number) => {
    const d = diagnoses[idx];
    if (d.id) {
      await (supabase as any).from("opd_diagnoses").delete().eq("id", d.id);
    }
    const next = diagnoses.filter((_, i) => i !== idx);
    // If removed was primary, reassign to first
    if (d.is_primary && next.length > 0) next[0].is_primary = true;
    setDiagnoses(next);
    syncPrimary(next);
  };

  const handleSetPrimary = async (idx: number) => {
    const next = diagnoses.map((d, i) => ({ ...d, is_primary: i === idx }));
    setDiagnoses(next);
    syncPrimary(next);
    if (encounterId) {
      for (const d of next) {
        if (d.id) await (supabase as any).from("opd_diagnoses").update({ is_primary: d.is_primary }).eq("id", d.id);
      }
    }
  };

  const selectIcd = (r: IcdResult) => {
    setAddIcd(r.code);
    setAddIcdDesc(r.description);
    setShowIcdDropdown(false);
  };

  const typeInfo = (type: string) => DIAG_TYPES.find(t => t.value === type) || DIAG_TYPES[0];

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700">Diagnoses</label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDiagManager(v => !v)}
            className="flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-[#1A2F5A] transition-colors"
          >
            <Pencil size={11} /> {showDiagManager ? "Done" : "Manage"}
          </button>
          <button
            onClick={() => setShowAddRow(v => !v)}
            className="text-[11px] flex items-center gap-0.5 text-[#1A2F5A] hover:underline"
          >
            <Plus size={11} /> Add Diagnosis
          </button>
        </div>
      </div>

      {/* Existing diagnoses list */}
      {diagnoses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {diagnoses.map((d, i) => {
            const ti = typeInfo(d.diagnosis_type);
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium",
                  // An unconfirmed AI suggestion reads as provisional, not as a diagnosis
                  // the doctor has made.
                  d.is_ai_suggested
                    ? "bg-violet-50 text-violet-700 border-violet-300 border-dashed"
                    : ti.color
                )}
                title={d.is_ai_suggested && d.ai_basis ? `AI suggestion — based on: ${d.ai_basis}` : undefined}
              >
                {d.is_ai_suggested ? (
                  // No star: a suggestion cannot be made primary without being accepted first.
                  <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide opacity-80">AI</span>
                ) : (
                  <button
                    onClick={() => handleSetPrimary(i)}
                    title={d.is_primary ? "Primary diagnosis" : "Set as primary"}
                    className={cn("flex-shrink-0 transition-colors", d.is_primary ? "text-amber-500" : "text-slate-300 hover:text-amber-400")}
                  >
                    <Star size={10} fill={d.is_primary ? "currentColor" : "none"} />
                  </button>
                )}
                <span>{d.diagnosis_text}</span>
                {d.icd10_code && <span className="font-mono opacity-70">({d.icd10_code})</span>}
                {d.is_ai_suggested ? (
                  <button
                    onClick={() => acceptSuggestion(i)}
                    className="ml-0.5 px-1.5 rounded-full bg-violet-600 text-white text-[9px] font-semibold hover:bg-violet-700"
                    title="Confirm this diagnosis. Until confirmed it is not coded or billed."
                  >
                    Confirm
                  </button>
                ) : (
                  <span className="opacity-60 capitalize">[{d.diagnosis_type}]</span>
                )}
                <button onClick={() => handleRemove(i)} className="ml-0.5 opacity-50 hover:opacity-100">
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick add chips */}
      {diagnoses.length === 0 && !showAddRow && (
        <div className="flex flex-wrap gap-1">
          {diagLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="h-5 w-24 rounded-full bg-muted animate-pulse inline-block" />
              ))
            : quickDiag.map(d => (
                <button
                  key={d}
                  onClick={() => { setAddText(d); setShowAddRow(true); }}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100"
                >
                  {d}
                </button>
              ))
          }
        </div>
      )}

      {showDiagManager && !diagLoading && (
        <QuickPickManagerPanel
          items={quickDiag}
          onSave={saveDiag}
          onReset={resetDiag}
          label="diagnosis chips"
        />
      )}

      {/* Add row */}
      {showAddRow && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="flex gap-2">
            {/* Diagnosis text */}
            <input
              autoFocus
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="Diagnosis / impression..."
              className="flex-1 h-8 px-3 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1A2F5A]"
            />
            {/* Type selector */}
            <select
              value={addType}
              onChange={e => setAddType(e.target.value as Diagnosis["diagnosis_type"])}
              className="h-8 px-2 border border-slate-200 rounded-lg text-xs outline-none bg-white"
            >
              {DIAG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* ICD-10 search */}
          <div className="relative" ref={icdDropdownRef}>
            <div className="flex items-center gap-1 h-8 px-3 border border-slate-200 rounded-lg bg-white">
              {icdLoading ? <Loader2 size={11} className="animate-spin text-slate-400 flex-shrink-0" /> : <Search size={11} className="text-slate-400 flex-shrink-0" />}
              <input
                value={addIcd || addIcdDesc}
                onChange={e => {
                  const v = e.target.value;
                  setAddIcd(v);
                  setAddIcdDesc("");
                  if (v.length >= 3) setShowIcdDropdown(true);
                }}
                placeholder="ICD-10 code or search (auto-fills from diagnosis)"
                className="flex-1 text-xs outline-none bg-transparent placeholder-slate-400"
              />
              {addIcd && (
                <button onClick={() => { setAddIcd(""); setAddIcdDesc(""); }} className="text-slate-400 hover:text-slate-600">
                  <X size={10} />
                </button>
              )}
            </div>
            {showIcdDropdown && icdResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                <div className="px-2 py-1 bg-slate-50 border-b border-slate-100">
                  <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wide">🤖 AI Suggested ICD-10 Codes</span>
                </div>
                {icdResults.map(r => (
                  <button
                    key={r.code}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2 text-xs border-b border-slate-50 last:border-0"
                    onMouseDown={() => selectIcd(r)}
                  >
                    <span className="font-mono font-semibold text-[#1A2F5A] w-14 flex-shrink-0">{r.code}</span>
                    <span className="text-slate-700 flex-1 truncate">{r.description}</span>
                    {r.category && <span className="text-[9px] text-slate-400 flex-shrink-0">{r.category}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleAdd}
              disabled={!addText.trim()}
              className="h-7 px-4 bg-[#1A2F5A] text-white text-[11px] font-semibold rounded-lg disabled:opacity-40 hover:bg-[#152647]"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddRow(false); setAddText(""); setAddIcd(""); setAddIcdDesc(""); setIcdResults([]); }}
              className="h-7 px-3 text-[11px] text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagnosisPanel;
