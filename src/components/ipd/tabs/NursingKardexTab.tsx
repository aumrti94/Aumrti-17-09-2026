import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOfflineWrite } from "@/contexts/OfflineSyncContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Pill, Plus, X, Activity, ClipboardList, CheckCircle2 } from "lucide-react";
import IPDDeviceTab from "./IPDDeviceTab";
import IOChartTab from "@/components/nursing/IOChartTab";
import { calculateNEWS2, getNEWS2BadgeClasses } from "@/lib/news2";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId?: string;
}

interface NursingVital {
  id: string;
  recorded_at: string;
  shift: string;
  temperature: number | null;
  pulse: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  weight: number | null;
  pain_score: number | null;
  urine_output_ml: number | null;
  intake_oral_ml: number | null;
  intake_iv_ml: number | null;
  gcs_total: number | null;
  mews_score: number | null;
  news2_score: number | null;
  on_supplemental_o2: boolean | null;
  notes: string | null;
}

interface MARRecord {
  id: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string | null;
  scheduled_time: string;
  administered_at: string | null;
  status: string;
  omission_reason: string | null;
  notes: string | null;
}

interface DeviceRecord {
  id: string;
  device_type: string;
  device_inserted_at: string;
  device_removed_at: string | null;
  insertion_site: string | null;
  notes: string | null;
  inserted_by: string | null;
}

interface DeviceThresholds {
  central_line: number;
  peripheral_line: number;
  urinary_catheter: number;
  ventilator: number;
  tracheostomy: number;
  [key: string]: number;
}

const DEFAULT_DEVICE_THRESHOLDS: DeviceThresholds = {
  central_line: 7,
  peripheral_line: 10,
  urinary_catheter: 7,
  ventilator: 14,
  tracheostomy: 30,
};

const DEVICE_LABELS: Record<string, string> = {
  central_line: "Central Line",
  peripheral_line: "Peripheral Line",
  urinary_catheter: "Urinary Catheter",
  ventilator: "Ventilator",
  tracheostomy: "Tracheostomy",
  others: "Other Device",
};

const DEVICE_TYPES = Object.entries(DEVICE_LABELS).map(([value, label]) => ({ value, label }));

// Bundle checklist items per device type (daily maintenance bundle)
const BUNDLE_ITEMS: Record<string, { key: string; label: string }[]> = {
  central_line: [
    { key: "hand_hygiene",        label: "Hand hygiene performed before access" },
    { key: "max_barrier",         label: "Maximum sterile barrier precautions maintained" },
    { key: "chlorhexidine",       label: "Chlorhexidine skin antisepsis applied" },
    { key: "optimal_site",        label: "Catheter at optimal site (femoral avoided)" },
    { key: "unnecessary_removed", label: "Necessity reviewed — central line still required" },
  ],
  urinary_catheter: [
    { key: "hand_hygiene",          label: "Hand hygiene performed" },
    { key: "perineal_care",         label: "Perineal care performed today" },
    { key: "drainage_unobstructed", label: "Drainage bag unobstructed and below bladder level" },
    { key: "catheter_secured",      label: "Catheter properly secured to prevent traction" },
  ],
  ventilator: [
    { key: "hand_hygiene",      label: "Hand hygiene performed" },
    { key: "hob_elevation",     label: "Head of bed elevated 30–45°" },
    { key: "oral_care",         label: "Oral care with chlorhexidine performed" },
    { key: "sedation_vacation", label: "Sedation vacation assessed / SAT performed" },
    { key: "cuff_pressure",     label: "Cuff pressure checked (20–30 cmH₂O)" },
  ],
  peripheral_line: [
    { key: "hand_hygiene",        label: "Hand hygiene performed" },
    { key: "site_inspection",     label: "Insertion site checked — no signs of phlebitis" },
    { key: "dressing_intact",     label: "Dressing clean, dry, and intact" },
    { key: "necessity_reviewed",  label: "Necessity reviewed — peripheral line still required" },
  ],
  tracheostomy: [
    { key: "hand_hygiene",    label: "Hand hygiene performed" },
    { key: "stoma_care",      label: "Stoma site assessed and cared for" },
    { key: "inner_cannula",   label: "Inner cannula cleaned or replaced" },
    { key: "ties_secure",     label: "Tracheostomy ties secure (1-finger space)" },
  ],
  others: [
    { key: "hand_hygiene",       label: "Hand hygiene performed" },
    { key: "site_care",          label: "Device site assessed and cared for" },
    { key: "necessity_reviewed", label: "Necessity reviewed — device still required" },
  ],
};

