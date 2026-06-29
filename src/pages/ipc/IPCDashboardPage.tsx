import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";
import NABHBadge from "@/components/nabh/NABHBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Activity, AlertTriangle, Plus, RefreshCw, Loader2,
  ShieldCheck, TrendingUp, TrendingDown, Thermometer, Microscope, ClipboardList,
  Brain, CheckCircle2, XCircle, ChevronDown, ChevronUp
} from "lucide-react";
import HandHygieneTab from "@/components/ipc/HandHygieneTab";
import {
  differenceInHours, format, subMonths, subDays,
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
  rates: { clabsi: number; cauti: number; vap: number };
  bundleCompliance: number | null;
  activeDevices: Record<string, number>;
}

interface MonthKpi {
  clabsiRate: number;
  cautiRate: number;
  vapRate: number;
  ssiRate: number;
  ssiCount: number;
  ssiProcedures: number;
  clDays: number;
  ucDays: number;
  ventDays: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

function deviceDays(devices: { device_type: string; device_inserted_at: string; device_removed_at: string | null }[], type: string): number {
  const now = new Date();
  return devices
    .filter(d => d.device_type === type)
    .reduce((sum, d) => {
      const end = d.device_removed_at ? new Date(d.device_removed_at) : now;
      return sum + differenceInHours(end, new Date(d.device_inserted_at)) / 24;
    }, 0);
}

function ratePerThousand(events: number, days: number): number {
  if (days < 1) return 0;
  return Math.round((events / days) * 1000 * 100) / 100;
}

function ratePer100(events: number, procedures: number): number {
  if (procedures < 1) return 0;
  return Math.round((events / procedures) * 100 * 100) / 100;
}

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function daysAgoStr(n: number): string {
  return format(subDays(new Date(), n), "yyyy-MM-dd");
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
  current: number | null;
  previous: number | null;
  benchmark?: number | null;
  benchmarkLabel?: string;
  unit: string;
  loading?: boolean;
}

const TrendKpiCard: React.FC<TrendKpiCardProps> = ({
  title, subtitle, current, previous, benchmark, benchmarkLabel, unit, loading,
}) => {
  const delta = current !== null && previous !== null ? current - previous : null;
  const up = delta !== null && delta > 0.001;
  const down = delta !== null && delta < -0.001;
  const exceeded = benchmark != null && current != null && current > benchmark;

  return (
    <div className={cn(
      "rounded-lg border p-4 bg-card",
      exceeded ? "border-red-300 bg-red-50/40 dark:bg-red-950/20" :
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

  // Monthly KPI trend data (always current vs previous calendar month)
  const [currMonthKpi, setCurrMonthKpi] = useState<MonthKpi | null>(null);
  const [prevMonthKpi, setPrevMonthKpi] = useState<MonthKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [addInfectionOpen, setAddInfectionOpen] = useState(false);

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

    const [devRes, infRes, bunRes] = await Promise.all([
      (supabase as any)
        .from("ipc_device_usage")
        .select("*, wards(name)")
        .eq("hospital_id", hospitalId)
        .gte("device_inserted_at", new Date(dateFrom).toISOString())
        .order("device_inserted_at", { ascending: false })
        .limit(500),
      (supabase as any)
        .from("ipc_infection_events")
        .select("*, wards(name)")
        .eq("hospital_id", hospitalId)
        .gte("onset_date", dateFrom)
        .lte("onset_date", dateTo)
        .order("onset_date", { ascending: false })
        .limit(500),
      (supabase as any)
        .from("ipc_bundle_checklists")
        .select("id,admission_id,device_type,bundle_type,checklist_date,compliance_pct")
        .eq("hospital_id", hospitalId)
        .gte("checklist_date", dateFrom)
        .lte("checklist_date", dateTo)
        .order("checklist_date", { ascending: false })
        .limit(300),
    ]);

    setDevices(devRes.data || []);
    setInfections(infRes.data || []);
    setBundles(bunRes.data || []);
    buildTrend(devRes.data || [], infRes.data || []);
    setLoading(false);
  }, [hospitalId, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Monthly KPI loading (always current vs prev calendar month) ───────────

  const loadMonthlyKpis = useCallback(async () => {
    if (!hospitalId) return;
    setKpiLoading(true);

    const now = new Date();
    const currStart = startOfMonth(now);
    const prevStart = startOfMonth(subMonths(now, 1));
    const prevEnd = endOfMonth(subMonths(now, 1));

    const [devRes, infRes, otRes] = await Promise.all([
      (supabase as any)
        .from("ipc_device_usage")
        .select("device_type,device_inserted_at,device_removed_at")
        .eq("hospital_id", hospitalId)
        .gte("device_inserted_at", prevStart.toISOString()),
      (supabase as any)
        .from("ipc_infection_events")
        .select("infection_type,onset_date")
        .eq("hospital_id", hospitalId)
        .gte("onset_date", format(prevStart, "yyyy-MM-dd")),
      (supabase as any)
        .from("ot_schedules")
        .select("id,scheduled_date")
        .eq("hospital_id", hospitalId)
        .eq("status", "completed")
        .gte("scheduled_date", format(prevStart, "yyyy-MM-dd"))
        .catch(() => ({ data: [] })),
    ]);

    const devs: { device_type: string; device_inserted_at: string; device_removed_at: string | null }[] = devRes.data || [];
    const infs: { infection_type: string; onset_date: string }[] = infRes.data || [];
    const otData: { scheduled_date: string }[] = (otRes as any)?.data || [];

    const computePeriod = (start: Date, end: Date): MonthKpi => {
      const periodDevs = devs.filter(d => {
        const ins = new Date(d.device_inserted_at);
        const rm = d.device_removed_at ? new Date(d.device_removed_at) : now;
        return ins <= end && rm >= start;
      });
      const clDays = deviceDays(periodDevs, "central_line");
      const ucDays = deviceDays(periodDevs, "urinary_catheter");
      const ventDays = deviceDays(periodDevs, "ventilator");

      const periodInfs = infs.filter(i => {
        const d = new Date(i.onset_date);
        return d >= start && d <= end;
      });
      const clabsi = periodInfs.filter(i => i.infection_type === "CLABSI").length;
      const cauti = periodInfs.filter(i => i.infection_type === "CAUTI").length;
      const vap = periodInfs.filter(i => i.infection_type === "VAP").length;
      const ssi = periodInfs.filter(i => i.infection_type === "SSI").length;

      const procs = otData.filter(c => {
        const d = new Date(c.scheduled_date);
        return d >= start && d <= end;
      }).length;

      return {
        clabsiRate: ratePerThousand(clabsi, clDays),
        cautiRate: ratePerThousand(cauti, ucDays),
        vapRate: ratePerThousand(vap, ventDays),
        ssiRate: ratePer100(ssi, procs),
        ssiCount: ssi,
        ssiProcedures: procs,
        clDays: Math.round(clDays),
        ucDays: Math.round(ucDays),
        ventDays: Math.round(ventDays),
      };
    };

    setCurrMonthKpi(computePeriod(currStart, now));
    setPrevMonthKpi(computePeriod(prevStart, prevEnd));
    setKpiLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadData(); }, [loadData, refreshKey]);
  useEffect(() => { loadMonthlyKpis(); }, [loadMonthlyKpis, refreshKey]);

  // ── Trend builder ─────────────────────────────────────────────────────────

  function buildTrend(devs: DeviceUsage[], infs: InfectionEvent[]) {
    const numMonths = Math.max(1, Math.min(12, Math.ceil(daysBack / 28)));
    const months: { label: string; start: Date; end: Date }[] = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      months.push({ label: format(d, "MMM yy"), start: startOfMonth(d), end: endOfMonth(d) });
    }

    const rows = months.map(m => {
      const mDevs = devs.filter(d => {
        const ins = new Date(d.device_inserted_at);
        const rm = d.device_removed_at ? new Date(d.device_removed_at) : new Date();
        return ins <= m.end && rm >= m.start;
      });
      const clDays = deviceDays(mDevs, "central_line");
      const ucDays = deviceDays(mDevs, "urinary_catheter");
      const ventDays = deviceDays(mDevs, "ventilator");

      const mInfs = infs.filter(i => {
        const d = new Date(i.onset_date);
        return d >= m.start && d <= m.end;
      });
      return {
        month: m.label,
        clabsiRate: ratePerThousand(mInfs.filter(i => i.infection_type === "CLABSI").length, clDays),
        cautiRate: ratePerThousand(mInfs.filter(i => i.infection_type === "CAUTI").length, ucDays),
        vapRate: ratePerThousand(mInfs.filter(i => i.infection_type === "VAP").length, ventDays),
        clDays: Math.round(clDays),
        ucDays: Math.round(ucDays),
        ventDays: Math.round(ventDays),
        totalInfections: mInfs.length,
      };
    });

    setTrendData(rows);
  }

  // ── Period-wide KPI calculations ──────────────────────────────────────────

  const kpis: KPIs = React.useMemo(() => {
    const deviceTypes = ["central_line", "peripheral_line", "urinary_catheter", "ventilator", "tracheostomy", "others"];
    const infTypes = ["CLABSI", "CAUTI", "VAP", "SSI", "BSI", "CDI", "MDRO", "other"];

    const dDays: Record<string, number> = {};
    const activeDevs: Record<string, number> = {};
    deviceTypes.forEach(t => {
      dDays[t] = Math.round(deviceDays(devices, t));
      activeDevs[t] = devices.filter(d => d.device_type === t && !d.device_removed_at).length;
    });

    const infCounts: Record<string, number> = {};
    infTypes.forEach(t => { infCounts[t] = infections.filter(i => i.infection_type === t).length; });

    const avgCompliance = bundles.length > 0
      ? bundles.reduce((s, b) => s + (b.compliance_pct ?? 100), 0) / bundles.length
      : null;

    return {
      deviceDays: dDays,
      infectionCounts: infCounts,
      rates: {
        clabsi: ratePerThousand(infCounts.CLABSI, dDays.central_line),
        cauti: ratePerThousand(infCounts.CAUTI, dDays.urinary_catheter),
        vap: ratePerThousand(infCounts.VAP, dDays.ventilator),
      },
      bundleCompliance: avgCompliance ? Math.round(avgCompliance) : null,
      activeDevices: activeDevs,
    };
  }, [devices, infections, bundles]);

  // ── AI Anomaly Detection ──────────────────────────────────────────────────

  const runAIInsights = async () => {
    if (!hospitalId) return;
    setAiLoading(true);
    setAiInsights("");
    setAiAcknowledged(false);

    const summary = {
      period: `${dateFrom} to ${dateTo} (${daysBack} days)`,
      currentMonth: currMonthKpi ? {
        clabsi: `${currMonthKpi.clabsiRate}/1000 line-days (${currMonthKpi.clDays} days)`,
        cauti: `${currMonthKpi.cautiRate}/1000 catheter-days (${currMonthKpi.ucDays} days)`,
        vap: `${currMonthKpi.vapRate}/1000 vent-days (${currMonthKpi.ventDays} days)`,
        ssi: `${currMonthKpi.ssiRate}/100 procedures (${currMonthKpi.ssiCount} events, ${currMonthKpi.ssiProcedures} OT cases)`,
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

NABH benchmark rates (India): CLABSI <1.5/1000 line-days, CAUTI <1.5/1000 catheter-days, VAP <2.0/1000 vent-days, SSI <2/100 procedures.

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
  const currMonthLabel = format(new Date(), "MMM yyyy");
  const prevMonthLabel = format(subMonths(new Date(), 1), "MMM yyyy");

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

      {/* ── Trend KPI Cards (current month vs previous month) ────────────── */}
      <div className="flex-shrink-0 px-5 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wide">HAI Rates</span>
          <span className="text-[10px] text-muted-foreground">
            — {currMonthLabel} vs {prevMonthLabel}
            {currMonthKpi?.ssiProcedures === 0 && <span className="ml-1 text-amber-600">(SSI: no OT procedures recorded)</span>}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <TrendKpiCard
            title="CLABSI Rate"
            subtitle={`Central line-days: ${currMonthKpi?.clDays ?? "—"} (curr) / ${prevMonthKpi?.clDays ?? "—"} (prev)`}
            current={currMonthKpi?.clabsiRate ?? null}
            previous={prevMonthKpi?.clabsiRate ?? null}
            benchmark={1.5}
            benchmarkLabel="NABH"
            unit="/1000 line-days"
            loading={kpiLoading}
          />
          <TrendKpiCard
            title="CAUTI Rate"
            subtitle={`Catheter-days: ${currMonthKpi?.ucDays ?? "—"} (curr) / ${prevMonthKpi?.ucDays ?? "—"} (prev)`}
            current={currMonthKpi?.cautiRate ?? null}
            previous={prevMonthKpi?.cautiRate ?? null}
            benchmark={1.5}
            benchmarkLabel="NABH"
            unit="/1000 cath-days"
            loading={kpiLoading}
          />
          <TrendKpiCard
            title="VAP Rate"
            subtitle={`Vent-days: ${currMonthKpi?.ventDays ?? "—"} (curr) / ${prevMonthKpi?.ventDays ?? "—"} (prev)`}
            current={currMonthKpi?.vapRate ?? null}
            previous={prevMonthKpi?.vapRate ?? null}
            benchmark={2.0}
            benchmarkLabel="NABH"
            unit="/1000 vent-days"
            loading={kpiLoading}
          />
          <TrendKpiCard
            title="SSI Rate"
            subtitle={`OT procedures: ${currMonthKpi?.ssiProcedures ?? "—"} (curr) / ${prevMonthKpi?.ssiProcedures ?? "—"} (prev)`}
            current={currMonthKpi?.ssiRate ?? null}
            previous={prevMonthKpi?.ssiRate ?? null}
            benchmark={2.0}
            benchmarkLabel="NABH"
            unit="/100 procedures"
            loading={kpiLoading}
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
          sub={`${bundles.length} checklists · ${dateFrom} – ${dateTo}`}
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
              <TabsTrigger key={t.v} value={t.v}
                className="text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 h-full"
              >{t.l}</TabsTrigger>
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
                    <BarChart data={Object.entries(DEVICE_LABELS).map(([k, l]) => ({ name: l.replace(" ", "\n"), days: kpis.deviceDays[k] || 0, fill: DEVICE_COLOURS[k] }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="days" name="Device Days">
                        {Object.entries(DEVICE_LABELS).map(([k]) => (
                          <rect key={k} fill={DEVICE_COLOURS[k]} />
                        ))}
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
                  <div className="space-y-3">
                    {[
                      { label: "CLABSI", rate: kpis.rates.clabsi, benchmark: 1.5, colour: "#ef4444" },
                      { label: "CAUTI",  rate: kpis.rates.cauti,  benchmark: 1.5, colour: "#f97316" },
                      { label: "VAP",    rate: kpis.rates.vap,    benchmark: 2.0, colour: "#3b82f6" },
                    ].map(({ label, rate, benchmark, colour }) => {
                      const exceeded = rate > benchmark;
                      return (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium">{label}</span>
                            <span className={exceeded ? "text-red-600 font-bold" : "text-green-600 font-semibold"}>
                              {rate} {exceeded ? "↑ EXCEEDED" : "✓"}
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                            <div className="h-full rounded-full" style={{ width: `${Math.min((rate / (benchmark * 2)) * 100, 100)}%`, backgroundColor: exceeded ? "#ef4444" : colour }} />
                            <div className="absolute top-0 h-full border-l-2 border-dashed border-gray-400" style={{ left: `${(benchmark / (benchmark * 2)) * 100}%` }} />
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
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold">Device Usage Log ({devices.length} records)</span>
                    <span className="text-xs text-muted-foreground">{dateFrom} – {dateTo}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          {["Type", "Ward", "Inserted", "Removed", "Device Days", "Status"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
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
                            </tr>
                          );
                        })}
                        {devices.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-sm">No device records in this period</td></tr>
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
                            No HAI events recorded in this period — excellent!
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
                  const avg = dtBundles.length > 0
                    ? Math.round(dtBundles.reduce((s, b) => s + (b.compliance_pct ?? 100), 0) / dtBundles.length)
                    : null;
                  return (
                    <div key={dt} className="rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEVICE_COLOURS[dt] }} />
                        <span className="text-sm font-semibold">{DEVICE_LABELS[dt]}</span>
                      </div>
                      <p className="text-2xl font-bold">{avg != null ? `${avg}%` : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{dtBundles.length} checklists</p>
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
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-sm font-semibold">Bundle Checklist Log</span>
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
                          const pct = b.compliance_pct ?? 100;
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
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full rounded-full"
                                      style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444" }} />
                                  </div>
                                  <span className={`text-xs font-semibold ${pct >= 80 ? "text-green-600" : pct >= 60 ? "text-amber-600" : "text-red-600"}`}>
                                    {pct}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {bundles.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground text-sm">No bundle checklists in this period</td></tr>
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
                      <strong>Note:</strong> NABH benchmarks — CLABSI &lt;1.5, CAUTI &lt;1.5, VAP &lt;2.0 per 1000 device-days; SSI &lt;2 per 100 procedures.
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
    </div>
  );
};

export default IPCDashboardPage;
