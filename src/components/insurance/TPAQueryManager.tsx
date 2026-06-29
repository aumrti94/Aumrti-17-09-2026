import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAI } from "@/lib/aiProvider";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Plus, AlertTriangle, Clock, CheckCircle2,
  Loader2, Sparkles, Send, Save, Search, X, ChevronRight,
} from "lucide-react";
import {
  differenceInMinutes, differenceInHours, differenceInDays,
  isPast, isToday, addDays, format, parseISO,
} from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

type PlanTier = "manual" | "ai_assisted" | "automated";

interface TPAQuery {
  id: string;
  hospital_id: string;
  claim_id: string | null;
  pre_auth_id: string | null;
  // New schema columns (nullable — old rows may not have these)
  query_date: string | null;
  response_deadline: string | null;
  response_text: string | null;
  response_date: string | null;
  ai_draft_response: string | null;
  // Old schema columns (always present)
  query_text: string;
  raised_by_tpa: string | null;
  raised_at: string;
  replied_text: string | null;
  replied_at: string | null;
  status: string;
  priority: string;
  // Joined
  claim_number: string | null;
  claimed_amount: number | null;
  procedure_codes: string[] | null;
  diagnosis_codes: string[] | null;
  patient_name: string | null;
  tpa_name: string | null;
}

