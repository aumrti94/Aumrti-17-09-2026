// @ts-nocheck
/**
 * export-drug-chart
 *
 * Gathers the IPD medication order list (ipd_medications), pharmacy
 * dispensing records (pharmacy_dispensing + pharmacy_dispensing_items), and
 * the Medication Administration Record (med_admin_records) for an admission.
 * Renders a combined drug chart as a print-ready HTML document, uploads it
 * to the insurance-documents bucket, and returns a signed URL.
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

function statusBadge(status: string): string {
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
  prescriptions: any[];
  dispensingItems: any[];
  marRecords: any[];
}): string {
  const { patientName, admissionId, hospitalName, generatedAt, prescriptions, dispensingItems, marRecords } = opts;

  // ── Section 1: Prescribed Medications ───────────────────────────────────
  const rxRows = prescriptions.length === 0
    ? '<tr><td colspan="7" style="color:#9ca3af;font-style:italic;text-align:center;padding:16px">No IPD medication orders found</td></tr>'
    : prescriptions.map((rx: any) => `
        <tr>
          <td><strong>${rx.drug_name ?? "—"}</strong></td>
          <td>${rx.dose ?? "—"}</td>
          <td>${rx.route ?? "—"}</td>
          <td>${rx.frequency ?? "—"}</td>
          <td>${fmtDate(rx.start_date)}</td>
          <td>${rx.end_date ? fmtDate(rx.end_date) : "Ongoing"}</td>
          <td>${rx.is_active === false ? '<span style="color:#dc2626;font-size:11px">Stopped</span>' : '<span style="color:#16a34a;font-size:11px">Active</span>'}</td>
        </tr>`).join("");

  // ── Section 2: Pharmacy Dispensing ──────────────────────────────────────
  const dispRows = dispensingItems.length === 0
    ? '<tr><td colspan="6" style="color:#9ca3af;font-style:italic;text-align:center;padding:16px">No pharmacy dispensing records found</td></tr>'
    : dispensingItems.map((di: any) => `
        <tr>
          <td><strong>${di.drug_name ?? "—"}</strong></td>
          <td>${di.batch_number ?? "—"}</td>
          <td>${di.quantity_dispensed ?? "—"}</td>
          <td>${di.expiry_date ? fmtDate(di.expiry_date) : "—"}</td>
          <td>₹${di.total_price != null ? Number(di.total_price).toFixed(2) : "—"}</td>
          <td>${di.dispensed_at ? fmtDT(di.dispensed_at) : "—"}</td>
        </tr>`).join("");

  // ── Section 3: Medication Administration Record ──────────────────────────
  const marRows = marRecords.length === 0
    ? '<tr><td colspan="7" style="color:#9ca3af;font-style:italic;text-align:center;padding:16px">No administration records found</td></tr>'
    : marRecords.map((mar: any) => `
        <tr>
          <td><strong>${mar.drug_name ?? "—"}</strong></td>
          <td>${mar.dose ?? "—"}</td>
          <td>${mar.route ?? "—"}</td>
          <td>${fmtDT(mar.scheduled_time)}</td>
          <td>${mar.administered_at ? fmtDT(mar.administered_at) : "—"}</td>
          <td>${statusBadge(mar.status ?? "pending")}</td>
          <td>${mar.omission_reason ?? mar.notes ?? "—"}</td>
        </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Drug Chart — ${patientName}</title>
<style>
  @media print { body { background:#fff; } }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:12px; background:#f3f4f6; color:#111; padding:24px; }
  .page { background:#fff; max-width:980px; margin:0 auto; padding:28px 36px; border:1px solid #e5e7eb; border-radius:8px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1A2F5A; padding-bottom:12px; margin-bottom:16px; }
  .logo { font-size:20px; font-weight:800; color:#1A2F5A; }
  .logo span { color:#0E7B7B; }
  .doc-title { font-size:16px; font-weight:700; color:#1A2F5A; text-align:right; }
  .doc-title small { display:block; font-size:10px; color:#6b7280; font-weight:400; margin-top:2px; }
  .patient-bar { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:12px; margin-bottom:16px; }
  .patient-bar .field label { font-size:10px; font-weight:700; text-transform:uppercase; color:#6b7280; display:block; margin-bottom:2px; }
  .patient-bar .field span { font-size:13px; font-weight:600; }
  h3 { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:#1A2F5A; background:#EEF2FF; padding:6px 10px; border-left:4px solid #1A2F5A; margin:18px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:11.5px; margin-bottom:4px; }
  th { background:#1A2F5A; color:#fff; text-align:left; padding:7px 10px; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; }
  td { padding:7px 10px; border-bottom:1px solid #f3f4f6; vertical-align:top; }
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
      Drug Chart
      <small>Generated: ${generatedAt}</small>
    </div>
  </div>

  <div class="patient-bar">
    <div class="field"><label>Patient</label><span>${patientName}</span></div>
    <div class="field"><label>Admission ID</label><span style="font-family:monospace;font-size:11px">${admissionId}</span></div>
    <div class="field"><label>Records</label><span>${prescriptions.length} Rx · ${dispensingItems.length} dispensed · ${marRecords.length} MAR</span></div>
  </div>

  <!-- Section 1: IPD Prescription Orders -->
  <h3>IPD Medication Orders <span class="section-count">${prescriptions.length} items</span></h3>
  <table>
    <thead>
      <tr>
        <th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th>
        <th>Start Date</th><th>End Date</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rxRows}</tbody>
  </table>

  <!-- Section 2: Pharmacy Dispensing -->
  <h3>Pharmacy Dispensing Records <span class="section-count">${dispensingItems.length} items</span></h3>
  <table>
    <thead>
      <tr>
        <th>Drug</th><th>Batch No.</th><th>Qty Dispensed</th>
        <th>Expiry</th><th>Amount</th><th>Dispensed At</th>
      </tr>
    </thead>
    <tbody>${dispRows}</tbody>
  </table>

  <!-- Section 3: Medication Administration Record (MAR) -->
  <h3>Medication Administration Record (MAR) <span class="section-count">${marRecords.length} entries</span></h3>
  <table>
    <thead>
      <tr>
        <th>Drug</th><th>Dose</th><th>Route</th><th>Scheduled</th>
        <th>Administered</th><th>Status</th><th>Notes / Reason</th>
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

    // ── Fetch drug data in parallel ─────────────────────────────────────────
    const [rxRes, dispRes, marRes] = await Promise.all([
      // IPD medication orders
      sb
        .from("ipd_medications")
        .select("drug_name, dose, route, frequency, start_date, end_date, is_active, notes")
        .eq("admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("start_date", { ascending: true }),

      // Pharmacy dispensing items — join through pharmacy_dispensing
      sb
        .from("pharmacy_dispensing_items")
        .select(`
          drug_name, batch_number, quantity_dispensed,
          expiry_date, total_price, is_ndps,
          pharmacy_dispensing!inner(admission_id, dispensed_at, hospital_id)
        `)
        .eq("pharmacy_dispensing.admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: true }),

      // Medication Administration Record
      sb
        .from("med_admin_records")
        .select("drug_name, dose, route, frequency, scheduled_time, administered_at, status, omission_reason, notes")
        .eq("admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("scheduled_time", { ascending: true })
        .limit(200),
    ]);

    // Flatten dispensing items — add dispensed_at from parent
    const dispensingItems = (dispRes.data ?? []).map((di: any) => ({
      ...di,
      dispensed_at: di.pharmacy_dispensing?.dispensed_at ?? null,
    }));

    // ── Render HTML ──────────────────────────────────────────────────────────
    const html = buildHtml({
      patientName,
      admissionId: admission_id,
      hospitalName,
      generatedAt: new Date().toLocaleString("en-IN"),
      prescriptions: rxRes.data ?? [],
      dispensingItems,
      marRecords: marRes.data ?? [],
    });

    // ── Upload ───────────────────────────────────────────────────────────────
    const storagePath = `${hospitalId}/${admission_id}/drug_chart_${Date.now()}.html`;
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
    console.error("[export-drug-chart]", e instanceof Error ? e.message : "unknown error");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
