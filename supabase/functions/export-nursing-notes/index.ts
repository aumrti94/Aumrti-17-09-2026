// @ts-nocheck
/**
 * export-nursing-notes
 *
 * Gathers nursing_vitals and med_admin_records for an IPD admission and
 * renders a combined nursing kardex as a print-ready HTML document.
 * Uploads it to the insurance-documents bucket and returns a signed URL.
 *
 * Note: nursing_handovers is ward-level (no admission_id FK), so it is
 * intentionally excluded — individual observation notes come from
 * nursing_vitals.notes instead.
 *
 * PHI note (Ananya): no patient identifiers written to console logs.
 * Signed URL TTL: 3600 s.
 *
 * Isolation (Meera): caller's hospital_id resolved from users table and
 * compared against admission.hospital_id before any data is returned.
 *
 * Request body: { admission_id: string }
 * Response:     { file_url: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtDT = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

function vitalBp(sys: number | null, dia: number | null): string {
  if (sys == null && dia == null) return "—";
  return `${sys ?? "?"} / ${dia ?? "?"}`;
}

function pewsFlag(mews: number | null): string {
  if (mews == null) return "—";
  if (mews >= 5) return `<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700">MEWS ${mews} ⚠</span>`;
  if (mews >= 3) return `<span style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">MEWS ${mews}</span>`;
  return `<span style="color:#6b7280;font-size:11px">${mews}</span>`;
}

function marStatusBadge(status: string): string {
  const map: Record<string, string> = {
    given:   "background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0",
    pending: "background:#fffbeb;color:#b45309;border:1px solid #fde68a",
    omitted: "background:#fef2f2;color:#dc2626;border:1px solid #fecaca",
    held:    "background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe",
    refused: "background:#fff7ed;color:#c2410c;border:1px solid #fed7aa",
  };
  const style = map[status] ?? "background:#f3f4f6;color:#374151;border:1px solid #e5e7eb";
  return `<span style="${style};padding:1px 7px;border-radius:3px;font-size:10px;font-weight:600;text-transform:uppercase">${status}</span>`;
}

function buildHtml(opts: {
  patientName: string;
  admissionId: string;
  hospitalName: string;
  generatedAt: string;
  vitals: any[];
  marRecords: any[];
}): string {
  const { patientName, admissionId, hospitalName, generatedAt, vitals, marRecords } = opts;

  // ── Section 1: Vital Signs Chart ─────────────────────────────────────────
  const vitalsRows = vitals.length === 0
    ? '<tr><td colspan="12" style="color:#9ca3af;font-style:italic;text-align:center;padding:16px">No vital signs recorded</td></tr>'
    : vitals.map((v: any) => `
        <tr>
          <td>${fmtDT(v.recorded_at)}</td>
          <td>${v.shift ? `<span style="font-size:10px;font-weight:600;text-transform:uppercase;color:#1A2F5A">${v.shift}</span>` : "—"}</td>
          <td>${v.temperature != null ? `${v.temperature}°C` : "—"}</td>
          <td>${v.pulse ?? "—"}</td>
          <td>${vitalBp(v.bp_systolic, v.bp_diastolic)}</td>
          <td>${v.respiratory_rate ?? "—"}</td>
          <td>${v.spo2 != null ? `${v.spo2}%` : "—"}</td>
          <td>${v.pain_score != null ? `${v.pain_score}/10` : "—"}</td>
          <td>${v.urine_output_ml != null ? `${v.urine_output_ml} mL` : "—"}</td>
          <td>${v.intake_oral_ml != null || v.intake_iv_ml != null
              ? `Oral: ${v.intake_oral_ml ?? 0} mL / IV: ${v.intake_iv_ml ?? 0} mL`
              : "—"}</td>
          <td>${pewsFlag(v.mews_score)}</td>
          <td style="max-width:140px;white-space:normal">${v.notes ?? "—"}</td>
        </tr>`).join("");

  // ── Section 2: Medication Administration Record ──────────────────────────
  const marRows = marRecords.length === 0
    ? '<tr><td colspan="7" style="color:#9ca3af;font-style:italic;text-align:center;padding:16px">No medication administration records found</td></tr>'
    : marRecords.map((mar: any) => `
        <tr>
          <td><strong>${mar.drug_name ?? "—"}</strong></td>
          <td>${mar.dose ?? "—"}</td>
          <td>${mar.route ?? "—"}</td>
          <td>${fmtDT(mar.scheduled_time)}</td>
          <td>${mar.administered_at ? fmtDT(mar.administered_at) : "—"}</td>
          <td>${marStatusBadge(mar.status ?? "pending")}</td>
          <td>${mar.omission_reason ?? mar.notes ?? "—"}</td>
        </tr>`).join("");

  // Summary counts for patient bar
  const morningShifts = vitals.filter((v: any) => v.shift === "morning" || v.shift === "day").length;
  const eveningShifts = vitals.filter((v: any) => v.shift === "evening" || v.shift === "afternoon").length;
  const nightShifts   = vitals.filter((v: any) => v.shift === "night").length;

  const critMews = vitals.filter((v: any) => v.mews_score != null && v.mews_score >= 5).length;
  const marGiven = marRecords.filter((m: any) => m.status === "given").length;
  const marOmit  = marRecords.filter((m: any) => m.status === "omitted" || m.status === "refused").length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nursing Notes — ${patientName}</title>
<style>
  @media print { body { background:#fff; } }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:12px; background:#f3f4f6; color:#111; padding:24px; }
  .page { background:#fff; max-width:1100px; margin:0 auto; padding:28px 36px; border:1px solid #e5e7eb; border-radius:8px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1A2F5A; padding-bottom:12px; margin-bottom:16px; }
  .logo { font-size:20px; font-weight:800; color:#1A2F5A; }
  .logo span { color:#0E7B7B; }
  .doc-title { font-size:16px; font-weight:700; color:#1A2F5A; text-align:right; }
  .doc-title small { display:block; font-size:10px; color:#6b7280; font-weight:400; margin-top:2px; }
  .patient-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:12px; margin-bottom:16px; }
  .patient-bar .field label { font-size:10px; font-weight:700; text-transform:uppercase; color:#6b7280; display:block; margin-bottom:2px; }
  .patient-bar .field span { font-size:13px; font-weight:600; }
  .stat-pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  .pill { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600; border:1px solid; }
  h3 { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:#1A2F5A; background:#EEF2FF; padding:6px 10px; border-left:4px solid #1A2F5A; margin:18px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:4px; }
  th { background:#1A2F5A; color:#fff; text-align:left; padding:7px 8px; font-size:10px; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
  td { padding:6px 8px; border-bottom:1px solid #f3f4f6; vertical-align:top; }
  tr:nth-child(even) td { background:#fafafa; }
  .footer { margin-top:20px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:10px; color:#9ca3af; display:flex; justify-content:space-between; }
  .section-count { font-size:10px; color:#6b7280; float:right; font-weight:400; text-transform:none; letter-spacing:0; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="logo">Aumrti<span>.</span></div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">${hospitalName}</div>
    </div>
    <div class="doc-title">
      Nursing Notes &amp; Observation Chart
      <small>Generated: ${generatedAt}</small>
    </div>
  </div>

  <div class="patient-bar">
    <div class="field"><label>Patient</label><span>${patientName}</span></div>
    <div class="field"><label>Admission ID</label><span style="font-family:monospace;font-size:11px">${admissionId}</span></div>
    <div class="field"><label>Vital Recordings</label><span>${vitals.length} entries (D:${morningShifts} E:${eveningShifts} N:${nightShifts})</span></div>
    <div class="field"><label>MAR Entries</label><span>${marRecords.length} (✓${marGiven} given · ✗${marOmit} omitted)</span></div>
  </div>

  ${critMews > 0 ? `<div class="stat-pills"><span class="pill" style="background:#fef2f2;color:#dc2626;border-color:#fecaca">⚠ ${critMews} critical MEWS score${critMews > 1 ? "s" : ""} recorded — review clinical notes</span></div>` : ""}

  <!-- Section 1: Vital Signs / Observation Chart -->
  <h3>Vital Signs &amp; Observation Chart <span class="section-count">${vitals.length} recordings</span></h3>
  <table>
    <thead>
      <tr>
        <th>Date &amp; Time</th>
        <th>Shift</th>
        <th>Temp (°C)</th>
        <th>Pulse</th>
        <th>BP (mmHg)</th>
        <th>RR /min</th>
        <th>SpO₂</th>
        <th>Pain</th>
        <th>Urine Out</th>
        <th>Intake (Oral/IV)</th>
        <th>MEWS</th>
        <th>Nursing Notes</th>
      </tr>
    </thead>
    <tbody>${vitalsRows}</tbody>
  </table>

  <!-- Section 2: Medication Administration Record -->
  <h3>Medication Administration Record (MAR) <span class="section-count">${marRecords.length} entries</span></h3>
  <table>
    <thead>
      <tr>
        <th>Drug</th>
        <th>Dose</th>
        <th>Route</th>
        <th>Scheduled</th>
        <th>Administered</th>
        <th>Status</th>
        <th>Omission Reason / Notes</th>
      </tr>
    </thead>
    <tbody>${marRows}</tbody>
  </table>

  <div class="footer">
    <span>Aumrti HMS · Insurance Document Package · Admission ${admissionId}</span>
    <span>${generatedAt} · For clinical use only</span>
  </div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anonSb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Input ────────────────────────────────────────────────────────────────
    const { admission_id } = await req.json();
    if (!admission_id) {
      return new Response(JSON.stringify({ error: "admission_id is required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Hospital isolation (Meera) ──────────────────────────────────────────
    const { data: userRow } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const callerHospitalId: string | null = userRow?.hospital_id ?? null;
    if (!callerHospitalId) {
      return new Response(JSON.stringify({ error: "User hospital not found" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: admission } = await sb
      .from("admissions")
      .select("hospital_id, patients(full_name)")
      .eq("id", admission_id)
      .maybeSingle();
    if (!admission) {
      return new Response(JSON.stringify({ error: "Admission not found" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (admission.hospital_id !== callerHospitalId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const hospitalId  = admission.hospital_id as string;
    const patientName = (admission.patients as any)?.full_name ?? "Patient";

    const { data: hosp } = await sb.from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
    const hospitalName = hosp?.name ?? "Hospital";

    // ── Fetch nursing data in parallel ──────────────────────────────────────
    const [vitalsRes, marRes] = await Promise.all([
      sb
        .from("nursing_vitals")
        .select(`
          recorded_at, shift,
          temperature, pulse, bp_systolic, bp_diastolic,
          spo2, respiratory_rate, weight,
          pain_score, urine_output_ml,
          intake_oral_ml, intake_iv_ml,
          gcs_total, mews_score, notes
        `)
        .eq("admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("recorded_at", { ascending: true })
        .limit(500),

      sb
        .from("med_admin_records")
        .select("drug_name, dose, route, frequency, scheduled_time, administered_at, status, omission_reason, notes")
        .eq("admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("scheduled_time", { ascending: true })
        .limit(300),
    ]);

    // ── Render HTML ──────────────────────────────────────────────────────────
    const html = buildHtml({
      patientName,
      admissionId: admission_id,
      hospitalName,
      generatedAt: new Date().toLocaleString("en-IN"),
      vitals: vitalsRes.data ?? [],
      marRecords: marRes.data ?? [],
    });

    // ── Upload ───────────────────────────────────────────────────────────────
    const storagePath = `${hospitalId}/${admission_id}/nursing_notes_${Date.now()}.html`;
    const encoder = new TextEncoder();
    const { error: uploadErr } = await sb.storage
      .from("insurance-documents")
      .upload(storagePath, encoder.encode(html), {
        contentType: "text/html;charset=utf-8",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // ── Signed URL — 1-hour TTL (Ananya: PHI) ───────────────────────────────
    const { data: signed } = await sb.storage
      .from("insurance-documents")
      .createSignedUrl(storagePath, 3600);
    if (!signed?.signedUrl) throw new Error("Failed to generate signed URL");

    return new Response(
      JSON.stringify({ file_url: signed.signedUrl }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[export-nursing-notes]", e instanceof Error ? e.message : "unknown error");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
