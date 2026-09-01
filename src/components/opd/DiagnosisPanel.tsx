import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Plus, X, Star, Search, Loader2, Pencil } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";
import {
  searchIcdCodes,
  fetchIcdSettings,
  systemsFor,
  pickAutoFill,
  MIN_SEARCH_LENGTH,
  type IcdResult,
  type ActiveSet,
  type ActiveCodeSystem,
} from "@/lib/icdSearch";

interface Diagnosis {
  id?: string;
  diagnosis_text: string;
  icd10_code: string;
  icd10_description: string;
  /**
   * ICD-11 runs ALONGSIDE ICD-10, never instead of it. PMJAY, HCX, insurance pre-auth and the
   * FHIR export all key on the ICD-10 columns, so dual-coding is the only safe shape while
   * India is mid-transition.
   */
  icd11_code?: string;
  icd11_description?: string;
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

interface Props {
  encounterId: string | null;
  hospitalId: string | null;
  patientId: string | null;
  userId: string | null;
  /**
   * `icd11_code` is appended, not substituted — existing callers that read only the first two
   * arguments keep working unchanged.
   */
  onPrimaryChange: (diagnosis: string, icd10_code: string, icd11_code?: string) => void;
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
  // Open by default: the ICD field used to be hidden behind an 11px "+ Add Diagnosis" link at
  // the very bottom of the Examination tab, which is why clinicians reported ICD coding as
  // "missing". The toggle itself still works exactly as before — only the initial state changed.
  const [showAddRow, setShowAddRow] = useState(true);
  const [pendingDiagnoses, setPendingDiagnoses] = useState<Diagnosis[]>([]);
  const [showDiagManager, setShowDiagManager] = useState(false);

  const { items: quickDiag, isLoading: diagLoading, save: saveDiag, reset: resetDiag } =
    useDoctorQuickPicks<string>("diagnoses");

  // Add row state
  const [addText, setAddText] = useState("");
  const [addIcd, setAddIcd] = useState("");
  const [addIcdDesc, setAddIcdDesc] = useState("");
  const [addIcd11, setAddIcd11] = useState("");
  const [addIcd11Desc, setAddIcd11Desc] = useState("");
  const [addType, setAddType] = useState<Diagnosis["diagnosis_type"]>("working");
  const [icdResults, setIcdResults] = useState<IcdResult[]>([]);
  const [icdLoading, setIcdLoading] = useState(false);
  const [showIcdDropdown, setShowIcdDropdown] = useState(false);
  const icdDropdownRef = useRef<HTMLDivElement>(null);
  /**
   * The doctor has typed in or cleared the ICD box themselves. Auto-fill stops the moment this
   * is true — once a human has touched the code, nothing may overwrite it behind their back.
   */
  const icdTouched = useRef(false);
  /** The current code was filled by the search, not chosen — shown as such, and replaceable. */
  const [icdAutoFilled, setIcdAutoFilled] = useState(false);

  const debouncedText = useDebounce(addText, 400);

  // Load existing diagnoses when encounterId is available
  useEffect(() => {
    if (!encounterId) { setDiagnosesLoaded(true); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from("opd_diagnoses")
        .select("id, diagnosis_text, icd10_code, icd10_description, icd11_code, icd11_description, is_primary, diagnosis_type, is_ai_suggested")
        .eq("encounter_id", encounterId)
        .order("created_at");
      if (data) setDiagnoses(data);
      // The add row starts open so the ICD field is visible on an empty encounter; once this
      // encounter already has diagnoses, collapse back to the original list-first view.
      if (data && data.length > 0) setShowAddRow(false);
      // Gates the voice/AI seed below. The seed effect used to race this load and decide
      // dedupe and is_primary against an empty list, so a seeded diagnosis could duplicate
      // an existing one or wrongly claim primary.
      setDiagnosesLoaded(true);
    })();
  }, [encounterId]);

  // Flush pending diagnoses when encounterId becomes available.
  //
  // The queue and the writer are read through a ref: this effect CLEARS
  // pendingDiagnoses, so depending on it would re-enter on its own write and
  // could save the same diagnosis twice.
  // Left empty at first render: `saveDiagnosis` is declared further down, so
  // naming it in the initialiser would be a use-before-declaration. The updater
  // effect below is declared first, so it always populates this before the
  // consumer effect runs.
  const flushRef = useRef<{ pendingDiagnoses: typeof pendingDiagnoses; saveDiagnosis: typeof saveDiagnosis } | null>(null);
  useEffect(() => { flushRef.current = { pendingDiagnoses, saveDiagnosis }; });

