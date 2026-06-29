import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Plus, Search, Loader2, Sparkles, CheckCircle2,
  AlertTriangle, Clock, XCircle, ChevronRight, RefreshCw,
  ClipboardList, Target, AlertCircle,
} from "lucide-react";
import ReportEventModal from "@/components/safety/ReportEventModal";
import AIRootCauseAnalysis from "@/components/quality/AIRootCauseAnalysis";
import OverdueCAPABanner from "@/components/safety/OverdueCAPABanner";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";
import NABHBadge from "@/components/nabh/NABHBadge";
import { format, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SafetyEvent {
  id: string; event_number: string; event_type: string; category: string | null;
  severity: string | null; status: string; description: string;
  immediate_action_taken: string | null; location: string | null;
  reported_at: string; department_id: string | null;
  patient_id: string | null; linked_nabh_standard_id: string | null;
  reported_by: string | null; updated_at: string;
}

interface RCARecord {
  id?: string; methodology: string; rca_summary: string;
  contributing_factors: { people: string; process: string; equipment: string; environment: string };
  ai_draft_used: boolean; completed_at: string | null;
}

interface CAPARecord {
  id: string; action_type: string; action_description: string;
  responsible_owner_id: string | null; due_date: string | null;
  status: string; completed_at: string | null; effectiveness_review: string | null;
  ai_suggested: boolean;
}

interface Dept { id: string; name: string; }
interface HUser { id: string; full_name: string; role: string; }
interface NABHStd { id: string; standard_code: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPE_COLOUR: Record<string, string> = {
  incident:     "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  near_miss:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  sentinel:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  complaint:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  grievance:    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  legal_notice: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  claim:        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const SEVERITY_COLOUR: Record<string, string> = {
  no_harm:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  mild:     "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  severe:   "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  death:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_COLOUR: Record<string, string> = {
  open:                 "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  under_investigation:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  action_planned:       "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  closed:               "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const CAPA_STATUS_COLOUR: Record<string, string> = {
  open:        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cancelled:   "bg-muted text-muted-foreground",
};

const BLANK_RCA: RCARecord = {
  methodology: "5_whys",
  rca_summary: "",
  contributing_factors: { people: "", process: "", equipment: "", environment: "" },
  ai_draft_used: false,
  completed_at: null,
};

const BLANK_CAPA = { action_type: "corrective", action_description: "", responsible_owner_id: "", due_date: "" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EventTypeBadge = ({ type }: { type: string }) => (
  <Badge className={cn("text-[10px] px-1.5 py-0 capitalize", EVENT_TYPE_COLOUR[type] ?? "bg-muted text-muted-foreground")}>
    {type.replace(/_/g, " ")}
  </Badge>
);

const SeverityBadge = ({ severity }: { severity: string | null }) =>
  severity ? (
    <Badge className={cn("text-[10px] px-1.5 py-0 capitalize", SEVERITY_COLOUR[severity] ?? "bg-muted text-muted-foreground")}>
      {severity.replace(/_/g, " ")}
    </Badge>
  ) : null;

const StatusBadge = ({ status }: { status: string }) => (
  <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLOUR[status] ?? "bg-muted text-muted-foreground")}>
    {status.replace(/_/g, " ")}
  </Badge>
);

// ─── Main Page ─────────────────────────────────────────────────────────────────

const SafetyEventsPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [users, setUsers] = useState<HUser[]>([]);
  const [nabh, setNabh] = useState<NABHStd[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  // Overdue-CAPA deep-link filter — populated when ?overdue_capa=1 is present
  const [overdueEventIds, setOverdueEventIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (searchParams.get("overdue_capa") !== "1" || !hospitalId) return;
    const load = async () => {
      const { data: evRows } = await (supabase as any)
        .from("safety_events").select("id").eq("hospital_id", hospitalId);
      const ids: string[] = (evRows || []).map((r: any) => r.id);
      if (ids.length === 0) { setOverdueEventIds([]); return; }
      const today = new Date().toISOString().split("T")[0];
      const { data: capaRows } = await (supabase as any)
        .from("safety_event_capa")
        .select("safety_event_id")
        .in("safety_event_id", ids)
        .lt("due_date", today)
        .neq("status", "completed")
        .neq("status", "cancelled");
      const overdueIds = [...new Set((capaRows || []).map((r: any) => r.safety_event_id as string))];
      setOverdueEventIds(overdueIds);
    };
    load();
  }, [searchParams, hospitalId]);

  // Detail pane
  const [selectedEvent, setSelectedEvent] = useState<SafetyEvent | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "rca" | "capa">("overview");

  // Overview edit
  const [overviewEdit, setOverviewEdit] = useState(false);
  const [overviewForm, setOverviewForm] = useState<Partial<SafetyEvent>>({});
  const [savingOverview, setSavingOverview] = useState(false);

  // RCA state
  const [rca, setRca] = useState<RCARecord>(BLANK_RCA);
  const [rcaId, setRcaId] = useState<string | undefined>();
  const [savingRca, setSavingRca] = useState(false);
  const [rcaAiDraft, setRcaAiDraft] = useState("");
  const [rcaAiLoading, setRcaAiLoading] = useState(false);
  const [rcaAiAttest, setRcaAiAttest] = useState(false);
  // NABH-assistant RCA draft (read-only panel, gates Save RCA)
  const [rcaNabhDraft, setRcaNabhDraft] = useState("");
  const [rcaNabhLoading, setRcaNabhLoading] = useState(false);
  const [rcaReviewed, setRcaReviewed] = useState(false);

  // CAPA state
  const [capas, setCapas] = useState<CAPARecord[]>([]);
  const [addingCapa, setAddingCapa] = useState(false);
  const [capaForm, setCapaForm] = useState(BLANK_CAPA);
  const [savingCapa, setSavingCapa] = useState(false);
  const [capaAiLoading, setCAPAAiLoading] = useState(false);
  const [capaAiSuggestions, setCapaAiSuggestions] = useState<string[]>([]);
  const [capaAiAttest, setCapaAiAttest] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [evRes, dRes, uRes, nRes] = await Promise.all([
      (supabase as any)
        .from("safety_events").select("*").eq("hospital_id", hospitalId)
        .order("reported_at", { ascending: false }),
      (supabase as any).from("departments").select("id, name").eq("hospital_id", hospitalId).order("name"),
      (supabase as any).from("users").select("id, full_name, role").eq("hospital_id", hospitalId).order("full_name"),
      (supabase as any).from("nabh_standards").select("id, standard_code").eq("is_active", true).order("standard_code"),
    ]);
    setEvents(evRes.data || []);
    setDepts(dRes.data || []);
    setUsers(uRes.data || []);
    setNabh(nRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Load RCA + CAPAs when selected event changes
  useEffect(() => {
    if (!selectedEvent) return;
    setRca(BLANK_RCA);
    setRcaId(undefined);
    setCapas([]);
    setRcaAiDraft("");
    setRcaAiAttest(false);
    setRcaNabhDraft("");
    setRcaNabhLoading(false);
    setRcaReviewed(false);
    setCapaAiSuggestions([]);
    setCapaAiAttest(false);

    Promise.all([
      (supabase as any).from("safety_event_rca").select("*").eq("safety_event_id", selectedEvent.id).maybeSingle(),
      (supabase as any).from("safety_event_capa").select("*").eq("safety_event_id", selectedEvent.id).order("created_at"),
    ]).then(([rcaRes, capaRes]) => {
      if (rcaRes.data) {
        setRcaId(rcaRes.data.id);
        setRca({
          methodology: rcaRes.data.methodology || "5_whys",
          rca_summary: rcaRes.data.rca_summary || "",
          contributing_factors: rcaRes.data.contributing_factors || BLANK_RCA.contributing_factors,
          ai_draft_used: rcaRes.data.ai_draft_used || false,
          completed_at: rcaRes.data.completed_at,
        });
      }
      setCapas(capaRes.data || []);
    });
  }, [selectedEvent?.id]); // eslint-disable-line

  // ── Filtered events ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => events.filter(e => {
    if (overdueEventIds !== null && !overdueEventIds.includes(e.id)) return false;
    if (typeFilter !== "ALL" && e.event_type !== typeFilter) return false;
    if (severityFilter !== "ALL" && e.severity !== severityFilter) return false;
    if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
    if (deptFilter !== "ALL" && e.department_id !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.event_number.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q)
      );
    }
    return true;
  }), [events, overdueEventIds, typeFilter, severityFilter, statusFilter, deptFilter, search]);

  // ── Select event ────────────────────────────────────────────────────────────
  const selectEvent = (ev: SafetyEvent) => {
    setSelectedEvent(ev);
    setOverviewForm({ status: ev.status, immediate_action_taken: ev.immediate_action_taken || "", location: ev.location || "" });
    setOverviewEdit(false);
    setDetailTab("overview");
    setAddingCapa(false);
  };

  // ── Save overview ───────────────────────────────────────────────────────────
  const saveOverview = async () => {
    if (!selectedEvent) return;
    setSavingOverview(true);
    const updates: Record<string, any> = {};
    if (overviewForm.status !== undefined)                   updates.status = overviewForm.status;
    if (overviewForm.immediate_action_taken !== undefined)   updates.immediate_action_taken = overviewForm.immediate_action_taken;
    if (overviewForm.location !== undefined)                 updates.location = overviewForm.location;

    const { error } = await (supabase as any).from("safety_events").update(updates).eq("id", selectedEvent.id);
    setSavingOverview(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }

    setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, ...updates } : e));
    setSelectedEvent(prev => prev ? { ...prev, ...updates } : prev);
    setOverviewEdit(false);
    toast({ title: "Event updated" });
  };

  // ── Save RCA ────────────────────────────────────────────────────────────────
  const saveRca = async () => {
    if (!selectedEvent) return;
    setSavingRca(true);
    const payload = {
      safety_event_id: selectedEvent.id,
      methodology: rca.methodology,
      rca_summary: rca.rca_summary,
      contributing_factors: rca.contributing_factors,
      ai_draft_used: rca.ai_draft_used,
      completed_by: userId ?? null,
      completed_at: rca.rca_summary.trim() ? new Date().toISOString() : null,
    };

    let error;
    if (rcaId) {
      ({ error } = await (supabase as any).from("safety_event_rca").update(payload).eq("id", rcaId));
    } else {
      const { data, error: e } = await (supabase as any).from("safety_event_rca").insert(payload).select("id").single();
      error = e;
      if (data) setRcaId(data.id);
    }
    setSavingRca(false);
    if (error) { toast({ title: "RCA save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "RCA saved" });

    // Auto-advance event status
    if (selectedEvent.status === "open" || selectedEvent.status === "under_investigation") {
      await (supabase as any).from("safety_events").update({ status: "under_investigation" }).eq("id", selectedEvent.id);
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, status: "under_investigation" } : e));
      setSelectedEvent(prev => prev ? { ...prev, status: "under_investigation" } : prev);
    }
  };

  // ── AI: generate RCA draft ──────────────────────────────────────────────────
  const generateRcaAI = async () => {
    if (!selectedEvent || !hospitalId) return;
    setRcaAiLoading(true);
    setRcaAiDraft("");
    const res = await callAI({
      featureKey: "nabh_criteria_mapper",
      hospitalId,
      prompt: `You are a clinical quality expert at an Indian hospital. Generate a structured 5-Whys RCA draft for this patient safety event.

Event Type: ${selectedEvent.event_type.replace(/_/g, " ")}
Category: ${(selectedEvent.category || "not specified").replace(/_/g, " ")}
Severity: ${selectedEvent.severity || "not specified"}
Description: ${selectedEvent.description}
Immediate Action: ${selectedEvent.immediate_action_taken || "none documented"}

Respond in this EXACT format:

WHY 1 (Immediate cause): [direct cause]
WHY 2 (Contributing factor): [deeper cause]
WHY 3 (System factor): [process/system issue]
WHY 4 (Organisational factor): [management/policy gap]
WHY 5 (Root cause): [fundamental root cause]

ROOT CAUSE SUMMARY: [2-3 sentences describing the root cause for NABH documentation]

CONTRIBUTING FACTORS:
People: [staff knowledge, training, behaviour factors]
Process: [protocol, workflow, communication gaps]
Equipment: [device, material, maintenance issues — or "Not applicable"]
Environment: [physical environment, workload, time pressure — or "Not applicable"]`,
      maxTokens: 700,
    });
    setRcaAiLoading(false);
    if (res.error) {
      toast({ title: "AI unavailable", description: res.error, variant: "destructive" });
      return;
    }
    setRcaAiDraft(res.text);
    setRcaAiAttest(false);
  };

  const applyRcaDraft = () => {
    if (!rcaAiDraft || !rcaAiAttest) return;
    // Extract root cause summary
    const summaryMatch = rcaAiDraft.match(/ROOT CAUSE SUMMARY:\s*(.+?)(?:\n|CONTRIBUTING|$)/si);
    const summary = summaryMatch ? summaryMatch[1].trim() : rcaAiDraft;
    // Extract contributing factors
    const peopleMatch   = rcaAiDraft.match(/People:\s*(.+?)(?:\n|Process:|$)/si);
    const processMatch  = rcaAiDraft.match(/Process:\s*(.+?)(?:\n|Equipment:|$)/si);
    const equipMatch    = rcaAiDraft.match(/Equipment:\s*(.+?)(?:\n|Environment:|$)/si);
    const envMatch      = rcaAiDraft.match(/Environment:\s*(.+?)(?:\n|$)/si);
    setRca(p => ({
      ...p,
      rca_summary: summary,
      contributing_factors: {
        people:      (peopleMatch?.[1] || "").trim(),
        process:     (processMatch?.[1] || "").trim(),
        equipment:   (equipMatch?.[1] || "").trim(),
        environment: (envMatch?.[1] || "").trim(),
      },
      ai_draft_used: true,
    }));
    setRcaAiDraft("");
    setRcaAiAttest(false);
    toast({ title: "AI draft applied — please review before saving" });
  };

  // ── AI: generate 5-Whys RCA via ai-nabh-assistant edge function ─────────────
  const generateRcaNabh = async () => {
    if (!selectedEvent || !hospitalId) return;
    setRcaNabhLoading(true);
    setRcaNabhDraft("");
    setRcaReviewed(false);

    const { data, error } = await supabase.functions.invoke("ai-nabh-assistant", {
      body: {
        hospital_id: hospitalId,
        context_type: "psq",
        context_filter: {
          rca_draft_for_event: {
            event_type: selectedEvent.event_type,
            category: selectedEvent.category || "not specified",
            severity: selectedEvent.severity || "not specified",
            description: selectedEvent.description,
            immediate_action: selectedEvent.immediate_action_taken || "none documented",
          },
        },
      },
    });

    setRcaNabhLoading(false);

    if (error || !data?.summary) {
      toast({ title: "AI unavailable", description: error?.message ?? "No response", variant: "destructive" });
      return;
    }

    setRcaNabhDraft(data.summary);

    // Log AI usage
    supabase.from("ai_feature_logs").insert({
      hospital_id: hospitalId,
      feature_key: "rca_draft_5whys",
      module: "safety_events",
      success: true,
      output_summary: `5-Whys RCA draft generated for event ${selectedEvent.event_number}`,
    }).catch(() => null);
  };

  // ── Save CAPA ───────────────────────────────────────────────────────────────
  const saveCapa = async () => {
    if (!selectedEvent || !capaForm.action_description.trim()) {
      toast({ title: "Action description required", variant: "destructive" });
      return;
    }
    setSavingCapa(true);
    const payload: Record<string, any> = {
      safety_event_id: selectedEvent.id,
      action_type: capaForm.action_type,
      action_description: capaForm.action_description.trim(),
    };
    if (capaForm.responsible_owner_id)  payload.responsible_owner_id = capaForm.responsible_owner_id;
    if (capaForm.due_date)              payload.due_date = capaForm.due_date;

    const { data, error } = await (supabase as any).from("safety_event_capa").insert(payload).select().single();
    setSavingCapa(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setCapas(prev => [...prev, data]);
    setCapaForm(BLANK_CAPA);
    setAddingCapa(false);
    toast({ title: "CAPA action added" });

    // Auto-advance event status
    if (selectedEvent.status !== "action_planned" && selectedEvent.status !== "closed") {
      await (supabase as any).from("safety_events").update({ status: "action_planned" }).eq("id", selectedEvent.id);
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, status: "action_planned" } : e));
      setSelectedEvent(prev => prev ? { ...prev, status: "action_planned" } : prev);
    }
  };

  const updateCapaStatus = async (capaId: string, status: string) => {
    const extra: Record<string, any> = {};
    if (status === "completed") extra.completed_at = new Date().toISOString();
    await (supabase as any).from("safety_event_capa").update({ status, ...extra }).eq("id", capaId);
    setCapas(prev => prev.map(c => c.id === capaId ? { ...c, status, ...extra } : c));
  };

  // ── AI: suggest CAPA actions ────────────────────────────────────────────────
  const suggestCapaAI = async () => {
    if (!selectedEvent || !hospitalId) return;
    setCAPAAiLoading(true);
    setCapaAiSuggestions([]);
    const res = await callAI({
      featureKey: "nabh_criteria_mapper",
      hospitalId,
      prompt: `You are a hospital quality officer. Suggest 3 specific corrective and preventive actions for this patient safety event. Be concise and actionable.

Event Type: ${selectedEvent.event_type.replace(/_/g, " ")}
Category: ${(selectedEvent.category || "not specified").replace(/_/g, " ")}
Description: ${selectedEvent.description}
RCA Summary: ${rca.rca_summary || "Not completed"}

Respond ONLY as a JSON array of 3 objects:
[
  {"type": "corrective", "action": "specific action description"},
  {"type": "preventive", "action": "specific action description"},
  {"type": "preventive", "action": "specific action description"}
]`,
      maxTokens: 400,
    });
    setCAPAAiLoading(false);
    if (res.error) {
      toast({ title: "AI unavailable", description: res.error, variant: "destructive" });
      return;
    }
    try {
      const jsonMatch = res.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array");
      const parsed: Array<{ type: string; action: string }> = JSON.parse(jsonMatch[0]);
      setCapaAiSuggestions(parsed.map(p => `[${p.type}] ${p.action}`));
    } catch {
      toast({ title: "Could not parse AI suggestions", variant: "destructive" });
    }
  };

  const addSuggestedCapa = async (suggestion: string) => {
    if (!selectedEvent || !capaAiAttest) return;
    const match = suggestion.match(/^\[(\w+)\] (.+)$/);
    if (!match) return;
    const { data, error } = await (supabase as any).from("safety_event_capa").insert({
      safety_event_id: selectedEvent.id,
      action_type: match[1] as string,
      action_description: match[2],
      ai_suggested: true,
    }).select().single();
    if (!error && data) {
      setCapas(prev => [...prev, data]);
      toast({ title: "Action added from AI suggestion" });
    }
  };

  // ── Stats (top summary) ─────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:      events.length,
    open:       events.filter(e => e.status === "open").length,
    sentinel:   events.filter(e => e.event_type === "sentinel").length,
    closed_30d: events.filter(e => {
      if (e.status !== "closed") return false;
      const diff = Date.now() - new Date(e.reported_at).getTime();
      return diff < 30 * 24 * 60 * 60 * 1000;
    }).length,
  }), [events]);

  const deptName = (id: string | null) => depts.find(d => d.id === id)?.name ?? "—";
  const userName = (id: string | null) => users.find(u => u.id === id)?.full_name ?? "—";

  const severityRowBg = (severity: string | null): string => {
    if (severity === "death" || severity === "severe") return "bg-red-50 dark:bg-red-950/20";
    if (severity === "moderate") return "bg-amber-50 dark:bg-amber-950/20";
    if (severity === "mild") return "bg-yellow-50 dark:bg-yellow-950/20";
    return "";
  };

  const daysOpen = (ev: SafetyEvent): number | null => {
    if (ev.status === "closed") return null;
    return Math.floor((Date.now() - new Date(ev.reported_at).getTime()) / 86_400_000);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
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
          <span className="text-sm font-semibold text-foreground">Safety Events & Complaints</span>
        </div>
        <div className="flex items-center gap-2">
          <NABHBadge standardCodes={["QPS.3", "QPS.4", "QPS.5"]} />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="ghost" onClick={loadEvents} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {hospitalId && (
            <NABHAssistantPanel
              hospitalId={hospitalId}
              contextType="psq"
              evidenceTitle="Patient Safety Analysis"
              moduleReference="SafetyEventsPage"
            />
          )}
          <Button size="sm" onClick={() => setReportOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Report Event
          </Button>
        </div>
      </div>

      {/* Overdue CAPA banner */}
      <OverdueCAPABanner hospitalId={hospitalId} />

      {/* Summary strip */}
      <div className="flex-shrink-0 border-b border-border bg-card px-5 py-2.5 flex gap-4">
        {[
          { label: "Total",     value: stats.total,      colour: "text-foreground" },
          { label: "Open",      value: stats.open,        colour: stats.open > 0 ? "text-red-600" : "text-foreground" },
          { label: "Sentinel",  value: stats.sentinel,    colour: stats.sentinel > 0 ? "text-red-700 font-bold" : "text-foreground" },
          { label: "Closed (30d)", value: stats.closed_30d, colour: "text-green-600" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 pr-4 border-r border-border last:border-0">
            <span className={cn("text-xl font-bold", s.colour)}>{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: filters + list ──────────────────────────────────── */}
        <div className="w-[340px] flex-shrink-0 border-r border-border flex flex-col">
          {/* Filter bar */}
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-7 text-xs" placeholder="Search events…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1.5">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Types</SelectItem>
                  {["incident","near_miss","sentinel","complaint","grievance","legal_notice","claim"].map(t => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Statuses</SelectItem>
                  {["open","under_investigation","action_planned","closed"].map(s => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Severities</SelectItem>
                  {["no_harm","mild","moderate","severe","death"].map(s => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue placeholder="Dept" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-xs">All Depts</SelectItem>
                  {depts.map(d => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] text-muted-foreground">{filtered.length} of {events.length} events</p>
              {overdueEventIds !== null && (
                <span className="flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  ⚠️ Overdue CAPAs
                  <button
                    onClick={() => setOverdueEventIds(null)}
                    className="ml-0.5 hover:text-amber-900 dark:hover:text-amber-200"
                    aria-label="Clear overdue filter"
                  >×</button>
                </span>
              )}
            </div>
            {/* Severity legend */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {[
                { label: "Death / Severe", bg: "bg-red-100 dark:bg-red-900/30",    text: "text-red-700 dark:text-red-400" },
                { label: "Moderate",       bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400" },
                { label: "Mild",           bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-500" },
                { label: "No Harm",        bg: "bg-slate-100 dark:bg-slate-800",    text: "text-slate-500 dark:text-slate-400" },
              ].map(l => (
                <span key={l.label} className={cn("text-[9px] font-semibold px-2 py-0.5 rounded-full", l.bg, l.text)}>
                  {l.label}
                </span>
              ))}
            </div>
          </div>

          {/* Event list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-xs">No events match the filters</div>
            ) : (
              filtered.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => selectEvent(ev)}
                  className={cn(
                    "w-full text-left p-3 border-b border-border/50 transition-colors",
                    severityRowBg(ev.severity),
                    selectedEvent?.id === ev.id
                      ? "bg-primary/10 border-l-2 border-l-primary"
                      : "hover:brightness-95",
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-xs font-bold text-foreground">{ev.event_number}</span>
                    <div className="flex items-center gap-1">
                      {(() => {
                        const days = daysOpen(ev);
                        if (days === null) return null;
                        return (
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded",
                            days > 7
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-muted text-muted-foreground",
                          )}>
                            {days}d open
                          </span>
                        );
                      })()}
                      <StatusBadge status={ev.status} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <EventTypeBadge type={ev.event_type} />
                    {ev.severity && <SeverityBadge severity={ev.severity} />}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{ev.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {format(parseISO(ev.reported_at), "dd MMM yyyy")}
                    {ev.department_id && ` · ${deptName(ev.department_id)}`}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Right panel: event detail ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {!selectedEvent ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <ClipboardList className="h-12 w-12 opacity-20" />
              <p className="text-sm">Select an event to view details</p>
              <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Report First Event
              </Button>
            </div>
          ) : (
            <>
              {/* Event header */}
              <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono font-bold text-sm text-foreground">{selectedEvent.event_number}</span>
                    <EventTypeBadge type={selectedEvent.event_type} />
                    {selectedEvent.severity && <SeverityBadge severity={selectedEvent.severity} />}
                    <StatusBadge status={selectedEvent.status} />
                    {selectedEvent.linked_nabh_standard_id && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {nabh.find(n => n.id === selectedEvent.linked_nabh_standard_id)?.standard_code ?? "NABH linked"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reported: {format(parseISO(selectedEvent.reported_at), "dd MMM yyyy, HH:mm")}
                    {selectedEvent.department_id && ` · ${deptName(selectedEvent.department_id)}`}
                  </p>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex-shrink-0 border-b border-border bg-card flex">
                {(["overview", "rca", "capa"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={cn(
                      "flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium transition-colors border-b-2",
                      detailTab === tab
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab === "overview" && <ClipboardList className="h-3.5 w-3.5" />}
                    {tab === "rca" && <AlertCircle className="h-3.5 w-3.5" />}
                    {tab === "capa" && <Target className="h-3.5 w-3.5" />}
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto px-5 py-4">

                {/* ── Overview ────────────────────────────────────────────── */}
                {detailTab === "overview" && (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-semibold">Event Details</h3>
                      {!overviewEdit
                        ? <Button size="sm" variant="outline" onClick={() => setOverviewEdit(true)}>Edit</Button>
                        : <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setOverviewEdit(false)}>Cancel</Button>
                            <Button size="sm" onClick={saveOverview} disabled={savingOverview}>
                              {savingOverview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </Button>
                          </div>
                      }
                    </div>

                    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3 text-sm">
                      <p className="text-foreground">{selectedEvent.description}</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Category: </span>
                          <span className="font-medium capitalize">{(selectedEvent.category || "—").replace(/_/g, " ")}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Location: </span>
                          {overviewEdit
                            ? <Input value={overviewForm.location ?? ""} onChange={e => setOverviewForm(p => ({ ...p, location: e.target.value }))} className="h-6 text-xs inline-block w-32 ml-1" />
                            : <span className="font-medium">{selectedEvent.location || "—"}</span>
                          }
                        </div>
                        <div>
                          <span className="text-muted-foreground">Reported by: </span>
                          <span className="font-medium">{userName(selectedEvent.reported_by)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Status: </span>
                          {overviewEdit ? (
                            <Select value={overviewForm.status ?? selectedEvent.status} onValueChange={v => setOverviewForm(p => ({ ...p, status: v }))}>
                              <SelectTrigger className="h-6 text-xs inline-flex w-36 ml-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {["open","under_investigation","action_planned","closed"].map(s => (
                                  <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <StatusBadge status={selectedEvent.status} />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Immediate Action Taken</Label>
                      {overviewEdit
                        ? <Textarea
                            rows={3}
                            className="text-xs resize-none"
                            value={overviewForm.immediate_action_taken ?? ""}
                            onChange={e => setOverviewForm(p => ({ ...p, immediate_action_taken: e.target.value }))}
                          />
                        : <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-foreground min-h-[60px]">
                            {selectedEvent.immediate_action_taken || <span className="italic text-muted-foreground">Not documented</span>}
                          </div>
                      }
                    </div>

                    {/* Progress timeline */}
                    <div className="pt-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-3">Workflow Progress</p>
                      <div className="flex items-center gap-1">
                        {[
                          { key: "open",               label: "Reported" },
                          { key: "under_investigation", label: "Under Review" },
                          { key: "action_planned",      label: "Action Planned" },
                          { key: "closed",              label: "Closed" },
                        ].map((step, idx, arr) => {
                          const statuses = arr.map(a => a.key);
                          const currentIdx = statuses.indexOf(selectedEvent.status);
                          const stepIdx = statuses.indexOf(step.key);
                          const done = stepIdx <= currentIdx;
                          return (
                            <React.Fragment key={step.key}>
                              <div className="flex flex-col items-center gap-1">
                                <div className={cn(
                                  "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors",
                                  done ? "bg-primary border-primary text-primary-foreground" : "border-border text-muted-foreground"
                                )}>
                                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{step.label}</span>
                              </div>
                              {idx < arr.length - 1 && (
                                <div className={cn("flex-1 h-0.5 mb-4", done && stepIdx < currentIdx ? "bg-primary" : "bg-border")} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── RCA ─────────────────────────────────────────────────── */}
                {detailTab === "rca" && (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="text-sm font-semibold">Root Cause Analysis</h3>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                          onClick={generateRcaNabh}
                          disabled={rcaNabhLoading || rcaAiLoading}
                        >
                          {rcaNabhLoading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Sparkles className="h-3 w-3 text-amber-500" />}
                          {rcaNabhLoading ? "Generating…" : "Generate Draft RCA (5 Whys)"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs"
                          onClick={generateRcaAI}
                          disabled={rcaAiLoading || rcaNabhLoading}
                        >
                          {rcaAiLoading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Sparkles className="h-3 w-3 text-purple-500" />}
                          {rcaAiLoading ? "Generating…" : "Generate AI Draft"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={saveRca}
                          disabled={savingRca || !rcaReviewed}
                          title={!rcaReviewed ? "Tick the review checkbox to enable" : undefined}
                        >
                          {savingRca ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save RCA"}
                        </Button>
                      </div>
                    </div>

                    {/* NABH-assistant 5-Whys draft panel (read-only) */}
                    {rcaNabhDraft && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" /> AI Draft — Review Before Saving
                        </p>
                        <Textarea
                          value={rcaNabhDraft}
                          readOnly
                          rows={12}
                          className="text-xs font-mono resize-none bg-white dark:bg-card cursor-default select-text"
                        />
                        <div className="flex items-start gap-2 pt-1">
                          <Checkbox
                            id="rca-reviewed"
                            checked={rcaReviewed}
                            onCheckedChange={v => setRcaReviewed(!!v)}
                          />
                          <label htmlFor="rca-reviewed" className="text-xs text-foreground cursor-pointer leading-relaxed">
                            I have reviewed and edited this RCA — the content above is clinically accurate and suitable for NABH documentation
                          </label>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-muted-foreground"
                          onClick={() => { setRcaNabhDraft(""); setRcaReviewed(false); }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}

                    {/* Mandatory review checkbox when no AI draft was generated */}
                    {!rcaNabhDraft && (
                      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
                        <Checkbox
                          id="rca-reviewed-plain"
                          checked={rcaReviewed}
                          onCheckedChange={v => setRcaReviewed(!!v)}
                        />
                        <label htmlFor="rca-reviewed-plain" className="text-xs text-muted-foreground cursor-pointer leading-relaxed">
                          I have reviewed and edited this RCA before saving
                        </label>
                      </div>
                    )}

                    {/* Existing editable AI draft panel */}
                    {rcaAiDraft && (
                      <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-4 space-y-3">
                        <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" /> AI Draft — Review, Edit, then Apply
                        </p>
                        <Textarea
                          value={rcaAiDraft}
                          onChange={e => setRcaAiDraft(e.target.value)}
                          rows={10}
                          className="text-xs font-mono resize-none bg-white dark:bg-card"
                        />
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="rca-attest"
                            checked={rcaAiAttest}
                            onCheckedChange={v => setRcaAiAttest(!!v)}
                          />
                          <label htmlFor="rca-attest" className="text-xs text-foreground cursor-pointer">
                            I have reviewed this AI-generated RCA and confirm it is clinically accurate
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={!rcaAiAttest} onClick={applyRcaDraft}>
                            Apply to RCA Form
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRcaAiDraft("")}>Dismiss</Button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">RCA Methodology</Label>
                        <Select value={rca.methodology} onValueChange={v => setRca(p => ({ ...p, methodology: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[
                              { value: "5_whys",   label: "5 Whys" },
                              { value: "fishbone", label: "Fishbone (Ishikawa)" },
                              { value: "fmea",     label: "FMEA" },
                              { value: "other",    label: "Other" },
                            ].map(m => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">RCA Summary / Root Cause</Label>
                        <Textarea
                          rows={4}
                          value={rca.rca_summary}
                          onChange={e => setRca(p => ({ ...p, rca_summary: e.target.value }))}
                          className="text-xs resize-none"
                          placeholder="Describe the root cause identified…"
                        />
                        {rca.ai_draft_used && (
                          <p className="text-[10px] text-purple-600 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> AI draft was used and attested
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Contributing Factors</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(["people", "process", "equipment", "environment"] as const).map(f => (
                            <div key={f} className="space-y-1">
                              <Label className="text-[11px] capitalize text-muted-foreground">{f}</Label>
                              <Textarea
                                rows={2}
                                value={rca.contributing_factors[f]}
                                onChange={e => setRca(p => ({
                                  ...p,
                                  contributing_factors: { ...p.contributing_factors, [f]: e.target.value },
                                }))}
                                className="text-xs resize-none"
                                placeholder={`${f} factors…`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── AI RCA Panel (appended to RCA tab) ───────────────── */}
                {detailTab === "rca" && selectedEvent && hospitalId && (
                  <div className="mt-4 max-w-2xl">
                    <AIRootCauseAnalysis
                      incident={{
                        id: selectedEvent.id,
                        incident_date: selectedEvent.reported_at?.split("T")[0] || "",
                        incident_type: selectedEvent.event_type,
                        severity_level: selectedEvent.severity || "minor",
                        description: selectedEvent.description,
                        location: selectedEvent.location ?? undefined,
                        outcome: selectedEvent.immediate_action_taken ?? undefined,
                      }}
                      hospitalId={hospitalId}
                    />
                  </div>
                )}

                {/* ── CAPA ────────────────────────────────────────────────── */}
                {detailTab === "capa" && (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">CAPA Actions ({capas.length})</h3>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs"
                          onClick={suggestCapaAI}
                          disabled={capaAiLoading}
                        >
                          {capaAiLoading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Sparkles className="h-3 w-3 text-purple-500" />}
                          {capaAiLoading ? "Suggesting…" : "AI Suggest Actions"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAddingCapa(p => !p)}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add Action
                        </Button>
                      </div>
                    </div>

                    {/* AI CAPA suggestions */}
                    {capaAiSuggestions.length > 0 && (
                      <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-3 space-y-3">
                        <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" /> AI Suggested Actions
                        </p>
                        {capaAiSuggestions.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 text-foreground">{s}</span>
                            <Button size="sm" className="h-6 text-[10px]" onClick={() => addSuggestedCapa(s)} disabled={!capaAiAttest}>
                              Add
                            </Button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1 border-t border-purple-200 dark:border-purple-700">
                          <Checkbox id="capa-attest" checked={capaAiAttest} onCheckedChange={v => setCapaAiAttest(!!v)} />
                          <label htmlFor="capa-attest" className="text-xs cursor-pointer">
                            I confirm these AI-suggested actions are appropriate for this event
                          </label>
                        </div>
                        <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setCapaAiSuggestions([])}>
                          Dismiss
                        </Button>
                      </div>
                    )}

                    {/* Add CAPA form */}
                    {addingCapa && (
                      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                        <p className="text-xs font-semibold">New Action</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <Select value={capaForm.action_type} onValueChange={v => setCapaForm(p => ({ ...p, action_type: v }))}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="corrective" className="text-xs">Corrective</SelectItem>
                                <SelectItem value="preventive" className="text-xs">Preventive</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Owner</Label>
                            <Select value={capaForm.responsible_owner_id} onValueChange={v => setCapaForm(p => ({ ...p, responsible_owner_id: v }))}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Assign…" /></SelectTrigger>
                              <SelectContent>
                                {users.map(u => <SelectItem key={u.id} value={u.id} className="text-xs">{u.full_name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Action Description <span className="text-destructive">*</span></Label>
                          <Textarea
                            rows={2}
                            className="text-xs resize-none"
                            value={capaForm.action_description}
                            onChange={e => setCapaForm(p => ({ ...p, action_description: e.target.value }))}
                            placeholder="Describe the corrective or preventive action…"
                          />
                        </div>
                        <div className="space-y-1 w-40">
                          <Label className="text-xs">Due Date</Label>
                          <Input type="date" className="h-7 text-xs" value={capaForm.due_date} onChange={e => setCapaForm(p => ({ ...p, due_date: e.target.value }))} />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveCapa} disabled={savingCapa}>
                            {savingCapa ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAddingCapa(false)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* CAPA list */}
                    {capas.length === 0 && !addingCapa ? (
                      <p className="text-xs text-muted-foreground italic py-4 text-center">No CAPA actions yet</p>
                    ) : (
                      <div className="space-y-2">
                        {capas.map(capa => (
                          <div key={capa.id} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Badge className={cn("text-[10px] px-1.5 py-0 capitalize",
                                  capa.action_type === "corrective"
                                    ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                )}>
                                  {capa.action_type}
                                </Badge>
                                {capa.ai_suggested && (
                                  <Sparkles className="h-3 w-3 text-purple-400" title="AI suggested" />
                                )}
                              </div>
                              <Select value={capa.status} onValueChange={v => updateCapaStatus(capa.id, v)}>
                                <SelectTrigger className="h-6 text-[10px] w-32">
                                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", CAPA_STATUS_COLOUR[capa.status])}>
                                    {capa.status.replace(/_/g, " ")}
                                  </span>
                                </SelectTrigger>
                                <SelectContent>
                                  {["open","in_progress","completed","cancelled"].map(s => (
                                    <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <p className="text-xs text-foreground">{capa.action_description}</p>
                            <div className="flex gap-4 text-[10px] text-muted-foreground">
                              {capa.responsible_owner_id && <span>Owner: {userName(capa.responsible_owner_id)}</span>}
                              {capa.due_date && <span>Due: {format(new Date(capa.due_date), "dd MMM yyyy")}</span>}
                              {capa.completed_at && <span className="text-green-600">Completed: {format(parseISO(capa.completed_at), "dd MMM")}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ReportEventModal
        open={reportOpen}
        onOpenChange={setReportOpen}
        onFiled={() => loadEvents()}
      />
    </div>
  );
};

export default SafetyEventsPage;