function deviceChipBase(type: string): string {
  switch (type) {
    case "central_line": return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300";
    case "peripheral_line": return "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "urinary_catheter": return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300";
    case "ventilator": return "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300";
    case "tracheostomy": return "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300";
    default: return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300";
  }
}

function deviceDays(insertedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(insertedAt).getTime()) / 86_400_000));
}

function nowDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const SHIFTS = [
  { value: "morning", label: "Morning (06–14h)" },
  { value: "afternoon", label: "Afternoon (14–20h)" },
  { value: "evening", label: "Evening (20–24h)" },
  { value: "night", label: "Night (00–06h)" },
];

const OMISSION_REASONS = [
  "Patient refused",
  "Patient nil by mouth (NBM)",
  "Drug unavailable",
  "Doctor hold order",
  "Allergic reaction observed",
  "Patient asleep / unresponsive",
  "Vomiting / unable to swallow",
  "IV access unavailable",
  "Other",
];

const ROUTE_LABELS: Record<string, string> = {
  oral: "PO", iv: "IV", im: "IM", sc: "SC",
  topical: "Top", inhalation: "Inh", rectal: "PR", other: "Other",
};

function calculateMEWS(v: {
  respiratory_rate?: number | null;
  pulse?: number | null;
  bp_systolic?: number | null;
  temperature?: number | null;
  gcs_total?: number | null;
}): number {
  let s = 0;
  const rr = v.respiratory_rate;
  if (rr != null) {
    if (rr <= 8) s += 3;
    else if (rr <= 14) s += 0;
    else if (rr <= 20) s += 1;
    else if (rr <= 29) s += 2;
    else s += 3;
  }
  const hr = v.pulse;
  if (hr != null) {
    if (hr <= 40) s += 2;
    else if (hr <= 50) s += 1;
    else if (hr <= 100) s += 0;
    else if (hr <= 110) s += 1;
    else if (hr <= 129) s += 2;
    else s += 3;
  }
  const sbp = v.bp_systolic;
  if (sbp != null) {
    if (sbp <= 70) s += 3;
    else if (sbp <= 80) s += 2;
    else if (sbp <= 100) s += 1;
    else if (sbp <= 199) s += 0;
    else s += 2;
  }
  const t = v.temperature;
  if (t != null) {
    if (t < 35.0) s += 2;
    else if (t <= 36.0) s += 1;
    else if (t <= 38.0) s += 0;
    else if (t <= 38.5) s += 1;
    else s += 2;
  }
  const gcs = v.gcs_total;
  if (gcs != null) {
    if (gcs >= 15) s += 0;
    else if (gcs >= 10) s += 1;
    else if (gcs >= 5) s += 2;
    else s += 3;
  }
  return s;
}

function mewsBadge(score: number | null) {
  if (score == null) return null;
  if (score >= 5) return "bg-red-100 text-red-700 font-bold";
  if (score >= 3) return "bg-amber-100 text-amber-700 font-semibold";
  return "bg-green-100 text-green-700";
}

function getScheduledTimes(frequency: string): string[] {
  const f = (frequency || "").toUpperCase().trim();
  if (f === "OD" || f === "QD" || f.includes("ONCE")) return ["08:00"];
  if (f === "BD" || f === "BID" || f.includes("TWICE")) return ["08:00", "20:00"];
  if (f === "TDS" || f === "TID" || f.includes("THRICE")) return ["08:00", "14:00", "20:00"];
  if (f === "QID" || f.includes("FOUR")) return ["06:00", "12:00", "18:00", "22:00"];
  if (f.includes("Q6") || f.includes("6H")) return ["06:00", "12:00", "18:00", "00:00"];
  if (f.includes("Q8") || f.includes("8H")) return ["06:00", "14:00", "22:00"];
  if (f.includes("Q12") || f.includes("12H")) return ["08:00", "20:00"];
  if (f === "SOS" || f === "PRN" || f.includes("NEEDED")) return [];
  return ["08:00"];
}

const emptyForm = {
  shift: "", temperature: "", pulse: "", bp_s: "", bp_d: "",
  spo2: "", rr: "", weight: "", pain: "", urine: "", oral: "", iv: "", gcs: "", notes: "",
};