  useEffect(() => {
    if (!encounterId || !hospitalId) return;
    const flush = flushRef.current;
    if (!flush || flush.pendingDiagnoses.length === 0) return;
    (async () => {
      for (const d of flush.pendingDiagnoses) {
        await flush.saveDiagnosis(d, encounterId);
      }
      setPendingDiagnoses([]);
    })();
  }, [encounterId, hospitalId]);

  // Which classification(s) this hospital codes in. Defaults to ICD-10 only, so a hospital
  // that has never opened Settings → ICD Code Master sees exactly what it saw before.
  const [icdSettings, setIcdSettings] = useState<{
    activeSet: ActiveSet;
    commonFirst: boolean;
    activeCodeSystem: ActiveCodeSystem;
  }>({ activeSet: "all", commonFirst: true, activeCodeSystem: "icd10" });

  useEffect(() => {
    if (!hospitalId) return;
    fetchIcdSettings(hospitalId).then(setIcdSettings);
  }, [hospitalId]);

  // ICD search — delegated to the shared helper, which fixes the `|`-under-websearch bug
  // that made multi-word diagnoses match almost nothing. See src/lib/icdSearch.ts.
  useEffect(() => {
    if (!debouncedText || debouncedText.length < MIN_SEARCH_LENGTH) { setIcdResults([]); return; }
    (async () => {
      setIcdLoading(true);
      const results = await searchIcdCodes({
        term: debouncedText,
        systems: systemsFor(icdSettings.activeCodeSystem),
        hospitalId,
        activeSet: icdSettings.activeSet,
        commonFirst: icdSettings.commonFirst,
        limit: 8,
      });
      setIcdResults(results);

      // "auto-fills from diagnosis" is what the field has always promised; until now it only
      // ever opened a dropdown and waited for a click. Fill it — but only from an unambiguous
      // match (see pickAutoFill), only into a box the doctor has not touched, and always
      // visibly, so a wrong guess is corrected rather than silently coded.
      const auto = icdTouched.current ? null : pickAutoFill(debouncedText, results);
      if (auto) {
        if (auto.code_system === "icd11") {
          setAddIcd11(auto.code);
          setAddIcd11Desc(auto.description);
        } else {
          setAddIcd(auto.code);
          setAddIcdDesc(auto.description);
        }
        setIcdAutoFilled(true);
      }

      // A filled box does not need the list thrown over it; the doctor can still open it.
      setShowIcdDropdown(results.length > 0 && !auto);
      setIcdLoading(false);
    })();
  }, [debouncedText, hospitalId, icdSettings]);

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
      icd11_code: d.icd11_code || null,
      icd11_description: d.icd11_description || null,
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
    if (primary) onPrimaryChange(primary.diagnosis_text, primary.icd10_code, primary.icd11_code || "");
    else onPrimaryChange("", "", "");
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

  /** Clear every add-row field back to the state a fresh row starts in. */
  const resetAddRow = () => {
    setAddText(""); setAddIcd(""); setAddIcdDesc(""); setAddType("working");
    setAddIcd11(""); setAddIcd11Desc("");
    setIcdResults([]);
    icdTouched.current = false;
    setIcdAutoFilled(false);
  };

