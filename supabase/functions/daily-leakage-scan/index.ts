import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeakageItem {
  category: 'lab' | 'radiology' | 'pharmacy' | 'ot';
  description: string;
  entity_id: string;
  estimated_amount: number;
}

interface ScanResult {
  hospital_id: string;
  items: LeakageItem[];
  lab_count: number;
  radiology_count: number;
  pharmacy_count: number;
  ot_count: number;
  total_items: number;
  estimated_amount: number;
}

const LAB_FALLBACK_RATE  = 200;
const RAD_FALLBACK_RATE  = 500;
const OT_FALLBACK_RATE   = 15000;

// ─── Core scan logic for one hospital ────────────────────────────────────────
async function scanHospital(sb: ReturnType<typeof createClient>, hospitalId: string): Promise<ScanResult> {
  const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const items: LeakageItem[] = [];

  // ── 1. Lab orders with billing_status = 'unbilled' older than 12 h ────────
  const { data: labOrders } = await sb
    .from('lab_orders')
    .select('id, created_at')
    .eq('hospital_id', hospitalId)
    .eq('billing_status', 'unbilled')
    .lt('created_at', cutoff12h);

  for (const lo of (labOrders || [])) {
    items.push({
      category: 'lab',
      description: 'Lab Order — unbilled',
      entity_id: lo.id,
      estimated_amount: LAB_FALLBACK_RATE,
    });
  }

  // ── 2. Radiology orders validated but unbilled, older than 12 h ───────────
  const { data: radOrders } = await sb
    .from('radiology_orders')
    .select('id, study_name, created_at')
    .eq('hospital_id', hospitalId)
    .eq('billing_status', 'unbilled')
    .eq('status', 'validated')
    .lt('created_at', cutoff12h);

  for (const ro of (radOrders || [])) {
    items.push({
      category: 'radiology',
      description: `Radiology: ${ro.study_name || 'Study'}`,
      entity_id: ro.id,
      estimated_amount: RAD_FALLBACK_RATE,
    });
  }

  // ── 3. Pharmacy IP dispenses with bill_linked = false, older than 12 h ────
  const { data: pharmaDispenses } = await (sb as any)
    .from('pharmacy_dispensing')
    .select('id, pharmacy_dispensing_items(drug_name, unit_price, quantity_dispensed)')
    .eq('hospital_id', hospitalId)
    .eq('dispensing_type', 'ip')
    .eq('bill_linked', false)
    .lt('created_at', cutoff12h);

  for (const pd of (pharmaDispenses || [])) {
    for (const di of (pd.pharmacy_dispensing_items || [])) {
      items.push({
        category: 'pharmacy',
        description: `Pharmacy IP: ${di.drug_name}`,
        entity_id: pd.id,
        estimated_amount: Number(di.unit_price || 0) * Number(di.quantity_dispensed || 1),
      });
    }
  }

  // ── 4. Completed OT cases older than 24 h with no surgery billing entry ───
  const { data: otCases } = await sb
    .from('ot_schedules')
    .select('id, surgery_name, admission_id, actual_end_time')
    .eq('hospital_id', hospitalId)
    .eq('status', 'completed')
    .not('actual_end_time', 'is', null)
    .not('admission_id', 'is', null)
    .lt('actual_end_time', cutoff24h);

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
    const billedAdmissionIds = new Set<string>();

    if (billIds.length > 0) {
      const { data: surgeryLineItems } = await sb
        .from('bill_line_items')
        .select('bill_id')
        .in('bill_id', billIds)
        .eq('source_module', 'surgery');

      for (const li of (surgeryLineItems || [])) {
        const admId = billIdToAdmission.get(li.bill_id);
        if (admId) billedAdmissionIds.add(admId);
      }
    }

    for (const ot of otCases) {
      if (billedAdmissionIds.has(ot.admission_id)) continue;
      items.push({
        category: 'ot',
        description: `OT: ${ot.surgery_name}`,
        entity_id: ot.id,
        estimated_amount: OT_FALLBACK_RATE,
      });
    }
  }

  const estimatedAmount = items.reduce((s, i) => s + i.estimated_amount, 0);

  return {
    hospital_id: hospitalId,
    items,
    lab_count:       items.filter(i => i.category === 'lab').length,
    radiology_count: items.filter(i => i.category === 'radiology').length,
    pharmacy_count:  items.filter(i => i.category === 'pharmacy').length,
    ot_count:        items.filter(i => i.category === 'ot').length,
    total_items:     items.length,
    estimated_amount: estimatedAmount,
  };
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

    // Fetch all active hospitals with WATI credentials
    const { data: hospitals, error: hospitalsErr } = await sb
      .from('hospitals')
      .select('id, name, wati_api_url, wati_api_key, whatsapp_enabled')
      .eq('is_active', true);

    if (hospitalsErr) throw new Error(`hospitals query: ${hospitalsErr.message}`);
    if (!hospitals || hospitals.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: 'No active hospitals' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const summary: { hospital_id: string; total_items: number; estimated_amount: number }[] = [];

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
          await sb.from('clinical_alerts').insert({
            hospital_id:  hospital.id,
            alert_type:   'leakage_detected',
            alert_message: `Leakage Alert (${reportDateFormatted}): ${scan.total_items} unbilled item(s) — estimated ${amountFormatted} revenue at risk. Open Leakage Scanner to review.`,
            severity:     scan.estimated_amount >= 50000 ? 'critical' : 'high',
            is_acknowledged: false,
          });

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
        });
      } catch (scanErr) {
        console.error(`Scan failed for hospital ${hospital.id}:`, scanErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, report_date: reportDateStr, hospitals: summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('daily-leakage-scan fatal:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
