import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Accept a specific date via POST body; default to yesterday (cron runs at 00:15 IST)
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetDate: string =
      body.date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const startOfDay = targetDate + "T00:00:00";
    const endOfDay   = targetDate + "T23:59:59";

    const { data: hospitals } = await sb
      .from("hospitals")
      .select("id, name")
      .eq("is_active", true);

    if (!hospitals?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No active hospitals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { hospital_id: string; ok: boolean; error?: string }[] = [];

    for (const hospital of hospitals) {
      try {
        const [bedsRes, wardsRes, admissionsRes, dischargesRes] = await Promise.all([
          sb.from("beds")
            .select("id, status, ward_id")
            .eq("hospital_id", hospital.id)
            .eq("is_active", true),
          sb.from("wards")
            .select("id, name, ward_type")
            .eq("hospital_id", hospital.id)
            .eq("is_active", true),
          sb.from("admissions")
            .select("id, transfer_in")
            .eq("hospital_id", hospital.id)
            .gte("admitted_at", startOfDay)
            .lte("admitted_at", endOfDay),
          sb.from("admissions")
            .select("id, discharge_type")
            .eq("hospital_id", hospital.id)
            .gte("discharged_at", startOfDay)
            .lte("discharged_at", endOfDay),
        ]);

        const beds  = bedsRes.data  || [];
        const wards = wardsRes.data || [];
        const wardMap = new Map(wards.map(w => [w.id, w]));

        // Ward-level aggregation
        const wardStats: Record<string, {
          name: string; ward_type: string;
          total: number; occupied: number; available: number; maintenance: number;
        }> = {};

        for (const bed of beds) {
          const ward     = wardMap.get(bed.ward_id);
          const wName    = ward?.name || "Unassigned";
          const wType    = ward?.ward_type || "general";
          if (!wardStats[wName]) {
            wardStats[wName] = { name: wName, ward_type: wType, total: 0, occupied: 0, available: 0, maintenance: 0 };
          }
          wardStats[wName].total++;
          if (bed.status === "occupied")    wardStats[wName].occupied++;
          else if (bed.status === "available")  wardStats[wName].available++;
          else if (bed.status === "maintenance") wardStats[wName].maintenance++;
        }

        // Hospital-level counts
        const totalBeds       = beds.length;
        const occupiedBeds    = beds.filter(b => b.status === "occupied").length;
        const availableBeds   = beds.filter(b => b.status === "available").length;
        const maintenanceBeds = beds.filter(b => b.status === "maintenance").length;

        // ICU beds (wards with type 'icu' or name containing "icu")
        const icuWardIds = wards
          .filter(w => w.ward_type === "icu" || w.name?.toLowerCase().includes("icu"))
          .map(w => w.id);
        const icuBeds    = beds.filter(b => icuWardIds.includes(b.ward_id));
        const icuOccupied = icuBeds.filter(b => b.status === "occupied").length;
        const icuTotal    = icuBeds.length;

        const admissionsToday = admissionsRes.data || [];
        const dischargesToday = dischargesRes.data || [];

        const newAdmissions = admissionsToday.length;
        const discharges    = dischargesToday.filter(a => a.discharge_type !== "transfer").length;
        const transfers     = admissionsToday.filter(a => (a as any).transfer_in === true).length;
        const deaths        = dischargesToday.filter(a => a.discharge_type === "death").length;

        await sb.from("daily_census_snapshots").upsert({
          hospital_id:      hospital.id,
          snapshot_date:    targetDate,
          total_beds:       totalBeds,
          occupied_beds:    occupiedBeds,
          available_beds:   availableBeds,
          maintenance_beds: maintenanceBeds,
          icu_occupied:     icuOccupied,
          icu_total:        icuTotal,
          new_admissions:   newAdmissions,
          discharges,
          transfers,
          deaths,
          ward_data: Object.values(wardStats),
        }, { onConflict: "hospital_id,snapshot_date" });

        results.push({ hospital_id: hospital.id, ok: true });
      } catch (err) {
        console.error(`Census failed for hospital ${hospital.id}:`, err);
        results.push({ hospital_id: hospital.id, ok: false, error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, date: targetDate, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("generate-daily-census fatal:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
