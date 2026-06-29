import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShieldCheck, RefreshCw, ChevronDown, ChevronRight, Link2, CheckCircle2,
  Clock, AlertCircle, Unlink, XCircle, Search, Send, FileText, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import ABDMComplianceDashboard from "@/pages/ABDMComplianceDashboard";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Consent {
  id: string;
  consent_id: string | null;
  patient_id: string | null;
  requester_name: string | null;
  purpose_code: string | null;
  purpose_text: string | null;
  hi_types: string[] | null;
  date_range_from: string | null;
  date_range_to: string | null;
  expiry: string | null;
  status: "REQUESTED" | "GRANTED" | "DENIED" | "REVOKED" | "EXPIRED";
  granted_at: string | null;
  created_at: string;
}

interface CareContext {
  id: string;
  patient_id: string;
  reference: string;
  display: string;
  context_type: string;
  link_status: "linked" | "pending" | "unlinked" | "failed";
  linked_at: string | null;
  created_at: string;
}

interface GatewayLog {
  id: string;
  action: string | null;
  direction: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  status: string | null;
  created_at: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const CONSENT_STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  REQUESTED: { cls: "bg-amber-100 text-amber-700 border-amber-200", label: "Requested" },
  GRANTED:   { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Granted" },
  DENIED:    { cls: "bg-red-100 text-red-600 border-red-200", label: "Denied" },
  REVOKED:   { cls: "bg-slate-100 text-slate-500 border-slate-200", label: "Revoked" },
  EXPIRED:   { cls: "bg-slate-100 text-slate-400 border-slate-200", label: "Expired" },
};

const LINK_STATUS_META: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  linked:   { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Linked",   icon: <CheckCircle2 className="h-3 w-3" /> },
  pending:  { cls: "bg-amber-100 text-amber-700 border-amber-200",       label: "Pending",  icon: <Clock className="h-3 w-3" /> },
  unlinked: { cls: "bg-slate-100 text-slate-500 border-slate-200",       label: "Unlinked", icon: <Unlink className="h-3 w-3" /> },
  failed:   { cls: "bg-red-100 text-red-600 border-red-200",             label: "Failed",   icon: <AlertCircle className="h-3 w-3" /> },
};

const HI_TYPES = [
  "OPConsultation", "DischargeSummary", "DiagnosticReport",
  "Prescription", "ImmunizationRecord", "HealthDocumentRecord",
];

const PURPOSE_OPTIONS = [
  { code: "CAREMGT", label: "Care Management" },
  { code: "BTG",     label: "Break the Glass" },
  { code: "PUBHLTH", label: "Public Health" },
  { code: "HPAYMT",  label: "Healthcare Payment" },
  { code: "DSRCH",   label: "Disease Specific Research" },
  { code: "CLNTRCH", label: "Clinical Research" },
];

// ─── Tab A: Active Consents ────────────────────────────────────────────────────

const ActiveConsentsTab: React.FC<{ hospitalId: string; role: string }> = ({ hospitalId, role }) => {
  const { toast } = useToast();
  const isAdmin = role === "hospital_admin" || role === "super_admin";
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchConsents = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("abdm_consents")
      .select("id, consent_id, patient_id, requester_name, purpose_code, purpose_text, hi_types, date_range_from, date_range_to, expiry, status, granted_at, created_at")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data } = await q;
    setConsents((data ?? []) as Consent[]);
    setLoading(false);
  }, [hospitalId, statusFilter]);

  useEffect(() => { fetchConsents(); }, [fetchConsents]);

  const handleRevoke = async (consent: Consent) => {
    if (!consent.consent_id) return;
    setRevoking(consent.id);
    try {
      // Get token + base URL for gateway call
      const { data: cfg } = await supabase
        .from("hospital_abdm_config")
        .select("abdm_access_token, abdm_base_url, is_production")
        .eq("hospital_id", hospitalId)
        .maybeSingle();

      if (!cfg?.abdm_access_token) throw new Error("No ABDM token. Refresh config.");

      await fetch(`${cfg.abdm_base_url}/v1/consents/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.abdm_access_token}`, "X-CM-ID": cfg.is_production ? "sbx" : "sbx" },
        body: JSON.stringify({ consentId: consent.consent_id }),
      });

      await supabase.from("abdm_consents").update({ status: "REVOKED", updated_at: new Date().toISOString() }).eq("id", consent.id);
      toast({ title: "Consent revoked" });
      await fetchConsents();
    } catch (err) {
      toast({ title: "Revoke failed", description: (err as Error).message, variant: "destructive" });
    }
    setRevoking(null);
  };

  const filtered = statusFilter === "all" ? consents : consents.filter(c => c.status === statusFilter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(CONSENT_STATUS_BADGE).map(s => (
              <SelectItem key={s} value={s}>{CONSENT_STATUS_BADGE[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchConsents} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} consent{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No consents found</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(c => {
          const badge = CONSENT_STATUS_BADGE[c.status] ?? CONSENT_STATUS_BADGE.REQUESTED;
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="rounded-lg border bg-card">
              <button
                className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isOpen ? null : c.id)}
              >
                {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{c.consent_id ?? "Pending ID"}</span>
                    <span className={cn("inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium", badge.cls)}>{badge.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {c.requester_name ?? "—"} · {c.purpose_text ?? c.purpose_code ?? "—"} · {new Date(c.created_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-3 border-t bg-muted/20 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                    <div><span className="text-muted-foreground">Requester:</span> {c.requester_name ?? "—"}</div>
                    <div><span className="text-muted-foreground">Purpose:</span> {c.purpose_text ?? c.purpose_code ?? "—"}</div>
                    <div><span className="text-muted-foreground">Date range:</span> {c.date_range_from ?? "—"} → {c.date_range_to ?? "—"}</div>
                    <div><span className="text-muted-foreground">Expiry:</span> {c.expiry ? new Date(c.expiry).toLocaleDateString("en-IN") : "—"}</div>
                    <div><span className="text-muted-foreground">Granted:</span> {c.granted_at ? new Date(c.granted_at).toLocaleDateString("en-IN") : "—"}</div>
                    <div><span className="text-muted-foreground">HI types:</span> {(c.hi_types ?? []).join(", ") || "—"}</div>
                  </div>
                  {isAdmin && c.status === "GRANTED" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs mt-1"
                      disabled={revoking === c.id}
                      onClick={() => handleRevoke(c)}
                    >
                      {revoking === c.id ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                      Revoke Consent
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Tab B: Care Contexts ─────────────────────────────────────────────────────

const CareContextsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [contexts, setContexts] = useState<CareContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [bulkLinking, setBulkLinking] = useState(false);

  const fetchContexts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("abdm_care_contexts")
      .select("id, patient_id, reference, display, context_type, link_status, linked_at, created_at")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);
    setContexts((data ?? []) as CareContext[]);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchContexts(); }, [fetchContexts]);

  const handleRetry = async (ctx: CareContext) => {
    setRetrying(ctx.id);
    try {
      const { error } = await supabase.functions.invoke("abdm-hip-link-init", {
        body: { hospital_id: hospitalId, patient_id: ctx.patient_id, care_context_ids: [ctx.id] },
      });
      if (error) throw error;
      toast({ title: "Retry initiated", description: ctx.display });
      await fetchContexts();
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
    setRetrying(null);
  };

  const handleBulkLink = async () => {
    const pending = contexts.filter(c => c.link_status === "unlinked" || c.link_status === "failed");
    if (pending.length === 0) { toast({ title: "No pending contexts to link" }); return; }
    setBulkLinking(true);
    let succeeded = 0;
    const byPatient = pending.reduce<Record<string, CareContext[]>>((acc, c) => {
      (acc[c.patient_id] = acc[c.patient_id] ?? []).push(c);
      return acc;
    }, {});
    for (const [patientId, ctxs] of Object.entries(byPatient)) {
      try {
        await supabase.functions.invoke("abdm-hip-link-init", {
          body: { hospital_id: hospitalId, patient_id: patientId, care_context_ids: ctxs.map(c => c.id) },
        });
        succeeded++;
      } catch { /* skip */ }
    }
    toast({ title: `Linking initiated for ${succeeded} patient(s)` });
    await fetchContexts();
    setBulkLinking(false);
  };

  const pendingCount = contexts.filter(c => c.link_status === "unlinked" || c.link_status === "failed").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchContexts} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        {pendingCount > 0 && (
          <Button size="sm" className="h-8 text-xs gap-1" onClick={handleBulkLink} disabled={bulkLinking}>
            {bulkLinking ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            Link All Pending ({pendingCount})
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{contexts.length} context{contexts.length !== 1 ? "s" : ""}</span>
      </div>

      {!loading && contexts.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Link2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No care contexts yet — complete OPD, lab, or radiology records to create them.</p>
        </div>
      )}

      <div className="space-y-2">
        {contexts.map(ctx => {
          const meta = LINK_STATUS_META[ctx.link_status] ?? LINK_STATUS_META.unlinked;
          const canRetry = ctx.link_status === "unlinked" || ctx.link_status === "failed";
          return (
            <div key={ctx.id} className="rounded-lg border bg-card px-3 py-2.5 flex items-start gap-3">
              <div className={cn("mt-0.5 shrink-0 rounded-full p-1", meta.cls)}>{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{ctx.display}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[10px] text-muted-foreground">
                  <span>{ctx.context_type}</span>
                  <span>·</span>
                  <span>{new Date(ctx.created_at).toLocaleDateString("en-IN")}</span>
                  {ctx.linked_at && <><span>·</span><span className="text-emerald-600">Linked {new Date(ctx.linked_at).toLocaleDateString("en-IN")}</span></>}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium", meta.cls)}>
                  {meta.icon}{meta.label}
                </span>
                {canRetry && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-6 px-2 text-[10px] text-blue-600 hover:bg-blue-50"
                    disabled={retrying === ctx.id}
                    onClick={() => handleRetry(ctx)}
                  >
                    {retrying === ctx.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Retry"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {contexts.length > 0 && (
        <div className="rounded-md bg-slate-50 border border-slate-100 px-3 py-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          {(["linked", "pending", "unlinked", "failed"] as CareContext["link_status"][]).map(s => {
            const count = contexts.filter(c => c.link_status === s).length;
            if (count === 0) return null;
            const m = LINK_STATUS_META[s];
            return (
              <span key={s} className={cn("inline-flex items-center gap-1", m.cls.split(" ")[1])}>
                {m.icon} {count} {m.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Tab C: Gateway Logs ──────────────────────────────────────────────────────

const GatewayLogsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const [logs, setLogs] = useState<GatewayLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("abdm_gateway_logs")
      .select("id, action, direction, request_payload, response_payload, status, created_at")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(100);
    setLogs((data ?? []) as GatewayLog[]);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{logs.length} log{logs.length !== 1 ? "s" : ""}</span>
      </div>

      {!loading && logs.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No gateway logs yet</p>
        </div>
      )}

      <div className="space-y-1.5">
        {logs.map(log => {
          const isOpen = expanded === log.id;
          return (
            <div key={log.id} className="rounded-lg border bg-card text-xs">
              <button
                className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isOpen ? null : log.id)}
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className={cn(
                  "shrink-0 px-1.5 py-px rounded text-[10px] font-medium",
                  log.direction === "inbound" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                )}>{log.direction ?? "—"}</span>
                <span className="font-mono font-medium truncate flex-1">{log.action ?? "—"}</span>
                <span className={cn("shrink-0 text-[10px]", log.status === "ok" ? "text-emerald-600" : "text-red-500")}>{log.status ?? "—"}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(log.created_at).toLocaleString("en-IN", { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t bg-muted/20 space-y-2 mt-0">
                  {log.request_payload && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mt-2 mb-1 font-semibold uppercase tracking-wide">Request</p>
                      <pre className="text-[10px] bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                        {JSON.stringify(log.request_payload, null, 2)}
                      </pre>
                    </div>
                  )}
                  {log.response_payload && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Response</p>
                      <pre className="text-[10px] bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                        {JSON.stringify(log.response_payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Tab D: Fetch Patient Records (HIU) ───────────────────────────────────────

const HIUFetchTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [abhaAddress, setAbhaAddress] = useState("");
  const [patientName, setPatientName] = useState("");
  const [purpose, setPurpose] = useState("CAREMGT");
  const [selectedHiTypes, setSelectedHiTypes] = useState<string[]>(["OPConsultation", "DischargeSummary", "DiagnosticReport"]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

  const toggleHiType = (t: string) => {
    setSelectedHiTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!abhaAddress.trim()) { toast({ title: "Enter ABHA address", variant: "destructive" }); return; }
    if (selectedHiTypes.length === 0) { toast({ title: "Select at least one HI type", variant: "destructive" }); return; }

    setSubmitting(true);
    try {
      const { data: cfg } = await supabase
        .from("hospital_abdm_config")
        .select("abdm_access_token, abdm_base_url, hfr_id, is_production")
        .eq("hospital_id", hospitalId)
        .maybeSingle();

      if (!cfg?.abdm_access_token) throw new Error("ABDM not configured. Set up gateway token in Settings → ABDM.");

      const payload = {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        consent: {
          purpose: { code: purpose, text: PURPOSE_OPTIONS.find(p => p.code === purpose)?.label ?? purpose },
          patient: { id: abhaAddress.trim() },
          hip: { id: cfg.hfr_id ?? "" },
          careContexts: [],
          hiu: { id: cfg.hfr_id ?? "" },
          requester: { name: patientName || "Hospital", identifier: { type: "REGNO", value: cfg.hfr_id ?? "", system: "https://www.mciindia.org" } },
          hiTypes: selectedHiTypes,
          permission: {
            accessMode: "VIEW",
            dateRange: { from: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined, to: `${dateTo}T23:59:59.000Z` },
            dataEraseAt: `${expiry}T23:59:59.000Z`,
            frequency: { unit: "HOUR", value: 1, repeats: 0 },
          },
        },
      };

      const cmId = cfg.is_production ? "abdm" : "sbx";
      const res = await fetch(`${cfg.abdm_base_url}/v1/consent-requests/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.abdm_access_token}`, "X-CM-ID": cmId },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gateway error ${res.status}: ${text}`);
      }

      // Store consent record
      await supabase.from("abdm_consents").insert({
        hospital_id: hospitalId,
        requester_name: patientName || "Hospital",
        purpose_code: purpose,
        purpose_text: PURPOSE_OPTIONS.find(p => p.code === purpose)?.label ?? purpose,
        hi_types: selectedHiTypes,
        date_range_from: dateFrom || null,
        date_range_to: dateTo,
        expiry: expiry,
        status: "REQUESTED",
      });

      toast({ title: "Consent request sent", description: `Request sent for ${abhaAddress}` });
      setAbhaAddress("");
    } catch (err) {
      toast({ title: "Request failed", description: (err as Error).message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div className="rounded-lg border bg-amber-50 border-amber-200 px-4 py-3">
        <p className="text-xs text-amber-800 font-medium">HIU Consent Request</p>
        <p className="text-[11px] text-amber-700 mt-0.5">
          Request the patient's health records from any ABDM-registered HIP. The patient will receive a notification on their PHR app to grant or deny consent.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Patient ABHA Address *</Label>
        <div className="flex gap-2">
          <Input
            value={abhaAddress}
            onChange={e => setAbhaAddress(e.target.value)}
            placeholder="e.g. patient@abdm"
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Requester Name</Label>
        <Input value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Doctor / dept name" className="h-8 text-xs" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Purpose *</Label>
        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PURPOSE_OPTIONS.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Health Information Types *</Label>
        <div className="flex flex-wrap gap-1.5">
          {HI_TYPES.map(t => (
            <button
              key={t} type="button"
              onClick={() => toggleHiType(t)}
              className={cn(
                "text-[11px] px-2 py-1 rounded-full border transition-colors",
                selectedHiTypes.includes(t)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Date From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Date To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Consent Expiry</Label>
        <Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="h-8 text-xs" />
      </div>

      <Button type="submit" className="gap-1.5" disabled={submitting}>
        {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send Consent Request
      </Button>
    </form>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const ABDMConsentPage: React.FC = () => {
  const { hospitalId, role } = useHospitalContext();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!hospitalId) return;
    supabase
      .from("abdm_consents")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("status", "REQUESTED")
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [hospitalId]);

  if (!hospitalId) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3 border-b bg-card flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold">ABDM Consent Manager</p>
            {pendingCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-px text-[10px] font-semibold">
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Manage ABHA-linked care contexts, consent artefacts, and gateway logs</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="consents" className="flex flex-col h-full">
          <TabsList className="shrink-0 justify-start rounded-none border-b bg-card h-9 px-5 w-full gap-0">
            <TabsTrigger value="consents" className="text-xs relative">
              Active Consents
              {pendingCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] font-bold">{pendingCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="care_contexts" className="text-xs">Care Contexts</TabsTrigger>
            <TabsTrigger value="gateway_logs" className="text-xs">Gateway Logs</TabsTrigger>
            <TabsTrigger value="hiu_fetch" className="text-xs">Fetch Records (HIU)</TabsTrigger>
            <TabsTrigger value="compliance" className="text-xs flex items-center gap-1">
              <BarChart3 size={11} /> Compliance Score
            </TabsTrigger>
          </TabsList>

          <TabsContent value="consents" className="flex-1 overflow-auto p-5 mt-0">
            <ActiveConsentsTab hospitalId={hospitalId} role={role ?? ""} />
          </TabsContent>

          <TabsContent value="care_contexts" className="flex-1 overflow-auto p-5 mt-0">
            <CareContextsTab hospitalId={hospitalId} />
          </TabsContent>

          <TabsContent value="gateway_logs" className="flex-1 overflow-auto p-5 mt-0">
            <GatewayLogsTab hospitalId={hospitalId} />
          </TabsContent>

          <TabsContent value="hiu_fetch" className="flex-1 overflow-auto p-5 mt-0">
            <HIUFetchTab hospitalId={hospitalId} />
          </TabsContent>

          <TabsContent value="compliance" className="flex-1 overflow-auto p-5 mt-0">
            <ABDMComplianceDashboard embedded />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ABDMConsentPage;
