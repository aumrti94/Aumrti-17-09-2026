import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth verification — super_admin or hospital_admin only
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData } = await supabase
    .from("users")
    .select("hospital_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!userData || !["super_admin", "hospital_admin"].includes(userData.role)) {
    return new Response(JSON.stringify({ error: "Forbidden — super_admin or hospital_admin required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hospitalId = userData.hospital_id;

  const drugs = [
    { drug_name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin', category: 'Antibiotic', dosage_forms: ['Capsule'], routes: ['Oral'], standard_doses: ['500mg TDS'], drug_schedule: 'H', reorder_level: 50, gst_percent: 12 },
    { drug_name: 'Azithromycin 500mg', generic_name: 'Azithromycin', category: 'Antibiotic', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['500mg OD'], drug_schedule: 'H', reorder_level: 30, gst_percent: 12 },
    { drug_name: 'Ceftriaxone 1g Inj', generic_name: 'Ceftriaxone', category: 'Antibiotic', dosage_forms: ['Injection'], routes: ['IV', 'IM'], standard_doses: ['1g BD'], drug_schedule: 'H1', reorder_level: 20, gst_percent: 12 },
    { drug_name: 'Metformin 500mg', generic_name: 'Metformin', category: 'Antidiabetic', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['500mg BD'], drug_schedule: 'H', reorder_level: 100, gst_percent: 12 },
    { drug_name: 'Amlodipine 5mg', generic_name: 'Amlodipine', category: 'Antihypertensive', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['5mg OD'], drug_schedule: 'H', reorder_level: 100, gst_percent: 12 },
    { drug_name: 'Pantoprazole 40mg', generic_name: 'Pantoprazole', category: 'GI', dosage_forms: ['Tablet', 'Injection'], routes: ['Oral', 'IV'], standard_doses: ['40mg OD'], drug_schedule: 'H', reorder_level: 80, gst_percent: 12 },
    { drug_name: 'Ondansetron 4mg', generic_name: 'Ondansetron', category: 'Antiemetic', dosage_forms: ['Tablet', 'Injection'], routes: ['Oral', 'IV'], standard_doses: ['4mg TDS'], drug_schedule: 'H', reorder_level: 50, gst_percent: 12 },
    { drug_name: 'Tramadol 50mg', generic_name: 'Tramadol', category: 'Analgesic', dosage_forms: ['Capsule', 'Injection'], routes: ['Oral', 'IV', 'IM'], standard_doses: ['50mg BD'], drug_schedule: 'X', reorder_level: 20, gst_percent: 12, is_ndps: true },
    { drug_name: 'Diclofenac 50mg', generic_name: 'Diclofenac', category: 'NSAID', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['50mg BD'], drug_schedule: 'H', reorder_level: 60, gst_percent: 5 },
    { drug_name: 'Cetirizine 10mg', generic_name: 'Cetirizine', category: 'Antihistamine', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['10mg OD'], drug_schedule: 'OTC', reorder_level: 80, gst_percent: 12 },
    { drug_name: 'ORS Sachet', generic_name: 'ORS', category: 'Supplement', dosage_forms: ['Sachet'], routes: ['Oral'], standard_doses: ['1 sachet TDS'], drug_schedule: 'OTC', reorder_level: 100, gst_percent: 0 },
    { drug_name: 'Ranitidine 150mg', generic_name: 'Ranitidine', category: 'GI', dosage_forms: ['Tablet'], routes: ['Oral'], standard_doses: ['150mg BD'], drug_schedule: 'H', reorder_level: 60, gst_percent: 12 },
    { drug_name: 'Dexamethasone 4mg Inj', generic_name: 'Dexamethasone', category: 'Steroid', dosage_forms: ['Injection'], routes: ['IV', 'IM'], standard_doses: ['4mg OD'], drug_schedule: 'H', reorder_level: 30, gst_percent: 12 },
    { drug_name: 'Normal Saline 500ml', generic_name: 'Sodium Chloride 0.9%', category: 'IV Fluid', dosage_forms: ['IV Fluid'], routes: ['IV'], standard_doses: ['500ml'], drug_schedule: 'H', reorder_level: 50, gst_percent: 12 },
    { drug_name: 'Ringer Lactate 500ml', generic_name: 'RL', category: 'IV Fluid', dosage_forms: ['IV Fluid'], routes: ['IV'], standard_doses: ['500ml'], drug_schedule: 'H', reorder_level: 50, gst_percent: 12 },
  ];

  const drugInserts = drugs.map(d => ({ hospital_id: hospitalId, ...d }));
  const { data: insertedDrugs, error: drugErr } = await supabase
    .from("drug_master")
    .upsert(drugInserts, { onConflict: "id", ignoreDuplicates: false })
    .select("id, drug_name");

  let resolvedDrugs: { id: string; drug_name: string }[] = [];

  if (drugErr) {
    for (const d of drugInserts) {
      const { data: existing } = await supabase
        .from("drug_master")
        .select("id, drug_name")
        .eq("hospital_id", hospitalId)
        .eq("drug_name", d.drug_name)
        .maybeSingle();
      if (existing) {
        resolvedDrugs.push(existing);
      } else {
        const { data: ins } = await supabase.from("drug_master").insert(d).select("id, drug_name").maybeSingle();
        if (ins) resolvedDrugs.push(ins);
      }
    }
  } else {
    const { data: allDrugs } = await supabase.from("drug_master").select("id, drug_name").eq("hospital_id", hospitalId);
    resolvedDrugs = allDrugs || [];
  }

  return await seedBatches(supabase, hospitalId, resolvedDrugs);
});

async function seedBatches(supabase: ReturnType<typeof createClient>, hospitalId: string, drugs: { id: string; drug_name: string }[]) {
  if (drugs.length === 0) {
    return new Response(JSON.stringify({ error: "No drugs found to seed batches for" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const batches: Record<string, unknown>[] = [];

  for (let i = 0; i < drugs.length && i < 16; i++) {
    const drug = drugs[i];
    const expiryMonths = 6 + Math.floor(Math.random() * 12);
    const expiry = new Date(now);
    expiry.setMonth(expiry.getMonth() + expiryMonths);
    const qty = 50 + Math.floor(Math.random() * 450);
    const cost = 2 + Math.floor(Math.random() * 48);
    const mrp = Math.round(cost * (1.3 + Math.random() * 0.5));

    batches.push({
      hospital_id: hospitalId,
      drug_id: drug.id,
      batch_number: `B${String(i + 1).padStart(3, "0")}-${now.getFullYear()}`,
      manufacturer: ["Cipla", "Sun Pharma", "Dr. Reddys", "Lupin", "Zydus"][i % 5],
      supplier_name: ["MedSupply Co", "PharmaDist Ltd", "HealthWholesale"][i % 3],
      expiry_date: expiry.toISOString().split("T")[0],
      quantity_received: qty,
      quantity_available: qty,
      cost_price: cost,
      mrp,
      sale_price: Math.round(mrp * 0.95),
      gst_percent: 12,
    });
  }

  if (drugs.length > 2) {
    const nearExpiry1 = new Date(now); nearExpiry1.setDate(nearExpiry1.getDate() + 15);
    const nearExpiry2 = new Date(now); nearExpiry2.setDate(nearExpiry2.getDate() + 5);
    batches.push({
      hospital_id: hospitalId, drug_id: drugs[0].id,
      batch_number: `EXP-001-${now.getFullYear()}`, manufacturer: "Cipla", supplier_name: "MedSupply Co",
      expiry_date: nearExpiry1.toISOString().split("T")[0],
      quantity_received: 30, quantity_available: 12, cost_price: 5, mrp: 8, sale_price: 7, gst_percent: 12,
    });
    batches.push({
      hospital_id: hospitalId, drug_id: drugs[1].id,
      batch_number: `EXP-002-${now.getFullYear()}`, manufacturer: "Sun Pharma", supplier_name: "PharmaDist Ltd",
      expiry_date: nearExpiry2.toISOString().split("T")[0],
      quantity_received: 20, quantity_available: 5, cost_price: 10, mrp: 15, sale_price: 14, gst_percent: 12,
    });
  }

  if (drugs.length > 4) {
    const exp3 = new Date(now); exp3.setMonth(exp3.getMonth() + 8);
    batches.push({
      hospital_id: hospitalId, drug_id: drugs[3].id,
      batch_number: `LOW-001-${now.getFullYear()}`, manufacturer: "Lupin", supplier_name: "HealthWholesale",
      expiry_date: exp3.toISOString().split("T")[0],
      quantity_received: 100, quantity_available: 3, cost_price: 8, mrp: 12, sale_price: 11, gst_percent: 12,
    });
    batches.push({
      hospital_id: hospitalId, drug_id: drugs[4].id,
      batch_number: `LOW-002-${now.getFullYear()}`, manufacturer: "Zydus", supplier_name: "MedSupply Co",
      expiry_date: exp3.toISOString().split("T")[0],
      quantity_received: 200, quantity_available: 7, cost_price: 3, mrp: 5, sale_price: 5, gst_percent: 5,
    });
  }

  const { error: batchErr } = await supabase.from("drug_batches").insert(batches);

  const { data: alertBatches } = await supabase
    .from("drug_batches")
    .select("id, drug_id, quantity_available, expiry_date")
    .eq("hospital_id", hospitalId);

  const alerts: Record<string, unknown>[] = [];
  const thirtyDays = new Date(now); thirtyDays.setDate(thirtyDays.getDate() + 30);
  const sevenDays = new Date(now); sevenDays.setDate(sevenDays.getDate() + 7);

  for (const b of alertBatches || []) {
    const exp = new Date(b.expiry_date as string);
    if (exp <= sevenDays) {
      alerts.push({ hospital_id: hospitalId, drug_id: b.drug_id, alert_type: "expiry_7", batch_id: b.id, quantity: b.quantity_available, expiry_date: b.expiry_date });
    } else if (exp <= thirtyDays) {
      alerts.push({ hospital_id: hospitalId, drug_id: b.drug_id, alert_type: "expiry_30", batch_id: b.id, quantity: b.quantity_available, expiry_date: b.expiry_date });
    }
    if (b.quantity_available === 0) {
      alerts.push({ hospital_id: hospitalId, drug_id: b.drug_id, alert_type: "out_of_stock", batch_id: b.id, quantity: 0 });
    } else if ((b.quantity_available as number) < 10) {
      alerts.push({ hospital_id: hospitalId, drug_id: b.drug_id, alert_type: "low_stock", batch_id: b.id, quantity: b.quantity_available });
    }
  }

  if (alerts.length > 0) {
    await supabase.from("pharmacy_stock_alerts").insert(alerts);
  }

  return new Response(JSON.stringify({
    success: true,
    hospital_id: hospitalId,
    drugs_count: drugs.length,
    batches_count: batches.length,
    alerts_count: alerts.length,
    batch_error: batchErr?.message,
  }), { headers: { "Content-Type": "application/json" } });
}
