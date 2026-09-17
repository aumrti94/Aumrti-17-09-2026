import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  OT_BILLING_SOURCE_MODULE,
  billedOtAdmissions,
  buildLeakageReport,
  leakageCutoffs,
  leakageSeverity,
  modulesWithLeaks,
  type LeakageReport,
} from '../_shared/leakageScan.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ScanResult = LeakageReport & { hospital_id: string };

/**
 * PHASE 2 EXTRACTION. The decision half of this scan — grace windows, fallback rates,
 * categorisation, the OT billed-check and the totals — now lives in
 * `../_shared/leakageScan.ts` and is unit tested at `src/lib/leakageScan.test.ts`.
 *
 * It was previously inline here, which meant no vitest run could import it and the grace
 * windows had never been asserted. Two defects had already reached production in this
 * function for want of that: a stale `source_module = 'surgery'` filter that flagged EVERY
 * completed OT case as leakage, and undefined top-level counts that made every successful
 * scan report "0 items across 0 modules".
 *
 * What stays here is I/O: the queries, and only the queries.
 */
async function scanHospital(sb: ReturnType<typeof createClient>, hospitalId: string): Promise<ScanResult> {
  const cutoffs = leakageCutoffs(Date.now());

  // ── 1. Lab orders with billing_status = 'unbilled' past the grace window ──
  const { data: labOrders } = await sb
    .from('lab_orders')
    .select('id, created_at')
    .eq('hospital_id', hospitalId)
    .eq('billing_status', 'unbilled')
    .lt('created_at', cutoffs.ancillary);

  // ── 2. Radiology orders validated but unbilled ───────────────────────────
  const { data: radOrders } = await sb
    .from('radiology_orders')
    .select('id, study_name, created_at')
    .eq('hospital_id', hospitalId)
    .eq('billing_status', 'unbilled')
    .eq('status', 'validated')
    .lt('created_at', cutoffs.ancillary);

  // ── 3. Pharmacy IP dispenses not linked to a bill ────────────────────────
  const { data: pharmaDispenses } = await (sb as any)
    .from('pharmacy_dispensing')
    .select('id, pharmacy_dispensing_items(drug_name, unit_price, quantity_dispensed)')
    .eq('hospital_id', hospitalId)
    .eq('dispensing_type', 'ip')
    .eq('bill_linked', false)
    .lt('created_at', cutoffs.ancillary);

  // ── 4. Completed OT cases past their longer grace window ─────────────────
  const { data: otCases } = await sb
    .from('ot_schedules')
    .select('id, surgery_name, admission_id, actual_end_time')
    .eq('hospital_id', hospitalId)
    .eq('status', 'completed')
    .not('actual_end_time', 'is', null)
    .not('admission_id', 'is', null)
    .lt('actual_end_time', cutoffs.ot);

  let billedAdmissionIds = new Set<string>();

  if (otCases && otCases.length > 0) {
    // Batch billing check: avoid N+1 by fetching all related data in 2 queries
    const admissionIds = [...new Set(otCases.map((ot: any) => ot.admission_id))];

    const { data: relatedBills } = await sb
      .from('bills')
      .select('id, admission_id')
      .eq('hospital_id', hospitalId)
      .in('admission_id', admissionIds);

    const billIdToAdmission = new Map<string, string>(
      (relatedBills || []).map((b: any) => [b.id, b.admission_id])
    );
    const billIds = (relatedBills || []).map((b: any) => b.id);

    if (billIds.length > 0) {
      const { data: otLineItems } = await sb
        .from('bill_line_items')
        .select('bill_id, source_module')
        .in('bill_id', billIds)
        .eq('source_module', OT_BILLING_SOURCE_MODULE);

      billedAdmissionIds = billedOtAdmissions(otLineItems as any[], billIdToAdmission);
    }
  }

  const report = buildLeakageReport({
    labOrders: labOrders as any[],
    radiologyOrders: radOrders as any[],
    pharmacyDispenses: pharmaDispenses as any[],
    otCases: otCases as any[],
    billedOtAdmissionIds: billedAdmissionIds,
  });

  return { hospital_id: hospitalId, ...report };
}