  const handleAdd = async () => {
    if (!addText.trim()) return;
    await addDiagnosis({
      diagnosis_text: addText.trim(),
      icd10_code: addIcd,
      icd10_description: addIcdDesc,
      icd11_code: addIcd11,
      icd11_description: addIcd11Desc,
      is_primary: diagnoses.length === 0,
      diagnosis_type: addType,
    });
    resetAddRow();
    setShowAddRow(false);
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

  /** Route the pick to the field for its own classification — the two are recorded side by side. */
  const selectIcd = (r: IcdResult) => {
    if (r.code_system === "icd11") {
      setAddIcd11(r.code);
      setAddIcd11Desc(r.description);
    } else {
      setAddIcd(r.code);
      setAddIcdDesc(r.description);
    }
    // A deliberate pick outranks the search: never auto-replace it on the next keystroke.
    icdTouched.current = true;
    setIcdAutoFilled(false);
    setShowIcdDropdown(false);
  };

  const typeInfo = (type: string) => DIAG_TYPES.find(t => t.value === type) || DIAG_TYPES[0];

  /** ICD-11 is opt-in per hospital; until it is enabled this panel looks exactly as it did. */
  const showIcd11 = icdSettings.activeCodeSystem !== "icd10";

  return (
    <div className="pt-3 mt-1 border-t-2 border-slate-200 space-y-2">
      <div className="flex items-center justify-between mb-1">
        {/* Promoted from a hairline footer label to a section header matching "General
            Examination" above — this section reads as part of the form, not as a footnote. */}
        <label className="text-xs font-bold text-slate-700">Diagnosis &amp; ICD Coding</label>
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
                {d.icd10_code && (
                  <span className="font-mono opacity-70" title={d.icd10_description || "ICD-10"}>({d.icd10_code})</span>
                )}
                {d.icd11_code && (
                  <span className="font-mono opacity-70" title={d.icd11_description || "ICD-11"}>
                    <span className="text-[8px] font-sans font-bold uppercase mr-0.5">11</span>{d.icd11_code}
                  </span>
                )}
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
                  // Hands off from here: the doctor is coding this one themselves.
                  icdTouched.current = true;
                  setIcdAutoFilled(false);
                  if (v.length >= 3) setShowIcdDropdown(true);
                }}
                placeholder="ICD-10 code or search (auto-fills from diagnosis)"
                className="flex-1 text-xs outline-none bg-transparent placeholder-slate-400"
              />
              {icdAutoFilled && (
                <span
                  className="text-[8px] font-bold px-1 py-px rounded bg-emerald-100 text-emerald-700 flex-shrink-0"
                  title="Filled from the diagnosis text. Check it, or clear it and pick another."
                >
                  AUTO
                </span>
              )}
              {icdResults.length > 0 && (
                <button
                  onClick={() => setShowIcdDropdown(v => !v)}
                  className="text-[9px] text-slate-400 hover:text-[#1A2F5A] flex-shrink-0"
                  title="Show other matching codes"
                >
                  {icdResults.length} match{icdResults.length === 1 ? "" : "es"}
                </button>
              )}
              {addIcd && (
                <button
                  onClick={() => {
                    setAddIcd(""); setAddIcdDesc("");
                    // An explicit clear is a decision too — do not refill it on the next keystroke.
                    icdTouched.current = true;
                    setIcdAutoFilled(false);
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            {/* The code alone says nothing at a glance. Whatever put it there — a pick or the
                auto-fill — the doctor has to be able to read what they are about to record. */}
            {addIcd && addIcdDesc && (
              <div className="px-3 pt-1 text-[10px] text-slate-500 truncate" title={addIcdDesc}>
                {addIcdDesc}
              </div>
            )}
            {showIcdDropdown && icdResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                <div className="px-2 py-1 bg-slate-50 border-b border-slate-100">
                  <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wide">
                    🤖 Suggested {showIcd11 ? "ICD Codes" : "ICD-10 Codes"}
                  </span>
                </div>
                {icdResults.map(r => (
                  <button
                    key={`${r.code_system}-${r.code}`}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2 text-xs border-b border-slate-50 last:border-0"
                    onMouseDown={() => selectIcd(r)}
                  >
                    {/* Which classification a hit belongs to decides which field it fills, so
                        it has to be visible before the click. */}
                    <span
                      className={cn(
                        "text-[8px] font-bold px-1 py-px rounded flex-shrink-0",
                        r.code_system === "icd11"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {r.code_system === "icd11" ? "ICD-11" : "ICD-10"}
                    </span>
                    <span className="font-mono font-semibold text-[#1A2F5A] w-14 flex-shrink-0">{r.code}</span>
                    <span className="text-slate-700 flex-1 truncate">{r.description}</span>
                    {r.category && <span className="text-[9px] text-slate-400 flex-shrink-0">{r.category}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ICD-11 — only for hospitals that have switched it on in Settings → ICD Code Master.
              Sits beside ICD-10 rather than replacing it: dual-coding is what the transition
              period needs, and the statutory exports still read ICD-10. */}
          {showIcd11 && (
            <div className="flex items-center gap-1 h-8 px-3 border border-violet-200 rounded-lg bg-white">
              <span className="text-[8px] font-bold px-1 py-px rounded bg-violet-100 text-violet-700 flex-shrink-0">ICD-11</span>
              <input
                value={addIcd11 || addIcd11Desc}
                onChange={e => { setAddIcd11(e.target.value); setAddIcd11Desc(""); icdTouched.current = true; setIcdAutoFilled(false); }}
                placeholder="ICD-11 code (pick from the list above, or type)"
                className="flex-1 text-xs outline-none bg-transparent placeholder-slate-400"
              />
              {addIcd11 && (
                <button onClick={() => { setAddIcd11(""); setAddIcd11Desc(""); }} className="text-slate-400 hover:text-slate-600">
                  <X size={10} />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleAdd}
              disabled={!addText.trim()}
              className="h-7 px-4 bg-[#1A2F5A] text-white text-[11px] font-semibold rounded-lg disabled:opacity-40 hover:bg-[#152647]"
            >
              Add
            </button>
            <button
              onClick={() => { resetAddRow(); setShowAddRow(false); }}
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
