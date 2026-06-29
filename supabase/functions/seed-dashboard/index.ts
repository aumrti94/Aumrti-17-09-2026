import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    // Get current user's hospital_id
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: userData } = await admin.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!userData) throw new Error("User not found");
    const hid = userData.hospital_id;

    // Check if already seeded (patients exist)
    const { count: patientCount } = await admin.from("patients").select("*", { count: "exact", head: true }).eq("hospital_id", hid);
    if (patientCount && patientCount > 0) {
      return new Response(JSON.stringify({ message: "Already seeded", seeded: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get wards and departments for this hospital
    const { data: wards } = await admin.from("wards").select("id, name, total_beds").eq("hospital_id", hid).eq("is_active", true);
    const { data: departments } = await admin.from("departments").select("id, name").eq("hospital_id", hid).eq("is_active", true);
    const { data: doctors } = await admin.from("users").select("id, full_name").eq("hospital_id", hid).eq("role", "doctor").eq("is_active", true);

    // 1. Seed patients
    const patientNames = [
      { name: "Rajesh Kumar", gender: "male", bg: "B+" },
      { name: "Priya Sharma", gender: "female", bg: "A+" },
      { name: "Mohammed Ali", gender: "male", bg: "O+" },
      { name: "Lakshmi Devi", gender: "female", bg: "AB+" },
      { name: "Arjun Reddy", gender: "male", bg: "A-" },
      { name: "Sunita Patel", gender: "female", bg: "B+" },
      { name: "Ramesh Gupta", gender: "male", bg: "O-" },
      { name: "Kavitha Nair", gender: "female", bg: "A+" },
      { name: "Suresh Yadav", gender: "male", bg: "B-" },
      { name: "Meena Iyer", gender: "female", bg: "O+" },
      { name: "Vinod Singh", gender: "male", bg: "AB-" },
      { name: "Anitha Krishnan", gender: "female", bg: "A+" },
      { name: "Prakash Rao", gender: "male", bg: "B+" },
      { name: "Deepa Menon", gender: "female", bg: "O+" },
      { name: "Sanjay Verma", gender: "male", bg: "A+" },
    ];

    const patients = patientNames.map((p, i) => ({
      hospital_id: hid,
      uhid: `UHID-${String(i + 1).padStart(4, "0")}`,
      full_name: p.name,
      gender: p.gender,
      blood_group: p.bg,
      phone: `98${String(70000000 + Math.floor(Math.random() * 9999999)).slice(0, 8)}`,
      dob: `${1956 + Math.floor(Math.random() * 30)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`,
    }));

    const { data: insertedPatients, error: pErr } = await admin.from("patients").insert(patients).select("id");
    if (pErr) throw pErr;
    const patientIds = insertedPatients!.map((p: any) => p.id);

    // 2. Seed beds (use existing wards or create default beds)
    if (wards && wards.length > 0) {
      const bedInserts: any[] = [];
      const statuses = ["occupied", "available", "cleaning", "reserved", "maintenance"];
      for (const ward of wards) {
        const numBeds = ward.total_beds || 10;
        for (let b = 1; b <= numBeds; b++) {
          const rand = Math.random();
          let status: string;
          if (rand < 0.6) status = "occupied";
          else if (rand < 0.8) status = "available";
          else if (rand < 0.9) status = "cleaning";
          else status = "reserved";
          bedInserts.push({
            hospital_id: hid,
            ward_id: ward.id,
            bed_number: `${ward.name?.substring(0, 3).toUpperCase()}-${String(b).padStart(2, "0")}`,
            status,
          });
        }
      }
      // Delete existing beds for this hospital first, then insert new ones
      await admin.from("beds").delete().eq("hospital_id", hid);
      const { error: bErr } = await admin.from("beds").insert(bedInserts);
      if (bErr) throw bErr;
    }

    // 3. Seed OPD visits (12 for today)
    const opdStatuses = ["waiting","waiting","waiting","waiting","waiting","waiting","waiting","waiting","completed","completed","completed","in_consultation"];
    const opdInserts = opdStatuses.map((status, i) => ({
      hospital_id: hid,
      patient_id: patientIds[i % patientIds.length],
      token_number: `T${String(i + 1).padStart(3, "0")}`,
      doctor_id: doctors && doctors.length > 0 ? doctors[i % doctors.length].id : null,
      department_id: departments && departments.length > 0 ? departments[i % departments.length].id : null,
      status,
    }));
    const { error: oErr } = await admin.from("opd_visits").insert(opdInserts);
    if (oErr) throw oErr;

    // 4. Seed bills (8 for current month)
    const billAmounts = [
      { total: 450, paid: 450, status: "paid" },
      { total: 1200, paid: 1200, status: "paid" },
      { total: 800, paid: 800, status: "paid" },
      { total: 3500, paid: 3500, status: "paid" },
      { total: 650, paid: 650, status: "paid" },
      { total: 2100, paid: 0, status: "pending" },
      { total: 900, paid: 0, status: "pending" },
      { total: 1800, paid: 900, status: "partial" },
    ];
    const now = new Date();
    const billInserts = billAmounts.map((b, i) => ({
      hospital_id: hid,
      patient_id: patientIds[i % patientIds.length],
      bill_number: `BILL-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(4, "0")}`,
      total_amount: b.total,
      paid_amount: b.paid,
      payment_status: b.status,
      bill_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * now.getDate())).padStart(2, "0")}`,
    }));
    const { error: billErr } = await admin.from("bills").insert(billInserts);
    if (billErr) throw billErr;

    // 5. Seed clinical alerts (2 unacknowledged)
    const alertInserts = [
      {
        hospital_id: hid,
        alert_type: "critical_lab_value",
        alert_message: "Critical potassium level: 6.8 mEq/L — Patient Rajesh Kumar, Ward 2 Bed 5",
        severity: "critical",
        patient_id: patientIds[0],
        ward_name: wards?.[0]?.name || "General Ward",
        bed_number: "05",
        is_acknowledged: false,
      },
      {
        hospital_id: hid,
        alert_type: "discharge_delay",
        alert_message: "Discharge TAT exceeded 6 hours — 3 patients pending clearance",
        severity: "high",
        is_acknowledged: false,
      },
    ];
    const { error: aErr } = await admin.from("clinical_alerts").insert(alertInserts);
    if (aErr) throw aErr;

    // 6. Seed staff attendance for today
    if (doctors && doctors.length > 0) {
      const attendanceInserts = doctors.map((d: any, i: number) => ({
        hospital_id: hid,
        user_id: d.id,
        status: i === doctors.length - 1 ? "leave" : "present",
      }));
      const { error: sErr } = await admin.from("staff_attendance").insert(attendanceInserts);
      if (sErr) throw sErr;
    }

    return new Response(JSON.stringify({ message: "Seeded successfully", seeded: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
