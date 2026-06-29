import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DateRange {
  from: string;
  to: string;
}

export function useRevenueKPIs(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-revenue-kpis", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;

      const [totalRes, outstandingRes, opdRes, ipdRes, pharmaRes] = await Promise.all([
        // Exclude bill_type="pharmacy" from bills total — pharmacy revenue comes from pharmacy_dispensing
        supabase.from("bills").select("paid_amount").eq("hospital_id", hospitalId)
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .in("payment_status", ["paid", "partial"])
          .neq("bill_type", "pharmacy"),
        supabase.from("bills").select("balance_due").eq("hospital_id", hospitalId)
          .in("payment_status", ["unpaid", "partial"])
          .gte("bill_date", range.from).lte("bill_date", range.to),
        supabase.from("bills").select("paid_amount, encounter_id").eq("hospital_id", hospitalId)
          .eq("bill_type", "opd").in("payment_status", ["paid", "partial"])
          .gte("bill_date", range.from).lte("bill_date", range.to),
        supabase.from("bills").select("paid_amount, admission_id").eq("hospital_id", hospitalId)
          .eq("bill_type", "ipd").in("payment_status", ["paid", "partial"])
          .gte("bill_date", range.from).lte("bill_date", range.to),
        // Pharmacy retail sales live in pharmacy_dispensing — covers all historical and future data
        (supabase as any).from("pharmacy_dispensing").select("net_amount").eq("hospital_id", hospitalId)
          .eq("dispensing_type", "retail").eq("status", "dispensed")
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59"),
      ]);

      const sum = (rows: any[] | null, field: string) =>
        (rows || []).reduce((s, r) => s + (Number(r[field]) || 0), 0);

      const pharmacyRevenue = sum(pharmaRes.data, "net_amount");

      return {
        totalRevenue: sum(totalRes.data, "paid_amount") + pharmacyRevenue,
        outstanding: sum(outstandingRes.data, "balance_due"),
        outstandingCount: outstandingRes.data?.length || 0,
        opdRevenue: sum(opdRes.data, "paid_amount"),
        opdCount: new Set(opdRes.data?.map(r => r.encounter_id).filter(Boolean)).size,
        ipdRevenue: sum(ipdRes.data, "paid_amount"),
        ipdCount: new Set(ipdRes.data?.map(r => r.admission_id).filter(Boolean)).size,
        pharmacyRevenue,
        pharmacyCount: pharmaRes.data?.length || 0,
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useRevenueTrend(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-revenue-trend", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const { data } = await supabase.from("bills")
        .select("bill_date, total_amount, paid_amount")
        .eq("hospital_id", hospitalId)
        .gte("bill_date", range.from).lte("bill_date", range.to)
        .order("bill_date");

      const grouped: Record<string, { billed: number; collected: number }> = {};
      (data || []).forEach(row => {
        const d = row.bill_date;
        if (!grouped[d]) grouped[d] = { billed: 0, collected: 0 };
        grouped[d].billed += Number(row.total_amount) || 0;
        grouped[d].collected += Number(row.paid_amount) || 0;
      });

      return Object.entries(grouped).map(([date, vals]) => ({
        date,
        billed: vals.billed,
        collected: vals.collected,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useRevenueBreakdown(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-revenue-breakdown", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      // Get bill IDs in range first, then fetch their line items
      const { data: billsInRange } = await supabase.from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .gte("bill_date", range.from).lte("bill_date", range.to)
        .limit(2000);

      const billIds = (billsInRange || []).map(b => b.id);
      if (!billIds.length) return [];

      const { data } = await supabase.from("bill_line_items")
        .select("item_type, total_amount")
        .eq("hospital_id", hospitalId)
        .in("bill_id", billIds)
        .limit(5000);
      const typeMap: Record<string, number> = {};
      (data || []).forEach(row => {
        const t = row.item_type || "other";
        typeMap[t] = (typeMap[t] || 0) + (Number(row.total_amount) || 0);
      });

      const total = Object.values(typeMap).reduce((s, v) => s + v, 0);
      const colors: Record<string, string> = {
        service: "hsl(217, 91%, 60%)",
        consultation: "hsl(217, 91%, 60%)",
        room: "hsl(263, 70%, 50%)",
        pharmacy: "hsl(0, 84%, 60%)",
        lab: "hsl(142, 71%, 45%)",
        radiology: "hsl(25, 95%, 53%)",
        procedure: "hsl(172, 66%, 50%)",
        other: "hsl(215, 14%, 60%)",
      };

      return Object.entries(typeMap)
        .map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
          pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
          fill: colors[name] || colors.other,
        }))
        .sort((a, b) => b.value - a.value);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function usePaymentModes(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-payment-modes", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const { data } = await supabase.from("bill_payments")
        .select("payment_mode, amount")
        .eq("hospital_id", hospitalId)
        .gte("payment_date", range.from).lte("payment_date", range.to);

      const modeMap: Record<string, { total: number; count: number }> = {};
      (data || []).forEach(row => {
        const m = row.payment_mode || "other";
        if (!modeMap[m]) modeMap[m] = { total: 0, count: 0 };
        modeMap[m].total += Number(row.amount) || 0;
        modeMap[m].count++;
      });

      const colors: Record<string, string> = {
        cash: "hsl(142, 71%, 45%)",
        upi: "hsl(263, 70%, 50%)",
        card: "hsl(217, 91%, 60%)",
        insurance: "hsl(25, 95%, 53%)",
        credit: "hsl(0, 84%, 60%)",
        netbanking: "hsl(172, 66%, 50%)",
      };

      return Object.entries(modeMap)
        .map(([mode, vals]) => ({
          mode: mode.charAt(0).toUpperCase() + mode.slice(1),
          total: vals.total,
          count: vals.count,
          fill: colors[mode] || "hsl(215, 14%, 60%)",
        }))
        .sort((a, b) => b.total - a.total);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useInsuranceSummary(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-insurance-summary", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;

      const { data } = await supabase.from("insurance_claims")
        .select("status, claimed_amount, approved_amount, settled_amount, tpa_name")
        .eq("hospital_id", hospitalId)
        .limit(2000);

      const claims = data || [];
      const submitted = claims.filter(c => c.status !== "draft");
      const settled = claims.filter(c => c.status === "settled");
      const pending = claims.filter(c => ["submitted", "under_review", "approved"].includes(c.status));
      const rejected = claims.filter(c => c.status === "rejected");

      const sumField = (arr: any[], field: string) => arr.reduce((s, r) => s + (Number(r[field]) || 0), 0);

      // TPA breakdown
      const tpaMap: Record<string, { submitted: number; settled: number; pending: number }> = {};
      claims.forEach(c => {
        const t = c.tpa_name;
        if (!tpaMap[t]) tpaMap[t] = { submitted: 0, settled: 0, pending: 0 };
        tpaMap[t].submitted += Number(c.claimed_amount) || 0;
        if (c.status === "settled") tpaMap[t].settled += Number(c.settled_amount) || 0;
        if (["submitted", "under_review", "approved"].includes(c.status))
          tpaMap[t].pending += Number(c.claimed_amount) || 0;
      });

      return {
        submittedCount: submitted.length,
        submittedAmount: sumField(submitted, "claimed_amount"),
        settledCount: settled.length,
        settledAmount: sumField(settled, "settled_amount"),
        pendingCount: pending.length,
        pendingAmount: sumField(pending, "claimed_amount"),
        rejectedCount: rejected.length,
        rejectedAmount: sumField(rejected, "claimed_amount"),
        topTPAs: Object.entries(tpaMap)
          .map(([name, vals]) => ({ name, ...vals }))
          .sort((a, b) => b.pending - a.pending)
          .slice(0, 3),
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useClinicalKPIs(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-clinical-kpis", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;

      const [opdRes, admRes, bedsRes, totalBedsRes, labRes, edRes] = await Promise.all([
        supabase.from("opd_encounters").select("id, created_at")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59"),
        supabase.from("admissions").select("id, admitted_at, discharged_at, status")
          .eq("hospital_id", hospitalId)
          .gte("admitted_at", range.from).lte("admitted_at", range.to + "T23:59:59"),
        supabase.from("beds").select("id, status").eq("hospital_id", hospitalId)
          .eq("is_active", true).eq("status", "occupied"),
        supabase.from("beds").select("id").eq("hospital_id", hospitalId).eq("is_active", true),
        supabase.from("lab_order_items").select("id, status")
          .eq("hospital_id", hospitalId)
          .in("status", ["reported", "validated"])
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("ed_visits").select("id, triage_category")
          .eq("hospital_id", hospitalId)
          .gte("arrival_time", range.from).lte("arrival_time", range.to + "T23:59:59"),
      ]);

      const opdCount = opdRes.data?.length || 0;
      const days = Math.max(1, Math.ceil((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
      const occupiedBeds = bedsRes.data?.length || 0;
      const totalBeds = totalBedsRes.data?.length || 0;
      const edData = edRes.data || [];

      return {
        opdVisits: opdCount,
        opdDailyAvg: Math.round(opdCount / days),
        admissions: admRes.data?.length || 0,
        bedOccupancy: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
        occupiedBeds,
        totalBeds,
        labTests: labRes.data?.length || 0,
        emergencyCases: edData.length,
        emergencyP1: edData.filter(e => e.triage_category === "P1").length,
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useOPDTrend(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-opd-trend", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const [opdRes, edRes] = await Promise.all([
        supabase.from("opd_encounters").select("created_at")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59"),
        supabase.from("ed_visits").select("arrival_time")
          .eq("hospital_id", hospitalId)
          .gte("arrival_time", range.from).lte("arrival_time", range.to + "T23:59:59"),
      ]);

      const grouped: Record<string, { opd: number; ed: number }> = {};
      (opdRes.data || []).forEach(r => {
        const d = r.created_at?.split("T")[0] || "";
        if (!grouped[d]) grouped[d] = { opd: 0, ed: 0 };
        grouped[d].opd++;
      });
      (edRes.data || []).forEach(r => {
        const d = r.arrival_time?.split("T")[0] || "";
        if (!grouped[d]) grouped[d] = { opd: 0, ed: 0 };
        grouped[d].ed++;
      });

      return Object.entries(grouped)
        .map(([date, vals]) => ({ date, ...vals }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useBedOccupancyBreakdown() {
  return useQuery({
    queryKey: ["analytics-bed-occupancy"],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return { segments: [], wards: [] };

      const { data: beds } = await supabase.from("beds")
        .select("id, status, ward_id").eq("hospital_id", hospitalId).eq("is_active", true);
      const { data: wards } = await supabase.from("wards")
        .select("id, name").eq("hospital_id", hospitalId).eq("is_active", true);

      const statusMap: Record<string, number> = {};
      (beds || []).forEach(b => {
        statusMap[b.status] = (statusMap[b.status] || 0) + 1;
      });

      const colors: Record<string, string> = {
        occupied: "hsl(217, 91%, 60%)",
        available: "hsl(142, 71%, 45%)",
        maintenance: "hsl(25, 95%, 53%)",
        reserved: "hsl(263, 70%, 50%)",
      };

      const segments = Object.entries(statusMap).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: colors[name] || "hsl(215, 14%, 60%)",
      }));

      const wardBreakdown = (wards || []).map(w => {
        const wardBeds = (beds || []).filter(b => b.ward_id === w.id);
        return {
          name: w.name,
          occupied: wardBeds.filter(b => b.status === "occupied").length,
          total: wardBeds.length,
        };
      });

      return { segments, wards: wardBreakdown };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useTopDiagnoses(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-top-diagnoses", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const { data } = await supabase.from("opd_encounters")
        .select("chief_complaint")
        .eq("hospital_id", hospitalId)
        .not("chief_complaint", "is", null)
        .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
        .limit(5000);

      const countMap: Record<string, number> = {};
      (data || []).forEach(r => {
        const c = r.chief_complaint?.trim();
        if (c) countMap[c] = (countMap[c] || 0) + 1;
      });

      return Object.entries(countMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useDailyHeatmap(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-heatmap", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const { data } = await supabase.from("bills")
        .select("bill_date, paid_amount")
        .eq("hospital_id", hospitalId)
        .gte("bill_date", range.from).lte("bill_date", range.to);

      const dayMap: Record<string, number> = {};
      (data || []).forEach(r => {
        dayMap[r.bill_date] = (dayMap[r.bill_date] || 0) + (Number(r.paid_amount) || 0);
      });

      // Generate all dates in range and fill missing with 0
      const allDays: { date: string; amount: number }[] = [];
      const start = new Date(range.from);
      const end = new Date(range.to);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        allDays.push({ date: dateStr, amount: dayMap[dateStr] || 0 });
      }
      return allDays;
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useDischargeTAT(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-discharge-tat", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return { entries: [], avgHours: 0, distribution: [] };

      const { data } = await supabase.from("admissions")
        .select("admitted_at, discharged_at, ward_id")
        .eq("hospital_id", hospitalId)
        .eq("status", "discharged")
        .not("discharged_at", "is", null)
        .not("admitted_at", "is", null)
        .gte("discharged_at", range.from)
        .lte("discharged_at", range.to + "T23:59:59")
        .limit(2000);

      const entries = (data || []).map(r => {
        const hours = (new Date(r.discharged_at!).getTime() - new Date(r.admitted_at!).getTime()) / 3600000;
        return { hours: Math.round(hours * 10) / 10, wardId: r.ward_id };
      }).filter(e => e.hours >= 0);

      const avgHours = entries.length > 0
        ? Math.round(entries.reduce((s, e) => s + e.hours, 0) / entries.length * 10) / 10
        : 0;

      // Distribution buckets: <24h, 24-48h, 48-72h, 72-96h, 96-120h, >120h
      const buckets = ["<24h", "24-48h", "48-72h", "72-96h", "96-120h", ">120h"];
      const counts = [0, 0, 0, 0, 0, 0];
      entries.forEach(e => {
        if (e.hours < 24) counts[0]++;
        else if (e.hours < 48) counts[1]++;
        else if (e.hours < 72) counts[2]++;
        else if (e.hours < 96) counts[3]++;
        else if (e.hours < 120) counts[4]++;
        else counts[5]++;
      });

      const distribution = buckets.map((bucket, i) => ({ bucket, count: counts[i] }));

      return { entries, avgHours, distribution, totalDischarges: entries.length };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users")
    .select("hospital_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data?.hospital_id || null;
}
