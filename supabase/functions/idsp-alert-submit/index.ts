import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ICD-10 codes that require IDSP notification (notifiable diseases list)
const NOTIFIABLE_DISEASE_MAP: Record<string, string> = {
  "A00": "Cholera", "A01": "Typhoid", "A02": "Salmonellosis", "A05": "Food poisoning",
  "A06": "Amoebiasis", "A09": "Gastroenteritis", "A15": "Tuberculosis", "A16": "Pulmonary TB",
  "A20": "Plague", "A22": "Anthrax", "A23": "Brucellosis", "A27": "Leptospirosis",
  "A33": "Tetanus (neonatal)", "A34": "Obstetric tetanus", "A35": "Tetanus",
  "A36": "Diphtheria", "A37": "Whooping cough", "A49": "MRSA", "A50": "Congenital syphilis",
  "A80": "Polio", "A82": "Rabies", "A90": "Dengue", "A91": "Dengue hemorrhagic fever",
  "A92": "Chikungunya", "A95": "Yellow fever", "A98": "Viral haemorrhagic fever",
  "B00": "Herpes simplex", "B01": "Chickenpox", "B05": "Measles", "B06": "Rubella",
  "B15": "Hepatitis A", "B16": "Hepatitis B", "B17": "Hepatitis C", "B18": "Chronic hepatitis",
  "B26": "Mumps", "B54": "Malaria (unspecified)", "B50": "Falciparum malaria",
  "B51": "Vivax malaria", "J09": "Pandemic flu", "J10": "Influenza", "J11": "Flu (unspecified)",
  "U07": "COVID-19",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Auth ──────────────────────────────────────────────────────────────
    // No auth check at all previously, and patient_id was never checked
    // against hospital_id — any caller with just the public anon key could
    // name any hospital_id + another hospital's patient_id, pull that
    // patient's PHI (name/age/gender/phone), and file a government IDSP
    // disease notification under the wrong hospital's credentials. Found in
    // the Phase 4 isolation audit — see KNOWN_BUGS.md.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hospital_id, patient_id, icd_code, disease_name: providedName, lab_order_id } = await req.json();

    if (!hospital_id || !icd_code) {
      return new Response(JSON.stringify({ error: "hospital_id and icd_code required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: staff } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!staff || staff.hospital_id !== hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if disease is notifiable
    const icdPrefix = icd_code.slice(0, 3);
    const diseaseName = providedName || NOTIFIABLE_DISEASE_MAP[icdPrefix];
    if (!diseaseName) {
      return new Response(JSON.stringify({ notifiable: false, message: `ICD ${icd_code} is not a notifiable disease` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch hospital and patient details
    const [hospitalRes, patientRes] = await Promise.all([
      supabase.from("hospitals").select("name, state, district, address").eq("id", hospital_id).maybeSingle(),
      patient_id ? supabase.from("patients").select("full_name, age, gender, phone").eq("id", patient_id).eq("hospital_id", hospital_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const hospital = hospitalRes.data;
    const patient = patientRes.data;

    // Fetch IDSP portal credentials from api_configurations
    const { data: apiConfig } = await supabase
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospital_id)
      .eq("service_key", "idsp_portal")
      .eq("is_active", true)
      .maybeSingle();

    let acknowledgmentRef = `IDSP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    let submissionStatus = "submitted";
    let rawResponse: Record<string, unknown> = {};

    if (apiConfig?.config) {
      // Real IDSP portal submission
      const creds = apiConfig.config as Record<string, string>;
      const alertPayload = {
        facility_name: hospital?.name,
        facility_state: hospital?.state,
        disease_code: icdPrefix,
        disease_name: diseaseName,
        report_date: new Date().toISOString().split("T")[0],
        patient_age: (patient as any)?.age,
        patient_gender: (patient as any)?.gender,
        ...(creds.hin_code ? { hin_code: creds.hin_code } : {}),
      };

      try {
        const idspRes = await fetch(`${creds.portal_url || "https://ihip.nhp.gov.in"}/api/idsp/alert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${creds.api_token || ""}`,
          },
          body: JSON.stringify(alertPayload),
        });
        rawResponse = await idspRes.json().catch(() => ({}));
        if ((rawResponse as any).acknowledgment_ref) {
          acknowledgmentRef = String((rawResponse as any).acknowledgment_ref);
        }
        submissionStatus = idspRes.ok ? "acknowledged" : "failed";
      } catch {
        submissionStatus = "submitted"; // queued for retry
      }
    }

    // Store submission record
    const { data: submission, error: submissionErr } = await supabase
      .from("idsp_submissions" as any)
      .insert({
        hospital_id,
        patient_id: patient_id || null,
        disease_code: icdPrefix,
        disease_name: diseaseName,
        acknowledgment_ref: acknowledgmentRef,
        status: submissionStatus,
        raw_response: rawResponse,
      })
      .select("id")
      .maybeSingle();
    if (submissionErr) console.error("idsp-alert-submit: submission insert failed:", submissionErr.message);

    return new Response(JSON.stringify({
      success: true,
      notifiable: true,
      disease_name: diseaseName,
      acknowledgment_ref: acknowledgmentRef,
      status: submissionStatus,
      submission_id: (submission as any)?.id,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("idsp-alert-submit error:", sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
