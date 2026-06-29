import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "./useAnalyticsData";

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

export interface DoctorScore {
  id: string;
  full_name: string;
  role: string;
  department_id: string | null;
  department_name: string;
  opdCount: number;
  ipdCount: number;
  otCases: number;
  revenue: number;
  avgLOS: number | null;
}

export function useDoctorScores(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-doctor-scores", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      // Get doctors
      const { data: doctors } = await supabase.from("users")
        .select("id, full_name, role, department_id")
        .eq("hospital_id", hospitalId)
        .eq("role", "doctor")
        .eq("is_active", true);

      if (!doctors?.length) return [];

      // Get departments for name mapping
      const { data: depts } = await supabase.from("departments")
        .select("id, name").eq("hospital_id", hospitalId);
      const deptMap: Record<string, string> = {};
      (depts || []).forEach(d => { deptMap[d.id] = d.name; });

      const doctorIds = doctors.map(d => d.id);

      // Parallel queries
      const [opdRes, admRes, otRes, billsOpdRes, billsIpdRes, tokensRes] = await Promise.all([
        supabase.from("opd_encounters").select("id, doctor_id")
          .eq("hospital_id", hospitalId)
          .in("doctor_id", doctorIds)
          .gte("created_at", range.from)
          .lte("created_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("admissions").select("id, admitting_doctor_id, admitted_at, discharged_at, status")
          .eq("hospital_id", hospitalId)
          .in("admitting_doctor_id", doctorIds)
          .gte("admitted_at", range.from)
          .lte("admitted_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("ot_schedules").select("id, surgeon_id")
          .eq("hospital_id", hospitalId)
          .in("surgeon_id", doctorIds)
          .eq("status", "completed")
          .gte("scheduled_date", range.from)
          .lte("scheduled_date", range.to)
          .limit(2000),
        supabase.from("bills").select("paid_amount, encounter_id")
          .eq("hospital_id", hospitalId)
          .eq("bill_type", "opd")
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .limit(5000),
        supabase.from("bills").select("paid_amount, admission_id")
          .eq("hospital_id", hospitalId)
          .eq("bill_type", "ipd")
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .limit(5000),
        // Fallback: get tokens to map bills without encounter_id to doctors
        supabase.from("opd_tokens").select("id, doctor_id, patient_id, visit_date")
          .eq("hospital_id", hospitalId)
          .in("doctor_id", doctorIds)
          .gte("visit_date", range.from)
          .lte("visit_date", range.to)
          .limit(5000),
      ]);

      // Map OPD encounters to doctors
      const opdByDoctor: Record<string, string[]> = {};
      (opdRes.data || []).forEach(e => {
        if (!opdByDoctor[e.doctor_id]) opdByDoctor[e.doctor_id] = [];
        opdByDoctor[e.doctor_id].push(e.id);
      });

      // Also count tokens per doctor (more reliable for OPD count)
      const tokenCountByDoctor: Record<string, number> = {};
      (tokensRes.data || []).forEach(t => {
        tokenCountByDoctor[t.doctor_id] = (tokenCountByDoctor[t.doctor_id] || 0) + 1;
      });

      // Map admissions to doctors
      const admByDoctor: Record<string, any[]> = {};
      (admRes.data || []).forEach(a => {
        if (!admByDoctor[a.admitting_doctor_id]) admByDoctor[a.admitting_doctor_id] = [];
        admByDoctor[a.admitting_doctor_id].push(a);
      });

      // Map OT to doctors
      const otByDoctor: Record<string, number> = {};
      (otRes.data || []).forEach(o => {
        otByDoctor[o.surgeon_id] = (otByDoctor[o.surgeon_id] || 0) + 1;
      });

      // Map encounter_id to paid_amount for OPD bills
      const opdBillMap: Record<string, number> = {};
      const unlinkedOpdBills: { patient_id?: string; bill_date?: string; paid_amount: number }[] = [];
      (billsOpdRes.data || []).forEach(b => {
        if (b.encounter_id) {
          opdBillMap[b.encounter_id] = (opdBillMap[b.encounter_id] || 0) + (Number(b.paid_amount) || 0);
        } else {
          // Collect unlinked bills for token-based fallback
          unlinkedOpdBills.push(b as any);
        }
      });

      // Map admission_id to paid_amount for IPD bills
      const ipdBillMap: Record<string, number> = {};
      (billsIpdRes.data || []).forEach(b => {
        if (b.admission_id) ipdBillMap[b.admission_id] = (ipdBillMap[b.admission_id] || 0) + (Number(b.paid_amount) || 0);
      });

      // Build token lookup: patient_id+visit_date → doctor_id for fallback revenue
      const tokenDoctorMap: Record<string, string> = {};
      (tokensRes.data || []).forEach(t => {
        const key = `${t.patient_id}::${t.visit_date}`;
        tokenDoctorMap[key] = t.doctor_id;
      });

      // Map unlinked OPD bills to doctors via tokens
      const tokenRevByDoctor: Record<string, number> = {};
      // We need patient_id and bill_date from unlinked bills - re-query with those fields
      // Actually billsOpdRes already has those if we select them. Let's use a separate approach:
      // Query OPD bills that have no encounter_id, with patient_id and bill_date
      const { data: unlinkedBills } = await supabase.from("bills")
        .select("paid_amount, patient_id, bill_date")
        .eq("hospital_id", hospitalId)
        .eq("bill_type", "opd")
        .is("encounter_id", null)
        .gte("bill_date", range.from).lte("bill_date", range.to)
        .limit(5000);

      (unlinkedBills || []).forEach(b => {
        const key = `${b.patient_id}::${b.bill_date}`;
        const docId = tokenDoctorMap[key];
        if (docId) {
          tokenRevByDoctor[docId] = (tokenRevByDoctor[docId] || 0) + (Number(b.paid_amount) || 0);
        }
      });

      return doctors.map(doc => {
        const docOpd = opdByDoctor[doc.id] || [];
        const docAdm = admByDoctor[doc.id] || [];
        const discharged = docAdm.filter(a => a.status === "discharged" && a.discharged_at && a.admitted_at);
        const avgLOS = discharged.length > 0
          ? discharged.reduce((sum, a) => {
              const days = (new Date(a.discharged_at).getTime() - new Date(a.admitted_at).getTime()) / 86400000;
              return sum + days;
            }, 0) / discharged.length
          : null;

        // Revenue = OPD encounter bills + IPD admission bills + token-fallback revenue
        let revenue = 0;
        docOpd.forEach(encId => { revenue += opdBillMap[encId] || 0; });
        docAdm.forEach(a => { revenue += ipdBillMap[a.id] || 0; });
        revenue += tokenRevByDoctor[doc.id] || 0;

        return {
          id: doc.id,
          full_name: doc.full_name,
          role: doc.role,
          department_id: doc.department_id,
          department_name: doc.department_id ? (deptMap[doc.department_id] || "Unassigned") : "Unassigned",
          opdCount: Math.max(docOpd.length, tokenCountByDoctor[doc.id] || 0),
          ipdCount: docAdm.length,
          otCases: otByDoctor[doc.id] || 0,
          revenue,
          avgLOS: avgLOS ? Math.round(avgLOS * 10) / 10 : null,
        } satisfies DoctorScore;
      }).sort((a, b) => b.revenue - a.revenue);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export interface DeptPerformance {
  id: string;
  name: string;
  doctorCount: number;
  opdCount: number;
  ipdCount: number;
  revenue: number;
  revenueShare: number;
}

export function useDeptPerformance(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-dept-performance", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return [];

      const [deptsRes, usersRes, opdRes, admRes, billsRes] = await Promise.all([
        supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).limit(100),
        supabase.from("users").select("id, department_id").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).limit(500),
        supabase.from("opd_encounters").select("id, doctor_id")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("admissions").select("id, admitting_doctor_id")
          .eq("hospital_id", hospitalId)
          .gte("admitted_at", range.from).lte("admitted_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("bills").select("paid_amount, encounter_id, admission_id")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .limit(5000),
      ]);

      const depts = deptsRes.data || [];
      const users = usersRes.data || [];
      const opd = opdRes.data || [];
      const adm = admRes.data || [];
      const bills = billsRes.data || [];

      // Doctor → dept mapping
      const doctorDept: Record<string, string> = {};
      users.forEach(u => { if (u.department_id) doctorDept[u.id] = u.department_id; });

      // Encounter → doctor mapping
      const encDoctor: Record<string, string> = {};
      opd.forEach(e => { encDoctor[e.id] = e.doctor_id; });

      // Admission → doctor mapping
      const admDoctor: Record<string, string> = {};
      adm.forEach(a => { admDoctor[a.id] = a.admitting_doctor_id; });

      const deptStats: Record<string, { doctors: Set<string>; opd: number; ipd: number; revenue: number }> = {};
      depts.forEach(d => { deptStats[d.id] = { doctors: new Set(), opd: 0, ipd: 0, revenue: 0 }; });

      users.forEach(u => {
        if (u.department_id && deptStats[u.department_id]) deptStats[u.department_id].doctors.add(u.id);
      });

      opd.forEach(e => {
        const dept = doctorDept[e.doctor_id];
        if (dept && deptStats[dept]) deptStats[dept].opd++;
      });

      adm.forEach(a => {
        const dept = doctorDept[a.admitting_doctor_id];
        if (dept && deptStats[dept]) deptStats[dept].ipd++;
      });

      bills.forEach(b => {
        let dept: string | undefined;
        if (b.encounter_id && encDoctor[b.encounter_id]) dept = doctorDept[encDoctor[b.encounter_id]];
        else if (b.admission_id && admDoctor[b.admission_id]) dept = doctorDept[admDoctor[b.admission_id]];
        if (dept && deptStats[dept]) deptStats[dept].revenue += Number(b.paid_amount) || 0;
      });

      const totalRevenue = Object.values(deptStats).reduce((s, d) => s + d.revenue, 0);

      return depts.map(d => ({
        id: d.id,
        name: d.name,
        doctorCount: deptStats[d.id]?.doctors.size || 0,
        opdCount: deptStats[d.id]?.opd || 0,
        ipdCount: deptStats[d.id]?.ipd || 0,
        revenue: deptStats[d.id]?.revenue || 0,
        revenueShare: totalRevenue > 0 ? Math.round(((deptStats[d.id]?.revenue || 0) / totalRevenue) * 1000) / 10 : 0,
      } satisfies DeptPerformance)).sort((a, b) => b.revenue - a.revenue);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useDeptDoctors(deptId: string | null, range: DateRange) {
  return useQuery({
    queryKey: ["analytics-dept-doctors", deptId, range],
    enabled: !!deptId,
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId || !deptId) return [];

      const { data: doctors } = await supabase.from("users")
        .select("id, full_name")
        .eq("hospital_id", hospitalId).eq("department_id", deptId).eq("role", "doctor").eq("is_active", true);

      if (!doctors?.length) return [];

      const doctorIds = doctors.map(d => d.id);

      const [opdRes, billsRes] = await Promise.all([
        supabase.from("opd_encounters").select("id, doctor_id")
          .eq("hospital_id", hospitalId)
          .in("doctor_id", doctorIds)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("bills").select("paid_amount, encounter_id")
          .eq("hospital_id", hospitalId)
          .eq("bill_type", "opd")
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .limit(5000),
      ]);

      const opdByDoc: Record<string, string[]> = {};
      (opdRes.data || []).forEach(e => {
        if (!opdByDoc[e.doctor_id]) opdByDoc[e.doctor_id] = [];
        opdByDoc[e.doctor_id].push(e.id);
      });

      const billMap: Record<string, number> = {};
      (billsRes.data || []).forEach(b => {
        if (b.encounter_id) billMap[b.encounter_id] = (billMap[b.encounter_id] || 0) + (Number(b.paid_amount) || 0);
      });

      const totalRevenue = doctors.reduce((s, doc) => {
        return s + (opdByDoc[doc.id] || []).reduce((r, encId) => r + (billMap[encId] || 0), 0);
      }, 0);

      return doctors.map(doc => {
        const opd = (opdByDoc[doc.id] || []).length;
        const rev = (opdByDoc[doc.id] || []).reduce((r, encId) => r + (billMap[encId] || 0), 0);
        return {
          name: doc.full_name,
          opd,
          revenue: rev,
          share: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0,
        };
      }).sort((a, b) => b.revenue - a.revenue);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useDeptTopServices(deptId: string | null, range: DateRange) {
  return useQuery({
    queryKey: ["analytics-dept-services", deptId, range],
    enabled: !!deptId,
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId || !deptId) return [];

      // Get doctors in this dept
      const { data: doctors } = await supabase.from("users")
        .select("id").eq("hospital_id", hospitalId).eq("department_id", deptId).eq("role", "doctor");
      if (!doctors?.length) return [];

      const doctorIds = doctors.map(d => d.id);

      // Get OPD encounters + IPD admissions for these doctors in range
      const [encRes, admRes] = await Promise.all([
        supabase.from("opd_encounters").select("id")
          .eq("hospital_id", hospitalId)
          .in("doctor_id", doctorIds)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59")
          .limit(5000),
        supabase.from("admissions").select("id")
          .eq("hospital_id", hospitalId)
          .in("admitting_doctor_id", doctorIds)
          .gte("admitted_at", range.from).lte("admitted_at", range.to + "T23:59:59")
          .limit(5000),
      ]);

      const encIds = (encRes.data || []).map(e => e.id);
      const admIds = (admRes.data || []).map(a => a.id);

      // Get bills for these encounters and admissions
      const billQueries = [];
      if (encIds.length > 0) {
        billQueries.push(supabase.from("bills").select("id")
          .eq("hospital_id", hospitalId).in("encounter_id", encIds).limit(5000));
      }
      if (admIds.length > 0) {
        billQueries.push(supabase.from("bills").select("id")
          .eq("hospital_id", hospitalId).in("admission_id", admIds).limit(5000));
      }
      if (billQueries.length === 0) return [];

      const billResults = await Promise.all(billQueries);
      const billIds = billResults.flatMap(r => (r.data || []).map(b => b.id));
      if (!billIds.length) return [];

      // Get line items
      const { data: items } = await supabase.from("bill_line_items")
        .select("description, total_amount")
        .eq("hospital_id", hospitalId)
        .in("bill_id", billIds)
        .limit(5000);

      const svcMap: Record<string, { total: number; count: number }> = {};
      (items || []).forEach(it => {
        const k = it.description;
        if (!svcMap[k]) svcMap[k] = { total: 0, count: 0 };
        svcMap[k].total += Number(it.total_amount) || 0;
        svcMap[k].count++;
      });

      return Object.entries(svcMap)
        .map(([name, v]) => ({ name, total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}