const emptyO2 = false;
const emptyAddDevice = { device_type: "", insertion_site: "", inserted_at: "" };

const NursingKardexTab: React.FC<Props> = ({ admissionId, hospitalId, userId, patientId }) => {
  const { write: offlineWrite, isOnline } = useOfflineWrite();
  const [subTab, setSubTab] = useState("vitals");

  // Vitals state
  const [vitals, setVitals] = useState<NursingVital[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [o2, setO2] = useState(emptyO2);
  const [saving, setSaving] = useState(false);

  // MAR state
  const [marRecords, setMarRecords] = useState<MARRecord[]>([]);
  const [generatingMAR, setGeneratingMAR] = useState(false);
  const [omitTarget, setOmitTarget] = useState<string | null>(null);
  const [omitReason, setOmitReason] = useState("");

  // Devices state
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [thresholds, setThresholds] = useState<DeviceThresholds>(DEFAULT_DEVICE_THRESHOLDS);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addDeviceForm, setAddDeviceForm] = useState(emptyAddDevice);
  const [savingDevice, setSavingDevice] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Bundle check state
  const [todayBundles, setTodayBundles] = useState<Record<string, { compliance_pct: number; checklist_id: string }>>({});
  const [bundleModalDevice, setBundleModalDevice] = useState<DeviceRecord | null>(null);
  const [bundleAnswers, setBundleAnswers] = useState<Record<string, boolean | null>>({});
  const [savingBundle, setSavingBundle] = useState(false);

  // ── Vitals fetching ──────────────────────────────────────────────────────
  const fetchVitals = useCallback(async () => {
    if (!admissionId) return;
    const { data } = await (supabase as any)
      .from("nursing_vitals")
      .select("*")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false })
      .limit(28);
    setVitals(data || []);
  }, [admissionId]);

  // ── MAR fetching ─────────────────────────────────────────────────────────
  // nursing_mar is the canonical MAR table (Phase 2 of the nursing completion plan) — joined to
  // ipd_medications to denormalize drug_name/dose/route for display, matching the shape this
  // tab's UI already expects.
  const fetchMAR = useCallback(async () => {
    if (!admissionId) return;
    const { data } = await (supabase as any)
      .from("nursing_mar")
      .select("id, scheduled_date, scheduled_time, administered_at, outcome, omission_reason, ipd_medications(drug_name, dose, route, frequency)")
      .eq("admission_id", admissionId)
      .order("scheduled_date", { ascending: true })
      .order("scheduled_time", { ascending: true });
    const mapped: MARRecord[] = (data || []).map((r: any) => ({
      id: r.id,
      drug_name: r.ipd_medications?.drug_name || "—",
      dose: r.ipd_medications?.dose || "",
      route: r.ipd_medications?.route || "",
      frequency: r.ipd_medications?.frequency ?? null,
      scheduled_time: `${r.scheduled_date}T${r.scheduled_time}`,
      administered_at: r.administered_at,
      status: r.outcome,
      omission_reason: r.omission_reason,
      notes: null,
    }));
    setMarRecords(mapped);
  }, [admissionId]);

  // ── Devices fetching ─────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    if (!admissionId) return;
    setDevicesLoading(true);
    const { data } = await (supabase as any)
      .from("ipc_device_usage")
      .select("id,device_type,device_inserted_at,device_removed_at,insertion_site,notes,inserted_by")
      .eq("admission_id", admissionId)
      .is("device_removed_at", null)
      .order("device_inserted_at", { ascending: true });
    setDevices(data || []);
    setDevicesLoading(false);
  }, [admissionId]);

  // ── Threshold fetching ───────────────────────────────────────────────────
  const fetchThresholds = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("hospital_settings")
      .select("value")
      .eq("hospital_id", hospitalId)
      .eq("key", "device_thresholds")
      .maybeSingle();
    if (data?.value) setThresholds({ ...DEFAULT_DEVICE_THRESHOLDS, ...data.value });
  }, [hospitalId]);

  // ── Today's bundle compliance fetching ───────────────────────────────────
  const fetchTodayBundles = useCallback(async () => {
    if (!admissionId) return;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await (supabase as any)
      .from("ipc_bundle_checklists")
      .select("id,device_usage_id,compliance_pct")
      .eq("admission_id", admissionId)
      .eq("checklist_date", today)
      .order("created_at", { ascending: false })
      .limit(50);
    // Keep only the latest check per device_usage_id
    const map: Record<string, { compliance_pct: number; checklist_id: string }> = {};
    for (const row of (data || [])) {
      if (row.device_usage_id && !map[row.device_usage_id]) {
        map[row.device_usage_id] = { compliance_pct: row.compliance_pct ?? 0, checklist_id: row.id };
      }
    }
    setTodayBundles(map);
  }, [admissionId]);

  useEffect(() => { fetchVitals(); }, [fetchVitals]);
  useEffect(() => { fetchMAR(); }, [fetchMAR]);
  useEffect(() => { fetchDevices(); }, [fetchDevices]);
  useEffect(() => { fetchThresholds(); }, [fetchThresholds]);
  useEffect(() => { fetchTodayBundles(); }, [fetchTodayBundles]);

  // Auto-detect shift based on current time
  useEffect(() => {
    const h = new Date().getHours();
    let shift = "morning";
    if (h >= 6 && h < 14) shift = "morning";
    else if (h >= 14 && h < 20) shift = "afternoon";
    else if (h >= 20) shift = "evening";
    else shift = "night";
    setForm((prev) => ({ ...prev, shift }));
  }, []);

  // ── Vitals handlers ──────────────────────────────────────────────────────
  const handleSaveVitals = async () => {
    if (!hospitalId || !patientId) return;
    if (!form.shift) {
      toast({ title: "Select shift", variant: "destructive" });
      return;
    }

    const n = (v: string) => (v ? Number(v) : null);
    const rr = n(form.rr);
    const spo2 = n(form.spo2);
    const sbp = n(form.bp_s);
    const hr = n(form.pulse);
    const temp = n(form.temperature);
    const gcs = n(form.gcs);

    const vitalsPayload = { respiratory_rate: rr, pulse: hr, bp_systolic: sbp, temperature: temp, gcs_total: gcs };
    const mewsScore = calculateMEWS(vitalsPayload);

    let news2Score: number | null = null;
    if (rr !== null && spo2 !== null && sbp !== null && hr !== null && temp !== null) {
      news2Score = calculateNEWS2({
        respiratory_rate: rr,
        spo2,
        on_supplemental_o2: o2,
        systolic_bp: sbp,
        heart_rate: hr,
        consciousness: (gcs === null || gcs >= 15) ? "A" : "C",
        temperature: temp,
      });
    }

    setSaving(true);
    try {
      await offlineWrite({
        table: "nursing_vitals",
        operation: "insert",
        data: {
          hospital_id: hospitalId,
          admission_id: admissionId,
          patient_id: patientId,
          recorded_by: userId || null,
          shift: form.shift,
          temperature: temp,
          pulse: hr,
          bp_systolic: sbp,
          bp_diastolic: n(form.bp_d),
          spo2,
          respiratory_rate: rr,
          weight: n(form.weight),
          pain_score: n(form.pain),
          urine_output_ml: n(form.urine),
          intake_oral_ml: n(form.oral),
          intake_iv_ml: n(form.iv),
          gcs_total: gcs,
          mews_score: mewsScore,
          news2_score: news2Score,
          on_supplemental_o2: o2,
          notes: form.notes || null,
        },
      });
    } catch (err: any) {
      setSaving(false);
      toast({ title: "Error saving vitals", description: err.message, variant: "destructive" });
      return;
    }
    setSaving(false);

    // Persist an escalation alert on a high score — previously this only showed a local toast,
    // so an elevated MEWS/NEWS2 recorded here never reached the clinical_alerts feed nurses
    // monitor elsewhere (nursing module completion plan, Phase 3).
    if (mewsScore >= 5 || (news2Score !== null && news2Score >= 5)) {
      const scoreLabel = news2Score !== null ? `NEWS2 ${news2Score} / MEWS ${mewsScore}` : `MEWS ${mewsScore}`;
      try {
        await offlineWrite({
          table: "clinical_alerts",
          operation: "insert",
          data: {
            hospital_id: hospitalId,
            patient_id: patientId,
            alert_type: "high_news2",
            severity: (news2Score !== null && news2Score >= 7) || mewsScore >= 7 ? "critical" : "high",
            alert_message: `Elevated early-warning score (${scoreLabel}) recorded via Nursing Kardex — clinical review required.`,
          },
        });
      } catch {
        // Best-effort — vitals were already saved successfully above; don't block on alert delivery.
      }
    }

    const news2Label = news2Score !== null ? ` · NEWS2: ${news2Score}` : "";
    const offlineNote = isOnline ? "" : " (queued — will sync when online)";
    toast({ title: `Vitals recorded — MEWS: ${mewsScore}${news2Label}${mewsScore >= 5 ? " ⚠️ Escalate!" : ""}${offlineNote}` });
    setForm(emptyForm);
    setO2(emptyO2);
    if (isOnline) fetchVitals();
  };

  // ── MAR handlers ─────────────────────────────────────────────────────────
  const handleMarkGiven = async (recordId: string) => {
    await (supabase as any).from("nursing_mar").update({
      outcome: "given",
      administered_at: new Date().toISOString(),
      administered_by: userId || null,
    }).eq("id", recordId);
    toast({ title: "Marked as given" });
    fetchMAR();
  };

  const handleMarkOmitted = async () => {
    if (!omitTarget || !omitReason) return;
    await (supabase as any).from("nursing_mar").update({
      outcome: "omitted",
      omission_reason: omitReason,
    }).eq("id", omitTarget);
    toast({ title: "Marked as omitted" });
    setOmitTarget(null);
    setOmitReason("");
    fetchMAR();
  };

  const handleGenerateMAR = async () => {
    if (!hospitalId || !patientId) return;
    setGeneratingMAR(true);

    const { data: meds } = await (supabase as any)
      .from("ipd_medications")
      .select("id, drug_name, dose, route, frequency")
      .eq("admission_id", admissionId)
      .eq("is_active", true);

    if (!meds || meds.length === 0) {
      toast({ title: "No active medications found", description: "Add medications in the Medications tab first." });
      setGeneratingMAR(false);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const records: any[] = [];

    for (const med of meds) {
      const times = getScheduledTimes(med.frequency || "");
      for (const time of times) {
        records.push({
          hospital_id: hospitalId,
          admission_id: admissionId,
          medication_id: med.id,
          scheduled_date: today,
          scheduled_time: `${time}:00`,
          outcome: "pending",
          five_rights_verified: false,
        });
      }
    }

    if (records.length === 0) {
      toast({ title: "No scheduled doses to generate", description: "Check medication frequencies (SOS/PRN drugs are not scheduled)." });
      setGeneratingMAR(false);
      return;
    }

    // Pre-generating the day's dose checklist can tolerate requiring connectivity (unlike
    // actually marking a dose given/omitted, which stays instant above) — this needs a direct
    // batch upsert with dedupe against the nursing_mar unique constraint, which
    // useOfflineWrite's insert-only API doesn't support.
    const { error } = await (supabase as any)
      .from("nursing_mar")
      .upsert(records, { onConflict: "admission_id,medication_id,scheduled_date,scheduled_time", ignoreDuplicates: true });

    setGeneratingMAR(false);
    if (error) {
      toast({ title: "Error generating MAR", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: `MAR generated — ${records.length} dose(s) scheduled for today` });
    fetchMAR();
  };

  // ── Device handlers ──────────────────────────────────────────────────────
  const handleAddDevice = async () => {
    if (!hospitalId || !patientId || !addDeviceForm.device_type) {
      toast({ title: "Device type is required", variant: "destructive" });
      return;
    }
    setSavingDevice(true);
    const insertedAt = addDeviceForm.inserted_at
      ? new Date(addDeviceForm.inserted_at).toISOString()
      : new Date().toISOString();

    try {
      await offlineWrite({
        table: "ipc_device_usage",
        operation: "insert",
        data: {
          hospital_id: hospitalId,
          admission_id: admissionId,
          patient_id: patientId,
          device_type: addDeviceForm.device_type,
          insertion_site: addDeviceForm.insertion_site || null,
          device_inserted_at: insertedAt,
          inserted_by: userId || null,
        },
      });
    } catch (err: any) {
      setSavingDevice(false);
      toast({ title: "Error adding device", description: err.message, variant: "destructive" });
      return;
    }
    setSavingDevice(false);

    toast({ title: `${DEVICE_LABELS[addDeviceForm.device_type] || "Device"} recorded` });
    setShowAddDevice(false);
    setAddDeviceForm(emptyAddDevice);
    fetchDevices();
  };

  const handleRemoveDevice = async (id: string, type: string) => {
    setRemovingId(id);
    const { error } = await (supabase as any)
      .from("ipc_device_usage")
      .update({ device_removed_at: new Date().toISOString(), removed_by: userId || null })
      .eq("id", id);
    setRemovingId(null);
    if (error) {
      toast({ title: "Error removing device", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${DEVICE_LABELS[type] || "Device"} marked as removed` });
    fetchDevices();
  };

  // ── Bundle check handler ─────────────────────────────────────────────────
  const handleSaveBundle = async () => {
    if (!hospitalId || !patientId || !bundleModalDevice) return;
    setSavingBundle(true);

    const items = BUNDLE_ITEMS[bundleModalDevice.device_type] || BUNDLE_ITEMS.others;
    const yesCount = items.filter(i => bundleAnswers[i.key] === true).length;
    // compliance_pct = yes answers / total items × 100 (unanswered = non-compliant)
    const compliancePct = Math.round((yesCount / items.length) * 100);

    const elements: Record<string, boolean | null> = {};
    items.forEach(i => { elements[i.key] = bundleAnswers[i.key] ?? null; });

    const { error } = await (supabase as any).from("ipc_bundle_checklists").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      device_usage_id: bundleModalDevice.id,
      device_type: bundleModalDevice.device_type,
      bundle_type: "maintenance",
      checklist_date: new Date().toISOString().split("T")[0],
      completed_by: userId || null,
      elements,
      compliance_pct: compliancePct,
    });

    setSavingBundle(false);
    if (error) {
      toast({ title: "Error saving bundle check", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: `Bundle check saved — ${compliancePct}%`,
      description: compliancePct < 100 ? "One or more items were not compliant — review with care team." : "Full bundle compliance achieved.",
    });
    setBundleModalDevice(null);
    setBundleAnswers({});
    fetchTodayBundles();
  };

  // ── Vitals helpers ───────────────────────────────────────────────────────
  function cellClass(field: string, value: number | null): string {
    if (value == null) return "";
    if (field === "spo2" && value < 90) return "text-red-700 font-bold";
    if (field === "temperature" && value > 38.5) return "text-red-700 font-bold";
    if (field === "pulse" && (value < 50 || value > 120)) return "text-red-700 font-bold";
    if (field === "bp_s" && (value > 160 || value < 90)) return "text-amber-700 font-semibold";
    return "";
  }

  const previewMews = calculateMEWS({
    respiratory_rate: form.rr ? Number(form.rr) : null,
    pulse: form.pulse ? Number(form.pulse) : null,
    bp_systolic: form.bp_s ? Number(form.bp_s) : null,
    temperature: form.temperature ? Number(form.temperature) : null,
    gcs_total: form.gcs ? Number(form.gcs) : null,
  });

  // ── MAR helpers ──────────────────────────────────────────────────────────
  const marByDate = marRecords.reduce<Record<string, MARRecord[]>>((acc, r) => {
    const date = r.scheduled_time.slice(0, 10);
    if (!acc[date]) acc[date] = [];
    acc[date].push(r);
    return acc;
  }, {});

  const statusColors: Record<string, string> = {
    given: "bg-green-100 text-green-700",
    omitted: "bg-red-100 text-red-700",
    refused: "bg-red-100 text-red-700",
    held: "bg-amber-100 text-amber-700",
    pending: "",
  };

  function marStatusColor(r: MARRecord): string {
    if (r.status === "given") return "bg-green-100 text-green-700 border-green-200";
    if (r.status === "omitted" || r.status === "refused") return "bg-red-50 text-red-700 border-red-200";
    if (r.status === "held") return "bg-amber-50 text-amber-700 border-amber-200";
    const scheduledMs = new Date(r.scheduled_time).getTime();
    const nowMs = Date.now();
    if (nowMs > scheduledMs + 30 * 60 * 1000) return "bg-orange-50 text-orange-700 border-orange-200";
    if (scheduledMs > nowMs) return "bg-slate-50 text-slate-500 border-slate-200";
    return "bg-amber-50 text-amber-700 border-amber-200";
  }

  const f = (k: string) => (v: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: v.target.value }));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={subTab} onValueChange={setSubTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-9 rounded-none border-b bg-muted/30 px-3 gap-1 justify-start">
          <TabsTrigger value="vitals" className="text-xs h-7">📊 Vitals Chart</TabsTrigger>
          <TabsTrigger value="mar" className="text-xs h-7">💊 Medication Administration</TabsTrigger>
          <TabsTrigger value="devices" className="text-xs h-7">🩺 Devices</TabsTrigger>
          <TabsTrigger value="io_chart" className="text-xs h-7">💧 I/O Chart</TabsTrigger>
        </TabsList>

        {/* ── VITALS SUB-TAB ── */}
        <TabsContent value="vitals" className="flex-1 overflow-auto m-0 p-3 space-y-4">
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Record Vitals</p>
              {(form.rr || form.pulse || form.bp_s) && (
                <span className={cn("text-[11px] px-2 py-0.5 rounded-full", mewsBadge(previewMews) || "bg-muted text-muted-foreground")}>
                  MEWS: {previewMews}
                  {previewMews >= 5 && " ⚠️"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-muted-foreground">Shift *</label>
                <Select value={form.shift} onValueChange={(v) => setForm((p) => ({ ...p, shift: v }))}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Select shift" /></SelectTrigger>
                  <SelectContent>
                    {SHIFTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-muted-foreground">Notes</label>
                <Input value={form.notes} onChange={f("notes")} className="h-8 text-xs mt-0.5" placeholder="Nursing observations…" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { k: "temperature", l: "Temp (°C)", placeholder: "37.0" },
                { k: "pulse", l: "Pulse (bpm)", placeholder: "72" },
                { k: "bp_s", l: "BP Sys (mmHg)", placeholder: "120" },
                { k: "bp_d", l: "BP Dia (mmHg)", placeholder: "80" },
                { k: "spo2", l: "SpO₂ (%)", placeholder: "98" },
                { k: "rr", l: "RR (/min)", placeholder: "16" },
                { k: "gcs", l: "GCS Total", placeholder: "15" },
                { k: "pain", l: "Pain (0–10)", placeholder: "0" },
              ].map(({ k, l, placeholder }) => (
                <div key={k}>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">{l}</label>
                  <Input
                    type="number"
                    value={(form as any)[k]}
                    onChange={f(k)}
                    className="h-8 text-xs mt-0.5"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="o2-check"
                checked={o2}
                onChange={e => setO2(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="o2-check" className="text-[11px] font-medium cursor-pointer select-none">
                Patient on supplemental O₂ (affects NEWS2 SpO₂ scoring)
              </label>
            </div>

            <div className="border-t border-border pt-2 mb-3">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Fluid Balance</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: "urine", l: "Urine Output (ml)" },
                  { k: "oral", l: "Oral Intake (ml)" },
                  { k: "iv", l: "IV Intake (ml)" },
                  { k: "weight", l: "Weight (kg)" },
                ].map(({ k, l }) => (
                  <div key={k}>
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">{l}</label>
                    <Input type="number" value={(form as any)[k]} onChange={f(k)} className="h-8 text-xs mt-0.5" />
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSaveVitals} disabled={saving || !form.shift} size="sm" className="w-full h-8 text-xs">
              {saving ? "Saving…" : "Save Vitals Entry"}
            </Button>
          </div>

          {vitals.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase text-muted-foreground">Vitals History (last 28 entries)</p>
                <button onClick={fetchVitals} className="text-muted-foreground hover:text-foreground">
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-muted-foreground whitespace-nowrap">Date / Shift</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">Temp</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">Pulse</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">BP</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">SpO₂</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">RR</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">GCS</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">Pain</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">Urine</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">MEWS</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-muted-foreground">NEWS2</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitals.map((v) => (
                      <tr key={v.id} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <p className="font-medium text-foreground">
                            {new Date(v.recorded_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </p>
                          <p className="text-[10px] text-muted-foreground capitalize">{v.shift}</p>
                        </td>
                        <td className={cn("px-2 py-1.5 text-center", cellClass("temperature", v.temperature))}>
                          {v.temperature ?? "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 text-center", cellClass("pulse", v.pulse))}>
                          {v.pulse ?? "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 text-center", cellClass("bp_s", v.bp_systolic))}>
                          {v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 text-center", cellClass("spo2", v.spo2))}>
                          {v.spo2 != null ? `${v.spo2}%` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center text-foreground">{v.respiratory_rate ?? "—"}</td>
                        <td className="px-2 py-1.5 text-center text-foreground">{v.gcs_total ?? "—"}</td>
                        <td className="px-2 py-1.5 text-center text-foreground">{v.pain_score ?? "—"}</td>
                        <td className="px-2 py-1.5 text-center text-foreground">{v.urine_output_ml != null ? `${v.urine_output_ml}ml` : "—"}</td>
                        <td className="px-2 py-1.5 text-center">
                          {v.mews_score != null ? (
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", mewsBadge(v.mews_score))}>
                              {v.mews_score}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {v.news2_score != null ? (
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", getNEWS2BadgeClasses(v.news2_score))}>
                              {v.news2_score}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground max-w-[120px] truncate">{v.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {vitals.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No vitals recorded yet. Use the form above to add the first entry.
            </div>
          )}
        </TabsContent>

        {/* ── MAR SUB-TAB ── */}
        <TabsContent value="mar" className="flex-1 overflow-auto m-0 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">
              Medication Administration Record
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={fetchMAR}>
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleGenerateMAR} disabled={generatingMAR}>
                <Pill className="h-3 w-3" />
                {generatingMAR ? "Generating…" : "Generate Today's MAR"}
              </Button>
            </div>
          </div>

          {Object.keys(marByDate).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm space-y-2">
              <p className="text-2xl">💊</p>
              <p className="font-medium">No MAR records found</p>
              <p className="text-xs">Click "Generate Today's MAR" to create scheduled doses from active medications.</p>
            </div>
          ) : (
            Object.entries(marByDate)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, records]) => (
                <div key={date} className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 flex items-center justify-between">
                    <p className="text-xs font-bold text-foreground">
                      {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span className="text-green-600 font-medium">{records.filter((r) => r.status === "given").length} given</span>
                      <span className="text-red-600 font-medium">{records.filter((r) => r.status === "omitted" || r.status === "refused").length} omitted</span>
                      <span className="text-amber-600 font-medium">{records.filter((r) => r.status === "pending").length} pending</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {records.map((r) => {
                      const scheduledTime = new Date(r.scheduled_time);
                      const isOverdue = r.status === "pending" && Date.now() > scheduledTime.getTime() + 30 * 60 * 1000;

                      return (
                        <div key={r.id} className={cn("px-3 py-2 flex items-center gap-3", marStatusColor(r))}>
                          <div className="w-12 text-center flex-shrink-0">
                            <p className="text-[11px] font-bold">
                              {scheduledTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                            </p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{r.drug_name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {r.dose} · {ROUTE_LABELS[r.route] || r.route}
                              {r.frequency && ` · ${r.frequency}`}
                            </p>
                            {r.status === "omitted" && r.omission_reason && (
                              <p className="text-[10px] text-red-600 mt-0.5">Omitted: {r.omission_reason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium",
                              statusColors[r.status] || "bg-muted text-muted-foreground"
                            )}>
                              {r.status === "given" ? `Given ${r.administered_at ? new Date(r.administered_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}` : r.status}
                              {isOverdue && r.status === "pending" && " ⚠️ Overdue"}
                            </span>
                            {r.status === "pending" && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => handleMarkGiven(r.id)}
                                >
                                  ✓ Given
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[10px] px-2 border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() => { setOmitTarget(r.id); setOmitReason(""); }}
                                >
                                  ✕ Omit
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
          )}

          {omitTarget && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setOmitTarget(null)}>
              <div className="bg-card rounded-lg shadow-xl p-4 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
                <p className="text-sm font-bold">Omission Reason *</p>
                <Select value={omitReason} onValueChange={setOmitReason}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select reason…" /></SelectTrigger>
                  <SelectContent>
                    {OMISSION_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setOmitTarget(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    disabled={!omitReason}
                    onClick={handleMarkOmitted}
                  >
                    Confirm Omit
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── DEVICES SUB-TAB (uses IPDDeviceTab — same as IPC/Devices) ── */}
        <TabsContent value="devices" className="h-full m-0">
          <IPDDeviceTab
            admissionId={admissionId}
            hospitalId={hospitalId}
            userId={userId}
            patientId={patientId}
          />
        </TabsContent>

        {/* ── I/O CHART SUB-TAB ── */}
        <TabsContent value="io_chart" className="h-full overflow-auto m-0">
          <IOChartTab
            admissionId={admissionId}
            hospitalId={hospitalId ?? ""}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NursingKardexTab;
