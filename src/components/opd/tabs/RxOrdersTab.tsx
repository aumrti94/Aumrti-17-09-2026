import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { X, Plus, AlertTriangle, ShieldX, CheckCircle2, Pencil, RotateCcw } from "lucide-react";
import type { PrescriptionData, DrugEntry, LabOrder, RadiologyOrder, EncounterData } from "../ConsultationWorkspace";
import { checkDrugSafety, type DrugSafetyResult } from "@/lib/drugSafetyCheck";
import DrugSafetyAlertModal from "@/components/opd/DrugSafetyAlertModal";
import AllergyBanner from "@/components/clinical/AllergyBanner";
import { isAntibioticByName } from "@/lib/high-alert-meds";
import AntibioticJustificationModal from "@/components/quality/AntibioticJustificationModal";
import { useToast } from "@/hooks/use-toast";
import { useConfigValues } from "@/hooks/useConfigValues";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import type { RxQuickPickTemplate } from "@/lib/quickPickDefaults";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";
import DrugMasterSearchInput from "@/components/opd/DrugMasterSearchInput";

interface Props {
  prescription: PrescriptionData;
  onChange: (partial: Partial<PrescriptionData>) => void;
  hospitalId: string | null;
  patientAllergies?: string[];
  diagnosis?: string;
  icdCode?: string;
  patientAge?: number;
  patientGender?: string;
  encounterId?: string | null;
  onCommit?: () => void;
  isSaving?: boolean;
  encounter?: EncounterData;
  onEncounterChange?: (partial: Partial<EncounterData>) => void;
}


const FREQ_PER_DAY: Record<string, number> = {
  OD: 1, QD: 1, HS: 1, SOS: 1, STAT: 1, AC: 1, PC: 1,
  BD: 2,
  TDS: 3,
  QID: 4,
};

const calcQty = (dose: string, frequency: string, days: string): number => {
  const doseNum = parseFloat(dose) || 1;
  const freqPerDay = FREQ_PER_DAY[frequency?.toUpperCase()] ?? 1;
  const d = parseInt(days || "0", 10) || 0;
  return d > 0 ? Math.ceil(doseNum * freqPerDay * d) : 0;
};


const templateToDrugEntry = (t: RxQuickPickTemplate): DrugEntry => ({
  drug_name: t.drug_name,
  dose: t.dose,
  route: t.route,
  frequency: t.frequency,
  duration_days: t.duration_days,
  instructions: t.instructions,
  quantity: t.quantity,
  is_stat: false,
});


/** Safety badge icons per drug */
interface DrugSafetyMeta {
  severity: "interaction" | "allergy_override" | "duplicate";
  tooltip: string;
}

