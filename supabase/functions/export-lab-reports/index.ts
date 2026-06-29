// @ts-nocheck
/**
 * export-lab-reports
 *
 * Gathers lab_orders + lab_order_items + lab_results for an IPD admission,
 * renders a combined investigation report as a print-ready HTML document,
 * uploads it to the insurance-documents bucket, and returns a signed URL.
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
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function flagBadge(flag: string | null): string {
  if (!flag || flag === "normal") return "";
  if (flag === "critical_high" || flag === "critical_low") return `<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700">⚠ ${flag.replace("_", " ").toUpperCase()}</span>`;
  return `<span style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">${flag.toUpperCase()}</span>`;
}

function buildHtml(opts: {
  patientName: string;
  admissionId: string;
  hospitalName: string;
  generatedAt: string;
  orders: any[];
  itemsByOrder: Record<string, any[]>;
}): string {
  const { patientName, admissionId, hospitalName, generatedAt, orders, itemsByOrder } = opts;

  const orderSections = orders.length === 0
    ? '<tr><td colspan="6" style="color:#9ca3af;font-style:italic;text-align:center;padding:18px">No lab orders found for this admission</td></tr>'
    : orders.map((order) => {
        const items = itemsByOrder[order.id] ?? [];
        const itemRows = items.length === 0
          ? `<tr><td colspan="6" style="color:#9ca3af;font-style:italic;padding:8px 10px">No results recorded</td></tr>`
          : items.map((it: any) => {
              const hasResult = it.result_value != null || it.result_numeric != null;
              const resultDisplay = it.result_value ?? (it.result_numeric != null ? String(it.result_numeric) : "—");
              return `<tr>
                <td>${it.test_name ?? it.test_id ?? "—"}</td>
                <td>${it.sample_collected_at ? fmtDate(it.sample_collected_at) : "—"}</td>
                <td><strong>${hasResult ? resultDisplay : "Pending"}</strong> ${it.result_unit ?? ""}</td>
                <td>${it.reference_range ?? "—"}</td>
                <td>${flagBadge(it.result_flag)}</td>
                <td>${it.validated_at ? "✓ Validated" : it.result_entered_at ? "Entered" : "Ordered"}</td>
              </tr>`;
            }).join("");

        return `
          <tr style="background:#EEF2FF">
            <td colspan="6" style="padding:8px 10px;font-weight:700;color:#1A2F5A;font-size:12px">
              Order #${order.id.slice(0, 8).toUpperCase()} &nbsp;·&nbsp; ${fmtDate(order.order_date)}
              &nbsp;·&nbsp; Priority: ${(order.priority ?? "routine").toUpperCase()}
              ${order.clinical_notes ? `&nbsp;·&nbsp; Notes: <em style="font-weight:400">${order.clinical_notes}</em>` : ""}
            </td>
          </tr>
          ${itemRows}`;
      }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Investigation Reports — ${patientName}</title>
<style>
  @media print { body { background:#fff; } }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:12px; background:#f3f4f6; color:#111; padding:24px; }
  .page { background:#fff; max-width:960px; margin:0 auto; padding:28px 36px; border:1px solid #e5e7eb; border-radius:8px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1A2F5A; padding-bottom:12px; margin-bottom:16px; }
  .logo { font-size:20px; font-weight:800; color:#1A2F5A; }
  .logo span { color:#0E7B7B; }
  .doc-title { font-size:16px; font-weight:700; color:#1A2F5A; text-align:right; }
  .doc-title small { display:block; font-size:10px; color:#6b7280; font-weight:400; margin-top:2px; }
  .patient-bar { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:12px; margin-bottom:16px; }
  .patient-bar .field label { font-size:10px; font-weight:700; text-transform:uppercase; color:#6b7280; display:block; margin-bottom:2px; }
  .patient-bar .field span { font-size:13px; font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#1A2F5A; color:#fff; text-align:left; padding:7px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  td { padding:7px 10px; border-bottom:1px solid #f3f4f6; vertical-align:top; }
  tr:nth-child(even):not([style]) td { background:#fafafa; }
  .footer { margin-top:20px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:10px; color:#9ca3af; display:flex; justify-content:space-between; }
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
      Investigation Reports
      <small>Generated: ${generatedAt}</small>
    </div>
  </div>

  <div class="patient-bar">
    <div class="field"><label>Patient</label><span>${patientName}</span></div>
    <div class="field"><label>Admission ID</label><span style="font-family:monospace;font-size:11px">${admissionId}</span></div>
    <div class="field"><label>Total Orders</label><span>${orders.length}</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Test Name</th>
        <th>Collected</th>
        <th>Result</th>
        <th>Ref. Range</th>
        <th>Flag</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${orderSections}</tbody>
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

    // ── Fetch lab data in parallel ──────────────────────────────────────────
    // lab_order_items store test_name via a join to lab_test_master through test_id.
    // We select test_name from a nested join where available.
    const [ordersRes, itemsRes] = await Promise.all([
      sb
        .from("lab_orders")
        .select("id, order_date, priority, clinical_notes, status")
        .eq("admission_id", admission_id)
        .eq("hospital_id", hospitalId)
        .order("order_date", { ascending: true }),

      sb
        .from("lab_order_items")
        .select(`
          id, lab_order_id, result_value, result_numeric, result_unit,
          result_flag, reference_range, result_entered_at, validated_at,
          sample_collected_at, status, notes,
          lab_test_master(test_name)
        `)
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: true }),
    ]);

    const orders: any[] = ordersRes.data ?? [];
    const orderIds = new Set(orders.map((o) => o.id));

    // Flatten items, enrich with test_name, filter to only this admission's orders
    const itemsByOrder: Record<string, any[]> = {};
    for (const item of (itemsRes.data ?? [])) {
      if (!orderIds.has(item.lab_order_id)) continue;
      const enriched = {
        ...item,
        test_name: (item.lab_test_master as any)?.test_name ?? null,
      };
      if (!itemsByOrder[item.lab_order_id]) itemsByOrder[item.lab_order_id] = [];
      itemsByOrder[item.lab_order_id].push(enriched);
    }

    // ── Render HTML ──────────────────────────────────────────────────────────
    const html = buildHtml({
      patientName,
      admissionId: admission_id,
      hospitalName,
      generatedAt: new Date().toLocaleString("en-IN"),
      orders,
      itemsByOrder,
    });

    // ── Upload ───────────────────────────────────────────────────────────────
    const storagePath = `${hospitalId}/${admission_id}/lab_reports_${Date.now()}.html`;
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
    console.error("[export-lab-reports]", e instanceof Error ? e.message : "unknown error");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
