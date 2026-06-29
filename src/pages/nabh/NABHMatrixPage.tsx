import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  ArrowLeft, Search, Download, Loader2, AlertCircle, CheckCircle2,
  Clock, XCircle, MinusCircle, ChevronRight, ExternalLink, Sparkles,
} from "lucide-react";
import EvidenceManager from "@/components/nabh/EvidenceManager";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";
import WeeklyDigestModal, { DIGEST_ALLOWED_ROLES } from "@/components/nabh/WeeklyDigestModal";
import EvidenceGapsModal from "@/components/nabh/EvidenceGapsModal";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NABHStandard {
  id: string;
  chapter_code: string;
  standard_code: string;
  objective_element_code: string | null;
  level: "Core" | "Commitment" | "Achievement" | "Excellence";
  description: string;
  is_active: boolean;
}

interface ComplianceRecord {
  id: string;
  nabh_standard_id: string;
  applicability: string;
  status: string;
  risk_level: string;
  process_owner_id: string | null;
  last_assessed_at: string | null;
  assessor_score: number | null;
  comments: string | null;
  updated_at: string;
}

interface HospitalUser {
  id: string;
  full_name: string;
  role: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAPTERS = ["AAC", "COP", "MOM", "PRE", "HIC", "ROM", "FMS", "HRM", "IMS", "QPS"];
const CHAPTER_NAMES: Record<string, string> = {
  AAC: "Access, Assessment & Continuity",
  COP: "Care of Patients",
  MOM: "Management of Medication",
  PRE: "Patient Rights & Education",
  HIC: "Hospital Infection Control",
  ROM: "Responsibilities of Management",
  FMS: "Facility Management & Safety",
  HRM: "Human Resource Management",
  IMS: "Information Management",
  QPS: "Quality & Patient Safety",
};

const LEVELS: Array<"Core" | "Commitment" | "Achievement" | "Excellence"> = [
  "Core", "Commitment", "Achievement", "Excellence",
];
const LEVEL_COLOUR: Record<string, string> = {
  Core:        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Commitment:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Achievement: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Excellence:  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const STATUSES = ["Not Started", "In Progress", "Compliant", "Non-Compliant", "Partially Compliant"];
const STATUS_COLOUR: Record<string, string> = {
  "Compliant":           "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Partially Compliant": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Non-Compliant":       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "In Progress":         "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Not Started":         "bg-muted text-muted-foreground",
};
const STATUS_ICON: Record<string, React.ElementType> = {
  "Compliant":           CheckCircle2,
  "Partially Compliant": AlertCircle,
  "Non-Compliant":       XCircle,
  "In Progress":         Clock,
  "Not Started":         MinusCircle,
};

const RISK_COLOUR: Record<string, string> = {
  Low:      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Medium:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  High:     "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const DONUT_COLOURS: Record<string, string> = {
  "Compliant":           "#22c55e",
  "Partially Compliant": "#f59e0b",
  "Non-Compliant":       "#ef4444",
  "In Progress":         "#3b82f6",
  "Not Started":         "#94a3b8",
};

const DEFAULT_COMPLIANCE: Omit<ComplianceRecord, "id" | "nabh_standard_id" | "updated_at"> = {
  applicability: "Applicable",
  status: "Not Started",
  risk_level: "Medium",
  process_owner_id: null,
  last_assessed_at: null,
  assessor_score: null,
  comments: null,
};

// ─── Helper: inline Select cell ───────────────────────────────────────────────

const InlineSelect = ({
  value, options, onChange, colourMap, disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  colourMap: Record<string, string>;
  disabled?: boolean;
}) => (
  <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger className="h-7 text-xs border-0 bg-transparent px-1 w-full focus:ring-1 focus:ring-primary/50">
      <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", colourMap[value] ?? "bg-muted text-muted-foreground")}>
        {value}
      </span>
    </SelectTrigger>
    <SelectContent>
      {options.map(o => (
        <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);

// ─── Progress summary card ─────────────────────────────────────────────────────

const LevelCard = ({ level, total, compliant, pct }: { level: string; total: number; compliant: number; pct: number }) => (
  <div className="flex-1 min-w-[110px] rounded-lg border border-border bg-card p-3">
    <Badge className={cn("text-[10px] px-1.5 py-0 mb-2", LEVEL_COLOUR[level])}>{level}</Badge>
    <p className="text-2xl font-bold text-foreground leading-none mt-1">{pct}%</p>
    <p className="text-[11px] text-muted-foreground mt-1">{compliant}/{total} compliant</p>
    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  </div>
);

// ─── Main Page ─────────────────────────────────────────────────────────────────

const NABHMatrixPage: React.FC = () => {
  const { hospitalId, userId, role } = useHospitalId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [standards, setStandards] = useState<NABHStandard[]>([]);
  const [complianceMap, setComplianceMap] = useState<Record<string, ComplianceRecord>>({});
  const [hospitalUsers, setHospitalUsers] = useState<HospitalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Filters
  const [chapter, setChapter] = useState("ALL");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  // Weekly digest modal
  const [digestOpen, setDigestOpen] = useState(false);
  const canGenerateDigest = DIGEST_ALLOWED_ROLES.includes(role ?? "");

  // Evidence gaps modal
  const [evidenceGapsOpen, setEvidenceGapsOpen] = useState(false);

  // Drawer
  const [selectedStd, setSelectedStd] = useState<NABHStandard | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCompliance, setDrawerCompliance] = useState<Partial<ComplianceRecord>>({});

  // ── Load data ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [stdRes, compRes, userRes] = await Promise.all([
      (supabase as any).from("nabh_standards").select("*").eq("is_active", true).order("chapter_code").order("standard_code"),
      (supabase as any).from("nabh_hospital_compliance").select("*").eq("hospital_id", hospitalId),
      (supabase as any).from("users").select("id, full_name, role").eq("hospital_id", hospitalId).order("full_name"),
    ]);

    setStandards(stdRes.data || []);
    const map: Record<string, ComplianceRecord> = {};
    for (const c of compRes.data || []) map[c.nabh_standard_id] = c;
    setComplianceMap(map);
    setHospitalUsers(userRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Seed the search box from ?filter=AAC.1 query param (used by NABHBadge links)
  useEffect(() => {
    const filterParam = searchParams.get("filter");
    if (filterParam) setSearch(decodeURIComponent(filterParam));
  }, []); // intentionally runs once on mount

  // ── Upsert compliance record ────────────────────────────────────────────────
  const upsertCompliance = async (
    standardId: string,
    updates: Partial<Omit<ComplianceRecord, "id" | "nabh_standard_id" | "updated_at">>,
  ) => {
    if (!hospitalId) return;

    // Optimistic update
    setComplianceMap(prev => ({
      ...prev,
      [standardId]: {
        ...DEFAULT_COMPLIANCE,
        ...prev[standardId],
        ...updates,
        id: prev[standardId]?.id ?? "",
        nabh_standard_id: standardId,
        updated_at: new Date().toISOString(),
      },
    }));

    setSaving(p => ({ ...p, [standardId]: true }));
    const { data, error } = await (supabase as any)
      .from("nabh_hospital_compliance")
      .upsert(
        { hospital_id: hospitalId, nabh_standard_id: standardId, ...DEFAULT_COMPLIANCE, ...updates },
        { onConflict: "hospital_id,nabh_standard_id" },
      )
      .select()
      .single();

    setSaving(p => ({ ...p, [standardId]: false }));
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    if (data) {
      setComplianceMap(prev => ({ ...prev, [standardId]: data }));
    }
  };

  // ── Save drawer form ────────────────────────────────────────────────────────
  const saveDrawer = async () => {
    if (!selectedStd) return;
    await upsertCompliance(selectedStd.id, {
      ...drawerCompliance,
      last_assessed_at: new Date().toISOString(),
      last_assessed_by: userId ?? undefined,
    } as any);
    toast({ title: "Compliance record saved" });
  };

  // ── Open drawer ─────────────────────────────────────────────────────────────
  const openDrawer = (std: NABHStandard) => {
    setSelectedStd(std);
    const existing = complianceMap[std.id];
    setDrawerCompliance({
      applicability:    existing?.applicability    ?? "Applicable",
      status:           existing?.status           ?? "Not Started",
      risk_level:       existing?.risk_level       ?? "Medium",
      process_owner_id: existing?.process_owner_id ?? null,
      assessor_score:   existing?.assessor_score   ?? null,
      comments:         existing?.comments         ?? "",
    });
    setDrawerOpen(true);
  };

  // ── Filtered rows ───────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return standards.filter(s => {
      if (chapter !== "ALL" && s.chapter_code !== chapter) return false;
      if (levelFilter !== "ALL" && s.level !== levelFilter) return false;
      const c = complianceMap[s.id];
      if (statusFilter !== "ALL") {
        const st = c?.status ?? "Not Started";
        if (st !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          s.standard_code.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.chapter_code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [standards, complianceMap, chapter, levelFilter, statusFilter, search]);

  // ── Progress stats ──────────────────────────────────────────────────────────
  const levelStats = useMemo(() => {
    return LEVELS.map(lvl => {
      const applicable = standards.filter(
        s => s.level === lvl && complianceMap[s.id]?.applicability !== "Not Applicable",
      );
      const total = standards.filter(s => s.level === lvl).length;
      const compliant = applicable.filter(s => complianceMap[s.id]?.status === "Compliant").length;
      const notApplicable = standards.filter(
        s => s.level === lvl && complianceMap[s.id]?.applicability === "Not Applicable",
      ).length;
      const denominator = total - notApplicable;
      return { level: lvl, total, compliant, pct: denominator > 0 ? Math.round((compliant / denominator) * 100) : 0 };
    });
  }, [standards, complianceMap]);

  const donutData = useMemo(() => {
    const counts: Record<string, number> = {
      "Compliant": 0, "Partially Compliant": 0, "Non-Compliant": 0, "In Progress": 0, "Not Started": 0,
    };
    standards.forEach(s => {
      if (complianceMap[s.id]?.applicability === "Not Applicable") return;
      const st = complianceMap[s.id]?.status ?? "Not Started";
      counts[st] = (counts[st] ?? 0) + 1;
    });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [standards, complianceMap]);

  const overallPct = useMemo(() => {
    const applicable = standards.filter(s => complianceMap[s.id]?.applicability !== "Not Applicable");
    if (!applicable.length) return 0;
    const compliant = applicable.filter(s => complianceMap[s.id]?.status === "Compliant").length;
    return Math.round((compliant / applicable.length) * 100);
  }, [standards, complianceMap]);

  const chapterStats = useMemo(() => {
    return CHAPTERS.map(ch => {
      const applicable = standards.filter(
        s => s.chapter_code === ch && complianceMap[s.id]?.applicability !== "Not Applicable",
      );
      const total = applicable.length;
      const compliant = applicable.filter(s => complianceMap[s.id]?.status === "Compliant").length;
      const pct = total > 0 ? Math.round((compliant / total) * 100) : 0;
      return { chapter: ch, total, compliant, pct };
    });
  }, [standards, complianceMap]);

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const cols = ["Standard", "Chapter", "Level", "Description", "Applicability", "Status", "Risk", "Last Assessed"];
    const rows = standards.map(s => {
      const c = complianceMap[s.id];
      return [
        s.standard_code,
        s.chapter_code,
        s.level,
        `"${s.description.replace(/"/g, '""')}"`,
        c?.applicability ?? "Applicable",
        c?.status ?? "Not Started",
        c?.risk_level ?? "Medium",
        c?.last_assessed_at ? format(new Date(c.last_assessed_at), "dd/MM/yyyy") : "",
      ].join(",");
    });
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NABH-Matrix-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported" });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const stdForEvidence = selectedStd ? complianceMap[selectedStd.id] : null;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/quality")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Quality
          </button>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-sm font-semibold text-foreground">NABH Compliance Matrix</span>
          <Badge variant="outline" className="text-[10px]">6th Edition</Badge>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {canGenerateDigest && hospitalId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDigestOpen(true)}
              className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Weekly Digest
            </Button>
          )}
          {hospitalId && (
            <NABHAssistantPanel
              hospitalId={hospitalId}
              contextType="nabh_matrix"
              contextFilter={chapter !== "ALL" ? { chapter } : {}}
              evidenceTitle={`NABH Readiness Snapshot${chapter !== "ALL" ? ` – ${chapter}` : ""}`}
              moduleReference="NABHMatrixPage"
            />
          )}
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={loading}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Chapter Donuts Row */}
        <div className="flex-shrink-0 border-b border-border bg-card px-5 py-2.5">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-thin">
            {chapterStats.map(({ chapter: ch, pct, compliant, total }) => {
              const fill = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
              const textCls = pct >= 80 ? "text-green-600 dark:text-green-400" : pct >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
              const donutData = [
                { value: total === 0 ? 1 : compliant },
                { value: total === 0 ? 0 : Math.max(0, total - compliant) },
              ];
              const isActive = chapter === ch;
              return (
                <button
                  key={ch}
                  onClick={() => setChapter(isActive ? "ALL" : ch)}
                  title={`${CHAPTER_NAMES[ch]} — ${compliant}/${total} compliant (${pct}%)`}
                  className={cn(
                    "flex flex-col items-center gap-0.5 flex-shrink-0 rounded-xl px-2 py-1.5 transition-all hover:bg-muted/60",
                    isActive && "bg-primary/5 ring-1 ring-primary/30",
                  )}
                >
                  <div className="relative w-20 h-20">
                    <ResponsiveContainer width={80} height={80}>
                      <PieChart>
                        <Pie
                          dataKey="value"
                          data={donutData}
                          innerRadius={26}
                          outerRadius={36}
                          startAngle={90}
                          endAngle={-270}
                          strokeWidth={0}
                        >
                          <Cell fill={total === 0 ? "#e2e8f0" : fill} />
                          <Cell fill="#e2e8f0" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className={cn("text-[13px] font-bold leading-none", total === 0 ? "text-muted-foreground" : textCls)}>
                        {total === 0 ? "—" : `${pct}%`}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-foreground tracking-wide">{ch}</p>
                  <p className="text-[9px] text-muted-foreground leading-none">{compliant}/{total}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Progress Summary */}
        <div className="flex-shrink-0 border-b border-border bg-card px-5 py-3">
          <div className="flex items-stretch gap-3">
            {/* Overall donut */}
            <div className="w-[120px] flex flex-col items-center justify-center bg-muted/40 rounded-lg p-2 border border-border">
              {donutData.length > 0 ? (
                <ResponsiveContainer width={80} height={80}>
                  <PieChart>
                    <Pie dataKey="value" data={donutData} innerRadius={24} outerRadius={36} strokeWidth={0}>
                      {donutData.map(entry => (
                        <Cell key={entry.name} fill={DONUT_COLOURS[entry.name] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val, name) => [`${val} OEs`, name]}
                      contentStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[80px] flex items-center justify-center text-xs text-muted-foreground">—</div>
              )}
              <p className="text-[11px] font-semibold text-foreground">{overallPct}% overall</p>
              <p className="text-[10px] text-muted-foreground">{standards.length} standards</p>
            </div>

            {/* Per-level cards */}
            <div className="flex-1 flex gap-3 overflow-x-auto">
              {levelStats.map(ls => (
                <LevelCard key={ls.level} {...ls} />
              ))}
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex-shrink-0 px-5 py-2.5 border-b border-border bg-background flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-xs w-56"
              placeholder="Search standards…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={chapter} onValueChange={setChapter}>
            <SelectTrigger className="h-8 text-xs w-[200px]">
              <SelectValue placeholder="All Chapters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Chapters</SelectItem>
              {CHAPTERS.map(c => (
                <SelectItem key={c} value={c} className="text-xs">
                  {c} – {CHAPTER_NAMES[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hospitalId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEvidenceGapsOpen(true)}
              className="h-8 text-xs gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Find Evidence Gaps (AI)
            </Button>
          )}
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Levels</SelectItem>
              {LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {(chapter !== "ALL" || levelFilter !== "ALL" || statusFilter !== "ALL" || search) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => { setChapter("ALL"); setLevelFilter("ALL"); setStatusFilter("ALL"); setSearch(""); }}
            >
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredRows.length} of {standards.length} standards
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading standards…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No standards match the current filters.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr>
                  {["Ch", "Standard", "Level", "Description", "Applicability", "Status", "Risk", "Last Assessed", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground border-b border-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((std, i) => {
                  const c = complianceMap[std.id];
                  const applicability = c?.applicability ?? "Applicable";
                  const status       = c?.status       ?? "Not Started";
                  const riskLevel    = c?.risk_level   ?? "Medium";
                  const isSaving     = saving[std.id];
                  const isNA         = applicability === "Not Applicable";
                  const StatusIcon   = STATUS_ICON[status] ?? MinusCircle;

                  return (
                    <tr
                      key={std.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/30 transition-colors",
                        i % 2 === 0 ? "bg-background" : "bg-muted/10",
                        isNA && "opacity-50",
                      )}
                    >
                      {/* Chapter */}
                      <td className="px-3 py-2 font-mono font-semibold text-muted-foreground whitespace-nowrap">
                        {std.chapter_code}
                      </td>
                      {/* Standard code */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold text-foreground">{std.standard_code}</span>
                        {std.objective_element_code && (
                          <span className="text-muted-foreground ml-1">({std.objective_element_code})</span>
                        )}
                      </td>
                      {/* Level */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge className={cn("text-[10px] px-1.5 py-0", LEVEL_COLOUR[std.level])}>
                          {std.level}
                        </Badge>
                      </td>
                      {/* Description */}
                      <td className="px-3 py-2 max-w-[320px]">
                        <span
                          className="line-clamp-2 text-foreground cursor-pointer hover:text-primary"
                          title={std.description}
                          onClick={() => openDrawer(std)}
                        >
                          {std.description}
                        </span>
                      </td>
                      {/* Applicability – inline */}
                      <td className="px-1 py-1 w-[130px]">
                        <InlineSelect
                          value={applicability}
                          options={["Applicable", "Not Applicable"]}
                          onChange={v => upsertCompliance(std.id, { applicability: v })}
                          colourMap={{
                            Applicable: "bg-green-100 text-green-700",
                            "Not Applicable": "bg-muted text-muted-foreground",
                          }}
                          disabled={isSaving}
                        />
                      </td>
                      {/* Status – inline */}
                      <td className="px-1 py-1 w-[160px]">
                        <div className="flex items-center gap-1">
                          {isSaving
                            ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />
                            : <StatusIcon className={cn("h-3 w-3 shrink-0", STATUS_COLOUR[status].split(" ")[1])} />
                          }
                          <InlineSelect
                            value={status}
                            options={STATUSES}
                            onChange={v => upsertCompliance(std.id, { status: v })}
                            colourMap={STATUS_COLOUR}
                            disabled={isSaving || isNA}
                          />
                        </div>
                      </td>
                      {/* Risk – inline */}
                      <td className="px-1 py-1 w-[110px]">
                        <InlineSelect
                          value={riskLevel}
                          options={["Low", "Medium", "High", "Critical"]}
                          onChange={v => upsertCompliance(std.id, { risk_level: v })}
                          colourMap={RISK_COLOUR}
                          disabled={isSaving || isNA}
                        />
                      </td>
                      {/* Last assessed */}
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {c?.last_assessed_at
                          ? format(new Date(c.last_assessed_at), "dd/MM/yy")
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      {/* Open drawer */}
                      <td className="px-2 py-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => openDrawer(std)}
                          title="View details & evidence"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Weekly Digest Modal */}
      {hospitalId && (
        <WeeklyDigestModal
          open={digestOpen}
          hospitalId={hospitalId}
          onClose={() => setDigestOpen(false)}
        />
      )}

      {/* Evidence Gaps Modal */}
      {hospitalId && (
        <EvidenceGapsModal
          open={evidenceGapsOpen}
          hospitalId={hospitalId}
          onClose={() => setEvidenceGapsOpen(false)}
        />
      )}

      {/* Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto flex flex-col gap-0 p-0">
          {selectedStd && (
            <>
              <SheetHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
                <div className="flex items-start gap-2 justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {selectedStd.standard_code}
                      </span>
                      <Badge className={cn("text-[10px] px-1.5 py-0", LEVEL_COLOUR[selectedStd.level])}>
                        {selectedStd.level}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {selectedStd.chapter_code}
                      </Badge>
                    </div>
                    <SheetTitle className="text-sm font-medium text-foreground leading-snug">
                      {selectedStd.description}
                    </SheetTitle>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Compliance fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Applicability</Label>
                    <Select
                      value={drawerCompliance.applicability ?? "Applicable"}
                      onValueChange={v => setDrawerCompliance(p => ({ ...p, applicability: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Applicable" className="text-xs">Applicable</SelectItem>
                        <SelectItem value="Not Applicable" className="text-xs">Not Applicable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={drawerCompliance.status ?? "Not Started"}
                      onValueChange={v => setDrawerCompliance(p => ({ ...p, status: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Risk Level</Label>
                    <Select
                      value={drawerCompliance.risk_level ?? "Medium"}
                      onValueChange={v => setDrawerCompliance(p => ({ ...p, risk_level: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Low", "Medium", "High", "Critical"].map(r => (
                          <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assessor Score (0–5)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      step={0.5}
                      className="h-8 text-xs"
                      value={drawerCompliance.assessor_score ?? ""}
                      onChange={e => setDrawerCompliance(p => ({
                        ...p,
                        assessor_score: e.target.value ? Number(e.target.value) : null,
                      }))}
                      placeholder="e.g. 3.5"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Process Owner</Label>
                    <Select
                      value={drawerCompliance.process_owner_id ?? "none"}
                      onValueChange={v => setDrawerCompliance(p => ({ ...p, process_owner_id: v === "none" ? null : v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Assign owner…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs text-muted-foreground">— No owner —</SelectItem>
                        {hospitalUsers.map(u => (
                          <SelectItem key={u.id} value={u.id} className="text-xs">
                            {u.full_name}
                            <span className="ml-1 text-muted-foreground text-[10px]">
                              ({u.role.replace(/_/g, " ")})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Comments / Gap Notes</Label>
                    <Textarea
                      rows={3}
                      className="text-xs resize-none"
                      value={drawerCompliance.comments ?? ""}
                      onChange={e => setDrawerCompliance(p => ({ ...p, comments: e.target.value }))}
                      placeholder="Describe gaps, corrective actions, or notes…"
                    />
                  </div>
                </div>

                <Button className="w-full" size="sm" onClick={saveDrawer}>
                  Save Compliance Record
                </Button>

                {/* Last assessed info */}
                {stdForEvidence?.last_assessed_at && (
                  <p className="text-[11px] text-muted-foreground text-center -mt-2">
                    Last saved: {format(new Date(stdForEvidence.last_assessed_at), "dd MMM yyyy, HH:mm")}
                  </p>
                )}

                {/* Quick links */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Related Modules
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {getRelatedModules(selectedStd.chapter_code).map(({ label, path }) => (
                      <button
                        key={path}
                        onClick={() => navigate(path)}
                        className="flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors text-foreground"
                      >
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Evidence Manager (only after compliance record exists) */}
                <div className="border-t border-border pt-4">
                  {stdForEvidence?.id ? (
                    <EvidenceManager hospitalId={hospitalId!} complianceId={stdForEvidence.id} />
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Save the compliance record first to attach evidence items.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

// ─── Chapter → related module links ──────────────────────────────────────────

function getRelatedModules(chapterCode: string): Array<{ label: string; path: string }> {
  const map: Record<string, Array<{ label: string; path: string }>> = {
    AAC: [{ label: "OPD", path: "/opd" }, { label: "IPD", path: "/ipd" }, { label: "Patients", path: "/patients" }],
    COP: [{ label: "IPD", path: "/ipd" }, { label: "OT", path: "/ot" }, { label: "Emergency", path: "/emergency" }],
    MOM: [{ label: "Pharmacy", path: "/pharmacy" }, { label: "IPD", path: "/ipd" }],
    PRE: [{ label: "OPD", path: "/opd" }, { label: "Patients", path: "/patients" }],
    HIC: [{ label: "Nursing", path: "/nursing" }, { label: "IPD", path: "/ipd" }],
    ROM: [{ label: "Quality", path: "/quality" }, { label: "Settings", path: "/settings" }],
    FMS: [{ label: "Assets", path: "/assets" }, { label: "Biomedical", path: "/biomedical" }, { label: "Housekeeping", path: "/housekeeping" }],
    HRM: [{ label: "HR & Payroll", path: "/hr" }],
    IMS: [{ label: "MRD", path: "/mrd" }, { label: "Analytics", path: "/analytics" }],
    QPS: [{ label: "Quality", path: "/quality" }, { label: "Analytics", path: "/analytics" }],
  };
  return map[chapterCode] ?? [];
}

export default NABHMatrixPage;