const RxOrdersTab: React.FC<Props> = ({ prescription, onChange, hospitalId, patientAllergies = [], encounterId, onCommit, isSaving, encounter, onEncounterChange }) => {
  const { toast } = useToast();
  const routeOptions     = useConfigValues("drug_routes");
  const frequencyOptions = useConfigValues("drug_frequencies");
  const [showAddDrug, setShowAddDrug] = useState(false);
  const [showRxManager, setShowRxManager] = useState(false);
  const [newTemplate, setNewTemplate] = useState<RxQuickPickTemplate>({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "" });
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [showLabManager, setShowLabManager] = useState(false);
  const [showRadManager, setShowRadManager] = useState(false);
  const { items: rxTemplates, isLoading: rxLoading, save: saveRx, reset: resetRx } =
    useDoctorQuickPicks<RxQuickPickTemplate>("rx_templates");
  const { items: labTemplates, isLoading: labTplLoading, save: saveLabTpl, reset: resetLabTpl } =
    useDoctorQuickPicks<string>("lab_templates");
  const { items: radTemplates, isLoading: radTplLoading, save: saveRadTpl, reset: resetRadTpl } =
    useDoctorQuickPicks<string>("radiology_templates");
  const [searchQuery, setSearchQuery] = useState("");
  const [newDrug, setNewDrug] = useState<DrugEntry>({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "", is_stat: false });
  const [labInput, setLabInput] = useState("");
  const [radInput, setRadInput] = useState("");
  const [labMaster, setLabMaster] = useState<string[]>([]);
  const [radMaster, setRadMaster] = useState<string[]>([]);
  const [labGroups, setLabGroups] = useState<{ id: string; group_name: string; fee: number; testNames: string[] }[]>([]);
  const [labSuggestions, setLabSuggestions] = useState<string[]>([]);
  const [radSuggestions, setRadSuggestions] = useState<string[]>([]);
  const [orderedLabTests, setOrderedLabTests] = useState<Set<string>>(new Set());
  const [orderedRadStudies, setOrderedRadStudies] = useState<Set<string>>(new Set());

  // Drug safety state
  const [checking, setChecking] = useState(false);
  const [safetyResult, setSafetyResult] = useState<DrugSafetyResult | null>(null);
  const [pendingDrug, setPendingDrug] = useState<DrugEntry | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [safeFlash, setSafeFlash] = useState(false);
  const [drugSafetyMeta, setDrugSafetyMeta] = useState<Map<number, DrugSafetyMeta>>(new Map());
  const [showAntibioticModal, setShowAntibioticModal] = useState(false);
  const [antibioticJustified, setAntibioticJustified] = useState(false);

  // Fetch lab tests, groups, and radiology modalities from DB
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("lab_test_master").select("test_name").eq("hospital_id", hospitalId).eq("is_active", true).order("test_name")
      .then(({ data }) => setLabMaster((data || []).map((t: any) => t.test_name)));
    (supabase as any)
      .from("lab_test_groups")
      .select("id, group_name, fee, lab_test_group_items(test_id, lab_test_master:test_id(test_name))")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("group_name")
      .then(({ data }: any) => setLabGroups((data || []).map((g: any) => ({
        id: g.id,
        group_name: g.group_name,
        fee: Number(g.fee) || 0,
        testNames: (g.lab_test_group_items || []).map((i: any) => i.lab_test_master?.test_name).filter(Boolean),
      }))));
    (supabase as any).from("radiology_study_master").select("study_name").eq("hospital_id", hospitalId).eq("is_active", true).order("sort_order")
      .then(({ data }: any) => setRadMaster((data || []).map((m: any) => m.study_name)));
  }, [hospitalId]);

  // Fetch already ordered investigations for this encounter to show status
  useEffect(() => {
    if (!encounterId) return;
    const fetchOrdered = async () => {
      const [labRes, radRes] = await Promise.all([
        supabase.from("lab_orders").select("lab_order_items(lab_test_master(test_name))").eq("encounter_id", encounterId),
        supabase.from("radiology_orders").select("study_name").eq("encounter_id", encounterId),
      ]);

      if (labRes.data) {
        const tests = new Set<string>();
        labRes.data.forEach((o: any) => {
          (o.lab_order_items || []).forEach((i: any) => {
            if (i.lab_test_master?.test_name) tests.add(i.lab_test_master.test_name.toLowerCase());
          });
        });
        setOrderedLabTests(tests);
      }
      if (radRes.data) {
        setOrderedRadStudies(new Set(radRes.data.map(r => r.study_name.toLowerCase())));
      }
    };
    fetchOrdered();
    // Refresh every 5s if there are draft orders
    const interval = setInterval(fetchOrdered, 5000);
    return () => clearInterval(interval);
  }, [encounterId, prescription.lab_orders.length, prescription.radiology_orders.length]);

  // Compute autocomplete suggestions — cross-filtered so radiology studies never appear in lab and vice versa
  useEffect(() => {
    if (!labInput.trim()) { setLabSuggestions([]); return; }
    const q = labInput.toLowerCase();
    const radSet = new Set(radMaster.map(n => n.toLowerCase()));
    setLabSuggestions(labMaster.filter(n => n.toLowerCase().includes(q) && !radSet.has(n.toLowerCase())).slice(0, 8));
  }, [labInput, labMaster, radMaster]);

  useEffect(() => {
    if (!radInput.trim()) { setRadSuggestions([]); return; }
    const q = radInput.toLowerCase();
    const labSet = new Set(labMaster.map(n => n.toLowerCase()));
    setRadSuggestions(radMaster.filter(n => n.toLowerCase().includes(q) && !labSet.has(n.toLowerCase())).slice(0, 8));
  }, [radInput, radMaster, labMaster]);

  const performSafetyCheck = async (drug: DrugEntry) => {
    if (isAntibioticByName(drug.drug_name) && !antibioticJustified) {
      setPendingDrug(drug);
      setShowAntibioticModal(true);
      return;
    }
    setChecking(true);
    setPendingDrug(drug);

    const currentDrugNames = prescription.drugs.map((d) => d.drug_name);

    try {
      const result = await checkDrugSafety(drug.drug_name, currentDrugNames, patientAllergies);

      if (result.hasIssues) {
        setSafetyResult(result);
        setShowSafetyModal(true);
      } else {
        // Safe — add directly with green flash
        addDrugDirect(drug);
        setSafeFlash(true);
        setTimeout(() => setSafeFlash(false), 1500);
      }
    } catch {
      // On error, still allow adding
      addDrugDirect(drug);
    } finally {
      setChecking(false);
    }
  };

  const addDrugDirect = (drug: DrugEntry) => {
    onChange({ drugs: [...prescription.drugs, drug] });
    resetAddForm();
  };

  const resetAddForm = () => {
    setNewDrug({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "", is_stat: false });
    setSearchQuery("");
    setShowAddDrug(false);
    setPendingDrug(null);
  };

  // Save the drug currently in the Add Drug form as a reusable Quick Template
  // (doctor's rx_templates). Save-only: it does NOT add the drug to this
  // prescription — the doctor clicks the resulting chip to add it.
  const saveNewDrugAsTemplate = async () => {
    if (!newDrug.drug_name.trim()) return;
    const tpl: RxQuickPickTemplate = {
      drug_name: newDrug.drug_name,
      dose: newDrug.dose,
      route: newDrug.route,
      frequency: newDrug.frequency,
      duration_days: newDrug.duration_days,
      instructions: newDrug.instructions,
      quantity: newDrug.quantity,
    };
    const dupe = rxTemplates.some((t) =>
      t.drug_name.trim().toLowerCase() === tpl.drug_name.trim().toLowerCase() &&
      t.dose === tpl.dose && t.frequency === tpl.frequency);
    if (dupe) { toast({ title: "Template already exists" }); return; }
    try {
      await saveRx([...rxTemplates, tpl]);
      toast({ title: "✓ Saved to Quick templates" });
    } catch {
      toast({ title: "Couldn't save template", variant: "destructive" });
    }
  };

  const handleSafetyAddAnyway = () => {
    if (pendingDrug && safetyResult) {
      const newIndex = prescription.drugs.length;
      addDrugDirect(pendingDrug);
      // Mark with interaction badge
      setDrugSafetyMeta((prev) => {
        const next = new Map(prev);
        next.set(newIndex, {
          severity: "interaction",
          tooltip: safetyResult.interactions.map((i) => `${i.drug_a} + ${i.drug_b}: ${i.clinical_effect}`).join("; "),
        });
        return next;
      });
    }
    setShowSafetyModal(false);
    setSafetyResult(null);
  };

  const handleSafetyOverride = (reason: string) => {
    if (pendingDrug && safetyResult) {
      const newIndex = prescription.drugs.length;
      addDrugDirect(pendingDrug);
      // Log override via clinical_alerts
      if (hospitalId) {
        supabase.from("clinical_alerts").insert({
          hospital_id: hospitalId,
          alert_type: "drug_override",
          severity: "critical",
          alert_message: `Drug safety override: ${pendingDrug.drug_name} added despite ${safetyResult.worstSeverity} alert. Reason: ${reason}`,
        }).then(() => {});
      }
      setDrugSafetyMeta((prev) => {
        const next = new Map(prev);
        next.set(newIndex, {
          severity: "allergy_override",
          tooltip: `Override: ${reason}`,
        });
        return next;
      });
    }
    setShowSafetyModal(false);
    setSafetyResult(null);
  };

  const handleSafetyClose = () => {
    setShowSafetyModal(false);
    setSafetyResult(null);
    setPendingDrug(null);
  };

  const removeDrug = (i: number) => {
    onChange({ drugs: prescription.drugs.filter((_, idx) => idx !== i) });
    setDrugSafetyMeta((prev) => {
      const next = new Map<number, DrugSafetyMeta>();
      prev.forEach((v, k) => {
        if (k < i) next.set(k, v);
        else if (k > i) next.set(k - 1, v);
      });
      return next;
    });
  };

  const addLab = (name: string) => {
    if (!name.trim()) return;
    const radSet = new Set(radMaster.map(n => n.toLowerCase()));
    if (radSet.has(name.toLowerCase())) {
      toast({ title: "Radiology study — use Radiology Orders", description: `"${name}" is a radiology study, not a lab test.`, variant: "destructive" });
      setLabInput("");
      return;
    }
    const exists = prescription.lab_orders.find((l) => l.test_name === name);
    if (exists) return;
    onChange({ lab_orders: [...prescription.lab_orders, { test_name: name, urgency: "routine", clinical_indication: "" }] });
    setLabInput("");
  };

  const addLabGroup = (group: { group_name: string; testNames: string[] }) => {
    const existingNames = new Set(prescription.lab_orders.map((l) => l.test_name));
    const newOrders = group.testNames
      .filter((name) => !existingNames.has(name))
      .map((name) => ({ test_name: name, urgency: "routine", clinical_indication: "" }));
    if (newOrders.length > 0) onChange({ lab_orders: [...prescription.lab_orders, ...newOrders] });
  };

  const isGroupFullyAdded = (group: { testNames: string[] }) =>
    group.testNames.length > 0 && group.testNames.every((n) => prescription.lab_orders.some((l) => l.test_name === n));

  const removeLab = (i: number) => {
    onChange({ lab_orders: prescription.lab_orders.filter((_, idx) => idx !== i) });
  };

  const addRad = (name: string) => {
    if (!name.trim()) return;
    const exists = prescription.radiology_orders.find((r) => r.study_name === name);
    if (exists) return;
    onChange({ radiology_orders: [...prescription.radiology_orders, { study_name: name, urgency: "routine", clinical_indication: "" }] });
    setRadInput("");
  };

  const removeRad = (i: number) => {
    onChange({ radiology_orders: prescription.radiology_orders.filter((_, idx) => idx !== i) });
  };

  const getSafetyBadge = (index: number) => {
    const meta = drugSafetyMeta.get(index);
    if (!meta) return null;
    if (meta.severity === "allergy_override") {
      return (
        <span title={meta.tooltip} className="inline-flex items-center gap-0.5 text-[9px] bg-red-100 text-destructive px-1.5 py-px rounded-full font-bold cursor-help">
          <ShieldX className="h-2.5 w-2.5" /> Override
        </span>
      );
    }
    return (
      <span title={meta.tooltip} className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-px rounded-full font-bold cursor-help">
        <AlertTriangle className="h-2.5 w-2.5" /> Interaction
      </span>
    );
  };

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Main prescription area */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Allergy Banner */}
        <AllergyBanner allergies={patientAllergies?.join(", ") || null} />

        {/* Safe flash */}
        {safeFlash && (
          <div className="flex-shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-1.5 flex items-center gap-2 animate-in fade-in duration-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs text-emerald-700 font-medium">✓ No interactions found</span>
          </div>
        )}

        {/* Prescription */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-bold text-foreground">Prescription</span>
            <button onClick={() => setShowAddDrug(true)} className="text-xs text-primary border border-primary px-2.5 py-1 rounded-md hover:bg-primary/5 flex items-center gap-1 transition-colors">
              <Plus className="h-3 w-3" /> Add Drug
            </button>
          </div>

          {prescription.drugs.map((drug, i) => (
            <div key={i} className="bg-muted/50 rounded-lg p-2.5 mb-1.5 relative group">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">{drug.drug_name}</span>
                {drug.is_ndps && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-px rounded-full font-bold">NDPS</span>}
                {getSafetyBadge(i)}
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                {[drug.dose, drug.route, drug.frequency, `${drug.duration_days}d`].filter(Boolean).map((v, j) => (
                  <span key={j} className="text-[11px] bg-muted text-muted-foreground px-2 py-px rounded">{v}</span>
                ))}
                {drug.quantity && (
                  <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-px rounded font-medium">Qty: {drug.quantity}</span>
                )}
              </div>
              {drug.instructions && <p className="text-xs text-muted-foreground italic mt-1">{drug.instructions}</p>}
              <button onClick={() => removeDrug(i)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}

          {showAddDrug && (
            <div className="border border-border rounded-lg p-3 mt-2 bg-background">
              <DrugMasterSearchInput
                value={searchQuery}
                hospitalId={hospitalId}
                onChange={(text) => { setSearchQuery(text); setNewDrug((d) => ({ ...d, drug_name: text })); }}
                onSelect={(r) => { setNewDrug((d) => ({ ...d, drug_name: r.drug_name, is_ndps: r.is_ndps })); setSearchQuery(r.drug_name); }}
                placeholder="Search drug name..."
                inputClassName="w-full h-9 px-3 border border-border rounded-lg text-sm outline-none focus:border-primary bg-background text-foreground"
              />
              <div className="grid grid-cols-4 gap-2 mt-2">
                <input
                  value={newDrug.dose}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, dose: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  placeholder="Dose"
                  className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                />
                <select value={newDrug.route} onChange={(e) => setNewDrug((d) => ({ ...d, route: e.target.value }))} className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground">
                  {routeOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <select
                  value={newDrug.frequency}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, frequency: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground"
                >
                  {frequencyOptions.map((f) => <option key={f.value} value={f.value}>{f.value}</option>)}
                </select>
                <input
                  value={newDrug.duration_days}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, duration_days: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  placeholder="Days"
                  className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                />
              </div>
              {/* Quantity row — auto-calculated, editable */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground font-medium w-16 flex-shrink-0">Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={newDrug.quantity}
                  onChange={(e) => setNewDrug((d) => ({ ...d, quantity: e.target.value }))}
                  placeholder="Auto"
                  className="w-24 h-8 px-2 border border-amber-300 bg-amber-50 rounded text-xs outline-none focus:border-amber-500 text-foreground font-semibold"
                />
                {newDrug.quantity && (
                  <span className="text-[11px] text-amber-700">
                    = {newDrug.dose || "?"} × {FREQ_PER_DAY[newDrug.frequency?.toUpperCase()] ?? 1}×/day × {newDrug.duration_days || "?"} days
                  </span>
                )}
              </div>
              <input value={newDrug.instructions} onChange={(e) => setNewDrug((d) => ({ ...d, instructions: e.target.value }))} placeholder="Instructions (e.g., Take after food)" className="w-full h-8 px-2 mt-2 border border-border rounded text-xs outline-none bg-background text-foreground" />
              {newDrug.is_ndps && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-[11px] text-amber-700">⚠️ NDPS Drug — Dual verification required before dispensing</div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  disabled={checking || !newDrug.drug_name}
                  onClick={() => { if (newDrug.drug_name) performSafetyCheck(newDrug); }}
                  className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {checking ? (
                    <>
                      <span className="h-3 w-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Checking safety...
                    </>
                  ) : (
                    "Add to Prescription"
                  )}
                </button>
                <button
                  onClick={saveNewDrugAsTemplate}
                  disabled={!newDrug.drug_name}
                  className="text-xs text-primary px-3 py-1.5 hover:underline disabled:opacity-50 disabled:no-underline flex items-center gap-1"
                  title="Save this drug as a reusable Quick Template"
                >
                  <Plus className="h-3 w-3" /> Save as template
                </button>
                <button onClick={() => { setShowAddDrug(false); setSearchQuery(""); }} className="text-xs text-muted-foreground px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}

          {/* Rx quick-pick templates */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-muted-foreground">Quick templates</span>
              <button
                onClick={() => setShowRxManager(v => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Pencil className="h-3 w-3" />
                {showRxManager ? "Done" : "Manage"}
              </button>
            </div>

            {rxLoading ? (
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} className="h-7 w-28 rounded-full bg-muted animate-pulse inline-block" />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {rxTemplates.map((t, idx) => (
                  <button
                    key={idx}
                    onClick={() => performSafetyCheck(templateToDrugEntry(t))}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-muted/50 border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {t.drug_name} {t.frequency} × {t.duration_days}d
                  </button>
                ))}
              </div>
            )}

            {showRxManager && !rxLoading && (
              <div className="mt-2 border border-border rounded-lg bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground/70">Manage Rx templates</p>

                {rxTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rxTemplates.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-background border border-border text-foreground/70">
                        {t.drug_name} {t.frequency}×{t.duration_days}d
                        <button
                          onClick={async () => {
                            const next = rxTemplates.filter((_, idx) => idx !== i);
                            await saveRx(next);
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {addingTemplate ? (
                  <div className="border border-border rounded-lg p-2.5 bg-background space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <DrugMasterSearchInput
                        value={newTemplate.drug_name}
                        hospitalId={hospitalId}
                        onChange={text => setNewTemplate(d => ({ ...d, drug_name: text }))}
                        onSelect={r => setNewTemplate(d => ({ ...d, drug_name: r.drug_name }))}
                        placeholder="Drug name"
                        className="col-span-2"
                        inputClassName="w-full h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <input
                        value={newTemplate.dose}
                        onChange={e => setNewTemplate(d => ({ ...d, dose: e.target.value }))}
                        placeholder="Dose"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <select
                        value={newTemplate.frequency}
                        onChange={e => setNewTemplate(d => ({ ...d, frequency: e.target.value }))}
                        className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground"
                      >
                        {frequencyOptions.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
                      </select>
                      <input
                        value={newTemplate.duration_days}
                        onChange={e => setNewTemplate(d => ({ ...d, duration_days: e.target.value }))}
                        placeholder="Days"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <input
                        value={newTemplate.quantity}
                        onChange={e => setNewTemplate(d => ({ ...d, quantity: e.target.value }))}
                        placeholder="Qty"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                    </div>
                    <input
                      value={newTemplate.instructions}
                      onChange={e => setNewTemplate(d => ({ ...d, instructions: e.target.value }))}
                      placeholder="Instructions (e.g., Take after food)"
                      className="w-full h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!newTemplate.drug_name}
                        onClick={async () => {
                          if (!newTemplate.drug_name) return;
                          await saveRx([...rxTemplates, newTemplate]);
                          setNewTemplate({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "" });
                          setAddingTemplate(false);
                        }}
                        className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium hover:bg-primary/90 disabled:opacity-50"
                      >
                        Save template
                      </button>
                      <button
                        onClick={() => setAddingTemplate(false)}
                        className="text-xs text-muted-foreground px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTemplate(true)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add template
                  </button>
                )}

                <button
                  onClick={resetRx}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Lab & Radiology */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground/70">Lab Orders</span>
                <button
                  onClick={() => setShowLabManager(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  {showLabManager ? "Done" : "My Tests"}
                </button>
              </div>

              {/* Doctor's quick lab templates */}
              {labTplLoading ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <span key={i} className="h-5 w-16 rounded-full bg-muted animate-pulse inline-block" />
                  ))}
                </div>
              ) : labTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {labTemplates.map(name => (
                    <button
                      key={name}
                      onClick={() => addLab(name)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                        prescription.lab_orders.some(l => l.test_name === name)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {showLabManager && !labTplLoading && (
                <QuickPickManagerPanel
                  items={labTemplates}
                  onSave={saveLabTpl}
                  onReset={resetLabTpl}
                  label="quick lab tests"
                />
              )}

              {/* Search input with autocomplete */}
              <div className="relative flex gap-1 mb-2">
                <div className="relative flex-1">
                  <input
                    value={labInput}
                    onChange={(e) => setLabInput(e.target.value)}
                    placeholder="Search test name..."
                    className="w-full h-7 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    onKeyDown={(e) => { if (e.key === "Enter") { addLab(labSuggestions[0] || labInput); setLabSuggestions([]); } if (e.key === "Escape") setLabSuggestions([]); }}
                  />
                  {labSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-7 bg-card border border-border rounded-lg shadow-lg max-h-36 overflow-y-auto">
                      {labSuggestions.map(name => (
                        <button key={name} onMouseDown={(e) => { e.preventDefault(); addLab(name); setLabInput(""); setLabSuggestions([]); }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-muted border-b border-border/40 last:border-b-0">
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { addLab(labSuggestions[0] || labInput); setLabSuggestions([]); }} className="text-xs bg-muted px-2 rounded hover:bg-muted/80">+</button>
              </div>
              {/* Panels / Groups */}
              {labGroups.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Panels</p>
                  <div className="flex flex-wrap gap-1">
                    {labGroups.map((g) => {
                      const done = isGroupFullyAdded(g);
                      return (
                        <button key={g.id} onClick={() => addLabGroup(g)}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                          )}>
                          {g.group_name}{g.fee > 0 && <span className="ml-1 opacity-60">₹{g.fee}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Individual tests from lab_test_master */}
              <div className="flex flex-wrap gap-1 mb-2 max-h-40 overflow-y-auto">
                {labMaster.map((name) => (
                  <button key={name} onClick={() => addLab(name)}
                    className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                      prescription.lab_orders.some(l => l.test_name === name)
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                    )}>
                    {name}
                  </button>
                ))}
              </div>
              {prescription.lab_orders.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Selected ({prescription.lab_orders.length})</span>
                    <div className="flex-1 border-t border-blue-200" />
                  </div>
                  <div className="space-y-1">
                    {prescription.lab_orders.map((l, i) => {
                      const isOrdered = orderedLabTests.has(l.test_name.toLowerCase());
                      return (
                        <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground/80">{l.test_name}</span>
                            {isOrdered && (
                              <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                                <CheckCircle2 size={10} /> BILLED & ORDERED
                              </span>
                            )}
                          </div>
                          <button onClick={() => removeLab(i)}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground/70">Radiology Orders</span>
                <button
                  onClick={() => setShowRadManager(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  {showRadManager ? "Done" : "My Studies"}
                </button>
              </div>

              {/* Doctor's quick radiology templates */}
              {radTplLoading ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className="h-5 w-20 rounded-full bg-muted animate-pulse inline-block" />
                  ))}
                </div>
              ) : radTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {radTemplates.map(name => (
                    <button
                      key={name}
                      onClick={() => addRad(name)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                        prescription.radiology_orders.some(r => r.study_name === name)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {showRadManager && !radTplLoading && (
                <QuickPickManagerPanel
                  items={radTemplates}
                  onSave={saveRadTpl}
                  onReset={resetRadTpl}
                  label="quick radiology studies"
                />
              )}

              {/* Search input with autocomplete */}
              <div className="relative flex gap-1 mb-2">
                <div className="relative flex-1">
                  <input
                    value={radInput}
                    onChange={(e) => setRadInput(e.target.value)}
                    placeholder="Search study name..."
                    className="w-full h-7 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    onKeyDown={(e) => { if (e.key === "Enter") { addRad(radSuggestions[0] || radInput); setRadSuggestions([]); } if (e.key === "Escape") setRadSuggestions([]); }}
                  />
                  {radSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-7 bg-card border border-border rounded-lg shadow-lg max-h-36 overflow-y-auto">
                      {radSuggestions.map(name => (
                        <button key={name} onMouseDown={(e) => { e.preventDefault(); addRad(name); setRadInput(""); setRadSuggestions([]); }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-muted border-b border-border/40 last:border-b-0">
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { addRad(radSuggestions[0] || radInput); setRadSuggestions([]); }} className="text-xs bg-muted px-2 rounded hover:bg-muted/80">+</button>
              </div>
              {/* All radiology modalities as chips */}
              <div className="flex flex-wrap gap-1 mb-2 max-h-40 overflow-y-auto">
                {radMaster.map((name) => (
                  <button key={name} onClick={() => addRad(name)}
                    className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                      prescription.radiology_orders.some(r => r.study_name === name)
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                    )}>
                    {name}
                  </button>
                ))}
              </div>
              {prescription.radiology_orders.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Selected ({prescription.radiology_orders.length})</span>
                    <div className="flex-1 border-t border-purple-200" />
                  </div>
                  <div className="space-y-1">
                    {prescription.radiology_orders.map((r, i) => {
                      const isOrdered = orderedRadStudies.has(r.study_name.toLowerCase());
                      return (
                        <div key={i} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded px-2 py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground/80">{r.study_name}</span>
                            {isOrdered && (
                              <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                                <CheckCircle2 size={10} /> BILLED & ORDERED
                              </span>
                            )}
                          </div>
                          <button onClick={() => removeRad(i)}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Plan, Follow-up & Advice */}
        {encounter && onEncounterChange && (
          <div className="border-t border-border p-4 space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">Plan &amp; Investigations</label>
              <textarea
                value={encounter.soap_plan}
                onChange={(e) => onEncounterChange({ soap_plan: e.target.value })}
                placeholder="Management plan, investigations advised, referrals..."
                className="w-full min-h-[70px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">Advice &amp; Instructions</label>
              <textarea
                value={prescription.advice_notes}
                onChange={(e) => onChange({ advice_notes: e.target.value })}
                placeholder="Advice and instructions for the patient..."
                className="w-full min-h-[60px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 mb-1 block">Follow-up</label>
                <input
                  type="text"
                  value={encounter.follow_up_notes}
                  onChange={(e) => onEncounterChange({ follow_up_notes: e.target.value })}
                  placeholder="e.g. Follow up with MRI report"
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#1A2F5A]"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 mb-1 block">Review date</label>
                <input
                  type="date"
                  value={prescription.review_date}
                  onChange={(e) => onChange({ review_date: e.target.value })}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#1A2F5A]"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action button if onCommit is provided */}
      {onCommit && (
        <div className="absolute bottom-4 right-[280px] z-10">
          <button
            onClick={onCommit}
            disabled={isSaving || (prescription.drugs.length === 0 && prescription.lab_orders.length === 0 && prescription.radiology_orders.length === 0)}
            className="flex items-center gap-2 bg-[#10B981] text-white px-6 py-2.5 rounded-lg shadow-lg hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all transform hover:scale-105 active:scale-95"
          >
            {isSaving ? (
              <span className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Committing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 size={18} /> Commit to IPD Record
              </span>
            )}
          </button>
        </div>
      )}

      {/* Safety alert modal */}
      {showSafetyModal && safetyResult && pendingDrug && (
        <DrugSafetyAlertModal
          open={showSafetyModal}
          drugName={pendingDrug.drug_name}
          result={safetyResult}
          hospitalId={hospitalId ?? undefined}
          onClose={handleSafetyClose}
          onAddAnyway={handleSafetyAddAnyway}
          onOverride={handleSafetyOverride}
        />
      )}

      {pendingDrug && (
        <AntibioticJustificationModal
          open={showAntibioticModal}
          drugName={pendingDrug.drug_name}
          hospitalId={hospitalId ?? ""}
          onSaved={() => {
            setShowAntibioticModal(false);
            setAntibioticJustified(true);
            if (pendingDrug) performSafetyCheck(pendingDrug);
          }}
          onCancel={() => { setShowAntibioticModal(false); setPendingDrug(null); }}
        />
      )}
    </div>
  );
};

export default RxOrdersTab;