// ─── WATI WhatsApp notification ───────────────────────────────────────────────
async function sendWATI(
  watiUrl: string,
  watiKey: string,
  phones: string[],
  reportDateFormatted: string,
  amountFormatted: string,
  totalItems: number,
): Promise<void> {
  if (!watiUrl || !watiKey || phones.length === 0) return;

  // Normalise numbers to E.164 without '+': WATI expects just digits, 91XXXXXXXXXX
  const receivers = phones
    .map(p => ({ whatsappNumber: p.replace(/\D/g, '').replace(/^0/, '91') }))
    .filter(r => r.whatsappNumber.length >= 10);

  if (receivers.length === 0) return;

  // The WATI template "leakage_alert_daily" must be pre-approved in WATI dashboard.
  // Template body: "Aumrti Leakage Alert — {{1}}: {{2}} estimated unbilled revenue detected.
  //   {{3}} items require immediate billing action. Open Aumrti → Leakage Scanner to review."
  const body = JSON.stringify({
    template_name:  'leakage_alert_daily',
    broadcast_name: `leakage_${reportDateFormatted.replace(/\//g, '_')}`,
    receivers,
    parameters: [
      { name: '1', value: reportDateFormatted },
      { name: '2', value: amountFormatted },
      { name: '3', value: String(totalItems) },
    ],
  });

  try {
    const res = await fetch(`${watiUrl}/api/v1/sendTemplateMessages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${watiKey}` },
      body,
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`WATI sendTemplateMessages HTTP ${res.status}: ${err}`);
    }
  } catch (err) {
    console.error('WATI fetch failed:', err);
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Report covers yesterday (the day that just ended at 00:30 UTC / 06:00 IST)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reportDateStr       = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    const reportDateFormatted = yesterday.toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    }); // DD/MM/YYYY

    // ── Auth ──────────────────────────────────────────────────────────────
    // Previously had NO auth check at all. The no-body path scans and returns
    // EVERY hospital's unbilled-revenue leakage figures — callable by anyone,
    // no token required. The body-scoped path let any authenticated user of
    // any hospital name another hospital's id and get its leakage figures
    // back, plus fire a WhatsApp alert to that hospital's own CFO/billing
    // staff. Found in the Phase 4 isolation audit — see KNOWN_BUGS.md.
    //
    // Two legitimate callers: the pg_cron nightly job sends no body and
    // authenticates with the service-role key (matching insurance-daily-alerts'
    // pattern in this same directory); the Billing UI's on-demand "Run Scan"
    // sends { hospital_id } via a real user's session and must be checked
    // against that user's own hospital.
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isInternalCaller = authHeader === `Bearer ${serviceKey}`;

    // Scope: an on-demand scan from the Billing UI sends { hospital_id } and must scan
    // ONLY that hospital. Previously the body was ignored entirely, so one user clicking
    // "Run Scan" kicked off a scan for every hospital on the platform — wasteful and
    // cross-tenant. The pg_cron nightly job sends no body and still scans all.
    let requestedHospitalId: string | null = null;
    try {
      const body = await req.json();
      requestedHospitalId = body?.hospital_id ?? null;
    } catch {
      // No/!JSON body — the cron path. Scan everything.
    }

    if (!isInternalCaller) {
      // A non-cron caller MUST name exactly one hospital, and it must be their own.
      if (!requestedHospitalId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const token = authHeader.replace(/^Bearer /, '');
      if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: staff } = await sb.from('users').select('hospital_id').eq('auth_user_id', user.id).maybeSingle();
      if (!staff || staff.hospital_id !== requestedHospitalId) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let hospitalQuery = sb
      .from('hospitals')
      .select('id, name, wati_api_url, wati_api_key, whatsapp_enabled')
      .eq('is_active', true);

    if (requestedHospitalId) hospitalQuery = hospitalQuery.eq('id', requestedHospitalId);

    const { data: hospitals, error: hospitalsErr } = await hospitalQuery;

    if (hospitalsErr) throw new Error(`hospitals query: ${hospitalsErr.message}`);
    if (!hospitals || hospitals.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: 'No active hospitals' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const summary: {
      hospital_id: string; total_items: number; estimated_amount: number; modules_with_leaks: number;
    }[] = [];
    const failures: string[] = [];

    for (const hospital of hospitals) {
      try {
        const scan = await scanHospital(sb, hospital.id);

        // Upsert — safe to re-run; updates if already exists for (hospital, date)
        await sb.from('leakage_reports').upsert({
          hospital_id:      hospital.id,
          report_date:      reportDateStr,
          lab_count:        scan.lab_count,
          radiology_count:  scan.radiology_count,
          pharmacy_count:   scan.pharmacy_count,
          ot_count:         scan.ot_count,
          total_items:      scan.total_items,
          estimated_amount: scan.estimated_amount,
          items:            scan.items,
          scan_completed_at: new Date().toISOString(),
        }, { onConflict: 'hospital_id,report_date' });

        if (scan.total_items > 0) {
          const amountFormatted = '₹' + scan.estimated_amount.toLocaleString('en-IN');

          // ── In-app clinical alert ─────────────────────────────────────────
          // Was unchecked — 'leakage_detected' had no entry in clinical_alerts_alert_type_check
          // until this same pass, so this insert has always failed silently, forever, while
          // the scan itself still reported ok:true.
          const { error: alertErr } = await sb.from('clinical_alerts').insert({
            hospital_id:  hospital.id,
            alert_type:   'leakage_detected',
            alert_message: `Leakage Alert (${reportDateFormatted}): ${scan.total_items} unbilled item(s) — estimated ${amountFormatted} revenue at risk. Open Leakage Scanner to review.`,
            severity:     leakageSeverity(scan.estimated_amount),
            is_acknowledged: false,
          });
          if (alertErr) console.error(`daily-leakage-scan: clinical_alerts insert failed for hospital ${hospital.id}:`, alertErr.message);

          // ── Fetch CFO / billing_executive / hospital_admin phone numbers ──
          const { data: staffUsers } = await sb
            .from('users')
            .select('phone')
            .eq('hospital_id', hospital.id)
            .in('role', ['cfo', 'billing_executive', 'hospital_admin'])
            .not('phone', 'is', null);

          const phones = (staffUsers || [])
            .map((u: any) => u.phone as string)
            .filter(Boolean);

          // ── WhatsApp notification via WATI ────────────────────────────────
          if (hospital.whatsapp_enabled && hospital.wati_api_url && hospital.wati_api_key) {
            await sendWATI(
              hospital.wati_api_url,
              hospital.wati_api_key,
              phones,
              reportDateFormatted,
              amountFormatted,
              scan.total_items,
            );
            await sb.from('leakage_reports')
              .update({ notified_at: new Date().toISOString() })
              .eq('hospital_id', hospital.id)
              .eq('report_date', reportDateStr);
          }

        }

        summary.push({
          hospital_id:      hospital.id,
          total_items:      scan.total_items,
          estimated_amount: scan.estimated_amount,
          modules_with_leaks: modulesWithLeaks(scan),
        });
      } catch (scanErr) {
        console.error(`Scan failed for hospital ${hospital.id}:`, scanErr instanceof Error ? scanErr.message : String(scanErr));
        failures.push(hospital.id);
      }
    }

    // Flat totals at the top level: the caller reads `leakage_count` / `modules_scanned`
    // directly, and previously got `undefined` for both — so a successful scan always
    // toasted "Found 0 unbilled items across 0 modules", indistinguishable from a no-op.
    const leakageCount = summary.reduce((s, h) => s + h.total_items, 0);
    const modulesScanned = summary.reduce((m, h) => Math.max(m, h.modules_with_leaks), 0);

    return new Response(
      JSON.stringify({
        ok: failures.length === 0,
        report_date: reportDateStr,
        hospitals: summary,
        leakage_count: leakageCount,
        modules_scanned: modulesScanned,
        estimated_amount: summary.reduce((s, h) => s + h.estimated_amount, 0),
        // Per-hospital scan errors were previously only console.error'd while the
        // response still claimed ok:true — a total failure looked like success.
        failed_hospitals: failures.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('daily-leakage-scan fatal:', err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
