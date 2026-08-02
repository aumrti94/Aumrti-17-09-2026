import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";
import NABHBadge from "@/components/nabh/NABHBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GatedTabsTrigger } from "@/components/access/GatedTabsTrigger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError } from "@/components/ui/FormError";
import { getErrorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
  fetchHicRates, deviceDaysInPeriod, makeRate, HIC_TARGETS,
  type HicRates, type Rate,
} from "@/lib/ipcRates";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Activity, AlertTriangle, Plus, RefreshCw, Loader2,
  ShieldCheck, TrendingUp, TrendingDown, Thermometer, Microscope, ClipboardList,
  Brain, CheckCircle2, XCircle, ChevronDown, ChevronUp
} from "lucide-react";
import HandHygieneTab from "@/components/ipc/HandHygieneTab";
import LogDeviceModal from "@/components/ipc/LogDeviceModal";
import BundleChecklistModal, { type BundleTarget } from "@/components/ipc/BundleChecklistModal";
import RemoveDeviceDialog, { type RemovalTarget } from "@/components/ipc/RemoveDeviceDialog";
import { type BundleType } from "@/lib/ipcBundles";
import {
  differenceInHours, format, subMonths, addMonths, subDays,
  startOfMonth, endOfMonth
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeviceUsage {
  id: string;
  admission_id: string;
  patient_id: string;
  ward_id: string | null;
  device_type: string;
  device_inserted_at: string;
  device_removed_at: string | null;
  insertion_site: string | null;
  notes: string | null;
  admissions?: { patients?: { full_name: string; uhid?: string }; ward_name?: string };
  wards?: { name: string } | null;
}

interface InfectionEvent {
  id: string;
  patient_id: string | null;
  admission_id: string | null;
  infection_type: string;
  onset_date: string;
  ward_id: string | null;
  organism: string | null;
  sensitivity_pattern: string | null;
  is_device_related: boolean;
  device_usage_id: string | null;
  outcome: string | null;
  notes: string | null;
  reported_by: string | null;
  patients?: { full_name: string; uhid?: string } | null;
  wards?: { name: string } | null;
}

interface BundleChecklist {
  id: string;
  admission_id: string;
  device_type: string;
  bundle_type: string;
  checklist_date: string;
  compliance_pct: number | null;
  admissions?: { patients?: { full_name: string } };
}

interface KPIs {
  deviceDays: Record<string, number>;
  infectionCounts: Record<string, number>;
  bundleCompliance: number | null;
  scoredBundles: number;
  activeDevices: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Row caps for the log tables. These bound the *lists*, not the rates — rates are
// aggregated server-side — but a truncated list is still worth telling the user about.
const DEVICE_ROW_LIMIT = 500;
const EVENT_ROW_LIMIT = 500;
const BUNDLE_ROW_LIMIT = 300;

const DEVICE_LABELS: Record<string, string> = {
  central_line: "Central Line",
  peripheral_line: "Peripheral IV",
  urinary_catheter: "Urinary Catheter",
  ventilator: "Ventilator",
  tracheostomy: "Tracheostomy",
  others: "Others",
};

const INFECTION_LABELS: Record<string, string> = {
  CLABSI: "CLABSI",
  CAUTI: "CAUTI",
  VAP: "VAP",
  SSI: "SSI",
  BSI: "BSI",
  CDI: "CDI",
  MDRO: "MDRO",
  other: "Other",
};

const DEVICE_COLOURS: Record<string, string> = {
  central_line: "#ef4444",
  peripheral_line: "#f97316",
  urinary_catheter: "#eab308",
  ventilator: "#3b82f6",
  tracheostomy: "#8b5cf6",
  others: "#6b7280",
};

const INFECTION_COLOURS: Record<string, string> = {
  CLABSI: "#ef4444",
  CAUTI: "#f97316",
  VAP: "#3b82f6",
  SSI: "#10b981",
  BSI: "#8b5cf6",
  CDI: "#ec4899",
  MDRO: "#f59e0b",
  other: "#6b7280",
};

const OUTCOME_COLOURS: Record<string, string> = {
  recovered: "bg-green-100 text-green-700",
  transferred: "bg-blue-100 text-blue-700",
  expired: "bg-red-100 text-red-700",
  ongoing: "bg-amber-100 text-amber-700",
  unknown: "bg-gray-100 text-gray-600",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function daysAgoStr(n: number): string {
  return format(subDays(new Date(), n), "yyyy-MM-dd");
}

/** Inclusive `yyyy-MM-dd` end date → the exclusive upper bound the collectors expect. */
function endExclusive(dateTo: string): Date {
  return new Date(new Date(`${dateTo}T00:00:00`).getTime() + 86_400_000);
}

const NO_RATES: HicRates = {
  clabsi: { value: null, numerator: 0, denominator: null },
  cauti: { value: null, numerator: 0, denominator: null },
  vap: { value: null, numerator: 0, denominator: null },
  ssi: { value: null, numerator: 0, denominator: null },
  hai: { value: null, numerator: 0, denominator: null },
  handHygiene: { value: null, numerator: 0, denominator: null },
  bundleCompliance: { value: null, numerator: 0, denominator: null },
};

interface QResult<T> { data: T[]; error: string | null }

/**
 * Await a Supabase query without letting it abort a Promise.all batch.
 *
 * PostgrestFilterBuilder is a bare thenable — it has `then` but no `catch`, so
 * `.catch()` on a builder throws a TypeError synchronously and takes the whole
 * batch (and the surrounding loading flag) down with it. Always go through here.
 */
async function safeQuery<T>(
  builder: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<QResult<T>> {
  try {
    const { data, error } = await builder;
    return { data: data ?? [], error: error ? getErrorMessage(error) : null };
  } catch (e) {
    return { data: [], error: getErrorMessage(e) };
  }
}

/**
 * Browser-side fallback for databases that predate the qi_collect_hic* collectors.
 *
 * Only the device-associated rates and SSI are reproduced here; hand hygiene and
 * bundle compliance stay null rather than being approximated, so nothing is
 * silently different from the server-side answer.
 */
async function computeRatesLocally(
  hospitalId: string, currStart: Date, currEnd: Date, prevStart: Date,
): Promise<{ curr: HicRates; prev: HicRates; error: string | null }> {
  const [devRes, infRes, otRes] = await Promise.all([
    safeQuery<{ device_type: string; device_inserted_at: string; device_removed_at: string | null }>(
      (supabase as any)
        .from("ipc_device_usage")
        .select("device_type,device_inserted_at,device_removed_at")
        .eq("hospital_id", hospitalId)
        .lt("device_inserted_at", currEnd.toISOString())
        .or(`device_removed_at.is.null,device_removed_at.gte.${prevStart.toISOString()}`),
    ),
    safeQuery<{ infection_type: string; onset_date: string }>(
      (supabase as any)
        .from("ipc_infection_events")
        .select("infection_type,onset_date")
        .eq("hospital_id", hospitalId)
        .gte("onset_date", format(prevStart, "yyyy-MM-dd"))
        .lt("onset_date", format(currEnd, "yyyy-MM-dd")),
    ),
    safeQuery<{ actual_end_time: string | null }>(
      (supabase as any)
        .from("ot_schedules")
        .select("actual_end_time")
        .eq("hospital_id", hospitalId)
        .eq("status", "completed")
        .gte("actual_end_time", prevStart.toISOString())
        .lt("actual_end_time", currEnd.toISOString()),
    ),
  ]);

  const period = (start: Date, end: Date): HicRates => {
    const inWindow = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= start.getTime() && t < end.getTime();
    };
    const count = (type: string) =>
      infRes.data.filter(i => i.infection_type === type && inWindow(`${i.onset_date}T00:00:00`)).length;
    const procedures = otRes.data.filter(o => o.actual_end_time && inWindow(o.actual_end_time)).length;

    return {
      ...NO_RATES,
      clabsi: makeRate(count("CLABSI"), deviceDaysInPeriod(devRes.data, "central_line", start, end), 1000),
      cauti: makeRate(count("CAUTI"), deviceDaysInPeriod(devRes.data, "urinary_catheter", start, end), 1000),
      vap: makeRate(count("VAP"), deviceDaysInPeriod(devRes.data, "ventilator", start, end), 1000),
      ssi: makeRate(count("SSI"), procedures, 100),
    };
  };

  return {
    curr: period(currStart, currEnd),
    prev: period(prevStart, currStart),
    error: [devRes.error, infRes.error, otRes.error].filter(Boolean).join(" · ") || null,
  };
}

// ─── Add Infection Event Modal ────────────────────────────────────────────────

interface AddInfectionModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  userId: string | null;
  onSaved: () => void;
}

const INFECTION_TYPES = ["CLABSI", "CAUTI", "VAP", "SSI", "BSI", "CDI", "MDRO", "other"];
const OUTCOMES = ["recovered", "transferred", "expired", "ongoing", "unknown"];

const AddInfectionModal: React.FC<AddInfectionModalProps> = ({ open, onOpenChange, hospitalId, userId, onSaved }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    infection_type: "",
    onset_date: format(new Date(), "yyyy-MM-dd"),
    ward_id: "",
    organism: "",
    sensitivity_pattern: "",
    is_device_related: false,
    outcome: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    (supabase as any).from("wards").select("id,name").eq("hospital_id", hospitalId).order("name")
      .then(({ data }: any) => setWards(data || []));
  }, [open, hospitalId]);

  const save = async () => {
    if (!form.infection_type || !form.onset_date) {
      toast({ title: "Fill required fields", description: "Infection type and onset date are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      hospital_id: hospitalId,
      infection_type: form.infection_type,
      onset_date: form.onset_date,
      is_device_related: form.is_device_related,
      reported_by: userId,
    };
    if (form.ward_id) payload.ward_id = form.ward_id;
    if (form.organism) payload.organism = form.organism;
    if (form.sensitivity_pattern) payload.sensitivity_pattern = form.sensitivity_pattern;
    if (form.outcome) payload.outcome = form.outcome;
    if (form.notes) payload.notes = form.notes;

    const { error } = await (supabase as any).from("ipc_infection_events").insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Infection event recorded" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record HAI Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Infection Type *</Label>
              <Select value={form.infection_type} onValueChange={v => setForm(p => ({ ...p, infection_type: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {INFECTION_TYPES.map(t => <SelectItem key={t} value={t}>{INFECTION_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Onset Date *</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={form.onset_date}
                onChange={e => setForm(p => ({ ...p, onset_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ward</Label>
              <Select value={form.ward_id} onValueChange={v => setForm(p => ({ ...p, ward_id: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select ward" /></SelectTrigger>
                <SelectContent>
                  {wards.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Outcome</Label>
              <Select value={form.outcome} onValueChange={v => setForm(p => ({ ...p, outcome: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Outcome" /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map(o => <SelectItem key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Organism</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. E. coli" value={form.organism}
                onChange={e => setForm(p => ({ ...p, organism: e.target.value }))} />
            </div>
            <div>
              <Label>Sensitivity Pattern</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. ESBL, MRSA" value={form.sensitivity_pattern}
                onChange={e => setForm(p => ({ ...p, sensitivity_pattern: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="device_related" checked={form.is_device_related}
              onCheckedChange={v => setForm(p => ({ ...p, is_device_related: !!v }))} />
            <Label htmlFor="device_related" className="cursor-pointer">Device-associated infection</Label>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea className="text-sm mt-1 h-20 resize-none" placeholder="Additional clinical notes..."
              value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save Event
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── KPI Card (summary, no trend) ────────────────────────────────────────────

const KpiCard = ({ title, value, sub, colour }: { title: string; value: string | number; sub?: string; colour: string }) => (
  <div className={`rounded-lg border p-4 ${colour}`}>
    <p className="text-xs font-medium text-muted-foreground">{title}</p>
    <p className="text-2xl font-bold mt-1">{value}</p>
    {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

// ─── Trend KPI Card ───────────────────────────────────────────────────────────

interface TrendKpiCardProps {
  title: string;
  subtitle: string;
  currentRate?: Rate | null;
  previousRate?: Rate | null;
  benchmark?: number | null;
  benchmarkLabel?: string;
  unit: string;
  loading?: boolean;
  /** Shown instead of a value when the period had no exposure to measure against. */
  noExposureNote?: string;
}

const TrendKpiCard: React.FC<TrendKpiCardProps> = ({
  title, subtitle, currentRate, previousRate, benchmark, benchmarkLabel, unit, loading, noExposureNote,
}) => {
  const current = currentRate?.value ?? null;
  const previous = previousRate?.value ?? null;
  // A null denominator means nothing was exposed — that is not a rate of zero, and
  // dressing it up as "0.00 ✓ within benchmark" is exactly the false all-clear this
  // dashboard used to give.
  const noExposure = currentRate != null && currentRate.denominator == null;
  const delta = current !== null && previous !== null ? current - previous : null;
  const up = delta !== null && delta > 0.001;
  const down = delta !== null && delta < -0.001;
  const exceeded = benchmark != null && current != null && current > benchmark;

  return (
    <div className={cn(
      "rounded-lg border p-4 bg-card",
      exceeded ? "border-red-300 bg-red-50/40 dark:bg-red-950/20" :
      noExposure ? "border-border" :
      current === 0 ? "border-green-200 bg-green-50/30 dark:bg-green-950/10" :
      "border-border"
    )}>
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <p className="text-[10px] text-muted-foreground/70 mb-2 leading-tight">{subtitle}</p>

      {loading ? (
        <div className="h-8 flex items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className={cn(
              "text-2xl font-bold tracking-tight",
              exceeded ? "text-red-600 dark:text-red-400" : "text-foreground"
            )}>
              {current !== null ? current.toFixed(2) : "—"}
            </span>
            <span className="text-[11px] text-muted-foreground">{unit}</span>
            {exceeded && (
              <span className="text-[10px] font-bold text-red-600 px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 rounded-full leading-tight">
                ↑ EXCEEDED
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {noExposure ? (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                {noExposureNote ?? "No exposure recorded in this period"}
              </span>
            ) : (
              <>
                {delta !== null && (
                  <span className={cn(
                    "flex items-center gap-0.5 text-xs font-semibold",
                    up ? "text-red-600 dark:text-red-400" :
                    down ? "text-green-600 dark:text-green-400" :
                    "text-muted-foreground"
                  )}>
                    {up ? <TrendingUp className="h-3 w-3" /> : down ? <TrendingDown className="h-3 w-3" /> : null}
                    {up ? "+" : ""}{delta.toFixed(2)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  prev: {previous !== null ? previous.toFixed(2) : "—"}
                </span>
              </>
            )}
            {benchmark != null && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                ≤{benchmark}{benchmarkLabel ? ` ${benchmarkLabel}` : ""}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const IPCDashboardPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Date range state — replaces the old "30d/90d/180d" selector
  const [dateFrom, setDateFrom] = useState(() => daysAgoStr(30));
  const [dateTo, setDateTo] = useState(() => todayStr());

  // Main data
  const [devices, setDevices] = useState<DeviceUsage[]>([]);
  const [infections, setInfections] = useState<InfectionEvent[]>([]);
  const [bundles, setBundles] = useState<BundleChecklist[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);

  // HAI rates for the selected period vs the preceding period of equal length
  const [currRates, setCurrRates] = useState<HicRates | null>(null);
  const [prevRates, setPrevRates] = useState<HicRates | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  /** true when the database lacks the qi_collect_hic* collectors and we computed locally. */
  const [ratesLocal, setRatesLocal] = useState(false);

  // Read failures — the dashboard must never render an empty result as "0 events, excellent"
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  const [addInfectionOpen, setAddInfectionOpen] = useState(false);

  // Device / bundle entry from within the IPC module
  const [logDeviceOpen, setLogDeviceOpen] = useState(false);
  const [bundleTarget, setBundleTarget] = useState<BundleTarget | null>(null);
  const [bundleTargetType, setBundleTargetType] = useState<BundleType>("maintenance");
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);

  // AI insights
  const [aiInsights, setAiInsights] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAcknowledged, setAiAcknowledged] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);

  // ── Quick-select helpers ──────────────────────────────────────────────────

  const setQuickRange = (days: number) => {
    setDateFrom(daysAgoStr(days));
    setDateTo(todayStr());
  };

  const setMonthRange = (monthsBack: number) => {
    const m = subMonths(new Date(), monthsBack);
    if (monthsBack === 0) {
      setDateFrom(format(startOfMonth(new Date()), "yyyy-MM-dd"));
      setDateTo(todayStr());
    } else {
      setDateFrom(format(startOfMonth(m), "yyyy-MM-dd"));
      setDateTo(format(endOfMonth(m), "yyyy-MM-dd"));
    }
  };

  const daysBack = Math.max(1, Math.ceil(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000
  ));

  // ── Main data loading ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setLoadError(null);

    try {
      const periodEnd = endExclusive(dateTo);

      const [devRes, infRes, bunRes] = await Promise.all([
        // Overlap predicate, not "inserted during the window": a line placed last
        // month and still in situ is very much part of this period's device log.
        safeQuery<DeviceUsage>(
          (supabase as any)
            .from("ipc_device_usage")
            .select("*, wards(name)")
            .eq("hospital_id", hospitalId)
            .lt("device_inserted_at", periodEnd.toISOString())
            .or(`device_removed_at.is.null,device_removed_at.gte.${new Date(`${dateFrom}T00:00:00`).toISOString()}`)
            .order("device_inserted_at", { ascending: false })
            .limit(DEVICE_ROW_LIMIT),
        ),
        safeQuery<InfectionEvent>(
          (supabase as any)
            .from("ipc_infection_events")
            .select("*, wards(name)")
            .eq("hospital_id", hospitalId)
            .gte("onset_date", dateFrom)
            .lte("onset_date", dateTo)
            .order("onset_date", { ascending: false })
            .limit(EVENT_ROW_LIMIT),
        ),
        safeQuery<BundleChecklist>(
          (supabase as any)
            .from("ipc_bundle_checklists")
            .select("id,admission_id,device_type,bundle_type,checklist_date,compliance_pct")
            .eq("hospital_id", hospitalId)
            .gte("checklist_date", dateFrom)
            .lte("checklist_date", dateTo)
            .order("checklist_date", { ascending: false })
            .limit(BUNDLE_ROW_LIMIT),
        ),
      ]);

      setDevices(devRes.data);
      setInfections(infRes.data);
      setBundles(bunRes.data);
      setLoadError([devRes.error, infRes.error, bunRes.error].filter(Boolean).join(" · ") || null);
    } finally {
      // finally, not a trailing statement: a throw here used to strand the spinner forever.
      setLoading(false);
    }
  }, [hospitalId, dateFrom, dateTo]);

  // ── HAI rate loading ──────────────────────────────────────────────────────
  //
  // Rates come from the database collectors (qi_collect_hic_device / qi_collect_hic)
  // so the dashboard reports exactly what the QI/NABH engine reports. They follow
  // the date picker and are compared against the preceding period of equal length.

  const loadRates = useCallback(async () => {
    if (!hospitalId) return;
    setKpiLoading(true);
    setRateError(null);

    try {
      const currStart = new Date(`${dateFrom}T00:00:00`);
      const currEnd = endExclusive(dateTo);
      const span = currEnd.getTime() - currStart.getTime();
      const prevStart = new Date(currStart.getTime() - span);

      const [curr, prev] = await Promise.all([
        fetchHicRates(hospitalId, currStart, currEnd),
        fetchHicRates(hospitalId, prevStart, currStart),
      ]);

      if (curr.unsupported || prev.unsupported) {
        // Older database without the collectors — compute in the browser instead.
        const local = await computeRatesLocally(hospitalId, currStart, currEnd, prevStart);
        setCurrRates(local.curr);
        setPrevRates(local.prev);
        setRatesLocal(true);
        setRateError(local.error);
        return;
      }

      setRatesLocal(false);
      setCurrRates(curr.rates);
      setPrevRates(prev.rates);
      setRateError(curr.error ?? prev.error);
    } finally {
      setKpiLoading(false);
    }
  }, [hospitalId, dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData, refreshKey]);
  useEffect(() => { loadRates(); }, [loadRates, refreshKey]);

  // ── Trend builder ─────────────────────────────────────────────────────────
  //
  // One collector call per month so the chart uses the same period-clipped
  // device-days as the KPI cards. Previously the chart had its own arithmetic and
  // could disagree with the cards above it.

  const loadTrend = useCallback(async () => {
    if (!hospitalId) return;

    const numMonths = Math.max(1, Math.min(12, Math.ceil(daysBack / 28)));
    const months = Array.from({ length: numMonths }, (_, i) => {
      const d = subMonths(new Date(), numMonths - 1 - i);
      // [first of the month, first of the next month) — the collectors treat p_to
      // as exclusive, and fetchHicRates clamps it to now for the in-progress month.
      return { label: format(d, "MMM yy"), start: startOfMonth(d), end: startOfMonth(addMonths(d, 1)) };
    });

    const results = await Promise.all(
      months.map(m => fetchHicRates(hospitalId, m.start, m.end)),
    );

    setTrendData(results.map((r, i) => {
      const rates = r.rates;
      return {
        month: months[i].label,
        // null, not 0 — recharts breaks the line rather than drawing a month with no
        // device exposure as a month with a perfect zero rate.
        clabsiRate: rates?.clabsi.value ?? null,
        cautiRate: rates?.cauti.value ?? null,
        vapRate: rates?.vap.value ?? null,
        clDays: Math.round(rates?.clabsi.denominator ?? 0),
        ucDays: Math.round(rates?.cauti.denominator ?? 0),
        ventDays: Math.round(rates?.vap.denominator ?? 0),
        totalInfections: rates?.hai.numerator ?? 0,
      };
    }));
  }, [hospitalId, daysBack]);

  useEffect(() => { loadTrend(); }, [loadTrend, refreshKey]);

  // ── Period-wide KPI calculations ──────────────────────────────────────────

  const kpis: KPIs = React.useMemo(() => {
    const deviceTypes = ["central_line", "peripheral_line", "urinary_catheter", "ventilator", "tracheostomy", "others"];
    const infTypes = ["CLABSI", "CAUTI", "VAP", "SSI", "BSI", "CDI", "MDRO", "other"];
    const periodStart = new Date(`${dateFrom}T00:00:00`);
    const periodEnd = endExclusive(dateTo);

    const dDays: Record<string, number> = {};
    const activeDevs: Record<string, number> = {};
    deviceTypes.forEach(t => {
      dDays[t] = Math.round(deviceDaysInPeriod(devices, t, periodStart, periodEnd));
      activeDevs[t] = devices.filter(d => d.device_type === t && !d.device_removed_at).length;
    });

    const infCounts: Record<string, number> = {};
    infTypes.forEach(t => { infCounts[t] = infections.filter(i => i.infection_type === t).length; });

    // Checklists written before the compliance trigger landed have a NULL
    // compliance_pct. They are unscored, not 100% compliant — exclude them from the
    // average rather than letting `?? 100` inflate it.
    const scored = bundles.filter(b => b.compliance_pct != null);
    const avgCompliance = scored.length > 0
      ? scored.reduce((s, b) => s + (b.compliance_pct as number), 0) / scored.length
      : null;

    return {
      deviceDays: dDays,
      infectionCounts: infCounts,
      bundleCompliance: avgCompliance != null ? Math.round(avgCompliance) : null,
      scoredBundles: scored.length,
      activeDevices: activeDevs,
    };
  }, [devices, infections, bundles, dateFrom, dateTo]);

  // ── AI Anomaly Detection ──────────────────────────────────────────────────

  const runAIInsights = async () => {
    if (!hospitalId) return;
    setAiLoading(true);
    setAiInsights("");
    setAiAcknowledged(false);

    // "no exposure" must reach the model as such — telling it a rate is 0.00 when
    // the denominator is empty invites a confident all-clear on absent data.
    const describe = (r: Rate | undefined, unit: string, denomLabel: string) =>
      r == null ? "not loaded"
        : r.value == null ? `no ${denomLabel} recorded (${r.numerator} events)`
        : `${r.value}${unit} (${r.numerator} events over ${Math.round(r.denominator as number)} ${denomLabel})`;

    const summary = {
      period: `${dateFrom} to ${dateTo} (${daysBack} days)`,
      currentPeriod: currRates ? {
        clabsi: describe(currRates.clabsi, "/1000", "line-days"),
        cauti: describe(currRates.cauti, "/1000", "catheter-days"),
        vap: describe(currRates.vap, "/1000", "vent-days"),
        ssi: describe(currRates.ssi, "/100", "OT procedures"),
      } : "no data",
      devices: Object.entries(kpis.activeDevices)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${DEVICE_LABELS[t]}: ${n} active, ${kpis.deviceDays[t]} device-days`),
      infections: Object.entries(kpis.infectionCounts)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${t}: ${n} events`),
      bundleCompliance: kpis.bundleCompliance != null ? `${kpis.bundleCompliance}%` : "No data",
    };

    const prompt = `You are an IPC (Infection Prevention & Control) specialist reviewing hospital surveillance data.

Data summary:
${JSON.stringify(summary, null, 2)}

NABH benchmark rates (India): CLABSI <${HIC_TARGETS.clabsi}/1000 line-days, CAUTI <${HIC_TARGETS.cauti}/1000 catheter-days, VAP <${HIC_TARGETS.vap}/1000 vent-days, SSI <${HIC_TARGETS.ssi}/100 procedures.
Where a metric reads "no ... recorded", the denominator is empty — report it as a surveillance data gap, not as a rate of zero.

Please provide:
1. ANOMALY ALERTS — any rates exceeding NABH benchmarks (list each exceeded threshold)
2. KEY OBSERVATIONS — notable patterns or concerns
3. RECOMMENDED ACTIONS — specific, actionable IPC interventions
4. COMPLIANCE GAPS — if bundle compliance <80%, suggest improvements

Keep each section concise and clinically actionable. Use plain text with numbered sub-points.`;

    try {
      const result = await callAI({ featureKey: "nabh_criteria_mapper", hospitalId, prompt, maxTokens: 800 });
      if (result.error || !result.text) {
        setAiInsights("AI analysis unavailable. Please review data manually.");
        toast({ title: "AI unavailable", description: result.error, variant: "destructive" });
      } else {
        setAiInsights(result.text);
      }
    } catch {
      setAiInsights("AI analysis unavailable. Please review data manually.");
    }
    setAiLoading(false);
    setAiExpanded(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!hospitalId) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const totalInfections = Object.values(kpis.infectionCounts).reduce((a, b) => a + b, 0);
  const totalActiveDevices = Object.values(kpis.activeDevices).reduce((a, b) => a + b, 0);
  const anyError = loadError ?? rateError;
  const deviceDaysChartData = Object.entries(DEVICE_LABELS)
    .map(([key, label]) => ({ key, name: label, days: kpis.deviceDays[key] || 0 }));

  // The rate cards now follow the date picker, so the comparison label has to
  // describe the real windows rather than the calendar months it used to assume.
  const prevWindowStart = new Date(
    new Date(`${dateFrom}T00:00:00`).getTime() - (endExclusive(dateTo).getTime() - new Date(`${dateFrom}T00:00:00`).getTime()),
  );
  const periodLabel = `${format(new Date(`${dateFrom}T00:00:00`), "d MMM")} – ${format(new Date(`${dateTo}T00:00:00`), "d MMM yyyy")}`;
  const prevPeriodLabel = `${format(prevWindowStart, "d MMM")} – ${format(subDays(new Date(`${dateFrom}T00:00:00`), 1), "d MMM yyyy")}`;
  const dayFmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString());

  // Quick-select active detection
  const isQuickActive = (days: number) => dateFrom === daysAgoStr(days) && dateTo === todayStr();
  const isMtdActive = dateFrom === format(startOfMonth(new Date()), "yyyy-MM-dd") && dateTo === todayStr();

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="text-base font-bold text-foreground">IPC Surveillance Dashboard</span>
          <Badge variant="outline" className="text-xs ml-1">NABH HIC</Badge>
        </div>
        <div className="flex items-center gap-2">
          <NABHBadge standardCodes={["HIC.1", "HIC.2", "HIC.9"]} />
          <Button size="sm" variant="outline" onClick={() => setRefreshKey(k => k + 1)} disabled={loading || kpiLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading || kpiLoading ? "animate-spin" : ""}`} />
          </Button>
          {hospitalId && (
            <NABHAssistantPanel
              hospitalId={hospitalId}
              contextType="ipc"
              contextFilter={{ from: dateFrom, to: dateTo }}
              evidenceTitle="IPC Surveillance Analysis"
              moduleReference="IPCDashboardPage"
            />
          )}
          <Button size="sm" onClick={() => setAddInfectionOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Log HAI Event
          </Button>
        </div>
      </div>

      {/* ── Date Range Picker ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 py-2 bg-muted/10 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period</span>
        {/* Quick chips */}
        <div className="flex items-center gap-1">
          {[
            { label: "30d", action: () => setQuickRange(30), active: isQuickActive(30) },
            { label: "90d", action: () => setQuickRange(90), active: isQuickActive(90) },
            { label: "6M",  action: () => setQuickRange(180), active: isQuickActive(180) },
            { label: "MTD", action: () => setMonthRange(0), active: isMtdActive },
            { label: "Last 3M", action: () => setMonthRange(2), active: false },
          ].map(({ label, action, active }) => (
            <button
              key={label}
              onClick={action}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >{label}</button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        {/* Custom date inputs */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">From</span>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={e => setDateFrom(e.target.value)}
            className="h-7 text-xs w-36 px-2"
          />
          <span className="text-xs text-muted-foreground">To</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={todayStr()}
            onChange={e => setDateTo(e.target.value)}
            className="h-7 text-xs w-36 px-2"
          />
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">{daysBack} day window</span>
      </div>

      {/* ── Read failures ─────────────────────────────────────────────────── */}
      {anyError && (
        <div className="flex-shrink-0 px-5 pt-3">
          <FormError message={anyError} />
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* ── Trend KPI Cards (selected period vs preceding period) ────────── */}
      <div className="flex-shrink-0 px-5 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wide">HAI Rates</span>
          <span className="text-[10px] text-muted-foreground">
            — {periodLabel} vs {prevPeriodLabel}
          </span>
          {ratesLocal && (
            <span className="text-[10px] text-amber-600">
              · computed in-browser — server-side collectors not deployed
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          <TrendKpiCard
            title="CLABSI Rate"
            subtitle={`Central line-days: ${dayFmt(currRates?.clabsi.denominator)} (curr) / ${dayFmt(prevRates?.clabsi.denominator)} (prev)`}
            currentRate={currRates?.clabsi}
            previousRate={prevRates?.clabsi}
            benchmark={HIC_TARGETS.clabsi}
            benchmarkLabel="NABH"
            unit="/1000 line-days"
            loading={kpiLoading}
            noExposureNote="No central-line days recorded in this period"
          />
          <TrendKpiCard
            title="CAUTI Rate"
            subtitle={`Catheter-days: ${dayFmt(currRates?.cauti.denominator)} (curr) / ${dayFmt(prevRates?.cauti.denominator)} (prev)`}
            currentRate={currRates?.cauti}
            previousRate={prevRates?.cauti}
            benchmark={HIC_TARGETS.cauti}
            benchmarkLabel="NABH"
            unit="/1000 cath-days"
            loading={kpiLoading}
            noExposureNote="No urinary-catheter days recorded in this period"
          />
          <TrendKpiCard
            title="VAP Rate"
            subtitle={`Vent-days: ${dayFmt(currRates?.vap.denominator)} (curr) / ${dayFmt(prevRates?.vap.denominator)} (prev)`}
            currentRate={currRates?.vap}
            previousRate={prevRates?.vap}
            benchmark={HIC_TARGETS.vap}
            benchmarkLabel="NABH"
            unit="/1000 vent-days"
            loading={kpiLoading}
            noExposureNote="No ventilator days recorded in this period"
          />
          <TrendKpiCard
            title="SSI Rate"
            subtitle={`OT procedures: ${dayFmt(currRates?.ssi.denominator)} (curr) / ${dayFmt(prevRates?.ssi.denominator)} (prev)`}
            currentRate={currRates?.ssi}
            previousRate={prevRates?.ssi}
            benchmark={HIC_TARGETS.ssi}
            benchmarkLabel="NABH"
            unit="/100 procedures"
            loading={kpiLoading}
            // The collector counts ot_schedules by actual_end_time, not scheduled_date —
            // a theatre list marked completed without an actual end time is invisible here.
            noExposureNote="No completed OT procedures with a recorded actual end time"
          />
        </div>
      </div>

      {/* ── Summary KPI Strip ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 py-3 bg-muted/20 border-b border-border grid grid-cols-3 gap-3">
        <KpiCard
          title="Active Devices"
          value={totalActiveDevices}
          sub="across all types (current)"
          colour="bg-card"
        />
        <KpiCard
          title="Bundle Compliance"
          value={kpis.bundleCompliance != null ? `${kpis.bundleCompliance}%` : "—"}
          sub={
            bundles.length === 0
              ? `0 checklists · ${dateFrom} – ${dateTo}`
              : `${kpis.scoredBundles} of ${bundles.length} scored · ${dateFrom} – ${dateTo}`
          }
          colour={kpis.bundleCompliance != null && kpis.bundleCompliance < 80 ? "bg-amber-50 border-amber-200" : "bg-card"}
        />
        <KpiCard
          title="Total HAI Events"
          value={totalInfections}
          sub={`${dateFrom} – ${dateTo} (${daysBack} days)`}
          colour={totalInfections > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}
        />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="h-9 rounded-none border-b border-border bg-card px-4 justify-start flex-shrink-0">
            {[
              { v: "overview",      l: "📊 Overview" },
              { v: "devices",       l: "🔌 Device Log" },
              { v: "infections",    l: "🦠 HAI Events" },
              { v: "bundles",       l: "✅ Bundle Compliance" },
              { v: "hand_hygiene",  l: "🖐 Hand Hygiene" },
              { v: "trends",        l: "📈 Trends" },
              { v: "ai",            l: "🤖 AI Insights" },
            ].map(t => (
              <GatedTabsTrigger module="ipc" key={t.v} value={t.v}
                className="text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 h-full"
              >{t.l}</GatedTabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ─────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="flex-1 overflow-auto p-5 m-0">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-5">
                {/* Device Days bar chart */}
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-semibold mb-3">Device Days by Type</p>
                  <ResponsiveContainer width="100%" height={220}>
                    {/* One array drives both the bars and their Cells, so colour order
                        cannot drift from row order. Bare <rect> children were ignored
                        by recharts, which is why every bar rendered the same colour. */}
                    <BarChart data={deviceDaysChartData} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="days" name="Device Days">
                        {deviceDaysChartData.map(d => <Cell key={d.key} fill={DEVICE_COLOURS[d.key]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Infection events by type */}
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-semibold mb-3">HAI Events by Type</p>
                  <div className="space-y-2 mt-2">
                    {Object.entries(INFECTION_LABELS).map(([k, l]) => {
                      const count = kpis.infectionCounts[k] || 0;
                      const maxCount = Math.max(...Object.values(kpis.infectionCounts), 1);
                      return (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-xs w-12 text-right font-medium text-muted-foreground">{l}</span>
                          <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: INFECTION_COLOURS[k] }} />
                          </div>
                          <span className="text-xs w-6 font-semibold">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Active devices now */}
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-semibold mb-3">Currently Active Devices</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(DEVICE_LABELS).map(([k, l]) => {
                      const n = kpis.activeDevices[k] || 0;
                      return (
                        <div key={k} className="flex items-center gap-2 p-2 rounded border bg-muted/20">
                          <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: DEVICE_COLOURS[k] }} />
                          <span className="text-xs flex-1">{l}</span>
                          <span className="text-sm font-bold">{n}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Rate comparison vs NABH benchmarks */}
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-semibold mb-3">Rates vs NABH Benchmarks (per 1000 device-days)</p>
                  {/* Same `currRates` object the KPI cards use — this panel used to run
                      its own arithmetic over a different window and disagree with them. */}
                  <div className="space-y-3">
                    {[
                      { label: "CLABSI", rate: currRates?.clabsi, benchmark: HIC_TARGETS.clabsi, colour: "#ef4444" },
                      { label: "CAUTI",  rate: currRates?.cauti,  benchmark: HIC_TARGETS.cauti,  colour: "#f97316" },
                      { label: "VAP",    rate: currRates?.vap,    benchmark: HIC_TARGETS.vap,    colour: "#3b82f6" },
                    ].map(({ label, rate, benchmark, colour }) => {
                      const value = rate?.value ?? null;
                      const exceeded = value != null && value > benchmark;
                      return (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium">{label}</span>
                            {value == null ? (
                              <span className="text-muted-foreground">— no device-days recorded</span>
                            ) : (
                              <span className={exceeded ? "text-red-600 font-bold" : "text-green-600 font-semibold"}>
                                {value} {exceeded ? "↑ EXCEEDED" : "✓"}
                              </span>
                            )}
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(((value ?? 0) / (benchmark * 2)) * 100, 100)}%`, backgroundColor: exceeded ? "#ef4444" : colour }} />
                            <div className="absolute top-0 h-full border-l-2 border-dashed border-gray-400" style={{ left: "50%" }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>0</span>
                            <span>Benchmark: {benchmark}</span>
                            <span>{benchmark * 2}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Device Log ───────────────────────────────────────────────── */}
          <TabsContent value="devices" className="flex-1 overflow-auto m-0">
            {loading ? (
              <div className="flex items-center gap-2 p-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <div className="p-5">
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">Device Usage Log ({devices.length} records)</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{dateFrom} – {dateTo}</span>
                      <Button size="sm" onClick={() => setLogDeviceOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Log Device
                      </Button>
                    </div>
                  </div>
                  {devices.length >= DEVICE_ROW_LIMIT && (
                    <p className="px-4 py-1.5 text-[11px] text-amber-600 bg-amber-50/50 border-b border-border">
                      Showing the first {DEVICE_ROW_LIMIT} records. Rate calculations are unaffected — they are aggregated server-side.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {["Type", "Ward", "Inserted", "Removed", "Device Days", "Status", ""].map((h, i) => (
                            <th key={h || `actions-${i}`} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map(d => {
                          const days = Math.round(differenceInHours(
                            d.device_removed_at ? new Date(d.device_removed_at) : new Date(),
                            new Date(d.device_inserted_at)
                          ) / 24 * 10) / 10;
                          const active = !d.device_removed_at;
                          return (
                            <tr key={d.id} className="border-t border-border hover:bg-muted/20">
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: DEVICE_COLOURS[d.device_type] }} />
                                  {DEVICE_LABELS[d.device_type] || d.device_type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{(d.wards as any)?.name || "—"}</td>
                              <td className="px-3 py-2">{format(new Date(d.device_inserted_at), "dd MMM yy HH:mm")}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {d.device_removed_at ? format(new Date(d.device_removed_at), "dd MMM yy HH:mm") : "—"}
                              </td>
                              <td className="px-3 py-2 font-medium">
                                <span className={days >= 7 ? "text-amber-600" : ""}>{days}d</span>
                              </td>
                              <td className="px-3 py-2">
                                <Badge className={active ? "bg-green-100 text-green-700 border-0 text-xs" : "bg-gray-100 text-gray-600 border-0 text-xs"}>
                                  {active ? "Active" : "Removed"}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                {active && (
                                  <>
                                    <Button
                                      size="sm" variant="ghost" className="h-7 text-xs"
                                      onClick={() => {
                                        setBundleTargetType("maintenance");
                                        setBundleTarget({
                                          deviceUsageId: d.id,
                                          admissionId: d.admission_id,
                                          patientId: d.patient_id,
                                          deviceType: d.device_type,
                                        });
                                      }}
                                    >Bundle</Button>
                                    <Button
                                      size="sm" variant="ghost" className="h-7 text-xs"
                                      onClick={() => setRemovalTarget({
                                        id: d.id, deviceType: d.device_type, insertedAt: d.device_inserted_at,
                                      })}
                                    >Remove</Button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {devices.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-sm">
                            {loadError
                              ? "Could not load device records — see the error above."
                              : "No device records in this period — use “Log Device” to start surveillance."}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── HAI Events ───────────────────────────────────────────────── */}
          <TabsContent value="infections" className="flex-1 overflow-auto m-0">
            <div className="p-5">
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">Healthcare-Associated Infection Events ({infections.length})</span>
                  <Button size="sm" onClick={() => setAddInfectionOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Log HAI
                  </Button>
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 p-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {["Type", "Onset", "Ward", "Organism", "Sensitivity", "Device-linked", "Outcome"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {infections.map(inf => (
                          <tr key={inf.id} className="border-t border-border hover:bg-muted/20">
                            <td className="px-3 py-2">
                              <Badge className="text-xs border-0" style={{ backgroundColor: INFECTION_COLOURS[inf.infection_type] + "22", color: INFECTION_COLOURS[inf.infection_type] }}>
                                {inf.infection_type}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-medium">{format(new Date(inf.onset_date), "dd MMM yy")}</td>
                            <td className="px-3 py-2 text-muted-foreground">{(inf.wards as any)?.name || "—"}</td>
                            <td className="px-3 py-2">{inf.organism || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{inf.sensitivity_pattern || "—"}</td>
                            <td className="px-3 py-2">
                              {inf.is_device_related
                                ? <CheckCircle2 className="h-4 w-4 text-amber-500" />
                                : <XCircle className="h-4 w-4 text-muted-foreground/30" />}
                            </td>
                            <td className="px-3 py-2">
                              {inf.outcome && (
                                <Badge className={`text-xs border-0 ${OUTCOME_COLOURS[inf.outcome] || ""}`}>
                                  {inf.outcome}
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                        {infections.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-sm">
                            {/* An empty array after a failed read is not a clean bill of health. */}
                            {loadError
                              ? "Could not load HAI events — see the error above."
                              : "No HAI events recorded in this period — excellent!"}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Bundle Compliance ─────────────────────────────────────────── */}
          <TabsContent value="bundles" className="flex-1 overflow-auto m-0">
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {["central_line", "urinary_catheter", "ventilator"].map(dt => {
                  const dtBundles = bundles.filter(b => b.device_type === dt);
                  // Unscored (NULL compliance_pct) rows are excluded, not counted as 100%.
                  const dtScored = dtBundles.filter(b => b.compliance_pct != null);
                  const avg = dtScored.length > 0
                    ? Math.round(dtScored.reduce((s, b) => s + (b.compliance_pct as number), 0) / dtScored.length)
                    : null;
                  return (
                    <div key={dt} className="rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEVICE_COLOURS[dt] }} />
                        <span className="text-sm font-semibold">{DEVICE_LABELS[dt]}</span>
                      </div>
                      <p className="text-2xl font-bold">{avg != null ? `${avg}%` : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dtScored.length} of {dtBundles.length} checklists scored
                      </p>
                      {avg != null && avg < 80 && (
                        <div className="mt-2 flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" /> Below 80% threshold
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">Bundle Checklist Log</span>
                  <span className="text-xs text-muted-foreground">
                    Record a checklist from the Device Log tab, against the device it applies to.
                  </span>
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 p-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {["Device", "Bundle Type", "Date", "Compliance %"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bundles.map(b => {
                          const pct = b.compliance_pct;
                          return (
                            <tr key={b.id} className="border-t border-border hover:bg-muted/20">
                              <td className="px-3 py-2">
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DEVICE_COLOURS[b.device_type] || "#888" }} />
                                  {DEVICE_LABELS[b.device_type] || b.device_type}
                                </span>
                              </td>
                              <td className="px-3 py-2 capitalize text-muted-foreground">{b.bundle_type}</td>
                              <td className="px-3 py-2">{format(new Date(b.checklist_date), "dd MMM yy")}</td>
                              <td className="px-3 py-2">
                                {pct == null ? (
                                  <span className="text-xs text-muted-foreground">— not scored</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full rounded-full"
                                        style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444" }} />
                                    </div>
                                    <span className={`text-xs font-semibold ${pct >= 80 ? "text-green-600" : pct >= 60 ? "text-amber-600" : "text-red-600"}`}>
                                      {pct}%
                                    </span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {bundles.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground text-sm">
                            {loadError
                              ? "Could not load bundle checklists — see the error above."
                              : "No bundle checklists in this period"}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Trends ───────────────────────────────────────────────────── */}
          <TabsContent value="trends" className="flex-1 overflow-auto m-0">
            <div className="p-5 space-y-5">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold mb-3">HAI Rates per 1000 Device Days</p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: any) => [`${v} /1000`, ""]} />
                    <Legend />
                    <Line type="monotone" dataKey="clabsiRate" name="CLABSI" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="cautiRate"  name="CAUTI"  stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="vapRate"    name="VAP"    stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold mb-3">Device Days Trend</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="clDays"   name="Central Line"     stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} />
                    <Area type="monotone" dataKey="ucDays"   name="Urinary Catheter" stroke="#f97316" fill="#f9731620" strokeWidth={1.5} />
                    <Area type="monotone" dataKey="ventDays" name="Ventilator"        stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold mb-3">Total HAI Events per Month</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="totalInfections" name="HAI Events" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* ── Hand Hygiene ─────────────────────────────────────────────── */}
          <TabsContent value="hand_hygiene" className="flex-1 overflow-hidden m-0">
            {hospitalId && <HandHygieneTab hospitalId={hospitalId} />}
          </TabsContent>

          {/* ── AI Insights ──────────────────────────────────────────────── */}
          <TabsContent value="ai" className="flex-1 overflow-auto m-0">
            <div className="p-5 max-w-3xl">
              <div className="rounded-lg border bg-card p-5">
                <div className="flex items-start gap-3 mb-4">
                  <Brain className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">AI-Powered IPC Anomaly Detection</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Analyzes device days, HAI rates and bundle compliance against NABH HIC benchmarks.
                      AI output is advisory only — clinical judgment takes precedence.
                    </p>
                  </div>
                </div>

                <Button onClick={runAIInsights} disabled={aiLoading} size="sm" className="mb-4">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Activity className="h-3.5 w-3.5 mr-1.5" />}
                  {aiLoading ? "Analyzing…" : "Run AI Analysis"}
                </Button>

                {aiInsights && (
                  <div className="space-y-3">
                    <div className="rounded-md border bg-muted/30 p-4">
                      <button
                        className="flex items-center gap-2 w-full text-left"
                        onClick={() => setAiExpanded(v => !v)}
                      >
                        <span className="text-sm font-medium flex-1">AI Analysis Results</span>
                        {aiExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {aiExpanded && (
                        <div className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed border-t border-border pt-3">
                          {aiInsights}
                        </div>
                      )}
                    </div>

                    <div className={`rounded-md border p-3 ${aiAcknowledged ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex items-start gap-2">
                        <Checkbox id="ai_ack" checked={aiAcknowledged} onCheckedChange={v => setAiAcknowledged(!!v)} className="mt-0.5" />
                        <Label htmlFor="ai_ack" className="text-xs cursor-pointer leading-snug">
                          I have reviewed the AI analysis above. I confirm this is advisory output and will apply
                          independent clinical judgment before taking any action based on these insights.
                        </Label>
                      </div>
                      {aiAcknowledged && (
                        <div className="mt-2 flex items-center gap-1.5 text-green-700 text-xs font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged — insights reviewed
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground bg-muted/20 rounded px-3 py-2">
                      <strong>Note:</strong> NABH benchmarks — CLABSI &lt;{HIC_TARGETS.clabsi}, CAUTI &lt;{HIC_TARGETS.cauti},
                      VAP &lt;{HIC_TARGETS.vap} per 1000 device-days; SSI &lt;{HIC_TARGETS.ssi} per 100 procedures.
                      Rates shown for selected period ({dateFrom} – {dateTo}).
                    </div>
                  </div>
                )}

                {!aiInsights && !aiLoading && (
                  <div className="text-sm text-muted-foreground bg-muted/20 rounded p-4 text-center">
                    Click "Run AI Analysis" to detect anomalies and get IPC recommendations
                    based on your current surveillance data.
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AddInfectionModal
        open={addInfectionOpen}
        onOpenChange={setAddInfectionOpen}
        hospitalId={hospitalId}
        userId={userId}
        onSaved={() => setRefreshKey(k => k + 1)}
      />

      <LogDeviceModal
        open={logDeviceOpen}
        onOpenChange={setLogDeviceOpen}
        hospitalId={hospitalId}
        userId={userId}
        onSaved={() => setRefreshKey(k => k + 1)}
        onInsertBundle={target => { setBundleTargetType("insert"); setBundleTarget(target); }}
      />

      <BundleChecklistModal
        open={bundleTarget != null}
        onOpenChange={open => { if (!open) setBundleTarget(null); }}
        hospitalId={hospitalId}
        userId={userId}
        target={bundleTarget}
        bundleType={bundleTargetType}
        onSaved={() => setRefreshKey(k => k + 1)}
      />

      <RemoveDeviceDialog
        target={removalTarget}
        onOpenChange={open => { if (!open) setRemovalTarget(null); }}
        userId={userId}
        onSaved={() => setRefreshKey(k => k + 1)}
      />
    </div>
  );
};

export default IPCDashboardPage;
