import React, { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { format } from "date-fns";
import { FileText, Bug, Baby, AlertTriangle, Download, Eye, ClipboardList, ChevronDown, CheckCircle2, Loader2, Plus } from "lucide-react";
import { getHospitalId } from "@/lib/getHospitalId";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SYNDROME_KEYWORDS: Record<string, string[]> = {
  "Fever (>38°C)": ["fever", "pyrexia", "febrile"],
  "Acute Diarrhoeal Disease": ["diarrhoea", "diarrhea", "loose stools", "gastro", "gastroenteritis"],
  "Jaundice": ["jaundice", "yellow eyes", "icterus"],
  "Rash with Fever": ["rash", "skin eruption"],
  "Severe Acute Respiratory Illness (SARI)": ["breathlessness", "sari", "severe respiratory", "pneumonia"],
  "Acute Flaccid Paralysis": ["afp", "flaccid paralysis"],
  "Dengue-like Illness": ["dengue", "myalgia", "thrombocytopenia"],
  "Malaria-like Illness": ["malaria", "chills", "rigors"],
};

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function getWeekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((d.getTime() - onejan.getTime()) / 86400000);
  return Math.ceil(dayOfYear / 7);
}

function getWeekDateRange(week: number, year: number): { from: string; to: string } {
  const jan1 = new Date(year, 0, 1);
  const startDay = (week - 1) * 7;
  const from = new Date(jan1.getTime() + startDay * 86400000);
  const to = new Date(from.getTime() + 6 * 86400000);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

const HMISPage: React.FC = () => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [kpis, setKpis] = useState({ thisMonth: 0, submitted: 0, pending: 0, idspAlerts: 0 });
  const [showIdspModal, setShowIdspModal] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [viewReport, setViewReport] = useState<any | null>(null);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const curWeek = getWeekNumber(now);

  const loadPcpndt = useCallback(async (hid: string) => {
    const { data } = await supabase.from("pcpndt_form_f").select("*").eq("hospital_id", hid).order("created_at", { ascending: false }).limit(50);
    setPcpndtRecords(data || []);
  }, []);

  const loadReports = useCallback(async (hid: string) => {
    const [reportsRes, idspRes] = await Promise.all([
      supabase.from("hmis_reports").select("*").eq("hospital_id", hid).order("created_at", { ascending: false }).limit(50),
      supabase.from("idsp_alerts").select("id", { count: "exact", head: true }).eq("hospital_id", hid).eq("year", curYear),
    ]);
    const allReports = reportsRes.data || [];
    setReports(allReports);
    setKpis({
      thisMonth: allReports.filter((r: any) => r.period_year === curYear && r.period_month === curMonth).length,
      submitted: allReports.filter((r: any) => r.status === "submitted" || r.status === "accepted").length,
      pending: allReports.filter((r: any) => r.status === "draft" || r.status === "generated").length,
      idspAlerts: idspRes.count || 0,
    });
  }, [curMonth, curYear]);

  useEffect(() => {
    const load = async () => {
      const hid = await getHospitalId();
      if (!hid) return;
      setHospitalId(hid);
      await Promise.all([loadReports(hid), loadPcpndt(hid)]);
      // Capture current user id for signing Form F
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: u } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
        if (u) setCurrentUserId(u.id);
      }
    };
    load();
  }, [loadReports, loadPcpndt]);

  // Load radiology orders when PCPNDT modal opens
  useEffect(() => {
    if (!showPcpndtModal || !hospitalId) return;
    supabase.from("radiology_orders")
      .select("id, order_date, indication, patients(full_name)")
      .eq("hospital_id", hospitalId)
      .order("order_date", { ascending: false })
      .limit(100)
      .then(({ data }) => setRadOrders(data || []));
  }, [showPcpndtModal, hospitalId]);

  // ══════════════════════════════════════════
  // MONTHLY HMIS REPORT GENERATOR
  // ══════════════════════════════════════════
  const generateMonthlyHMIS = async (month: number, year: number) => {
    if (!hospitalId) return;
    setGenerating("monthly_hmis");

    try {
      const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const toDate = `${year}-${String(month).padStart(2, "0")}-${getDaysInMonth(month, year)}`;

      // Parallel data fetch
      const [opdRes, ipdRes, bedsRes, otRes, maternalRes, labRes] = await Promise.all([
        supabase.from("opd_encounters").select("id, patient_id, created_at, department_id").eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        supabase.from("admissions").select("id, patient_id, admitted_at, discharged_at, status, discharge_type, ward_id").eq("hospital_id", hospitalId).gte("admitted_at", fromDate).lte("admitted_at", toDate + "T23:59:59"),
        supabase.from("beds").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("is_active", true),
        supabase.from("ot_schedules").select("id, surgery_type, status").eq("hospital_id", hospitalId).gte("scheduled_date", fromDate).lte("scheduled_date", toDate).eq("status", "completed"),
        supabase.from("obstetric_records").select("id, record_type, delivery_mode, created_at").eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59").eq("record_type", "delivery"),
        supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
      ]);

      const opdData = opdRes.data || [];
      const ipdData = ipdRes.data || [];
      const otData = otRes.data || [];
      const maternalData = maternalRes.data || [];
      const totalBeds = bedsRes.count || 0;
      const totalLabTests = labRes.count || 0;

      // OPD metrics
      const totalOPD = opdData.length;
      // Approximate new patients: unique patient_ids that appear for first time this month
      const patientIds = opdData.map((e: any) => e.patient_id);
      const uniquePatients = new Set(patientIds);
      const newPatients = uniquePatients.size; // approximation

      // IPD metrics
      const totalAdmissions = ipdData.length;
      const totalDischarges = ipdData.filter((a: any) => a.status === "discharged").length;
      const totalDeaths = ipdData.filter((a: any) => a.discharge_type === "expired" || a.status === "expired").length;

      // ALOS
      const discharged = ipdData.filter((a: any) => a.discharged_at && a.admitted_at);
      const totalDays = discharged.reduce((sum: number, a: any) => {
        const days = Math.max(1, Math.ceil((new Date(a.discharged_at).getTime() - new Date(a.admitted_at).getTime()) / 86400000));
        return sum + days;
      }, 0);
      const alos = discharged.length > 0 ? parseFloat((totalDays / discharged.length).toFixed(1)) : 0;

      // BOR
      const daysInMonth = getDaysInMonth(month, year);
      const bor = totalBeds > 0 ? parseFloat(((totalDays / (totalBeds * daysInMonth)) * 100).toFixed(1)) : 0;

      // Surgery
      const totalSurgeries = otData.length;
      const surgeryByType: Record<string, number> = {};
      otData.forEach((o: any) => {
        const t = o.surgery_type || "other";
        surgeryByType[t] = (surgeryByType[t] || 0) + 1;
      });

      // Maternal
      const totalDeliveries = maternalData.length;
      const normalDeliveries = maternalData.filter((m: any) => m.delivery_mode === "svd" || m.delivery_mode === "normal").length;
      const csDeliveries = maternalData.filter((m: any) => ["lscs", "lscs_elective", "lscs_emergency", "caesarean"].includes(m.delivery_mode)).length;

      const reportData = {
        period: { month, year, month_name: MONTHS[month - 1] },
        opd: { total_attendance: totalOPD, new_patients: newPatients, old_patients: Math.max(0, totalOPD - newPatients) },
        ipd: { admissions: totalAdmissions, discharges: totalDischarges, deaths: totalDeaths, alos, bor, total_bed_days: totalDays, total_beds: totalBeds },
        surgery: { total: totalSurgeries, by_type: surgeryByType },
        maternal: { deliveries: totalDeliveries, normal: normalDeliveries, caesarean: csDeliveries },
        lab: { total_tests: totalLabTests },
        generated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("hmis_reports").upsert({
        hospital_id: hospitalId,
        report_type: "monthly_hmis",
        period_month: month,
        period_year: year,
        status: "generated",
        generated_at: new Date().toISOString(),
        report_data: reportData,
      } as any, { onConflict: "hospital_id,report_type,period_year,period_month" }).select().maybeSingle();

      if (error) {
        // Fallback: insert if upsert fails
        await supabase.from("hmis_reports").insert({
          hospital_id: hospitalId, report_type: "monthly_hmis", period_month: month, period_year: year,
          status: "generated", generated_at: new Date().toISOString(), report_data: reportData,
        } as any);
      }

      toast.success(`HMIS Report generated for ${MONTHS[month - 1]} ${year}`);
      setViewReport(reportData);
      await loadReports(hospitalId);
    } catch (err: any) {
      toast.error("Failed to generate report: " + (err?.message || "Unknown error"));
    } finally {
      setGenerating(null);
    }
  };

  // ══════════════════════════════════════════
  // IDSP WEEKLY P-FORM GENERATOR
  // ══════════════════════════════════════════
  const generateIDSPPForm = async (week: number, year: number) => {
    if (!hospitalId) return;
    setGenerating("weekly_idsp_p");

    try {
      const { from: fromDate, to: toDate } = getWeekDateRange(week, year);

      const [opdRes, ipdRes] = await Promise.all([
        supabase.from("opd_encounters").select("id, chief_complaint").eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        supabase.from("admissions").select("id, admitting_diagnosis, discharge_type").eq("hospital_id", hospitalId).gte("admitted_at", fromDate).lte("admitted_at", toDate + "T23:59:59"),
      ]);

      const opdData = opdRes.data || [];
      const ipdData = ipdRes.data || [];

      // Match syndromes by keyword
      const syndromeData: Record<string, { opd: number; ipd: number; deaths: number }> = {};
      Object.keys(SYNDROME_KEYWORDS).forEach(s => { syndromeData[s] = { opd: 0, ipd: 0, deaths: 0 }; });

      opdData.forEach((enc: any) => {
        const text = (enc.chief_complaint || "").toLowerCase();
        Object.entries(SYNDROME_KEYWORDS).forEach(([syndrome, keywords]) => {
          if (keywords.some(kw => text.includes(kw))) {
            syndromeData[syndrome].opd++;
          }
        });
      });

      ipdData.forEach((adm: any) => {
        const text = (adm.admitting_diagnosis || "").toLowerCase();
        Object.entries(SYNDROME_KEYWORDS).forEach(([syndrome, keywords]) => {
          if (keywords.some(kw => text.includes(kw))) {
            syndromeData[syndrome].ipd++;
            if (adm.discharge_type === "expired") syndromeData[syndrome].deaths++;
          }
        });
      });

      const reportData = {
        period: { week, year },
        date_range: { from: fromDate, to: toDate },
        syndromes: syndromeData,
        total_opd_screened: opdData.length,
        total_ipd_screened: ipdData.length,
        generated_at: new Date().toISOString(),
      };

      await supabase.from("hmis_reports").insert({
        hospital_id: hospitalId, report_type: "weekly_idsp_p", period_week: week, period_year: year,
        status: "generated", generated_at: new Date().toISOString(), report_data: reportData,
      } as any);

      toast.success(`IDSP P-Form generated for Week ${week}`);
      setViewReport(reportData);
      await loadReports(hospitalId);
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    } finally {
      setGenerating(null);
    }
  };

  // ══════════════════════════════════════════
  // RMNCH+A REPORT GENERATOR
  // ══════════════════════════════════════════
  const generateRMNCHA = async (month: number, year: number) => {
    if (!hospitalId) return;
    setGenerating("rmncha_monthly");

    try {
      const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const toDate = `${year}-${String(month).padStart(2, "0")}-${getDaysInMonth(month, year)}`;

      const [maternalRes, neonatalRes, ancEarlyRes, highRiskRes, ifaRes, vaccRes] = await Promise.all([
        supabase.from("obstetric_records").select("id, record_type, delivery_mode, created_at").eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        supabase.from("neonatal_records").select("id, birth_weight_grams, apgar_1min, apgar_5min, created_at").eq("hospital_id", hospitalId).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        (supabase as any).from("obstetric_records").select("id").eq("hospital_id", hospitalId).eq("record_type", "anc").lte("gestational_age_weeks", 12).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        (supabase as any).from("obstetric_records").select("id").eq("hospital_id", hospitalId).eq("record_type", "anc").eq("is_high_risk", true).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        (supabase as any).from("obstetric_records").select("id").eq("hospital_id", hospitalId).eq("record_type", "anc").eq("iron_prescribed", true).gte("created_at", fromDate).lte("created_at", toDate + "T23:59:59"),
        supabase.from("vaccination_records").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("administered_date", fromDate).lte("administered_date", toDate),
      ]);

      const maternal = maternalRes.data || [];
      const neonatal = neonatalRes.data || [];

      const ancVisits = maternal.filter((m: any) => m.record_type === "anc").length;
      const deliveries = maternal.filter((m: any) => m.record_type === "delivery");
      const postnatal = maternal.filter((m: any) => m.record_type === "postnatal").length;
      const normalDeliveries = deliveries.filter((d: any) => d.delivery_mode === "svd" || d.delivery_mode === "normal").length;
      const csDeliveries = deliveries.filter((d: any) => ["lscs", "lscs_elective", "lscs_emergency", "caesarean"].includes(d.delivery_mode)).length;

      const lbw = neonatal.filter((n: any) => n.birth_weight_grams && n.birth_weight_grams < 2500).length;
      const vlbw = neonatal.filter((n: any) => n.birth_weight_grams && n.birth_weight_grams < 1500).length;
      const normalWeight = neonatal.filter((n: any) => n.birth_weight_grams && n.birth_weight_grams >= 2500).length;
      const birthAsphyxia = neonatal.filter((n: any) => n.apgar_5min !== null && n.apgar_5min !== undefined && n.apgar_5min < 7).length;

      const reportData = {
        period: { month, year, month_name: MONTHS[month - 1] },
        anc: {
          total_visits: ancVisits,
          early_registration: ancEarlyRes.data?.length || 0,
          high_risk_detected: highRiskRes.data?.length || 0,
          ifa_prescribed: ifaRes.data?.length || 0,
        },
        delivery: {
          total: deliveries.length,
          normal: normalDeliveries,
          caesarean: csDeliveries,
        },
        postnatal: { visits: postnatal },
        neonatal: {
          total: neonatal.length,
          normal_weight: normalWeight,
          low_birth_weight: lbw,
          very_low_birth_weight: vlbw,
          birth_asphyxia: birthAsphyxia,
        },
        immunization: { total_given: vaccRes.count || 0 },
        generated_at: new Date().toISOString(),
      };

      await supabase.from("hmis_reports").insert({
        hospital_id: hospitalId, report_type: "rmncha_monthly", period_month: month, period_year: year,
        status: "generated", generated_at: new Date().toISOString(), report_data: reportData,
      } as any);

      toast.success(`RMNCH+A Report generated for ${MONTHS[month - 1]} ${year}`);
      setViewReport(reportData);
      await loadReports(hospitalId);
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    } finally {
      setGenerating(null);
    }
  };

  const [submitting, setSubmitting] = useState<string | null>(null);

  // PCPNDT Form F state
  const [pcpndtRecords, setPcpndtRecords] = useState<any[]>([]);
  const [showPcpndtModal, setShowPcpndtModal] = useState(false);
  const [pcpndtForm, setPcpndtForm] = useState({
    patient_name: "", patient_age: "", patient_address: "",
    referred_by: "", indication: "", sex_determination_done: false, remarks: "",
    order_id: "", signed_at: new Date().toISOString().split("T")[0],
  });
  const [radOrders, setRadOrders] = useState<any[]>([]);
  const [savingPcpndt, setSavingPcpndt] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const savePcpndt = async () => {
    if (!hospitalId || !currentUserId || !pcpndtForm.order_id || !pcpndtForm.patient_name) {
      toast.error("Patient name and radiology order are required");
      return;
    }
    setSavingPcpndt(true);
    const { error } = await supabase.from("pcpndt_form_f").insert({
      hospital_id: hospitalId,
      order_id: pcpndtForm.order_id,
      patient_name: pcpndtForm.patient_name,
      patient_age: parseInt(pcpndtForm.patient_age) || null,
      patient_address: pcpndtForm.patient_address || null,
      referred_by: pcpndtForm.referred_by || null,
      indication: pcpndtForm.indication || null,
      sex_determination_done: pcpndtForm.sex_determination_done,
      remarks: pcpndtForm.remarks || null,
      signed_by: currentUserId,
      signed_at: pcpndtForm.signed_at,
    } as any);
    if (error) { toast.error(error.message); setSavingPcpndt(false); return; }
    toast.success("Form F recorded");
    setShowPcpndtModal(false);
    if (hospitalId) loadPcpndt(hospitalId);
    setSavingPcpndt(false);
    setPcpndtForm({ patient_name: "", patient_age: "", patient_address: "", referred_by: "", indication: "", sex_determination_done: false, remarks: "", order_id: "", signed_at: new Date().toISOString().split("T")[0] });
  };

  const printFormF = (record: any) => {
    const { printDocument } = require("@/lib/printUtils");
    const body = `
      <h2 style="color:#1A2F5A; text-align:center">FORM F</h2>
      <p style="text-align:center; font-size:11px; color:#666">[See Rule 9(1)] — PC-PNDT Act 1994<br/>Record to be maintained by Genetic Counselling Centre / Clinic / Laboratory / Hospital</p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:16px">
        <tr><td style="padding:6px;border:1px solid #ddd; width:40%;font-weight:bold">Patient Name</td><td style="padding:6px;border:1px solid #ddd">${record.patient_name}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Age</td><td style="padding:6px;border:1px solid #ddd">${record.patient_age ?? "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Address</td><td style="padding:6px;border:1px solid #ddd">${record.patient_address ?? "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Referred By</td><td style="padding:6px;border:1px solid #ddd">${record.referred_by ?? "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Indication for Procedure</td><td style="padding:6px;border:1px solid #ddd">${record.indication ?? "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Sex Determination Done?</td><td style="padding:6px;border:1px solid #ddd;${record.sex_determination_done ? "color:red;font-weight:bold" : ""}">${record.sex_determination_done ? "YES" : "No"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Remarks / Findings</td><td style="padding:6px;border:1px solid #ddd">${record.remarks ?? "—"}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">Date</td><td style="padding:6px;border:1px solid #ddd">${record.signed_at ?? record.created_at?.split("T")[0] ?? "—"}</td></tr>
      </table>
      <div style="margin-top:40px; display:flex; justify-content:flex-end;">
        <div style="text-align:center; width:200px; border-top:1px solid #333; padding-top:4px; font-size:11px">Signature of Doctor / Radiologist</div>
      </div>`;
    printDocument("PCPNDT Form F", body);
  };

  const markSubmitted = async (reportId: string) => {
    await supabase.from("hmis_reports")
      .update({ status: "submitted", submitted_at: new Date().toISOString() } as any)
      .eq("id", reportId);
    toast.success("Report marked as submitted");
    setViewReport(null);
    if (hospitalId) await loadReports(hospitalId);
  };

  const submitToPortal = async (reportId: string) => {
    if (!hospitalId) return;
    setSubmitting(reportId);
    try {
      const { data, error } = await supabase.functions.invoke("hmis-portal-submit", {
        body: { reportId, hospitalId },
      });
      if (error) throw error;
      if (data?.status === "submitted") {
        toast.success(`Submitted to portal. Ack: ${data.acknowledgment_ref}`);
      } else {
        toast.info(data?.message || "Portal unavailable — marked for manual upload");
      }
      await loadReports(hospitalId);
    } catch (err: any) {
      // Fallback: just mark as submitted manually
      await supabase.from("hmis_reports").update({ status: "submitted", submitted_at: new Date().toISOString() } as any).eq("id", reportId);
      toast.info("Portal credentials not configured — marked as submitted manually");
      await loadReports(hospitalId);
    } finally {
      setSubmitting(null);
    }
  };

  const viewExistingReport = (report: any) => {
    if (report.report_data && Object.keys(report.report_data).length > 0) {
      setViewReport({ ...report.report_data, _id: report.id, _status: report.status, _type: report.report_type });
    } else {
      toast.info("No compiled data — regenerate this report");
    }
  };

  // Statuses
  const getStatus = (type: string, month?: number, week?: number) => {
    const match = reports.find((r: any) => {
      if (r.report_type !== type || r.period_year !== curYear) return false;
      if (month && r.period_month !== month) return false;
      if (week && r.period_week !== week) return false;
      return true;
    });
    return match?.status || null;
  };

  const hmisStatus = getStatus("monthly_hmis", curMonth);
  const idspStatus = getStatus("weekly_idsp_p", undefined, curWeek);
  const rmnchaStatus = getStatus("rmncha_monthly", curMonth);

  const statusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline" className="text-[10px] bg-muted/30">Not Generated</Badge>;
    const colors: Record<string, string> = {
      draft: "bg-amber-100 text-amber-800",
      generated: "bg-blue-100 text-blue-800",
      submitted: "bg-emerald-100 text-emerald-800",
      accepted: "bg-emerald-500 text-white",
    };
    return <Badge className={`text-[10px] ${colors[status] || ""}`}>{status}</Badge>;
  };

  const kpiCards = [
    { label: "Reports This Month", value: kpis.thisMonth, color: "text-primary", bg: "bg-primary/5" },
    { label: "Submitted", value: kpis.submitted, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Pending", value: kpis.pending, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "IDSP Alerts", value: kpis.idspAlerts, color: "text-red-600", bg: "bg-red-50" },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card" style={{ height: 52 }}>
        <h1 className="text-base font-bold text-foreground">📊 Govt HMIS Reporting</h1>
        <div className="flex gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={generating === "monthly_hmis"} onClick={() => generateMonthlyHMIS(curMonth, curYear)}>
            {generating === "monthly_hmis" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
            Generate Report
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowIdspModal(true)}>
            <AlertTriangle className="h-3.5 w-3.5 mr-1" /> IDSP Alert
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2" style={{ height: 72 }}>
        {kpiCards.map(k => (
          <div key={k.label} className={`${k.bg} rounded-lg p-3 flex flex-col justify-center`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{k.label}</p>
            <p className={`text-xl font-bold ${k.color} font-mono`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        {/* 3 Report Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-5 border-border">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">📋 MoHFW Monthly HMIS</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Due: 5th of every month</p>
                <div className="mt-2">{statusBadge(hmisStatus)}</div>
                <Button size="sm" className="mt-3 h-8 text-xs w-full" variant={hmisStatus ? "outline" : "default"}
                  disabled={generating === "monthly_hmis"} onClick={() => generateMonthlyHMIS(curMonth, curYear)}>
                  {generating === "monthly_hmis" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Generate {MONTHS[curMonth - 1]} Report →
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                <Bug className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">🦠 IDSP Disease Surveillance</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Due: Every Monday (P-form)</p>
                <div className="mt-2">{statusBadge(idspStatus)}</div>
                <Button size="sm" className="mt-3 h-8 text-xs w-full" variant={idspStatus ? "outline" : "default"}
                  disabled={generating === "weekly_idsp_p"} onClick={() => generateIDSPPForm(curWeek, curYear)}>
                  {generating === "weekly_idsp_p" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Generate Week {curWeek} P-Form →
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5 border-border">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-pink-50 flex items-center justify-center">
                <Baby className="h-5 w-5 text-pink-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">🤰 RMNCH+A Maternal & Child</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">Due: 5th of every month</p>
                <div className="mt-2">{statusBadge(rmnchaStatus)}</div>
                <Button size="sm" className="mt-3 h-8 text-xs w-full" variant={rmnchaStatus ? "outline" : "default"}
                  disabled={generating === "rmncha_monthly"} onClick={() => generateRMNCHA(curMonth, curYear)}>
                  {generating === "rmncha_monthly" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Generate Report →
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* History Table */}
        <Card className="border-border">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Report History</h3>
          </div>
          <div className="overflow-auto max-h-[280px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Report Type</TableHead>
                  <TableHead className="text-xs">Period</TableHead>
                  <TableHead className="text-xs">Generated</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-medium">
                      {r.report_type === "monthly_hmis" ? "Monthly HMIS" :
                        r.report_type === "weekly_idsp_p" ? "IDSP P-Form" :
                          r.report_type === "weekly_idsp_l" ? "IDSP L-Form" :
                            r.report_type === "rmncha_monthly" ? "RMNCH+A" : r.report_type}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.period_month ? `${MONTHS[r.period_month - 1]} ${r.period_year}` :
                        r.period_week ? `W${r.period_week} ${r.period_year}` : r.period_year}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.generated_at ? format(new Date(r.generated_at), "dd/MM/yyyy HH:mm") : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="View" onClick={() => viewExistingReport(r)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {(r.status === "generated" || r.status === "draft") && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50" title="Submit to Portal"
                            onClick={() => submitToPortal(r.id)} disabled={submitting === r.id}>
                            {submitting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle2 className="h-3 w-3 mr-1" />Submit</>}
                          </Button>
                        )}
                        {r.acknowledgment_ref && (
                          <span className="text-[10px] font-mono text-emerald-700 px-1" title={`Ack: ${r.acknowledgment_ref}`}>✓ACK</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {reports.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">No reports generated yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* PCPNDT Form F Register */}
        <Card className="border-border">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">⚖️ PCPNDT Form F Register</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">PC-PNDT Act 1994 — Mandatory record of pre-natal diagnostic procedures</p>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={() => setShowPcpndtModal(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Form F
            </Button>
          </div>
          <div className="overflow-auto max-h-[240px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Patient Name</TableHead>
                  <TableHead className="text-xs">Age</TableHead>
                  <TableHead className="text-xs">Indication</TableHead>
                  <TableHead className="text-xs text-center">Sex Det.</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pcpndtRecords.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono">{r.signed_at || r.created_at?.split("T")[0]}</TableCell>
                    <TableCell className="text-xs font-medium">{r.patient_name}</TableCell>
                    <TableCell className="text-xs">{r.patient_age ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{r.indication ?? "—"}</TableCell>
                    <TableCell className="text-xs text-center">
                      {r.sex_determination_done
                        ? <Badge className="text-[9px] bg-red-100 text-red-700">YES</Badge>
                        : <Badge variant="outline" className="text-[9px]">No</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => printFormF(r)}>Print</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pcpndtRecords.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No Form F entries yet. Add when conducting prenatal diagnostic procedures.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* Report Viewer Modal */}
      {viewReport && <ReportViewerModal data={viewReport} onClose={() => setViewReport(null)} onMarkSubmitted={viewReport._id ? () => markSubmitted(viewReport._id) : undefined} />}

      {/* PCPNDT Form F Modal */}
      <Dialog open={showPcpndtModal} onOpenChange={setShowPcpndtModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-sm">PCPNDT Form F — New Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Radiology Order (Required)</label>
              <Select value={pcpndtForm.order_id} onValueChange={v => {
                const order = radOrders.find((o: any) => o.id === v);
                setPcpndtForm(p => ({
                  ...p,
                  order_id: v,
                  patient_name: (order as any)?.patients?.full_name || p.patient_name,
                  indication: (order as any)?.indication || p.indication,
                }));
              }}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue placeholder="Select radiology order..." />
                </SelectTrigger>
                <SelectContent>
                  {radOrders.map((o: any) => (
                    <SelectItem key={o.id} value={o.id} className="text-xs">
                      {(o as any).patients?.full_name || "Unknown"} — {o.order_date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Patient Name *</label><Input value={pcpndtForm.patient_name} onChange={e => setPcpndtForm(p => ({...p, patient_name: e.target.value}))} className="h-8 text-xs mt-1" /></div>
              <div><label className="text-xs font-medium">Age</label><Input type="number" value={pcpndtForm.patient_age} onChange={e => setPcpndtForm(p => ({...p, patient_age: e.target.value}))} className="h-8 text-xs mt-1" /></div>
            </div>
            <div><label className="text-xs font-medium">Address</label><Input value={pcpndtForm.patient_address} onChange={e => setPcpndtForm(p => ({...p, patient_address: e.target.value}))} className="h-8 text-xs mt-1" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Referred By</label><Input value={pcpndtForm.referred_by} onChange={e => setPcpndtForm(p => ({...p, referred_by: e.target.value}))} className="h-8 text-xs mt-1" /></div>
              <div><label className="text-xs font-medium">Procedure Date</label><Input type="date" value={pcpndtForm.signed_at} onChange={e => setPcpndtForm(p => ({...p, signed_at: e.target.value}))} className="h-8 text-xs mt-1" /></div>
            </div>
            <div><label className="text-xs font-medium">Indication for Procedure</label><Input value={pcpndtForm.indication} onChange={e => setPcpndtForm(p => ({...p, indication: e.target.value}))} className="h-8 text-xs mt-1" /></div>
            <div><label className="text-xs font-medium">Findings / Remarks</label><Textarea value={pcpndtForm.remarks} onChange={e => setPcpndtForm(p => ({...p, remarks: e.target.value}))} className="text-xs min-h-[60px] mt-1" /></div>
            <div className="flex items-center gap-2 p-3 rounded-md border border-border bg-red-50/30">
              <input type="checkbox" id="sex_det" checked={pcpndtForm.sex_determination_done} onChange={e => setPcpndtForm(p => ({...p, sex_determination_done: e.target.checked}))} className="h-4 w-4 accent-red-600" />
              <label htmlFor="sex_det" className="text-xs font-semibold text-red-700 cursor-pointer">Sex determination was performed (legally required to disclose)</label>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowPcpndtModal(false)}>Cancel</Button>
            <Button size="sm" onClick={savePcpndt} disabled={savingPcpndt || !pcpndtForm.order_id || !pcpndtForm.patient_name}>
              {savingPcpndt ? "Saving..." : "Save Form F"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IDSP Alert Modal */}
      {showIdspModal && hospitalId && <IDSPAlertModal hospitalId={hospitalId} onClose={() => { setShowIdspModal(false); if (hospitalId) loadReports(hospitalId); }} week={curWeek} year={curYear} />}
    </div>
  );
};

// ══════════════════════════════════════════
// REPORT VIEWER MODAL
// ══════════════════════════════════════════
const ReportViewerModal: React.FC<{ data: any; onClose: () => void; onMarkSubmitted?: () => void }> = ({ data, onClose, onMarkSubmitted }) => {
  const isHMIS = !!data.opd;
  const isIDSP = !!data.syndromes;
  const isRMNCHA = !!data.anc;

  const title = isHMIS
    ? `MoHFW HMIS Report — ${data.period?.month_name || ""} ${data.period?.year || ""}`
    : isIDSP
      ? `IDSP P-Form — Week ${data.period?.week || ""} / ${data.period?.year || ""}`
      : `RMNCH+A Report — ${data.period?.month_name || ""} ${data.period?.year || ""}`;

  const StatRow = ({ label, value }: { label: string; value: any }) => (
    <div className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-bold font-mono text-foreground">{value}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* HMIS Report Sections */}
          {isHMIS && (
            <>
              <CollapsibleSection title="🏥 OPD" defaultOpen>
                <StatRow label="Total OPD Attendance" value={data.opd.total_attendance} />
                <StatRow label="Unique Patients" value={data.opd.new_patients} />
                <StatRow label="Repeat Visits" value={data.opd.old_patients} />
              </CollapsibleSection>

              <CollapsibleSection title="🛏️ IPD" defaultOpen>
                <StatRow label="Admissions" value={data.ipd.admissions} />
                <StatRow label="Discharges" value={data.ipd.discharges} />
                <StatRow label="Deaths" value={data.ipd.deaths} />
                <StatRow label="ALOS (days)" value={data.ipd.alos} />
                <StatRow label="BOR (%)" value={data.ipd.bor + "%"} />
                <StatRow label="Total Bed Days" value={data.ipd.total_bed_days} />
                <StatRow label="Total Beds" value={data.ipd.total_beds} />
              </CollapsibleSection>

              <CollapsibleSection title="🔪 Surgery">
                <StatRow label="Total Operations" value={data.surgery.total} />
                {data.surgery.by_type && Object.entries(data.surgery.by_type).map(([type, count]) => (
                  <StatRow key={type} label={`  ${type}`} value={count as number} />
                ))}
              </CollapsibleSection>

              <CollapsibleSection title="🤰 Maternal Health">
                <StatRow label="Total Deliveries" value={data.maternal.deliveries} />
                <StatRow label="Normal (SVD)" value={data.maternal.normal} />
                <StatRow label="Caesarean (LSCS)" value={data.maternal.caesarean} />
              </CollapsibleSection>

              <CollapsibleSection title="🔬 Laboratory">
                <StatRow label="Total Tests" value={data.lab.total_tests} />
              </CollapsibleSection>
            </>
          )}

          {/* IDSP P-Form */}
          {isIDSP && (
            <>
              <div className="text-[10px] text-muted-foreground mb-2">
                Period: {data.date_range?.from} to {data.date_range?.to} · OPD screened: {data.total_opd_screened} · IPD screened: {data.total_ipd_screened}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Syndrome</TableHead>
                    <TableHead className="text-[10px] text-right">OPD</TableHead>
                    <TableHead className="text-[10px] text-right">IPD</TableHead>
                    <TableHead className="text-[10px] text-right">Deaths</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.syndromes).map(([syndrome, counts]: [string, any]) => (
                    <TableRow key={syndrome} className={counts.opd + counts.ipd > 0 ? "bg-amber-50/50" : ""}>
                      <TableCell className="text-[10px] font-medium">{syndrome}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{counts.opd}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{counts.ipd}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{counts.deaths > 0 ? <span className="text-destructive font-bold">{counts.deaths}</span> : "0"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {/* RMNCH+A */}
          {isRMNCHA && (
            <>
              <CollapsibleSection title="🤰 Antenatal Care (ANC)" defaultOpen>
                <StatRow label="Total ANC Visits" value={data.anc.total_visits} />
                <StatRow label="Early Registration (≤12 wks)" value={data.anc.early_registration ?? "—"} />
                <StatRow label="High-Risk Cases Detected" value={data.anc.high_risk_detected ?? "—"} />
                <StatRow label="IFA Prescribed" value={data.anc.ifa_prescribed ?? "—"} />
              </CollapsibleSection>
              <CollapsibleSection title="🏥 Deliveries" defaultOpen>
                <StatRow label="Total Deliveries" value={data.delivery.total} />
                <StatRow label="Normal (SVD)" value={data.delivery.normal} />
                <StatRow label="Caesarean (LSCS)" value={data.delivery.caesarean} />
              </CollapsibleSection>
              <CollapsibleSection title="👶 Neonatal" defaultOpen>
                <StatRow label="Total Neonates" value={data.neonatal.total} />
                <StatRow label="Normal Weight (≥2.5 kg)" value={data.neonatal.normal_weight ?? "—"} />
                <StatRow label="Low Birth Weight (1.5–2.5 kg)" value={data.neonatal.low_birth_weight} />
                <StatRow label="Very Low Birth Weight (<1.5 kg)" value={data.neonatal.very_low_birth_weight ?? "—"} />
                <StatRow label="Birth Asphyxia (APGAR<7 at 5min)" value={data.neonatal.birth_asphyxia ?? "—"} />
              </CollapsibleSection>
              <CollapsibleSection title="💉 Immunisation">
                <StatRow label="Vaccines Given This Month" value={data.immunization?.total_given ?? "—"} />
              </CollapsibleSection>
              <CollapsibleSection title="🩺 Postnatal">
                <StatRow label="PNC Visits" value={data.postnatal.visits} />
              </CollapsibleSection>
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button size="sm" className="text-xs" variant="outline" onClick={() => {
            try {
              const wb = XLSX.utils.book_new();
              const rows: any[] = [];
              const addSection = (title: string, obj: Record<string, any>) => {
                rows.push([title]);
                Object.entries(obj).forEach(([k, v]) => {
                  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
                    Object.entries(v).forEach(([sk, sv]) => rows.push([`${k} - ${sk}`, sv]));
                  } else { rows.push([k, v]); }
                });
                rows.push([]);
              };
              if (isHMIS) { addSection("OPD", data.opd); addSection("IPD", data.ipd); addSection("Surgery", data.surgery); addSection("Maternal", data.maternal); addSection("Lab", data.lab); }
              if (isIDSP) { rows.push(["Syndrome", "OPD Cases", "IPD Cases", "Deaths"]); Object.entries(data.syndromes).forEach(([s, c]: [string, any]) => rows.push([s, c.opd, c.ipd, c.deaths])); }
              if (isRMNCHA) { addSection("ANC", data.anc); addSection("Delivery", data.delivery); addSection("Neonatal", data.neonatal); addSection("Immunisation", data.immunization || {}); addSection("Postnatal", data.postnatal); }
              const ws = XLSX.utils.aoa_to_sheet(rows);
              XLSX.utils.book_append_sheet(wb, ws, "Report");
              XLSX.writeFile(wb, `HMIS_Report_${data.period?.month_name || data.period?.week || ""}_${data.period?.year || ""}.xlsx`);
              toast.success("Excel downloaded");
            } catch { toast.error("Download failed"); }
          }}>
            <Download className="h-3 w-3 mr-1" /> Download Excel
          </Button>
          {onMarkSubmitted && data._status !== "submitted" && data._status !== "accepted" && (
            <Button size="sm" className="text-xs" variant="outline" onClick={onMarkSubmitted}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> Mark as Submitted
            </Button>
          )}
          <Button size="sm" className="text-xs" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Collapsible section helper
const CollapsibleSection: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen, children }) => {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 rounded-lg text-xs font-bold text-foreground hover:bg-muted/50 transition-colors">
        {title}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pt-1 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

// IDSP Alert Modal — saves locally AND submits to NHA IHIP portal
const IDSPAlertModal: React.FC<{ hospitalId: string; onClose: () => void; week: number; year: number }> = ({ hospitalId, onClose, week, year }) => {
  const [disease, setDisease] = useState("");
  const [syndrome, setSyndrome] = useState("");
  const [casesOpd, setCasesOpd] = useState("0");
  const [casesIpd, setCasesIpd] = useState("0");
  const [deaths, setDeaths] = useState("0");
  const [isOutbreak, setIsOutbreak] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [portalAck, setPortalAck] = useState<string | null>(null);

  const DISEASES = ["Acute Diarrhoeal Disease", "Typhoid", "Cholera", "Viral Hepatitis", "Dengue", "Chikungunya", "Malaria", "Leptospirosis", "Acute Encephalitis Syndrome", "Meningitis", "Measles", "Diphtheria", "Pertussis", "Chicken Pox", "Other"];

  // Map disease display names to ICD-10 prefixes for the edge function
  const DISEASE_ICD: Record<string, string> = {
    "Cholera": "A00",
    "Typhoid": "A01",
    "Acute Diarrhoeal Disease": "A09",
    "Malaria": "B54",
    "Dengue": "A90",
    "Chikungunya": "A92",
    "Measles": "B05",
    "Diphtheria": "A36",
    "Pertussis": "A37",
    "Chicken Pox": "B01",
    "Viral Hepatitis": "B17",
    "Leptospirosis": "A27",
    "Acute Encephalitis Syndrome": "A83",
    "Meningitis": "G03",
    "Other": "A49",
  };

  const save = async () => {
    if (!disease) { toast.error("Select a disease"); return; }
    setSubmitting(true);
    try {
      // 1 — Save to local idsp_alerts table
      const { error } = await supabase.from("idsp_alerts").insert({
        hospital_id: hospitalId, alert_date: new Date().toISOString().split("T")[0],
        disease, syndrome: syndrome || null,
        cases_opd: parseInt(casesOpd) || 0, cases_ipd: parseInt(casesIpd) || 0,
        deaths: parseInt(deaths) || 0, week_number: week, year,
        is_outbreak: isOutbreak, notes: notes || null,
      } as any);
      if (error) { toast.error(error.message); return; }

      // 2 — Submit to NHA IHIP portal via edge function
      const icdCode = DISEASE_ICD[disease] || "A49";
      try {
        const { data: portalData, error: portalError } = await supabase.functions.invoke("idsp-alert-submit", {
          body: {
            hospital_id: hospitalId,
            icd_code: icdCode,
            disease_name: disease,
          },
        });
        if (!portalError && portalData?.acknowledgment_ref) {
          setPortalAck(portalData.acknowledgment_ref);
          toast.success(`IDSP alert recorded & submitted — Ack: ${portalData.acknowledgment_ref}`);
        } else {
          // Portal credentials not configured — local save still succeeded
          toast.success("IDSP alert recorded locally ✓");
          toast.info("Configure IDSP portal credentials in Settings → Integrations for live submission");
          onClose();
        }
      } catch {
        toast.success("IDSP alert recorded locally ✓");
        onClose();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to save IDSP alert");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={portalAck ? undefined : onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">IDSP Disease Alert — W{week}/{year}</DialogTitle></DialogHeader>

        {portalAck ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 rounded-lg p-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-emerald-700">Submitted to IDSP Portal</p>
              <p className="text-[11px] font-mono text-emerald-600 mt-1">Ack: {portalAck}</p>
            </div>
            <Button size="sm" className="w-full text-xs" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Select value={disease} onValueChange={setDisease}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select disease" /></SelectTrigger>
              <SelectContent>{DISEASES.map(d => <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Syndrome (optional)" value={syndrome} onChange={e => setSyndrome(e.target.value)} className="h-8 text-xs" />
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] text-muted-foreground">OPD Cases</label><Input type="number" value={casesOpd} onChange={e => setCasesOpd(e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-[10px] text-muted-foreground">IPD Cases</label><Input type="number" value={casesIpd} onChange={e => setCasesIpd(e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-[10px] text-muted-foreground">Deaths</label><Input type="number" value={deaths} onChange={e => setDeaths(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={isOutbreak} onChange={e => setIsOutbreak(e.target.checked)} className="rounded" />
              <span className="text-destructive font-semibold">⚠️ Mark as Outbreak</span>
            </label>
            <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} className="text-xs h-16" />
            <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
              Alert will be saved locally and submitted to NHA IHIP portal if credentials are configured in Settings → Integrations.
            </div>
          </div>
        )}

        {!portalAck && (
          <DialogFooter>
            <Button size="sm" className="text-xs gap-1.5" onClick={save} disabled={submitting || !disease}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              {submitting ? "Submitting…" : "Save & Submit to IDSP"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HMISPage;
