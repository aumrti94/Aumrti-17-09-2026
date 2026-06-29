// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ContextType = "nabh_matrix" | "audit" | "ipc" | "psq" | "governance" | "weekly_digest" | "evidence_gaps";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { hospital_id, context_type, context_filter } = await req.json() as {
      hospital_id: string;
      context_type: ContextType;
      context_filter?: Record<string, unknown>;
    };

    if (!hospital_id || !context_type) return json({ error: "Missing required fields" }, 400);

    let isRcaDraft = false;

    // Service role client for data fetching
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Fetch context data based on context_type ──────────────────────────────

    let contextData: Record<string, unknown> = {};

    if (context_type === "nabh_matrix") {
      const chapter = context_filter?.chapter as string | undefined;

      // High and critical risk compliance gaps
      let gapQuery = sb
        .from("nabh_hospital_compliance")
        .select("status, risk_level, assessor_score, comments, nabh_standards(chapter_code, standard_code, level, description)")
        .eq("hospital_id", hospital_id)
        .in("risk_level", ["High", "Critical"])
        .limit(30);

      const { data: gaps } = await gapQuery;

      // Overall status counts
      const { data: allStatuses } = await sb
        .from("nabh_hospital_compliance")
        .select("status, risk_level")
        .eq("hospital_id", hospital_id);

      const statusCounts = (allStatuses || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      const riskCounts = (allStatuses || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.risk_level] = (acc[r.risk_level] || 0) + 1;
        return acc;
      }, {});

      contextData = {
        chapter_filter: chapter || "ALL",
        total_standards: allStatuses?.length || 0,
        status_counts: statusCounts,
        risk_counts: riskCounts,
        high_critical_gaps: (gaps || []).map((g: any) => ({
          standard_code: g.nabh_standards?.standard_code,
          chapter: g.nabh_standards?.chapter_code,
          level: g.nabh_standards?.level,
          description: g.nabh_standards?.description?.substring(0, 120),
          status: g.status,
          risk_level: g.risk_level,
          score: g.assessor_score,
          comments: g.comments?.substring(0, 80),
        })),
      };

    } else if (context_type === "audit") {
      const { data: audits } = await sb
        .from("clinical_audits")
        .select("id, title, objective, standard_criteria, conclusion, ai_summary, period_from, period_to, departments(name)")
        .eq("hospital_id", hospital_id)
        .eq("status", "closed")
        .order("updated_at", { ascending: false })
        .limit(10);

      // Sample compliance rates
      const auditIds = (audits || []).map((a: any) => a.id);
      const { data: samples } = await sb
        .from("audit_samples")
        .select("audit_id, is_compliant")
        .in("audit_id", auditIds.length ? auditIds : ["00000000-0000-0000-0000-000000000000"]);

      const rateByAudit: Record<string, { pass: number; total: number }> = {};
      for (const s of (samples || []) as any[]) {
        if (!rateByAudit[s.audit_id]) rateByAudit[s.audit_id] = { pass: 0, total: 0 };
        rateByAudit[s.audit_id].total++;
        if (s.is_compliant) rateByAudit[s.audit_id].pass++;
      }

      contextData = {
        closed_audits: (audits || []).map((a: any) => ({
          title: a.title,
          department: a.departments?.name,
          standard_criteria: a.standard_criteria?.substring(0, 100),
          conclusion: a.conclusion?.substring(0, 150),
          compliance_rate: rateByAudit[a.id]
            ? `${Math.round((rateByAudit[a.id].pass / rateByAudit[a.id].total) * 100)}% (${rateByAudit[a.id].pass}/${rateByAudit[a.id].total})`
            : "No samples",
        })),
      };

    } else if (context_type === "ipc") {
      const monthsBack = (context_filter?.months as number) || 3;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - monthsBack);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const { data: infections } = await sb
        .from("ipc_infection_events")
        .select("infection_type, onset_date, organism, is_device_related, outcome, wards(name)")
        .eq("hospital_id", hospital_id)
        .gte("onset_date", cutoffStr)
        .order("onset_date", { ascending: false })
        .limit(50);

      const byType = (infections || []).reduce((acc: Record<string, number>, e: any) => {
        acc[e.infection_type] = (acc[e.infection_type] || 0) + 1;
        return acc;
      }, {});
      const deviceRelated = (infections || []).filter((e: any) => e.is_device_related).length;

      const { data: bundles } = await sb
        .from("ipc_bundle_checklists")
        .select("bundle_type, all_elements_done, compliance_date")
        .eq("hospital_id", hospital_id)
        .gte("compliance_date", cutoffStr)
        .limit(30);

      const bundleCompliance = (bundles || []).reduce((acc: Record<string, { done: number; total: number }>, b: any) => {
        if (!acc[b.bundle_type]) acc[b.bundle_type] = { done: 0, total: 0 };
        acc[b.bundle_type].total++;
        if (b.all_elements_done) acc[b.bundle_type].done++;
        return acc;
      }, {});

      contextData = {
        period_months: monthsBack,
        total_infection_events: (infections || []).length,
        by_infection_type: byType,
        device_related_count: deviceRelated,
        bundle_compliance: bundleCompliance,
        top_organisms: (infections || [])
          .filter((e: any) => e.organism)
          .reduce((acc: Record<string, number>, e: any) => { acc[e.organism] = (acc[e.organism] || 0) + 1; return acc; }, {}),
      };

    } else if (context_type === "psq") {
      // ── RCA draft path: generate 5-Whys for a specific event ──────────────
      const rcaEvent = context_filter?.rca_draft_for_event as {
        description: string; immediate_action: string;
        event_type: string; category: string; severity: string;
      } | undefined;

      if (rcaEvent) {
        isRcaDraft = true;
        contextData = {
          event_type: rcaEvent.event_type,
          category: rcaEvent.category,
          severity: rcaEvent.severity,
          description: rcaEvent.description,
          immediate_action: rcaEvent.immediate_action || "none documented",
        };
      } else {
        // ── Standard PSQ aggregate path ──────────────────────────────────────
        const { data: events } = await sb
          .from("safety_events")
          .select("event_type, category, severity, status, location, reported_at")
          .eq("hospital_id", hospital_id)
          .order("reported_at", { ascending: false })
          .limit(30);

        const byType = (events || []).reduce((acc: Record<string, number>, e: any) => {
          acc[e.event_type] = (acc[e.event_type] || 0) + 1;
          return acc;
        }, {});
        const bySeverity = (events || []).reduce((acc: Record<string, number>, e: any) => {
          if (e.severity) acc[e.severity] = (acc[e.severity] || 0) + 1;
          return acc;
        }, {});
        const byStatus = (events || []).reduce((acc: Record<string, number>, e: any) => {
          acc[e.status] = (acc[e.status] || 0) + 1;
          return acc;
        }, {});
        const openSentinels = (events || []).filter((e: any) => e.event_type === "sentinel" && e.status !== "closed").length;

        contextData = {
          total_events: (events || []).length,
          by_type: byType,
          by_severity: bySeverity,
          by_status: byStatus,
          open_sentinel_events: openSentinels,
        };
      }

    } else if (context_type === "evidence_gaps") {
      // context_filter.gaps: Array<{compliance_id, oe_code, chapter, standard_code, description, status}>
      const gaps = (context_filter?.gaps as any[]) || [];
      if (gaps.length === 0) return json({ suggestions: [] });

      // Module map provided so AI can cite real paths
      const moduleMap: Record<string, Array<{ module: string; path: string }>> = {
        AAC: [{ module: "OPD Queue", path: "/opd" }, { module: "IPD Admissions", path: "/ipd" }, { module: "Patient Registration", path: "/patients" }],
        COP: [{ module: "IPD Workspace", path: "/ipd" }, { module: "OT Workspace", path: "/ot" }, { module: "Emergency", path: "/emergency" }],
        MOM: [{ module: "Pharmacy", path: "/pharmacy" }, { module: "IPD Medication", path: "/ipd" }],
        PRE: [{ module: "OPD Consultation", path: "/opd" }, { module: "Patient Registration", path: "/patients" }],
        HIC: [{ module: "IPC Dashboard", path: "/ipc/dashboard" }, { module: "Nursing Kardex", path: "/nursing" }],
        ROM: [{ module: "Committees", path: "/quality/committees" }, { module: "QI Projects", path: "/quality/qi-projects" }],
        FMS: [{ module: "FMS Dashboard", path: "/fms/dashboard" }, { module: "Biomedical", path: "/biomedical" }],
        HRM: [{ module: "HR & Credentialing", path: "/hr" }],
        IMS: [{ module: "MRD", path: "/mrd" }, { module: "Record Retention", path: "/settings/record-retention" }, { module: "Access Logs", path: "/ims/access-logs" }],
        QPS: [{ module: "Safety Events", path: "/quality/events" }, { module: "Clinical Audits", path: "/quality/clinical-audits" }, { module: "NABH Matrix", path: "/nabh/compliance" }],
      };

      contextData = { gaps: gaps.slice(0, 25), module_map: moduleMap };

    } else if (context_type === "weekly_digest") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      const todayStr = new Date().toISOString().split("T")[0];

      // 1. Safety events in last 7 days
      const { data: safetyEvents } = await sb
        .from("safety_events")
        .select("event_type, category, severity, status, reported_at")
        .eq("hospital_id", hospital_id)
        .gte("reported_at", cutoffStr)
        .order("reported_at", { ascending: false });

      const safetyBySeverity = (safetyEvents || []).reduce((acc: Record<string, number>, e: any) => {
        if (e.severity) acc[e.severity] = (acc[e.severity] || 0) + 1;
        return acc;
      }, {});
      const safetyByType = (safetyEvents || []).reduce((acc: Record<string, number>, e: any) => {
        acc[e.event_type] = (acc[e.event_type] || 0) + 1;
        return acc;
      }, {});
      const openSentinels = (safetyEvents || []).filter((e: any) => e.event_type === "sentinel" && e.status !== "closed").length;

      // 2. IPC infection events in last 7 days
      const { data: ipcEvents } = await sb
        .from("ipc_infection_events")
        .select("infection_type, organism, is_device_related, onset_date")
        .eq("hospital_id", hospital_id)
        .gte("onset_date", cutoffStr);

      const ipcByType = (ipcEvents || []).reduce((acc: Record<string, number>, e: any) => {
        acc[e.infection_type] = (acc[e.infection_type] || 0) + 1;
        return acc;
      }, {});
      const deviceRelated = (ipcEvents || []).filter((e: any) => e.is_device_related).length;

      // 3. Clinical audit activity in last 7 days
      const { data: auditActivity } = await sb
        .from("clinical_audits")
        .select("title, status, updated_at, departments(name)")
        .eq("hospital_id", hospital_id)
        .gte("updated_at", cutoffStr + "T00:00:00")
        .order("updated_at", { ascending: false })
        .limit(10);

      const auditByStatus = (auditActivity || []).reduce((acc: Record<string, number>, a: any) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});

      // 4. CAPA overdue: committee_actions with due_date < today and not completed/deferred
      const { data: overdueActions } = await sb
        .from("committee_actions")
        .select("description, priority, due_date, status, committees(name)")
        .eq("hospital_id", hospital_id)
        .lt("due_date", todayStr)
        .not("status", "in", '("completed","deferred")')
        .order("due_date", { ascending: true })
        .limit(20);

      const capaOverdueCount = (overdueActions || []).length;
      const capaHighPriority = (overdueActions || []).filter((a: any) => a.priority === "high").length;

      // 5. NABH compliance status changes in last 7 days
      const { data: complianceChanges } = await sb
        .from("nabh_hospital_compliance")
        .select("status, risk_level, nabh_standards(chapter_code, standard_code)")
        .eq("hospital_id", hospital_id)
        .gte("updated_at", cutoffStr + "T00:00:00")
        .limit(30);

      const changedToCompliant = (complianceChanges || []).filter((c: any) => c.status === "Compliant").length;
      const changedToNonCompliant = (complianceChanges || []).filter((c: any) => c.status === "Non-Compliant").length;
      const newCriticalRisk = (complianceChanges || []).filter((c: any) => c.risk_level === "Critical").length;

      contextData = {
        period: `${cutoffStr} to ${todayStr}`,
        safety_events: {
          total: (safetyEvents || []).length,
          by_severity: safetyBySeverity,
          by_type: safetyByType,
          open_sentinel_events: openSentinels,
        },
        infection_control: {
          total_new_events: (ipcEvents || []).length,
          by_type: ipcByType,
          device_related: deviceRelated,
        },
        clinical_audits: {
          activity_count: (auditActivity || []).length,
          by_status: auditByStatus,
          recent_titles: (auditActivity || []).slice(0, 3).map((a: any) => a.title),
        },
        capa: {
          overdue_count: capaOverdueCount,
          high_priority_overdue: capaHighPriority,
          top_overdue: (overdueActions || []).slice(0, 3).map((a: any) => ({
            description: (a.description || "").substring(0, 80),
            days_overdue: Math.floor((new Date().getTime() - new Date(a.due_date).getTime()) / 86400_000),
            committee: (a as any).committees?.name,
          })),
        },
        nabh_compliance_changes: {
          total_updated: (complianceChanges || []).length,
          moved_to_compliant: changedToCompliant,
          moved_to_non_compliant: changedToNonCompliant,
          new_critical_risks: newCriticalRisk,
        },
      };

    } else if (context_type === "governance") {
      const { data: meetings } = await sb
        .from("committee_meetings")
        .select("id, meeting_date, quorum_met, committees(name)")
        .eq("hospital_id", hospital_id)
        .order("meeting_date", { ascending: false })
        .limit(6);

      const meetingIds = (meetings || []).map((m: any) => m.id);
      const { data: actions } = await sb
        .from("committee_actions")
        .select("description, status, due_date, priority")
        .in("meeting_id", meetingIds.length ? meetingIds : ["00000000-0000-0000-0000-000000000000"])
        .in("status", ["open", "in_progress"])
        .limit(20);

      const overdueActions = (actions || []).filter((a: any) =>
        a.due_date && new Date(a.due_date) < new Date(),
      ).length;

      contextData = {
        recent_meetings_count: (meetings || []).length,
        quorum_met_rate: (meetings || []).length
          ? `${Math.round(((meetings || []).filter((m: any) => m.quorum_met).length / (meetings || []).length) * 100)}%`
          : "N/A",
        pending_actions_count: (actions || []).length,
        overdue_actions_count: overdueActions,
        committees_active: [...new Set((meetings || []).map((m: any) => m.committees?.name).filter(Boolean))],
        high_priority_open: (actions || []).filter((a: any) => a.priority === "high").length,
      };
    }

    // ── System Prompt ──────────────────────────────────────────────────────────

    const isWeeklyDigest = context_type === "weekly_digest";
    const isEvidenceGaps = context_type === "evidence_gaps";

    let systemPrompt = isEvidenceGaps
      ? `You are an expert NABH accreditation consultant for Indian hospitals (6th Edition standards).

For each compliance gap in the input, suggest exactly ONE piece of evidence that would satisfy the NABH assessor, and identify which Aumrti HMS module can generate or export it.

Respond ONLY with valid JSON in exactly this format — no other text:
{
  "suggestions": [
    {
      "compliance_id": "<copy from input>",
      "oe_code": "<copy from input>",
      "chapter": "<copy from input>",
      "suggested_evidence_type": "<one of: Policy|SOP|Form|Record|Report|Audit|Training|Committee Minutes|Screenshot>",
      "suggested_evidence_title": "<specific document title, max 60 chars>",
      "aumrti_module": "<module name from module_map>",
      "aumrti_path": "<path from module_map>",
      "action_note": "<1 sentence: what to do in the module to produce this evidence>"
    }
  ]
}

Rules:
- Choose the most directly relevant module from the module_map for each chapter
- suggested_evidence_title must be specific (e.g. "Surgical Safety Checklist Completion Rate Report" not just "Report")
- action_note must be actionable (e.g. "Export the monthly clinical audit report as PDF from Clinical Audits module")
- Do not fabricate paths — only use paths from the provided module_map
- Every input gap must have exactly one suggestion in the output`
      : isWeeklyDigest
      ? `You are an expert NABH (National Accreditation Board for Hospitals & Healthcare Providers) consultant writing a Weekly Quality Digest for the Medical Superintendent of an Indian hospital.

Write a concise professional narrative — PLAIN TEXT ONLY, no JSON, no markdown, no bullet symbols. Maximum 300 words.

Use this exact structure (write each heading on its own line followed by 1–2 sentences):

NABH WEEKLY QUALITY DIGEST – [date range from data]

PATIENT SAFETY: [findings from safety events data]

INFECTION CONTROL: [findings from IPC data]

CLINICAL AUDITS: [audit activity summary]

GOVERNANCE & CAPA: [overdue actions summary]

NABH COMPLIANCE MOVEMENT: [compliance status changes]

ACTION REQUIRED: [2–3 most urgent items needing Medical Superintendent attention]

Base every statement strictly on the data provided. Do not invent numbers or events not in the data.`
      : `You are an expert NABH (National Accreditation Board for Hospitals & Healthcare Providers) consultant specialising in Indian hospital accreditation under the 6th Edition standards.

Your role: analyse hospital compliance data and provide concise, actionable NABH guidance.

CRITICAL CONSTRAINTS:
- NEVER fabricate compliance statuses, scores, or data not present in the provided context
- Only summarise what is actually in the data; do not invent risks or actions not supported by it
- Reference specific NABH chapters (AAC, COP, MOM, HIC, FMS, HRM, IMS, QPS) where relevant
- Prioritise findings by severity and accreditation impact
- Use Indian hospital context and terminology

Respond ONLY with valid JSON in exactly this format — no other text:
{"summary":"<2-3 sentence overview>","risks":["<specific risk 1>","<risk 2>","<risk 3>","<risk 4>","<risk 5>"],"recommended_actions":["<action 1>","<action 2>","<action 3>","<action 4>","<action 5>"]}`;

    const CONTEXT_LABELS: Record<ContextType, string> = {
      nabh_matrix: "NABH Compliance Matrix — Gap Analysis",
      audit: "Clinical Audit Programme — Closed Audits Summary",
      ipc: "Infection Prevention & Control Surveillance",
      psq: "Patient Safety & Quality Events",
      governance: "Governance, Committees & Action Tracking",
      weekly_digest: "NABH Weekly Quality Digest",
      evidence_gaps: "Evidence Gap Analysis — OE-level suggestions",
    };

    let userPrompt = isEvidenceGaps
      ? `Analyse these NABH compliance gaps and suggest specific evidence for each:

${JSON.stringify(contextData, null, 2)}

Return ONLY the JSON suggestions array as specified. One suggestion per gap.`
      : isWeeklyDigest
      ? `Generate the NABH Weekly Quality Digest narrative from this hospital data:

${JSON.stringify(contextData, null, 2)}

Write plain text only, max 300 words, using the structure in your instructions.`
      : `Task: ${CONTEXT_LABELS[context_type]}

Hospital compliance data:
${JSON.stringify(contextData, null, 2)}

Provide your NABH expert assessment as JSON only.`;

    // ── Override prompts for RCA draft (plain-text 5-Whys) ────────────────────
    if (isRcaDraft) {
      const ev = contextData as any;
      systemPrompt = `You are a patient safety expert generating a Root Cause Analysis (RCA) using the 5 Whys methodology for NABH QPS documentation at an Indian hospital. Write in plain text — no JSON.`;
      userPrompt = `Generate a structured 5-Whys RCA for this safety event:

Event Type: ${ev.event_type}
Category: ${ev.category}
Severity: ${ev.severity}
Description: ${ev.description}
Immediate Action Taken: ${ev.immediate_action}

Respond in this EXACT plain-text format only:

WHY 1 (Immediate cause): [direct cause of the event]
WHY 2 (Contributing factor): [why WHY 1 occurred]
WHY 3 (System factor): [process or system issue]
WHY 4 (Organisational factor): [management or policy gap]
WHY 5 (Root cause): [fundamental root cause]

ROOT CAUSE SUMMARY: [2–3 sentences describing the root cause for NABH documentation]

CONTRIBUTING FACTORS:
People: [staff knowledge, training, behaviour factors]
Process: [protocol, workflow, communication gaps]
Equipment: [device/material issues, or "Not applicable"]
Environment: [physical environment, workload, or "Not applicable"]`;
    }

    // ── AI Call using shared config helper ────────────────────────────────────

    const config = (await resolveAiConfig(hospital_id, "nabh_evidence", 1024)) ?? resolveAiConfigFromEnv(1024);
    if (!config) {
      return json({ error: "No AI provider configured. Go to Settings → API Hub." }, 503);
    }

    const responseText = await callAiChat(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 1024, 0.4);

    // ── RCA draft: return plain text directly, skip JSON parsing ──────────────
    if (isRcaDraft) {
      return json({ summary: responseText.trim(), risks: [], recommended_actions: [] });
    }

    // ── Weekly digest: return narrative + context summary ─────────────────────
    if (isWeeklyDigest) {
      return json({
        narrative: responseText.trim(),
        context_summary: contextData,
      });
    }

    // ── Evidence gaps: parse suggestions array ────────────────────────────────
    if (isEvidenceGaps) {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (!match) return json({ suggestions: [] });
      try {
        const parsed = JSON.parse(match[0]);
        const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
        return json({ suggestions });
      } catch (_) {
        return json({ suggestions: [] });
      }
    }

    // ── Parse structured JSON ──────────────────────────────────────────────────

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ error: "AI returned unparseable response" }, 500);

    let parsed: { summary?: string; risks?: unknown; recommended_actions?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return json({ error: "AI response JSON parse failed" }, 500);
    }

    return json({
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter((r: unknown) => typeof r === "string").slice(0, 5) : [],
      recommended_actions: Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions.filter((a: unknown) => typeof a === "string").slice(0, 5) : [],
    });

  } catch (err) {
    console.error("ai-nabh-assistant:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
