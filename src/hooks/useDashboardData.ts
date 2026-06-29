import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalContext } from "@/contexts/HospitalContext";

export interface DashboardKPIs {
  totalPatients: number;
  patientsToday: number;
  bedsOccupied: number;
  bedsTotal: number;
  opdActive: number;
  opdWaiting: number;
  opdSeen: number;
  revenueMTD: number;
  revenueLastMonth: number;
  doctorsOnDuty: number;
  doctorsOnLeave: number;
  criticalAlerts: number;
}

const empty: DashboardKPIs = {
  totalPatients: 0, patientsToday: 0,
  bedsOccupied: 0, bedsTotal: 0,
  opdActive: 0, opdWaiting: 0, opdSeen: 0,
  revenueMTD: 0, revenueLastMonth: 0,
  doctorsOnDuty: 0, doctorsOnLeave: 0,
  criticalAlerts: 0,
};

export function useDashboardData() {
  const [kpis, setKpis] = useState<DashboardKPIs>(empty);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const { toast } = useToast();
  const { hospitalId: ctxHospitalId } = useHospitalContext();
  // Use a ref so fetchAll always reads the latest hospitalId without stale closure issues.
  const hospitalIdRef = useRef<string | null>(null);
  // Debounce timer for realtime-triggered refetches.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (ctxHospitalId && ctxHospitalId !== hospitalIdRef.current) {
    hospitalIdRef.current = ctxHospitalId;
  }

  const fetchAll = useCallback(async () => {
    try {
      const hid = hospitalIdRef.current;
      if (!hid) { setLoading(false); return; }

      const today = new Date().toISOString().split("T")[0];
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthStart = lastMonth.toISOString().split("T")[0];
      const lastMonthEndStr = lastMonthEnd.toISOString().split("T")[0];

      // Fire all queries in parallel with Promise.allSettled for resilience.
      // Revenue queries use server-side SUM to avoid transferring all rows.
      const results = await Promise.allSettled([
        // 0: Total patients
        supabase.from("patients").select("*", { count: "exact", head: true }).eq("hospital_id", hid),
        // 1: Patients today
        supabase.from("patients").select("*", { count: "exact", head: true }).eq("hospital_id", hid)
          .gte("created_at", today + "T00:00:00").lt("created_at", today + "T23:59:59.999Z"),
        // 2: Total active beds (count only)
        supabase.from("beds").select("*", { count: "exact", head: true }).eq("hospital_id", hid).eq("is_active", true),
        // 3: Occupied beds (count only)
        supabase.from("beds").select("*", { count: "exact", head: true }).eq("hospital_id", hid).eq("status", "occupied"),
        // 4: OPD active today (count only)
        supabase.from("opd_visits").select("*", { count: "exact", head: true }).eq("hospital_id", hid).eq("visit_date", today).neq("status", "cancelled"),
        // 5: OPD waiting (count only)
        supabase.from("opd_visits").select("*", { count: "exact", head: true }).eq("hospital_id", hid).eq("visit_date", today).eq("status", "waiting"),
        // 6: OPD seen/completed (count only)
        supabase.from("opd_visits").select("*", { count: "exact", head: true }).eq("hospital_id", hid).eq("visit_date", today).eq("status", "completed"),
        // 7: Revenue MTD — paid/partial bills only (client-side sum for reliability)
        supabase.from("bills").select("paid_amount").eq("hospital_id", hid)
          .gte("bill_date", monthStart).in("payment_status", ["paid", "partial"])
          .neq("bill_type", "pharmacy"),
        // 8: Revenue last month
        supabase.from("bills").select("paid_amount").eq("hospital_id", hid)
          .gte("bill_date", lastMonthStart).lte("bill_date", lastMonthEndStr)
          .in("payment_status", ["paid", "partial"]).neq("bill_type", "pharmacy"),
        // 9: Total doctors
        supabase.from("users").select("*", { count: "exact", head: true }).eq("hospital_id", hid)
          .eq("role", "doctor").eq("is_active", true),
        // 10: On leave
        supabase.from("staff_attendance").select("*", { count: "exact", head: true }).eq("hospital_id", hid)
          .eq("attendance_date", today).eq("status", "leave"),
        // 11: Critical alerts
        supabase.from("clinical_alerts").select("id", { count: "exact", head: true }).eq("hospital_id", hid)
          .eq("is_acknowledged", false),
        // 12: Pharmacy retail MTD
        (supabase as any).from("pharmacy_dispensing").select("net_amount").eq("hospital_id", hid)
          .eq("dispensing_type", "retail").eq("status", "dispensed")
          .gte("created_at", monthStart),
        // 13: Pharmacy retail last month
        (supabase as any).from("pharmacy_dispensing").select("net_amount").eq("hospital_id", hid)
          .eq("dispensing_type", "retail").eq("status", "dispensed")
          .gte("created_at", lastMonthStart)
          .lte("created_at", lastMonthEndStr + "T23:59:59"),
      ]);

      const val = <T,>(idx: number, fallback: T): T => {
        const r = results[idx];
        if (r.status === "fulfilled") return r.value as unknown as T;
        console.warn(`Dashboard query ${idx} failed:`, (r as PromiseRejectedResult).reason);
        return fallback;
      };

      // Sum a numeric column across all returned rows.
      const extractSum = (res: any, field: string): number => {
        if (!res?.data) return 0;
        return res.data.reduce((s: number, row: any) => s + Number(row[field] ?? 0), 0);
      };

      const billsMTDRes = val<any>(7, { data: [] });
      const billsLastRes = val<any>(8, { data: [] });
      const pharmaMTDRes = val<any>(12, { data: [] });
      const pharmaLastRes = val<any>(13, { data: [] });

      setKpis({
        totalPatients: val<any>(0, { count: 0 }).count || 0,
        patientsToday: val<any>(1, { count: 0 }).count || 0,
        bedsTotal: val<any>(2, { count: 0 }).count || 0,
        bedsOccupied: val<any>(3, { count: 0 }).count || 0,
        opdActive: val<any>(4, { count: 0 }).count || 0,
        opdWaiting: val<any>(5, { count: 0 }).count || 0,
        opdSeen: val<any>(6, { count: 0 }).count || 0,
        revenueMTD: extractSum(billsMTDRes, "paid_amount") + extractSum(pharmaMTDRes, "net_amount"),
        revenueLastMonth: extractSum(billsLastRes, "paid_amount") + extractSum(pharmaLastRes, "net_amount"),
        doctorsOnDuty: Math.max(0, (val<any>(9, { count: 0 }).count || 0) - (val<any>(10, { count: 0 }).count || 0)),
        doctorsOnLeave: val<any>(10, { count: 0 }).count || 0,
        criticalAlerts: val<any>(11, { count: 0 }).count || 0,
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced variant used by realtime subscriptions. Batches rapid sequential
  // events (e.g. several OPD updates in quick succession) into a single fetch.
  const debouncedFetchAll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fetchAll(); }, 500);
  }, [fetchAll]);

  const seedData = useCallback(async () => {
    setSeeding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await supabase.functions.invoke("seed-dashboard", {});
      if (res.data?.seeded) {
        toast({ title: "Sample data loaded", description: "Dashboard now shows live data." });
        await fetchAll();
      }
    } catch (err) {
      console.error("Seed error:", err);
    } finally {
      setSeeding(false);
    }
  }, [fetchAll, toast]);

  useEffect(() => {
    if (ctxHospitalId) fetchAll();
  }, [fetchAll, ctxHospitalId]);

  // Realtime subscriptions — use debounced refetch to prevent burst stampedes.
  useEffect(() => {
    const hid = hospitalIdRef.current;
    if (!hid) return;

    const channel = supabase.channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "beds", filter: `hospital_id=eq.${hid}` }, debouncedFetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "opd_visits", filter: `hospital_id=eq.${hid}` }, debouncedFetchAll)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clinical_alerts", filter: `hospital_id=eq.${hid}` }, (payload: any) => {
        debouncedFetchAll();
        if (payload.new?.severity === "critical") {
          toast({ title: "🚨 Critical Alert", description: payload.new.alert_message, variant: "destructive" });
        }
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedFetchAll, toast, ctxHospitalId]);

  return { kpis, loading, seeding, seedData, refetch: fetchAll };
}