interface ClaimSearchResult {
  id: string;
  claim_number: string | null;
  claimed_amount: number | null;
  tpa_name: string;
  patient_name: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const effectiveDeadline = (q: TPAQuery): Date | null => {
  if (q.response_deadline) return parseISO(q.response_deadline);
  const anchor = q.query_date ?? q.raised_at;
  if (anchor) return addDays(parseISO(anchor), 3);
  return null;
};

const effectiveDate = (q: TPAQuery): string =>
  q.query_date ?? q.raised_at;

const effectiveResponse = (q: TPAQuery): string | null =>
  q.response_text ?? q.replied_text ?? null;

const isOverdue = (q: TPAQuery): boolean => {
  if (["responded", "replied", "closed"].includes(q.status)) return false;
  const d = effectiveDeadline(q);
  return !!d && isPast(d);
};

const isDueToday = (q: TPAQuery): boolean => {
  if (isOverdue(q)) return false;
  if (["responded", "replied", "closed"].includes(q.status)) return false;
  const d = effectiveDeadline(q);
  return !!d && isToday(d);
};

const isResolved = (q: TPAQuery): boolean =>
  ["responded", "replied", "closed"].includes(q.status);

function countdownLabel(deadline: Date | null): string {
  if (!deadline) return "No deadline set";
  if (isPast(deadline)) {
    const mins = Math.abs(differenceInMinutes(deadline, new Date()));
    if (mins < 60) return `${mins} min overdue`;
    const hrs = Math.abs(differenceInHours(deadline, new Date()));
    if (hrs < 24) return `${hrs} hr overdue`;
    return `${Math.abs(differenceInDays(deadline, new Date()))} days overdue`;
  }
  const mins = differenceInMinutes(deadline, new Date());
  if (mins < 60) return `${mins} min remaining`;
  const hrs = differenceInHours(deadline, new Date());
  if (hrs < 24) return `${hrs} hr remaining`;
  const days = differenceInDays(deadline, new Date());
  const remHrs = hrs - days * 24;
  return remHrs > 0 ? `${days} days ${remHrs} hr remaining` : `${days} days remaining`;
}

const formatINR = (n: number | null | undefined): string =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;

// ── Component ──────────────────────────────────────────────────────────────

const TPAQueryManager: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [queries,      setQueries]      = useState<TPAQuery[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [planTier,     setPlanTier]     = useState<PlanTier>("manual");

  // Filters
  const [statusFilter, setStatusFilter] = useState("open");
  const [tpaFilter,    setTpaFilter]    = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");

  // Add-query form
  const [showAdd,     setShowAdd]      = useState(false);
  const [newForm,     setNewForm]      = useState({
    tpa_name: "", query_text: "", query_date: format(new Date(), "yyyy-MM-dd"),
    claim_id: "", claim_label: "",
  });
  const [claimSearch,   setClaimSearch]   = useState("");
  const [claimResults,  setClaimResults]  = useState<ClaimSearchResult[]>([]);
  const [searchingClaim,setSearchingClaim]= useState(false);

  // Detail panel — response
  const [responseText, setResponseText] = useState("");
  const [aiDrafting,   setAiDrafting]   = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [savingDraft,  setSavingDraft]  = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  // ── Boot ──────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: { data: any }) => { if (data) setUserId(data.id); });
    });
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("hospital_insurance_settings")
      .select("plan_tier")
      .eq("hospital_id", hospitalId)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.plan_tier) setPlanTier(data.plan_tier as PlanTier);
      });
  }, [hospitalId]);

  // ── Data loading ──────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setLoadError(null);

    try {
      // Fetch queries sorted by deadline (NULLs last)
      const { data: rawQueries, error: fetchErr } = await (supabase as any)
        .from("tpa_queries")
        .select(`
          id, hospital_id, claim_id, pre_auth_id,
          query_date, response_deadline, response_text, response_date, ai_draft_response,
          query_text, raised_by_tpa, raised_at, replied_text, replied_at, status, priority
        `)
        .eq("hospital_id", hospitalId)
        .order("response_deadline", { ascending: true, nullsFirst: false });

      if (fetchErr) throw new Error(fetchErr.message);

      const rows: any[] = rawQueries ?? [];
      if (rows.length === 0) { setQueries([]); return; }

      // Batch-join claims + patients
      const claimIds = [...new Set(rows.map((r) => r.claim_id).filter(Boolean))];
      let claimsMap: Record<string, any> = {};
      let patientsMap: Record<string, string> = {};

      if (claimIds.length > 0) {
        const { data: claims } = await (supabase as any)
          .from("insurance_claims")
          .select("id, claim_number, claimed_amount, procedure_codes, diagnosis_codes, tpa_name, patient_id")
          .in("id", claimIds);

        const patientIds = [...new Set((claims ?? []).map((c: any) => c.patient_id).filter(Boolean))];
        const { data: patients } = patientIds.length
          ? await supabase.from("patients").select("id, full_name").in("id", patientIds)
          : { data: [] };

        patientsMap = Object.fromEntries((patients ?? []).map((p: any) => [p.id, p.full_name]));
        claimsMap   = Object.fromEntries(
          (claims ?? []).map((c: any) => [
            c.id,
            { ...c, patient_name: patientsMap[c.patient_id] ?? null },
          ])
        );
      }

      setQueries(
        rows.map((r) => {
          const claim = r.claim_id ? claimsMap[r.claim_id] : null;
          return {
            ...r,
            claim_number:    claim?.claim_number   ?? null,
            claimed_amount:  claim?.claimed_amount  ? Number(claim.claimed_amount) : null,
            procedure_codes: claim?.procedure_codes ?? null,
            diagnosis_codes: claim?.diagnosis_codes ?? null,
            patient_name:    claim?.patient_name    ?? null,
            tpa_name:        r.raised_by_tpa ?? claim?.tpa_name ?? null,
          } as TPAQuery;
        })
      );
    } catch (err: any) {
      console.error("TPAQueryManager load error:", err);
      setQueries([]);
      setLoadError("Could not load TPA queries (schema may be out of date)");
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Clear response text when selection changes
  useEffect(() => {
    const q = queries.find((x) => x.id === selectedId);
    setResponseText(q ? (effectiveResponse(q) ?? "") : "");
  }, [selectedId, queries]);

  // ── Derived ───────────────────────────────────────────────────────────

  const overdueQueries = useMemo(() =>
    queries.filter((q) => isOverdue(q)),
    [queries]
  );

  const allTpaNames = useMemo(() =>
    [...new Set(queries.map((q) => q.tpa_name).filter(Boolean))] as string[],
    [queries]
  );

  const filtered = useMemo(() => {
    return queries.filter((q) => {
      if (statusFilter !== "all" && q.status !== statusFilter) return false;
      if (tpaFilter !== "all" && q.tpa_name !== tpaFilter) return false;
      if (dateFrom) {
        const d = effectiveDate(q);
        if (d < dateFrom) return false;
      }
      if (dateTo) {
        const d = effectiveDate(q);
        if (d > dateTo + "T23:59:59") return false;
      }
      return true;
    });
  }, [queries, statusFilter, tpaFilter, dateFrom, dateTo]);

  const selected = useMemo(() =>
    queries.find((q) => q.id === selectedId) ?? null,
    [queries, selectedId]
  );

  // ── Claim search ──────────────────────────────────────────────────────

  const searchClaims = async (q: string) => {
    if (q.trim().length < 2) { setClaimResults([]); return; }
    setSearchingClaim(true);
    const { data: claims } = await (supabase as any)
      .from("insurance_claims")
      .select("id, claim_number, claimed_amount, tpa_name, patient_id")
      .eq("hospital_id", hospitalId)
      .or(`claim_number.ilike.%${q}%,tpa_name.ilike.%${q}%`)
      .limit(10);

    if (claims?.length) {
      const patientIds = [...new Set(claims.map((c: any) => c.patient_id).filter(Boolean))];
      const { data: patients } = await supabase.from("patients").select("id, full_name").in("id", patientIds);
      const pMap = Object.fromEntries((patients ?? []).map((p: any) => [p.id, p.full_name]));
      setClaimResults(
        claims.map((c: any) => ({
          id: c.id,
          claim_number: c.claim_number,
          claimed_amount: c.claimed_amount ? Number(c.claimed_amount) : null,
          tpa_name: c.tpa_name,
          patient_name: pMap[c.patient_id] ?? "Unknown",
        }))
      );
    } else {
      setClaimResults([]);
    }
    setSearchingClaim(false);
  };

  // ── Add query ─────────────────────────────────────────────────────────

  const submitNewQuery = async () => {
    if (!newForm.query_text.trim() || !hospitalId) return;
    const queryDate = newForm.query_date || format(new Date(), "yyyy-MM-dd");
    const deadline  = format(addDays(parseISO(queryDate), 3), "yyyy-MM-dd");

    await (supabase as any).from("tpa_queries").insert({
      hospital_id:       hospitalId,
      claim_id:          newForm.claim_id || null,
      query_text:        newForm.query_text.trim(),
      raised_by_tpa:     newForm.tpa_name.trim() || null,
      query_date:        queryDate,
      response_deadline: deadline,
      raised_at:         new Date().toISOString(),
      status:            "open",
      priority:          "normal",
    });

    toast({ title: "TPA query logged ✓" });
    setShowAdd(false);
    setNewForm({
      tpa_name: "", query_text: "", query_date: format(new Date(), "yyyy-MM-dd"),
      claim_id: "", claim_label: "",
    });
    setClaimSearch("");
    setClaimResults([]);
    load();
  };

  // ── AI draft response ─────────────────────────────────────────────────

  const draftWithAI = async () => {
    if (!selected || !hospitalId) return;
    setAiDrafting(true);
    try {
      const prompt = `You are a TPA desk administrator at an Indian private hospital.

The TPA has raised this query on a claim:
"${selected.query_text}"

Claim details:
- Patient: ${selected.patient_name ?? "Not specified"}
- TPA / Insurer: ${selected.tpa_name ?? "Not specified"}
- Claim number: ${selected.claim_number ?? "Not specified"}
- Claimed amount: ${formatINR(selected.claimed_amount)}
- Procedures: ${(selected.procedure_codes ?? []).join(", ") || "Not specified"}
- Diagnosis: ${(selected.diagnosis_codes ?? []).join(", ") || "Not specified"}

Write a professional, factual response letter addressing the TPA query.
Requirements:
- Clinical justification for the treatment
- Reference the pre-auth number if applicable
- Summarise supporting evidence (clinical notes, investigation reports)
- Formal Indian medical correspondence tone
- Under 300 words
- Do NOT include subject line, salutation or signature block (those will be added separately)`;

      const result = await callAI({
        featureKey: "tpa_query_reply",
        hospitalId,
        prompt,
        maxTokens: 500,
      });

      if (result.error) throw new Error(result.error);

      const draft = result.text.trim();
      setResponseText(draft);

      // Persist draft to DB
      await (supabase as any)
        .from("tpa_queries")
        .update({ ai_draft_response: draft })
        .eq("id", selected.id);

      toast({ title: "AI draft ready — review before submitting" });
    } catch (err: any) {
      toast({ title: "AI draft failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setAiDrafting(false);
    }
  };

  // ── Save draft ────────────────────────────────────────────────────────

  const saveDraft = async () => {
    if (!selected) return;
    setSavingDraft(true);
    await (supabase as any)
      .from("tpa_queries")
      .update({ response_text: responseText, replied_text: responseText })
      .eq("id", selected.id);
    toast({ title: "Draft saved" });
    setSavingDraft(false);
    load();
  };

  // ── Submit response ───────────────────────────────────────────────────

  const submitResponse = async () => {
    if (!selected || !responseText.trim()) return;
    setSubmitting(true);
    const now = new Date().toISOString();
    await (supabase as any)
      .from("tpa_queries")
      .update({
        response_text: responseText.trim(),
        response_date: now,
        replied_text:  responseText.trim(),
        replied_at:    now,
        replied_by:    userId,
        status:        "responded",
      })
      .eq("id", selected.id);

    // Bump query_count on linked claim
    if (selected.claim_id) {
      await (supabase as any).rpc("increment_query_count", { claim_id_in: selected.claim_id })
        .catch(() => {/* rpc may not exist yet */});
    }

    toast({ title: "Response submitted to TPA ✓" });
    setSubmitting(false);
    setSelectedId(null);
    load();
  };

  // ── Status color helpers ──────────────────────────────────────────────

  const rowBg = (q: TPAQuery) => {
    if (isOverdue(q))    return "border-l-red-500 bg-red-50/30";
    if (isDueToday(q))   return "border-l-amber-400 bg-amber-50/20";
    if (isResolved(q))   return "border-l-emerald-400 bg-emerald-50/10";
    return "border-l-transparent";
  };

  const statusBadge = (q: TPAQuery) => {
    if (isOverdue(q))    return <Badge className="text-[9px] px-1.5 py-0 bg-red-600 text-white">OVERDUE</Badge>;
    if (isDueToday(q))   return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-300">Due Today</Badge>;
    if (isResolved(q))   return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200">Responded</Badge>;
    const closed = q.status === "closed";
    if (closed) return <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">Closed</Badge>;
    return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200">Open</Badge>;
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Overdue alert banner ── */}
      {overdueQueries.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          <AlertTriangle size={14} className="shrink-0" />
          <strong>⚠️ {overdueQueries.length} quer{overdueQueries.length > 1 ? "ies are" : "y is"} overdue</strong>
          &mdash; TPA may reject claims if not responded promptly.
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {["open", "all", "responded", "closed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-semibold transition-colors capitalize",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {s}
              {s === "open" && overdueQueries.length > 0 && (
                <span className="ml-1 bg-red-600 text-white rounded-full px-1.5 py-0.5 text-[9px] leading-none">
                  {overdueQueries.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* TPA filter */}
        <Select value={tpaFilter} onValueChange={setTpaFilter}>
          <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="All TPAs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All TPAs</SelectItem>
            {allTpaNames.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Date range */}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="h-7 text-xs border border-input rounded-md px-2 bg-background w-32" />
        <span className="text-xs text-muted-foreground">–</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="h-7 text-xs border border-input rounded-md px-2 bg-background w-32" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-xs text-muted-foreground hover:text-foreground">
            <X size={12} />
          </button>
        )}

        <div className="ml-auto">
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={12} /> Log New TPA Query
          </Button>
        </div>
      </div>

      {/* ── Add query form ── */}
      {showAdd && (
        <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-muted/30 space-y-3">
          <h3 className="text-sm font-semibold">Log New TPA Query</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-semibold">TPA / Insurer Name</Label>
              <Input className="mt-1 h-8 text-sm" placeholder="e.g. Medi Assist"
                value={newForm.tpa_name} onChange={(e) => setNewForm((p) => ({ ...p, tpa_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs font-semibold">Query Date</Label>
              <Input className="mt-1 h-8 text-sm" type="date"
                value={newForm.query_date} onChange={(e) => setNewForm((p) => ({ ...p, query_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs font-semibold">Response Deadline</Label>
              <Input className="mt-1 h-8 text-sm bg-muted/50" type="date" readOnly
                value={newForm.query_date ? format(addDays(parseISO(newForm.query_date), 3), "yyyy-MM-dd") : ""}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Auto: query date + 3 days</p>
            </div>
          </div>

          {/* Claim search */}
          <div>
            <Label className="text-xs font-semibold">Link to Claim (optional)</Label>
            <div className="relative mt-1">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                className="h-8 w-full pl-7 pr-3 rounded-md border border-input bg-background text-sm"
                placeholder="Search claim # or TPA name…"
                value={newForm.claim_label || claimSearch}
                onChange={(e) => {
                  if (newForm.claim_id) {
                    setNewForm((p) => ({ ...p, claim_id: "", claim_label: "" }));
                  }
                  setClaimSearch(e.target.value);
                  searchClaims(e.target.value);
                }}
              />
              {newForm.claim_id && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setNewForm((p) => ({ ...p, claim_id: "", claim_label: "" }))}>
                  <X size={12} className="text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            {searchingClaim && <p className="text-[10px] text-muted-foreground mt-1">Searching…</p>}
            {claimResults.length > 0 && !newForm.claim_id && (
              <div className="mt-1 border border-border rounded-md bg-background shadow-sm max-h-36 overflow-y-auto">
                {claimResults.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex justify-between items-center"
                    onClick={() => {
                      setNewForm((p) => ({
                        ...p,
                        claim_id: c.id,
                        claim_label: `${c.claim_number ?? "—"} · ${c.patient_name}`,
                        tpa_name: p.tpa_name || c.tpa_name,
                      }));
                      setClaimResults([]);
                      setClaimSearch("");
                    }}
                  >
                    <span>
                      <span className="font-mono font-semibold">{c.claim_number ?? "No #"}</span>
                      {" · "}{c.patient_name}{" · "}{c.tpa_name}
                    </span>
                    <span className="text-muted-foreground">{formatINR(c.claimed_amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold">Query Text (from TPA)</Label>
            <textarea
              rows={3}
              className="mt-1 w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none"
              placeholder="Paste the exact query text received from the TPA…"
              value={newForm.query_text}
              onChange={(e) => setNewForm((p) => ({ ...p, query_text: e.target.value }))}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="text-xs gap-1" onClick={submitNewQuery}
              disabled={!newForm.query_text.trim()}>
              <Plus size={12} /> Log Query
            </Button>
            <Button size="sm" variant="ghost" className="text-xs"
              onClick={() => { setShowAdd(false); setClaimSearch(""); setClaimResults([]); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Main split view ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── List panel ── */}
        <div className="w-[380px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {filtered.length} quer{filtered.length !== 1 ? "ies" : "y"}
            </span>
            <span className="text-[10px] text-muted-foreground">Sorted by deadline</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
              <AlertTriangle size={24} className="text-amber-500 opacity-70" />
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <button
                className="text-xs text-primary underline underline-offset-2"
                onClick={load}
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
              <MessageSquare size={32} className="opacity-30" />
              <p className="text-sm">No queries for selected filters</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {filtered.map((q) => {
                const deadline = effectiveDeadline(q);
                const overdue  = isOverdue(q);
                return (
                  <button
                    key={q.id}
                    onClick={() => setSelectedId(q.id === selectedId ? null : q.id)}
                    className={cn(
                      "w-full text-left px-3 py-3 border-l-[3px] transition-colors hover:bg-muted/50",
                      rowBg(q),
                      selectedId === q.id && "bg-primary/5 border-l-primary"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* TPA + claim # */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {q.tpa_name && (
                            <span className="text-xs font-semibold truncate">{q.tpa_name}</span>
                          )}
                          {q.claim_number && (
                            <span className="text-[10px] font-mono text-muted-foreground">#{q.claim_number}</span>
                          )}
                        </div>
                        {/* Patient */}
                        {q.patient_name && (
                          <p className="text-xs text-muted-foreground truncate">{q.patient_name}</p>
                        )}
                        {/* Query preview */}
                        <p className="text-xs text-foreground line-clamp-2 mt-0.5">{q.query_text}</p>
                        {/* Deadline */}
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {statusBadge(q)}
                          {deadline && (
                            <span className={cn(
                              "text-[10px] flex items-center gap-0.5",
                              overdue ? "text-red-600 font-semibold" :
                              isDueToday(q) ? "text-amber-600 font-semibold" :
                              "text-muted-foreground"
                            )}>
                              <Clock size={9} />
                              {overdue ? `OVERDUE ${countdownLabel(deadline)}` : countdownLabel(deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground mt-0.5",
                        selectedId === q.id && "text-primary")} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Detail panel ── */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MessageSquare size={40} className="opacity-20" />
              <p className="text-sm">Select a query to view details and respond</p>
            </div>
          ) : (
            <div className="p-5 space-y-4 max-w-2xl">

              {/* ── Query header ── */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    {selected.tpa_name ?? "TPA Query"}
                    {statusBadge(selected)}
                  </h2>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {selected.claim_number && <span>Claim <span className="font-mono font-semibold text-foreground">#{selected.claim_number}</span></span>}
                    {selected.patient_name && <span>· {selected.patient_name}</span>}
                    <span>· Received {format(parseISO(effectiveDate(selected)), "dd MMM yyyy")}</span>
                  </div>
                </div>
              </div>

              {/* ── Countdown timer ── */}
              {(() => {
                const deadline = effectiveDeadline(selected);
                if (!deadline) return null;
                const overdue = isPast(deadline);
                return (
                  <div className={cn(
                    "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border",
                    overdue
                      ? "bg-red-50 border-red-200 text-red-700"
                      : isDueToday(selected)
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-blue-50 border-blue-200 text-blue-700"
                  )}>
                    <Clock size={14} className="shrink-0" />
                    <span>
                      {overdue ? "⚠️ " : "⏱ "}
                      Response deadline: <strong>{format(deadline, "dd MMM yyyy")}</strong>
                      {" — "}{countdownLabel(deadline)}
                    </span>
                  </div>
                );
              })()}

              {/* ── Claim details card ── */}
              {(selected.claimed_amount || selected.procedure_codes?.length || selected.diagnosis_codes?.length) && (
                <div className="bg-muted/40 rounded-lg px-4 py-3 text-xs space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Claim Details</p>
                  {selected.claimed_amount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Claimed amount</span>
                      <span className="font-semibold">{formatINR(selected.claimed_amount)}</span>
                    </div>
                  )}
                  {selected.procedure_codes?.length ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Procedures</span>
                      <span className="font-mono text-right">{selected.procedure_codes.join(", ")}</span>
                    </div>
                  ) : null}
                  {selected.diagnosis_codes?.length ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Diagnosis</span>
                      <span className="font-mono text-right">{selected.diagnosis_codes.join(", ")}</span>
                    </div>
                  ) : null}
                </div>
              )}

              {/* ── Full query text ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Query from TPA
                </p>
                <div className="bg-amber-50/60 border border-amber-200 rounded-lg px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
                  {selected.query_text}
                </div>
              </div>

              {/* ── Response section ── */}
              {!isResolved(selected) ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Response</p>
                    {(planTier === "ai_assisted" || planTier === "automated") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
                        disabled={aiDrafting}
                        onClick={draftWithAI}
                      >
                        {aiDrafting
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Sparkles size={11} />
                        }
                        {aiDrafting ? "Drafting…" : "🤖 Draft Response"}
                      </Button>
                    )}
                  </div>

                  {selected.ai_draft_response && !responseText && (
                    <button
                      className="w-full text-left text-xs text-violet-600 px-3 py-2 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 transition-colors"
                      onClick={() => setResponseText(selected.ai_draft_response!)}
                    >
                      ✨ Load previous AI draft
                    </button>
                  )}

                  <textarea
                    rows={8}
                    className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Type your response to the TPA query, or click '🤖 Draft Response' to generate one with AI…"
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                  />

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={submitting || !responseText.trim()}
                      onClick={submitResponse}
                    >
                      {submitting
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Send size={12} />
                      }
                      {submitting ? "Submitting…" : (planTier !== "manual" && responseText === selected.ai_draft_response ? "Submit with AI Draft" : "Submit Response")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={savingDraft || !responseText.trim()}
                      onClick={saveDraft}
                    >
                      {savingDraft ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      Save Draft
                    </Button>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    "Save Draft" keeps the query open. "Submit Response" marks it as responded and records the response date.
                  </p>
                </div>
              ) : (
                /* Resolved view */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Response submitted
                      {(selected.response_date ?? selected.replied_at)
                        ? ` on ${format(parseISO(selected.response_date ?? selected.replied_at!), "dd MMM yyyy")}`
                        : ""}
                    </p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap">
                    {effectiveResponse(selected) ?? "—"}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={async () => {
                      await (supabase as any).from("tpa_queries").update({ status: "open" }).eq("id", selected.id);
                      load();
                    }}
                  >
                    Re-open Query
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TPAQueryManager;
