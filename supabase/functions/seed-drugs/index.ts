import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DRUGS = [
  { drug_name: "Paracetamol 500mg", generic_name: "Paracetamol", category: "Analgesic", dosage_forms: ["Tablet"], standard_doses: ["500mg"], routes: ["Oral"] },
  { drug_name: "Amoxicillin 500mg", generic_name: "Amoxicillin", category: "Antibiotic", dosage_forms: ["Capsule"], standard_doses: ["500mg"], routes: ["Oral"] },
  { drug_name: "Metformin 500mg", generic_name: "Metformin", category: "Antidiabetic", dosage_forms: ["Tablet"], standard_doses: ["500mg"], routes: ["Oral"] },
  { drug_name: "Amlodipine 5mg", generic_name: "Amlodipine", category: "Antihypertensive", dosage_forms: ["Tablet"], standard_doses: ["5mg","10mg"], routes: ["Oral"] },
  { drug_name: "Atorvastatin 10mg", generic_name: "Atorvastatin", category: "Statin", dosage_forms: ["Tablet"], standard_doses: ["10mg","20mg"], routes: ["Oral"] },
  { drug_name: "Omeprazole 20mg", generic_name: "Omeprazole", category: "PPI", dosage_forms: ["Capsule"], standard_doses: ["20mg"], routes: ["Oral"] },
  { drug_name: "Azithromycin 500mg", generic_name: "Azithromycin", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["500mg"], routes: ["Oral"] },
  { drug_name: "Ciprofloxacin 500mg", generic_name: "Ciprofloxacin", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["500mg"], routes: ["Oral"] },
  { drug_name: "Pantoprazole 40mg", generic_name: "Pantoprazole", category: "PPI", dosage_forms: ["Tablet"], standard_doses: ["40mg"], routes: ["Oral"] },
  { drug_name: "Cefixime 200mg", generic_name: "Cefixime", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["200mg"], routes: ["Oral"] },
  { drug_name: "Doxycycline 100mg", generic_name: "Doxycycline", category: "Antibiotic", dosage_forms: ["Capsule"], standard_doses: ["100mg"], routes: ["Oral"] },
  { drug_name: "Ibuprofen 400mg", generic_name: "Ibuprofen", category: "NSAID", dosage_forms: ["Tablet"], standard_doses: ["400mg"], routes: ["Oral"] },
  { drug_name: "Losartan 50mg", generic_name: "Losartan", category: "Antihypertensive", dosage_forms: ["Tablet"], standard_doses: ["50mg"], routes: ["Oral"] },
  { drug_name: "Telmisartan 40mg", generic_name: "Telmisartan", category: "Antihypertensive", dosage_forms: ["Tablet"], standard_doses: ["40mg"], routes: ["Oral"] },
  { drug_name: "Metoprolol 25mg", generic_name: "Metoprolol", category: "Beta Blocker", dosage_forms: ["Tablet"], standard_doses: ["25mg","50mg"], routes: ["Oral"] },
  { drug_name: "Aspirin 75mg", generic_name: "Aspirin", category: "Antiplatelet", dosage_forms: ["Tablet"], standard_doses: ["75mg"], routes: ["Oral"] },
  { drug_name: "Clopidogrel 75mg", generic_name: "Clopidogrel", category: "Antiplatelet", dosage_forms: ["Tablet"], standard_doses: ["75mg"], routes: ["Oral"] },
  { drug_name: "Atorvastatin 20mg", generic_name: "Atorvastatin", category: "Statin", dosage_forms: ["Tablet"], standard_doses: ["20mg"], routes: ["Oral"] },
  { drug_name: "Glimepiride 1mg", generic_name: "Glimepiride", category: "Antidiabetic", dosage_forms: ["Tablet"], standard_doses: ["1mg","2mg"], routes: ["Oral"] },
  { drug_name: "Insulin Regular", generic_name: "Insulin", category: "Antidiabetic", dosage_forms: ["Injection"], standard_doses: ["10U","20U"], routes: ["SC","IV"] },
  { drug_name: "Ondansetron 4mg", generic_name: "Ondansetron", category: "Antiemetic", dosage_forms: ["Tablet"], standard_doses: ["4mg","8mg"], routes: ["Oral"] },
  { drug_name: "Domperidone 10mg", generic_name: "Domperidone", category: "Prokinetic", dosage_forms: ["Tablet"], standard_doses: ["10mg"], routes: ["Oral"] },
  { drug_name: "Ranitidine 150mg", generic_name: "Ranitidine", category: "H2 Blocker", dosage_forms: ["Tablet"], standard_doses: ["150mg"], routes: ["Oral"] },
  { drug_name: "Cetirizine 10mg", generic_name: "Cetirizine", category: "Antihistamine", dosage_forms: ["Tablet"], standard_doses: ["10mg"], routes: ["Oral"] },
  { drug_name: "Montelukast 10mg", generic_name: "Montelukast", category: "Antiasthmatic", dosage_forms: ["Tablet"], standard_doses: ["10mg"], routes: ["Oral"] },
  { drug_name: "Salbutamol Inhaler", generic_name: "Salbutamol", category: "Bronchodilator", dosage_forms: ["Inhaler"], standard_doses: ["100mcg"], routes: ["Inhalation"] },
  { drug_name: "Budesonide Inhaler", generic_name: "Budesonide", category: "Corticosteroid", dosage_forms: ["Inhaler"], standard_doses: ["200mcg"], routes: ["Inhalation"] },
  { drug_name: "Prednisolone 5mg", generic_name: "Prednisolone", category: "Corticosteroid", dosage_forms: ["Tablet"], standard_doses: ["5mg","10mg"], routes: ["Oral"] },
  { drug_name: "Methylprednisolone 4mg", generic_name: "Methylprednisolone", category: "Corticosteroid", dosage_forms: ["Tablet"], standard_doses: ["4mg","8mg"], routes: ["Oral"] },
  { drug_name: "Amoxicillin+Clavulanate 625mg", generic_name: "Amoxicillin+Clavulanate", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["625mg"], routes: ["Oral"] },
  { drug_name: "Fluconazole 150mg", generic_name: "Fluconazole", category: "Antifungal", dosage_forms: ["Capsule"], standard_doses: ["150mg"], routes: ["Oral"] },
  { drug_name: "Metronidazole 400mg", generic_name: "Metronidazole", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["400mg"], routes: ["Oral"] },
  { drug_name: "Albendazole 400mg", generic_name: "Albendazole", category: "Anthelmintic", dosage_forms: ["Tablet"], standard_doses: ["400mg"], routes: ["Oral"] },
  { drug_name: "Iron + Folic Acid", generic_name: "Ferrous Sulphate + Folic Acid", category: "Supplement", dosage_forms: ["Tablet"], standard_doses: ["1 tab"], routes: ["Oral"] },
  { drug_name: "Calcium + Vitamin D3", generic_name: "Calcium Carbonate + Cholecalciferol", category: "Supplement", dosage_forms: ["Tablet"], standard_doses: ["1 tab"], routes: ["Oral"] },
  { drug_name: "Vitamin B12", generic_name: "Methylcobalamin", category: "Supplement", dosage_forms: ["Tablet"], standard_doses: ["1500mcg"], routes: ["Oral"] },
  { drug_name: "Multivitamin", generic_name: "Multivitamin", category: "Supplement", dosage_forms: ["Tablet"], standard_doses: ["1 tab"], routes: ["Oral"] },
  { drug_name: "Paracetamol+Tramadol", generic_name: "Paracetamol+Tramadol", category: "Analgesic", dosage_forms: ["Tablet"], standard_doses: ["325/37.5mg"], routes: ["Oral"] },
  { drug_name: "Diclofenac 50mg", generic_name: "Diclofenac", category: "NSAID", dosage_forms: ["Tablet"], standard_doses: ["50mg"], routes: ["Oral"] },
  { drug_name: "Aceclofenac 100mg", generic_name: "Aceclofenac", category: "NSAID", dosage_forms: ["Tablet"], standard_doses: ["100mg"], routes: ["Oral"] },
  { drug_name: "Rabeprazole 20mg", generic_name: "Rabeprazole", category: "PPI", dosage_forms: ["Tablet"], standard_doses: ["20mg"], routes: ["Oral"] },
  { drug_name: "Esomeprazole 40mg", generic_name: "Esomeprazole", category: "PPI", dosage_forms: ["Capsule"], standard_doses: ["40mg"], routes: ["Oral"] },
  { drug_name: "Levothyroxine 50mcg", generic_name: "Levothyroxine", category: "Thyroid", dosage_forms: ["Tablet"], standard_doses: ["50mcg","100mcg"], routes: ["Oral"] },
  { drug_name: "Hydroxychloroquine 200mg", generic_name: "Hydroxychloroquine", category: "DMARD", dosage_forms: ["Tablet"], standard_doses: ["200mg"], routes: ["Oral"] },
  { drug_name: "Azithromycin 250mg", generic_name: "Azithromycin", category: "Antibiotic", dosage_forms: ["Tablet"], standard_doses: ["250mg"], routes: ["Oral"] },
  { drug_name: "Ceftriaxone 1g (Inj)", generic_name: "Ceftriaxone", category: "Antibiotic", dosage_forms: ["Injection"], standard_doses: ["1g"], routes: ["IV","IM"] },
  { drug_name: "Dexamethasone 4mg (Inj)", generic_name: "Dexamethasone", category: "Corticosteroid", dosage_forms: ["Injection"], standard_doses: ["4mg"], routes: ["IV","IM"] },
  { drug_name: "Ondansetron 4mg (Inj)", generic_name: "Ondansetron", category: "Antiemetic", dosage_forms: ["Injection"], standard_doses: ["4mg"], routes: ["IV"] },
  { drug_name: "Tramadol 50mg (Inj)", generic_name: "Tramadol", category: "Analgesic", dosage_forms: ["Injection"], standard_doses: ["50mg"], routes: ["IV","IM"], is_ndps: true },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!).auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!userData) throw new Error("User not found");

    const hospitalId = userData.hospital_id;

    // Check if already seeded
    const { count } = await supabase.from("drug_master").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId);
    if ((count || 0) >= 40) {
      return new Response(JSON.stringify({ message: "Drugs already seeded" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = DRUGS.map((d) => ({ ...d, hospital_id: hospitalId }));
    const { error } = await supabase.from("drug_master").insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ message: `Seeded ${rows.length} drugs` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
