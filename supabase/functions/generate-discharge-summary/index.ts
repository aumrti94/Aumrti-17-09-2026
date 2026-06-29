// @ts-nocheck
/**
 * generate-discharge-summary
 *
 * Calls ai-discharge-summary (forwarding the user Bearer token) to get a
 * structured, AI-generated discharge summary, then renders it as a
 * print-ready HTML document, uploads it to the insurance-documents bucket,
 * and returns a short-lived signed URL.
 *
 * PHI note (Ananya): no patient data is written to console logs.
 * Signed URL TTL: 3600 s — adequate for a billing-desk download session.
 *
 * Isolation (Meera): caller's hospital_id is resolved from users table and
 * compared against the admission record before any data is served.
 *
 * Request body: { admission_id: string }
 * Response:     { file_url: string }   — signed URL to the HTML file
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function buildHtml(opts: {
  patientName: string;
  admissionId: string;
  hospitalName: string;
  generatedAt: string;
  structured: Record<string, any>;
  rawFallback: Record<string, any> | null;
}): string {
  const { patientName, admissionId, hospitalName, generatedAt, structured: s, rawFallback } = opts;

  // Medications table rows
  const medRows = Array.isArray(s.discharge_medications) && s.discharge_medications.length
    ? s.discharge_medications.map((m: any) =>
        `<tr>
          <td>${m.drug ?? "—"}</td>
          <td>${m.dose ?? "—"}</td>
          <td>${m.frequency ?? "—"}</td>
          <td>${m.duration ?? "—"}</td>
          <td>${m.instructions ?? "—"}</td>
        </tr>`
      ).join("")
    : '<tr><td colspan="5" class="na">None recorded</td></tr>';

  const followUp = Array.isArray(s.follow_up_appointments) && s.follow_up_appointments.length
    ? s.follow_up_appointments.map((f: string) => `<li>${f}</li>`).join("")
    : "<li>—</li>";

  const redFlags = Array.isArray(s.red_flag_symptoms) && s.red_flag_symptoms.length
    ? s.red_flag_symptoms.map((r: string) => `<li>${r}</li>`).join("")
    : "<li>—</li>";

  const procedures = Array.isArray(s.procedures_performed) && s.procedures_performed.length
    ? s.procedures_performed.map((p: string) => `<li>${p}</li>`).join("")
    : "<li>None</li>";

  const comorbidities = Array.isArray(s.comorbidities) && s.comorbidities.length
    ? s.comorbidities.join(", ")
    : "None documented";

  const icdPrimary   = s.icd_codes?.primary  ?? "Pending";
  const icdSecondary = Array.isArray(s.icd_codes?.secondary) && s.icd_codes.secondary.length
    ? s.icd_codes.secondary.join(", ")
    : "—";

  const vitals = s.vitals_at_discharge ?? {};

  // If AI structured data is thin (no AI config), show a raw data notice
  const rawNotice = rawFallback
    ? `<div class="notice">⚠ AI provider not configured — summary below is auto-formatted from EMR data. Review and complete manually before submission.</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Discharge Summary — ${patientName}</title>
<style>
  @media print { body { background:#fff; } .no-print { display:none; } }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:13px; background:#f3f4f6; color:#111; padding:24px; }
  .page { background:#fff; max-width:900px; margin:0 auto; padding:32px 40px; border:1px solid #e5e7eb; border-radius:8px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1A2F5A; padding-bottom:14px; margin-bottom:18px; }
  .logo { font-size:22px; font-weight:800; color:#1A2F5A; letter-spacing:-0.5px; }
  .logo span { color:#0E7B7B; }
  .doc-title { font-size:18px; font-weight:700; color:#1A2F5A; text-align:right; }
  .doc-title small { display:block; font-size:11px; color:#6b7280; font-weight:400; margin-top:2px; }
  .patient-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:14px; margin-bottom:18px; }
  .patient-bar .field label { font-size:10px; font-weight:700; text-transform:uppercase; color:#6b7280; display:block; margin-bottom:2px; }
  .patient-bar .field span { font-size:13px; font-weight:600; color:#111; }
  h3 { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:#1A2F5A; background:#EEF2FF; padding:6px 10px; border-left:4px solid #1A2F5A; margin:18px 0 10px; }
  p { line-height:1.6; margin-bottom:8px; }
  ul { padding-left:18px; line-height:1.7; }
  table { width:100%; border-collapse:collapse; margin-bottom:6px; font-size:12px; }
  th { background:#1A2F5A; color:#fff; text-align:left; padding:7px 10px; font-size:11px; text-transform:uppercase; }
  td { padding:7px 10px; border-bottom:1px solid #f3f4f6; vertical-align:top; }
  tr:nth-child(even) td { background:#f9fafb; }
  .vitals-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
  .vital-box { border:1px solid #e5e7eb; border-radius:6px; padding:10px; text-align:center; }
  .vital-box .val { font-size:17px; font-weight:700; color:#1A2F5A; }
  .vital-box .lbl { font-size:10px; color:#6b7280; text-transform:uppercase; margin-top:2px; }
  .redflags { background:#fff7f7; border:1px solid #fecaca; border-radius:6px; padding:12px 16px; }
  .redflags li { color:#991b1b; }
  .patient-summary { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:14px; line-height:1.7; font-size:13px; }
  .footer { margin-top:24px; padding-top:14px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; display:flex; justify-content:space-between; }
  .notice { background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#92400e; }
  .na { color:#9ca3af; font-style:italic; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="logo">Aumrti<span>.</span></div>
      <div style="font-size:11px;color:#6b7280;margin-top:3px;">${hospitalName}</div>
    </div>
    <div class="doc-title">
      Discharge Summary
      <small>Generated: ${generatedAt}</small>
    </div>
  </div>

  ${rawNotice}

  <div class="patient-bar">
    <div class="field"><label>Patient Name</label><span>${patientName}</span></div>
    <div class="field"><label>Admission ID</label><span style="font-family:monospace;font-size:11px">${admissionId}</span></div>
    <div class="field"><label>ICD-10 Primary</label><span>${icdPrimary}</span></div>
    <div class="field"><label>Comorbidities</label><span>${comorbidities}</span></div>
  </div>

  <h3>Final Diagnosis</h3>
  <p>${s.final_diagnosis ?? rawFallback?.diagnosis ?? "—"}</p>
  ${icdSecondary !== "—" ? `<p style="font-size:12px;color:#6b7280">Secondary ICD-10: ${icdSecondary}</p>` : ""}

  <h3>Hospital Course</h3>
  <p>${s.hospital_course ?? rawFallback?.course ?? "—"}</p>

  <h3>Procedures Performed</h3>
  <ul>${procedures}</ul>

  <h3>Vitals at Discharge</h3>
  <div class="vitals-grid">
    <div class="vital-box"><div class="val">${vitals.bp ?? "—"}</div><div class="lbl">BP (mmHg)</div></div>
    <div class="vital-box"><div class="val">${vitals.hr ?? "—"}</div><div class="lbl">Heart Rate</div></div>
    <div class="vital-box"><div class="val">${vitals.spo2 ?? "—"}</div><div class="lbl">SpO₂</div></div>
    <div class="vital-box"><div class="val">${vitals.temp ?? "—"}</div><div class="lbl">Temp (°C)</div></div>
    <div class="vital-box"><div class="val">${vitals.rr ?? "—"}</div><div class="lbl">RR (/min)</div></div>
  </div>

  <h3>Discharge Medications</h3>
  <table>
    <thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
    <tbody>${medRows}</tbody>
  </table>

  <h3>Diet &amp; Activity Instructions</h3>
  <p><strong>Diet:</strong> ${s.diet_instructions ?? "—"}</p>
  <p><strong>Activity:</strong> ${s.activity_restrictions ?? "—"}</p>

  <h3>Follow-Up Appointments</h3>
  <ul>${followUp}</ul>

  <h3>Red Flag Symptoms — Return to ER Immediately If</h3>
  <div class="redflags"><ul>${redFlags}</ul></div>

  <h3>Patient Summary (Plain Language)</h3>
  <div class="patient-summary">${s.patient_friendly_summary ?? "—"}</div>
  ${s.emergency_contact_note ? `<p style="margin-top:10px;font-size:12px;color:#374151"><strong>Emergency:</strong> ${s.emergency_contact_note}</p>` : ""}

  <div class="footer">
    <span>AI-assisted • Clinician must review and countersign before submission</span>
    <span>Aumrti HMS · insurance-documents · Admission ${admissionId}</span>
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

    // ── Input ───────────────────────────────────────────────────────────────
    const { admission_id } = await req.json();
    if (!admission_id) {
      return new Response(JSON.stringify({ error: "admission_id is required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Hospital isolation (Meera) ─────────────────────────────────────────
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

    const hospitalId   = admission.hospital_id as string;
    const patientName  = (admission.patients as any)?.full_name ?? "Patient";

    // ── Fetch hospital name (for header) ────────────────────────────────────
    const { data: hosp } = await sb
      .from("hospitals")
      .select("name")
      .eq("id", hospitalId)
      .maybeSingle();
    const hospitalName = hosp?.name ?? "Hospital";

    // ── Call ai-discharge-summary to get structured content ─────────────────
    // Forward the original Bearer token so ai-discharge-summary can authenticate.
    let structured: Record<string, any> = {};
    let rawFallback: Record<string, any> | null = null;

    const aiRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-discharge-summary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
          "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({ admission_id }),
      },
    ).catch(() => null);

    if (aiRes?.ok) {
      const aiBody = await aiRes.json().catch(() => ({}));
      if (aiBody?.structured && typeof aiBody.structured === "object") {
        structured = aiBody.structured;
      } else {
        // ai-discharge-summary returned ok but no structured data — treat as fallback
        rawFallback = { diagnosis: "See clinical notes", course: "Refer to ward round notes" };
      }
    } else {
      // AI call failed (no config, network error, etc.) — fallback: just render with empty structured
      rawFallback = { diagnosis: "AI generation unavailable", course: "" };
    }

    // ── Render HTML ──────────────────────────────────────────────────────────
    const html = buildHtml({
      patientName,
      admissionId: admission_id,
      hospitalName,
      generatedAt: new Date().toLocaleString("en-IN"),
      structured,
      rawFallback,
    });

    // ── Upload to insurance-documents ────────────────────────────────────────
    const storagePath = `${hospitalId}/${admission_id}/discharge_summary_${Date.now()}.html`;
    const encoder = new TextEncoder();
    const { error: uploadErr } = await sb.storage
      .from("insurance-documents")
      .upload(storagePath, encoder.encode(html), {
        contentType: "text/html;charset=utf-8",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // ── Signed URL — 3600 s (1 hour) for PHI compliance (Ananya) ────────────
    const { data: signed } = await sb.storage
      .from("insurance-documents")
      .createSignedUrl(storagePath, 3600);
    if (!signed?.signedUrl) throw new Error("Failed to generate signed URL");

    return new Response(
      JSON.stringify({ file_url: signed.signedUrl }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    // PHI note: log only error message, not patient data
    console.error("[generate-discharge-summary]", e instanceof Error ? e.message : "unknown error");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
