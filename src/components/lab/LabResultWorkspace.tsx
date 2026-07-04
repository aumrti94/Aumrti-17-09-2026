import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";
import { hasTabAccess } from "@/lib/tabPermissions";
import { Clock, Save, CheckCircle2, FileText, Printer, MessageSquare, AlertTriangle, Pencil } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWhatsAppNotification } from "@/components/whatsapp/WhatsAppNotificationCard";
import { sendLabResultReady } from "@/lib/whatsapp-notifications";
import { printDocument, printHeader } from "@/lib/printUtils";
import { logRecordAccess } from "@/lib/ims";
import { getLatestQcWarnings } from "@/lib/labQc";
import LabTrendPanel from "./LabTrendPanel";
import LabAnomalyDetector from "./LabAnomalyDetector";
import LabInterpretationPanel from "./LabInterpretationPanel";

interface LabOrder {
  id: string;
  priority: string;
  status: string;
  order_date: string;
  order_time: string;
  clinical_notes: string | null;
  patient_id: string;
  ordered_by: string;
  patients: { full_name: string; uhid: string; gender: string | null; dob: string | null; phone?: string | null } | null;
  ordered_by_user: { full_name: string } | null;
  lab_order_items: any[];
}

interface TestItem {
  id: string;
  test_id: string;
  status: string;
  result_value: string | null;
  result_numeric: number | null;
  result_unit: string | null;
  result_flag: string | null;
  reference_range: string | null;
  sample_barcode: string | null;
  sample_collected_at: string | null;
  validated_at: string | null;
  critical_acknowledged: boolean;
  notes: string | null;
  test_name: string;
  test_code: string | null;
  category: string;
  unit: string | null;
  normal_min: number | null;
  normal_max: number | null;
  critical_low: number | null;
  critical_high: number | null;
  tat_minutes: number | null;
  sample_type: string;
}

interface Props {
  order: LabOrder;
  onRefresh: () => void;
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function getAge(dob: string | null): string {
  if (!dob) return "";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}y`;
}

function calcFlag(value: number, item: TestItem): string | null {
  if (item.critical_low != null && value < item.critical_low) return "CL";
  if (item.critical_high != null && value > item.critical_high) return "CH";
  if (item.normal_min != null && value < item.normal_min) return "L";
  if (item.normal_max != null && value > item.normal_max) return "H";
  if (item.normal_min != null || item.normal_max != null) return "N";
  return null;
}

const FLAG_STYLES: Record<string, { bg: string; text: string; label: string; border?: string }> = {
  N: { bg: "", text: "", label: "" },
  H: { bg: "bg-amber-50", text: "text-amber-700", label: "↑ H" },
  L: { bg: "bg-blue-50", text: "text-blue-700", label: "↓ L" },
  CH: { bg: "bg-red-50", text: "text-red-700", label: "↑↑ CH", border: "border-l-[3px] border-l-destructive" },
  CL: { bg: "bg-indigo-50", text: "text-indigo-700", label: "↓↓ CL", border: "border-l-[3px] border-l-indigo-500" },
  A: { bg: "bg-purple-50", text: "text-purple-700", label: "A" },
};

const STATUS_PILLS: Record<string, { bg: string; text: string; label: string }> = {
  ordered: { bg: "bg-muted", text: "text-muted-foreground", label: "Ordered" },
  sample_collected: { bg: "bg-amber-100", text: "text-amber-700", label: "Collected" },
  in_process: { bg: "bg-blue-100", text: "text-blue-700", label: "Processing" },
  result_entered: { bg: "bg-blue-100", text: "text-blue-700", label: "Entered" },
  pending_validation: { bg: "bg-teal-100", text: "text-teal-700", label: "⏳ Pending Sign-off" },
  validated: { bg: "bg-emerald-100", text: "text-emerald-700", label: "✓ Validated" },
  reported: { bg: "bg-emerald-200", text: "text-emerald-800", label: "✓ Reported" },
};

const LabResultWorkspace: React.FC<Props> = ({ order, onRefresh }) => {
  const { toast } = useToast();
  const { role, permissions } = useHospitalContext();
  const { show: showWaNotif, card: waCard } = useWhatsAppNotification();
  const [items, setItems] = useState<TestItem[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [labNotes, setLabNotes] = useState(order.clinical_notes || "");
  // Antibiogram state (microbiology / culture tests)
  const [antibiogramOrganism, setAntibiogramOrganism] = useState("");
  const [antibiogramColonyCount, setAntibiogramColonyCount] = useState("");
  const [antibiogramSpecimen, setAntibiogramSpecimen] = useState("urine");
  const [antibiogramSensitivity, setAntibiogramSensitivity] = useState<Record<string, "S" | "I" | "R">>({});
  const [antibiogramSaving, setAntibiogramSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [samples, setSamples] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [labHospitalId, setLabHospitalId] = useState<string>("");
  const [validating, setValidating] = useState(false);
  const [autoRunAnomaly, setAutoRunAnomaly] = useState(false);
  const [hospitalName, setHospitalName] = useState<string>("");
  const [nablNumber, setNablNumber] = useState<string>("");
  // Barcode state
  const [orderBarcode, setOrderBarcode] = useState<string | null>((order as any).barcode || null);
  // Dual-validation state
  const [requiresDualValidation, setRequiresDualValidation] = useState(false);
  const [validationNotes, setValidationNotes] = useState("");
  // Critical notify gate: item id → confirmed
  const [doctorNotifyConfirmed, setDoctorNotifyConfirmed] = useState<Record<string, boolean>>({});
  // QC advisory: test names already warned about this session (avoid repeat toasts)
  const qcWarnedTests = React.useRef<Set<string>>(new Set());

  // Get current user id and hospital id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).limit(1).maybeSingle()
        .then(async ({ data }) => {
          if (!data) return;
          setCurrentUserId(data.id);
          setLabHospitalId(data.hospital_id);
          const { data: hosp } = await (supabase as any).from("hospitals")
            .select("name, nabl_accreditation_number")
            .eq("id", data.hospital_id).maybeSingle();
          if (hosp) { setHospitalName(hosp.name || ""); setNablNumber(hosp.nabl_accreditation_number || ""); }
        });
    });
  }, []);

  // Fetch items with test master details
  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("lab_order_items")
      .select(`
        id, test_id, status, result_value, result_numeric, result_unit,
        result_flag, reference_range, sample_barcode, sample_collected_at,
        validated_at, critical_acknowledged, notes,
        lab_test_master!lab_order_items_test_id_fkey (
          test_name, test_code, category, unit, normal_min, normal_max,
          critical_low, critical_high, tat_minutes, sample_type
        )
      `)
      .eq("lab_order_id", order.id)
      .order("created_at", { ascending: true });

    if (error) { console.error("Fetch items error:", error); return; }

    const mapped = (data || []).map((d: any) => ({
      ...d,
      test_name: d.lab_test_master?.test_name || "",
      test_code: d.lab_test_master?.test_code || null,
      category: d.lab_test_master?.category || "other",
      unit: d.lab_test_master?.unit || d.result_unit,
      normal_min: d.lab_test_master?.normal_min,
      normal_max: d.lab_test_master?.normal_max,
      critical_low: d.lab_test_master?.critical_low,
      critical_high: d.lab_test_master?.critical_high,
      tat_minutes: d.lab_test_master?.tat_minutes,
      sample_type: d.lab_test_master?.sample_type || "blood",
    }));

    // Sort by category then test_name
    mapped.sort((a: TestItem, b: TestItem) => a.category.localeCompare(b.category) || a.test_name.localeCompare(b.test_name));
    setItems(mapped);

    // Init local values
    const vals: Record<string, string> = {};
    mapped.forEach((m: TestItem) => { if (m.result_value) vals[m.id] = m.result_value; });
    setLocalValues(vals);
  }, [order.id]);

  // Fetch samples
  const fetchSamples = useCallback(async () => {
    const { data } = await supabase
      .from("lab_samples")
      .select("*")
      .eq("lab_order_id", order.id);
    setSamples(data || []);
  }, [order.id]);

  // Fetch history — lazy, only when History tab is first opened.
  // Uses two targeted indexed queries instead of the old hospital-wide scan + nested await waterfall.
  const fetchHistory = useCallback(async () => {
    if (!order.patient_id) return;

    // Step 1: get this patient's previous completed order IDs (fast indexed lookup)
    const { data: patientOrders } = await supabase
      .from("lab_orders")
      .select("id, order_date")
      .eq("patient_id", order.patient_id)
      .neq("id", order.id)
      .in("status", ["completed"])
      .order("order_date", { ascending: false })
      .limit(20);

    if (!patientOrders || patientOrders.length === 0) { setHistory([]); return; }

    // Step 2: fetch items only for those order IDs (targeted, no hospital-wide scan)
    const orderIds = patientOrders.map((o: any) => o.id);
    const { data } = await supabase
      .from("lab_order_items")
      .select(`
        result_numeric, result_flag, result_value, result_unit,
        lab_order_id,
        lab_test_master!lab_order_items_test_id_fkey (test_name, test_code),
        lab_orders!lab_order_items_lab_order_id_fkey (order_date)
      `)
      .in("lab_order_id", orderIds)
      .in("status", ["validated", "reported"])
      .not("result_value", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);

    setHistory(data || []);
  }, [order.id, order.patient_id]);

  // Only load items + samples on mount; history is lazy-loaded on tab open
  useEffect(() => {
    fetchItems();
    fetchSamples();
  }, [fetchItems, fetchSamples]);

  // Check dual-validation config once items + hospitalId are loaded
  useEffect(() => {
    if (!labHospitalId || items.length === 0) return;
    const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
    (async () => {
      const { data } = await (supabase as any)
        .from("lab_dual_validation_config")
        .select("requires_dual_validation")
        .eq("hospital_id", labHospitalId)
        .in("test_category", categories);
      setRequiresDualValidation(data?.some((c: any) => c.requires_dual_validation) ?? false);
    })();
  }, [labHospitalId, items]);

  // TAT calculation — freeze at validated_at when the order is completed
  const isCompleted = order.status === "completed";
  const completedAt = isCompleted
    ? items.reduce<string | null>((latest, i) => {
        if (!i.validated_at) return latest;
        return !latest || i.validated_at > latest ? i.validated_at : latest;
      }, null)
    : null;
  const tatEndMs = completedAt ? new Date(completedAt).getTime() : Date.now();
  const elapsed = (tatEndMs - new Date(order.order_time).getTime()) / 60000;
  const avgTat = items.length > 0
    ? items.reduce((s, i) => s + (i.tat_minutes || 60), 0) / items.length
    : 60;
  const tatRatio = elapsed / avgTat;
  const tatLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)}h ${Math.floor(elapsed % 60)}m` : `${Math.floor(elapsed)}m`;
  const tatBg = isCompleted
    ? "bg-emerald-50 text-emerald-800"
    : tatRatio > 1 ? "bg-red-50 text-red-800"
    : tatRatio > 0.75 ? "bg-amber-50 text-amber-800"
    : "bg-emerald-50 text-emerald-800";

  const patient = order.patients;

  // Save a single result
  const saveResult = async (item: TestItem, rawValue: string) => {
    if (!currentUserId) return;
    const isNumeric = item.normal_min != null || item.normal_max != null;
    const numVal = isNumeric ? parseFloat(rawValue) : null;
    const flag = isNumeric && numVal != null && !isNaN(numVal) ? calcFlag(numVal, item) : (rawValue && !isNumeric ? "A" : null);
    // For text results: Negative/Not detected = normal
    if (!isNumeric && rawValue) {
      const lower = rawValue.toLowerCase();
      if (lower === "negative" || lower === "not detected") {
        // Keep flag null (normal text)
      }
    }
    const finalFlag = isNumeric && numVal != null && !isNaN(numVal) ? calcFlag(numVal, item)
      : (!isNumeric && rawValue && ["positive", "detected"].includes(rawValue.toLowerCase())) ? "A"
      : null;

    const { error } = await supabase
      .from("lab_order_items")
      .update({
        result_value: rawValue || null,
        result_numeric: numVal != null && !isNaN(numVal) ? numVal : null,
        result_flag: finalFlag,
        result_unit: item.unit,
        reference_range: item.normal_min != null && item.normal_max != null
          ? `${item.normal_min}–${item.normal_max} ${item.unit || ""}`
          : item.normal_max != null ? `< ${item.normal_max} ${item.unit || ""}` : null,
        result_entered_at: new Date().toISOString(),
        result_entered_by: currentUserId,
        status: "result_entered",
      })
      .eq("id", item.id);

    if (error) { console.error("Save result error:", error); return; }

    // QC advisory (Phase 2): if the latest QC run for this test violates a Westgard
    // rule, surface a non-blocking warning. Never blocks or delays saving — the result
    // is already persisted above; this is fire-and-forget.
    if (labHospitalId && item.test_name && !qcWarnedTests.current.has(item.test_name)) {
      qcWarnedTests.current.add(item.test_name);
      getLatestQcWarnings(labHospitalId, item.test_name).then((warnings) => {
        const worst = warnings.find(w => w.severity === "reject") || warnings[0];
        if (worst) {
          toast({
            title: `⚠️ QC ${worst.severity === "reject" ? "failure" : "warning"} on ${item.test_name} (${worst.rule})`,
            description: `${worst.message}. Verify the run before releasing this result.`,
          });
        }
      }).catch(() => {});
    }

    // Critical alert
    if (finalFlag === "CH" || finalFlag === "CL") {
      const { data: orderData } = await supabase.from("lab_orders").select("hospital_id").eq("id", order.id).maybeSingle();
      if (orderData) {
        await supabase.from("clinical_alerts").insert({
          hospital_id: orderData.hospital_id,
          alert_type: "critical_lab_value",
          severity: "critical",
          alert_message: `Critical ${item.test_name}: ${rawValue} ${item.unit || ""} — Patient: ${patient?.full_name} (${patient?.uhid})`,
          patient_id: order.patient_id,
          lab_order_item_id: item.id,
        });
        toast({
          title: `🚨 Critical: ${item.test_name} = ${rawValue}`,
          description: `Patient: ${patient?.full_name}`,
          variant: "destructive",
        });
      }
    }

    fetchItems();
    onRefresh();
  };

  const handleAcknowledgeCritical = async (itemId: string) => {
    if (!currentUserId) return;
    await supabase.from("lab_order_items").update({
      critical_acknowledged: true,
      critical_acknowledged_by: currentUserId,
      critical_acknowledged_at: new Date().toISOString(),
    }).eq("id", itemId);

    // Also update clinical_alerts
    await supabase.from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: currentUserId,
      acknowledged_at: new Date().toISOString(),
    }).eq("lab_order_item_id", itemId);

    fetchItems();
    toast({ title: "✓ Critical value acknowledged" });
  };

  const handleMarkCollected = async () => {
    if (!currentUserId) return;
    const p = order.patients;
    // Prefer the order's accession number (Phase 3) so printed labels carry the same
    // identifier the analyzer echoes back; legacy orders keep the LAB-<uhid>-<id> format.
    const { data: accRow } = await (supabase as any)
      .from("lab_orders").select("accession_number").eq("id", order.id).maybeSingle();
    const newBarcode = accRow?.accession_number
      || `LAB-${(p?.uhid || "NOID").replace(/\s/g, "")}-${order.id.slice(0, 8).toUpperCase()}`;

    await supabase.from("lab_order_items").update({
      status: "sample_collected",
      sample_collected_at: new Date().toISOString(),
      sample_collected_by: currentUserId,
    }).eq("lab_order_id", order.id).in("status", ["ordered"]);

    await supabase.from("lab_orders").update({
      status: "sample_collected",
      barcode: newBarcode,
      sample_collected_at: new Date().toISOString(),
    } as any).eq("id", order.id);
    setOrderBarcode(newBarcode);
    await supabase.from("lab_samples").update({
      status: "collected",
      collected_at: new Date().toISOString(),
      collected_by: currentUserId,
    }).eq("lab_order_id", order.id).eq("status", "pending");

    fetchItems(); fetchSamples(); onRefresh();
    toast({ title: "📦 Sample collected" });
  };

  const handleMarkReceived = async () => {
    if (!currentUserId) return;
    await supabase.from("lab_samples").update({
      status: "received",
      received_at: new Date().toISOString(),
      received_by: currentUserId,
    }).eq("lab_order_id", order.id).eq("status", "collected");
    fetchSamples(); onRefresh();
    toast({ title: "📥 Sample received at lab" });
  };

  const handleMarkProcessing = async () => {
    if (!currentUserId) return;
    await supabase.from("lab_samples").update({
      status: "processing",
    }).eq("lab_order_id", order.id).eq("status", "received");

    await supabase.from("lab_order_items").update({
      status: "in_process",
    }).eq("lab_order_id", order.id).in("status", ["ordered", "sample_collected"]);

    await supabase.from("lab_orders").update({ status: "in_process" }).eq("id", order.id);
    fetchItems(); fetchSamples(); onRefresh();
    toast({ title: "🔬 Sample processing started" });
  };

  const handleSubmitForValidation = async () => {
    if (!currentUserId || validating) return;
    setValidating(true);
    const unacknowledged = items.filter(i => (i.result_flag === "CH" || i.result_flag === "CL") && !i.critical_acknowledged);
    if (unacknowledged.length > 0) {
      toast({ title: "Acknowledge all critical values before submitting", variant: "destructive" });
      setValidating(false);
      return;
    }
    await supabase.from("lab_orders").update({ status: "pending_validation" } as any).eq("id", order.id);
    setValidating(false);
    onRefresh();
    toast({ title: "⏳ Submitted for pathologist sign-off" });
  };

  // Shared post-release tail: OPD auto-billing + WhatsApp "result ready".
  // Used by both release paths (single-step handleValidateAll and the dual-validation
  // handlePathologistValidate) so pathologist sign-off no longer skips billing/notification.
  const finalizeReleasedOrder = async () => {
    // Auto-bill OPD lab charges (skip IPD — handled by discharge auto-pull)
    const { data: fullOrder } = await supabase.from("lab_orders")
      .select("hospital_id, admission_id, encounter_id, patient_id, ordered_by")
      .eq("id", order.id).maybeSingle();

    if (fullOrder && !fullOrder.admission_id) {
      try {
        const { autoBillOpdInvestigation, getInvestigationRate } = await import("@/lib/investigationBilling");
        const lineItems: { description: string; itemType: "lab_test"; unitRate: number; gstPercent: number; gstAmount: number }[] = [];

        for (const item of items) {
          if (!item.test_name) continue;
          const { rate, gstPercent } = await getInvestigationRate(fullOrder.hospital_id, item.test_name, "lab");
          const gstAmount = rate * gstPercent / 100;
          lineItems.push({
            description: item.test_name,
            itemType: "lab_test",
            unitRate: rate,
            gstPercent,
            gstAmount,
          });
        }

        const result = await autoBillOpdInvestigation({
          hospitalId: fullOrder.hospital_id,
          patientId: fullOrder.patient_id,
          encounterId: fullOrder.encounter_id,
          admissionId: null,
          orderedBy: fullOrder.ordered_by,
          lineItems,
          billPrefix: "LAB",
          sourceModule: "lab",
          sourceId: order.id,
        });

        if (result) {
          toast({ title: `Lab charges billed: ₹${result.total.toLocaleString("en-IN")}` });
        }
      } catch (e) {
        console.error("Lab auto-billing error (non-blocking):", e);
      }
    }

    // Trigger WhatsApp notification
    if (patient?.phone && fullOrder) {
      try {
        const { data: hospital } = await supabase.from("hospitals").select("name").eq("id", fullOrder.hospital_id).maybeSingle();
        const abnormalCount = items.filter(i => i.result_flag && !["N", null].includes(i.result_flag)).length;
        const result = await sendLabResultReady({
          hospitalId: fullOrder.hospital_id,
          hospitalName: hospital?.name || "Hospital",
          patientId: order.patient_id,
          patientName: patient.full_name,
          phone: patient.phone,
          testCount: items.length,
          abnormalCount,
          orderDate: order.order_date,
        });
        showWaNotif(patient.full_name, "lab_result_ready", result.waUrl);
      } catch (e) {
        console.error("Lab WhatsApp notification error (non-blocking):", e);
      }
    }
  };

  const handlePathologistValidate = async () => {
    if (!currentUserId || validating) return;
    setValidating(true);
    const now = new Date().toISOString();
    await supabase.from("lab_order_items").update({
      status: "reported",
      validated_at: now,
      validated_by: currentUserId,
    }).eq("lab_order_id", order.id).neq("status", "cancelled");

    await supabase.from("lab_orders").update({
      status: "completed",
      validated_by: currentUserId,
      validated_at: now,
      validation_notes: validationNotes || null,
    } as any).eq("id", order.id);

    // Fire-and-forget ABHA care context linking (non-blocking)
    if (labHospitalId && order.patient_id) {
      supabase.functions.invoke("abdm-auto-link-care-context", {
        body: {
          hospital_id: labHospitalId,
          patient_id: order.patient_id,
          event_type: "lab_reported",
          source_id: order.id,
        },
      }).catch(() => {});
    }

    await finalizeReleasedOrder();

    setValidating(false);
    setAutoRunAnomaly(true);
    fetchItems();
    onRefresh();
    toast({ title: "✓ Report validated & signed by pathologist" });
  };

  const printBarcodeLabel = async () => {
    if (!orderBarcode) return;
    const p = order.patients;
    const testNames = items.map(i => i.test_name).join(", ");
    const dateStr = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const html = `<!DOCTYPE html>
<html><head><title>Barcode Label</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;width:50mm}
  .label{width:50mm;min-height:25mm;padding:2mm;display:flex;flex-direction:column;align-items:center;border:.5px solid #000}
  svg{width:46mm;height:14mm}
  p{font-size:7px;text-align:center;line-height:1.3}
  .name{font-size:9px;font-weight:bold}
  @media print{@page{size:50mm 25mm;margin:0}body{width:50mm}}
</style></head>
<body>
<div class="label">
  <svg id="bc"></svg>
  <p class="name">${p?.full_name || "Patient"}</p>
  <p>${p?.uhid || ""} | ${dateStr}</p>
  <p style="max-width:46mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${testNames}</p>
</div>
<script>
  JsBarcode("#bc","${orderBarcode}",{format:"CODE128",width:1.5,height:40,displayValue:true,fontSize:8,margin:2});
  setTimeout(()=>{window.print();window.close();},400);
<\/script>
</body></html>`;
    const win = window.open("", "_blank", "width=320,height=270,toolbar=0,menubar=0");
    if (win) {
      win.document.write(html);
      win.document.close();
      if (currentUserId) {
        await supabase.from("lab_orders").update({
          barcode_printed_at: new Date().toISOString(),
          barcode_printed_by: currentUserId,
        } as any).eq("id", order.id);
      }
    }
  };

  const handleValidateAll = async () => {
    if (!currentUserId || validating) return;
    setValidating(true);
    const unacknowledgedCritical = items.filter(i => (i.result_flag === "CH" || i.result_flag === "CL") && !i.critical_acknowledged);
    if (unacknowledgedCritical.length > 0) {
      toast({ title: "Acknowledge critical values before releasing", variant: "destructive" });
      setValidating(false); // was missing — the early return left the button locked
      return;
    }

    await supabase.from("lab_order_items").update({
      status: "reported",
      validated_at: new Date().toISOString(),
      validated_by: currentUserId,
    }).eq("lab_order_id", order.id).neq("status", "cancelled");

    await supabase.from("lab_orders").update({ status: "completed" }).eq("id", order.id);

    await finalizeReleasedOrder();

    setValidating(false);
    setAutoRunAnomaly(true); // auto-trigger AI anomaly analysis after validation
    fetchItems(); onRefresh();
    toast({ title: "✓ Report released" });
  };

  const allResultsEntered = items.length > 0 && items.every(i => i.result_value || localValues[i.id]);
  const hasUnacknowledgedCritical = items.some(i => (i.result_flag === "CH" || i.result_flag === "CL") && !i.critical_acknowledged);

  // Microbiology / culture detection
  const hasMicrobiology = items.some(i =>
    i.category?.toLowerCase().includes("micro") ||
    i.test_name?.toLowerCase().includes("culture") ||
    i.test_name?.toLowerCase().includes("sensitivity")
  );

  const saveAntibiogram = async () => {
    const microItem = items.find(i =>
      i.category?.toLowerCase().includes("micro") ||
      i.test_name?.toLowerCase().includes("culture")
    );
    if (!microItem) return;
    setAntibiogramSaving(true);
    const sensitivityJson = antibiogramSensitivity;
    await (supabase as any).from("lab_order_items").update({
      notes: JSON.stringify({
        organism: antibiogramOrganism,
        colony_count: antibiogramColonyCount,
        specimen_type: antibiogramSpecimen,
        sensitivity: sensitivityJson,
      }),
    }).eq("id", microItem.id);
    toast({ title: "Antibiogram saved" });
    setAntibiogramSaving(false);
    fetchItems();
  };

  // Group items by category
  const grouped = items.reduce<Record<string, TestItem[]>>((acc, item) => {
    const cat = item.category.toUpperCase();
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  // History grouped by test
  const historyByTest = history.reduce<Record<string, any[]>>((acc, h) => {
    const name = h.lab_test_master?.test_name || "Unknown";
    if (!acc[name]) acc[name] = [];
    acc[name].push(h);
    return acc;
  }, {});

  return (
    <>
    {waCard}
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
      {/* Order Header */}
      <div className="h-[68px] shrink-0 bg-card border-b border-border px-5 flex items-center gap-4">
        {/* Patient info */}
        <div className="flex items-center gap-3 min-w-0">
          {patient && (
            <>
              <div className="w-9 h-9 rounded-full bg-[hsl(var(--sidebar-background))] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {getInitials(patient.full_name)}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground truncate">{patient.full_name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{patient.uhid}</span>
                  <span className="text-[11px] text-muted-foreground">{getAge(patient.dob)} {patient.gender === "male" ? "M" : patient.gender === "female" ? "F" : ""}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Order info */}
        <div className="text-center min-w-0">
          <p className="text-xs text-muted-foreground font-mono">LAB-{order.id.slice(0, 8).toUpperCase()}</p>
          <div className="flex items-center gap-2 justify-center">
            {order.priority !== "routine" && (
              <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                order.priority === "stat" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700"
              )}>
                {order.priority === "stat" ? "🔴 STAT" : "🟡 URGENT"}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              Dr. {(order.ordered_by_user as any)?.full_name || "Unknown"}
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* TAT display — frozen after release */}
        <div className={cn("rounded-lg px-3.5 py-2 shrink-0", tatBg, !isCompleted && tatRatio > 1 && "ring-1 ring-red-300 animate-pulse")}>
          {isCompleted ? (
            <>
              <p className="text-sm font-bold flex items-center gap-1"><CheckCircle2 size={13} /> Released</p>
              <p className="text-[10px] opacity-70">TAT: {tatLabel}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold flex items-center gap-1"><Clock size={13} /> {tatLabel}</p>
              <p className="text-[10px] opacity-70">Target: {Math.round(avgTat)}m</p>
            </>
          )}
        </div>

        {/* Status action */}
        {order.status === "ordered" && (
          <button onClick={handleMarkCollected}
            className="shrink-0 px-3.5 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 active:scale-[0.97] transition-all">
            📦 Mark Collected
          </button>
        )}
        {/* Dual-validation: technician submits for sign-off */}
        {allResultsEntered && requiresDualValidation && role !== "doctor" && role !== "pathologist" && role !== "radiologist" && order.status !== "completed" && order.status !== "pending_validation" && (
          <button onClick={handleSubmitForValidation}
            disabled={hasUnacknowledgedCritical || validating}
            className="shrink-0 px-3.5 py-1.5 rounded-lg bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {validating ? "⏳ Submitting..." : "⏳ Submit for Validation"}
          </button>
        )}
        {/* Dual-validation: pathologist/doctor sees Validate & Sign */}
        {requiresDualValidation && (role === "doctor" || role === "pathologist" || role === "radiologist") && order.status === "pending_validation" && (
          <button onClick={handlePathologistValidate}
            disabled={validating}
            className="shrink-0 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {validating ? "⏳ Signing..." : "✓ Validate & Sign"}
          </button>
        )}
        {/* Standard single-step validation */}
        {allResultsEntered && !requiresDualValidation && order.status !== "completed" && order.status !== "pending_validation" && (
          <button onClick={handleValidateAll}
            disabled={hasUnacknowledgedCritical || validating}
            className="shrink-0 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title={hasUnacknowledgedCritical ? "Acknowledge critical values first" : ""}>
            {validating ? "⏳ Validating..." : "✓ Validate & Release"}
          </button>
        )}
      </div>

      {/* Tabs — History is lazy-loaded on first open */}
      <Tabs defaultValue="results" className="flex-1 flex flex-col overflow-hidden"
        onValueChange={(v) => { if (v === "history") fetchHistory(); }}
      >
        <TabsList className="shrink-0 bg-card border-b border-border rounded-none h-11 w-full justify-start px-5 gap-0">
          {[
            { v: "results", l: "Results" },
            { v: "sample", l: "Sample" },
            { v: "history", l: "History" },
            { v: "notes", l: "Notes" },
          ]
            .filter((t) => hasTabAccess("lab", t.v, permissions, role))
            .map((t) => (
              <TabsTrigger key={t.v} value={t.v} className="rounded-none border-b-2 border-transparent data-[state=active]:border-b-[hsl(var(--sidebar-background))] data-[state=active]:text-[hsl(var(--sidebar-background))] data-[state=active]:shadow-none text-[13px] px-6">
                {t.l}
              </TabsTrigger>
            ))}
        </TabsList>

        {/* TAB 1: Results */}
        <TabsContent value="results" className="flex-1 overflow-auto m-0 mt-0">
          <div className="min-w-[600px]">
            {/* Header row */}
            <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur border-b border-border grid grid-cols-[160px_150px_70px_130px_70px_90px_50px] gap-0 px-4 py-2 text-[11px] font-bold uppercase text-muted-foreground tracking-wide">
              <span>Test Name</span>
              <span>Result</span>
              <span>Unit</span>
              <span>Ref. Range</span>
              <span className="text-center">Flag</span>
              <span>Status</span>
              <span></span>
            </div>

            {Object.entries(grouped).map(([category, catItems]) => (
              <React.Fragment key={category}>
                <div className="bg-muted/60 px-4 py-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wide border-b border-border">
                  {category.replace(/_/g, " ")}
                </div>
                {catItems.map(item => {
                  const fs = item.result_flag ? FLAG_STYLES[item.result_flag] : null;
                  const sp = STATUS_PILLS[item.status] || STATUS_PILLS.ordered;
                  const isNumeric = item.normal_min != null || item.normal_max != null;
                  const isCritical = item.result_flag === "CH" || item.result_flag === "CL";
                  const isValidated = item.status === "validated" || item.status === "reported";

                  return (
                    <React.Fragment key={item.id}>
                      <div className={cn(
                        "grid grid-cols-[160px_150px_70px_130px_70px_90px_50px] gap-0 px-4 items-center h-12 border-b border-border/50 transition-colors",
                        fs?.bg || "bg-card",
                        fs?.border
                      )}>
                        {/* Test Name */}
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">{item.test_name}</p>
                          {item.test_code && <p className="text-[10px] text-muted-foreground">{item.test_code}</p>}
                        </div>

                        {/* Result Input */}
                        <div>
                          {isValidated ? (
                            <span className="text-sm font-semibold text-foreground">{item.result_value || "—"}</span>
                          ) : isNumeric ? (
                            <input
                              type="number"
                              step="any"
                              value={localValues[item.id] || ""}
                              onChange={e => setLocalValues(p => ({ ...p, [item.id]: e.target.value }))}
                              onBlur={e => { if (e.target.value) saveResult(item, e.target.value); }}
                              className="w-[100px] h-9 border border-border rounded-md px-2.5 text-sm font-semibold text-center bg-card focus:ring-2 focus:ring-ring focus:border-transparent outline-none tabular-nums"
                              placeholder="—"
                            />
                          ) : (
                            <select
                              value={localValues[item.id] || ""}
                              onChange={e => {
                                setLocalValues(p => ({ ...p, [item.id]: e.target.value }));
                                if (e.target.value) saveResult(item, e.target.value);
                              }}
                              className="w-[120px] h-9 border border-border rounded-md px-2 text-sm bg-card focus:ring-2 focus:ring-ring outline-none"
                            >
                              <option value="">Select...</option>
                              <option value="Positive">Positive</option>
                              <option value="Negative">Negative</option>
                              <option value="Detected">Detected</option>
                              <option value="Not detected">Not detected</option>
                              <option value="Equivocal">Equivocal</option>
                            </select>
                          )}
                        </div>

                        {/* Unit */}
                        <span className="text-xs text-muted-foreground">{item.unit || "—"}</span>

                        {/* Ref Range */}
                        <span className="text-xs text-muted-foreground">
                          {item.normal_min != null && item.normal_max != null
                            ? `${item.normal_min} – ${item.normal_max}`
                            : item.normal_max != null ? `< ${item.normal_max}` : "—"}
                        </span>

                        {/* Flag */}
                        <div className="flex justify-center">
                          {fs && fs.label && (
                            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded", fs.bg, fs.text,
                              isCritical && "animate-pulse"
                            )}>
                              {fs.label}
                            </span>
                          )}
                        </div>

                        {/* Status */}
                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full text-center", sp.bg, sp.text)}>
                          {sp.label}
                        </span>

                        {/* Actions */}
                        <div className="flex justify-center">
                          {isValidated ? (
                            <span className="text-muted-foreground/50"><CheckCircle2 size={14} /></span>
                          ) : item.result_value ? (
                            <button className="text-muted-foreground hover:text-foreground"><Pencil size={13} /></button>
                          ) : null}
                        </div>
                      </div>

                      {/* Critical banner */}
                      {isCritical && !item.critical_acknowledged && (
                        <div className="mx-4 my-1 bg-red-50 border-2 border-red-300 rounded-lg px-4 py-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={18} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-destructive uppercase tracking-wide">
                                🚨 Critical Value — Notify Treating Doctor Immediately
                              </p>
                              <p className="text-sm font-semibold text-foreground mt-0.5">
                                {item.test_name}: <span className="text-destructive">{item.result_value} {item.unit || ""}</span>
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Normal range: {item.normal_min != null && item.normal_max != null ? `${item.normal_min} – ${item.normal_max}` : "—"}
                                {item.critical_low != null ? ` | Critical low: ${item.critical_low}` : ""}
                                {item.critical_high != null ? ` | Critical high: ${item.critical_high}` : ""}
                              </p>
                              <label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-gray-400 accent-red-600"
                                  checked={doctorNotifyConfirmed[item.id] || false}
                                  onChange={e => setDoctorNotifyConfirmed(prev => ({ ...prev, [item.id]: e.target.checked }))}
                                />
                                <span className="text-xs font-semibold text-foreground">
                                  I have notified the treating doctor about this critical value
                                </span>
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={() => handleAcknowledgeCritical(item.id)}
                              disabled={!doctorNotifyConfirmed[item.id]}
                              className="px-3 py-1.5 rounded-md bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              ✓ Acknowledge & Continue
                            </button>
                          </div>
                        </div>
                      )}
                      {isCritical && item.critical_acknowledged && (
                        <div className="mx-4 my-1 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-xs text-emerald-700 font-medium">
                          ✓ Critical acknowledged
                        </div>
                      )}
                      {/* Trend analysis for validated numeric results */}
                      {isValidated && isNumeric && item.result_numeric != null && labHospitalId && (
                        <div className="mx-4 my-1">
                          <LabTrendPanel
                            testName={item.test_name}
                            currentResult={item.result_numeric}
                            unit={item.unit}
                            normalMin={item.normal_min}
                            normalMax={item.normal_max}
                            patientId={order.patient_id}
                            hospitalId={labHospitalId}
                          />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          {/* Antibiogram section — shown for microbiology / culture orders */}
          {hasMicrobiology && (
            <div className="mx-4 mb-3 border border-blue-200 rounded-lg p-4 bg-blue-50/30 space-y-3">
              <p className="text-xs font-bold text-blue-800 uppercase tracking-wide">🔬 Microbiology / Antibiogram</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground font-medium block mb-1">Specimen Type</label>
                  <select value={antibiogramSpecimen} onChange={e => setAntibiogramSpecimen(e.target.value)}
                    className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background">
                    {["urine","blood","sputum","wound","csf","pus","stool","throat_swab","other"].map(s => (
                      <option key={s} value={s}>{s.replace(/_/g," ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground font-medium block mb-1">Organism Identified</label>
                  <input value={antibiogramOrganism} onChange={e => setAntibiogramOrganism(e.target.value)}
                    placeholder="e.g. E. coli, MRSA" className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground font-medium block mb-1">Colony Count</label>
                  <input value={antibiogramColonyCount} onChange={e => setAntibiogramColonyCount(e.target.value)}
                    placeholder="e.g. >10⁵ CFU/mL" className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground font-medium block mb-2">Sensitivity (S=Sensitive · I=Intermediate · R=Resistant)</label>
                <div className="grid grid-cols-4 gap-1">
                  {["Amoxicillin","Ampicillin","Ciprofloxacin","Levofloxacin","Cotrimoxazole","Nitrofurantoin","Gentamicin","Amikacin","Ceftriaxone","Cefuroxime","Piperacillin-Taz","Meropenem","Imipenem","Azithromycin","Doxycycline","Clindamycin"].map(drug => (
                    <div key={drug} className="flex items-center gap-1 bg-background border border-border rounded px-2 py-1">
                      <span className="text-[10px] text-muted-foreground flex-1 truncate" title={drug}>{drug}</span>
                      <select value={antibiogramSensitivity[drug] || ""}
                        onChange={e => setAntibiogramSensitivity(p => ({ ...p, [drug]: e.target.value as "S"|"I"|"R" }))}
                        className={cn("h-6 w-10 text-[11px] font-bold border-0 rounded text-center appearance-none cursor-pointer",
                          antibiogramSensitivity[drug] === "S" ? "bg-green-100 text-green-800" :
                          antibiogramSensitivity[drug] === "I" ? "bg-amber-100 text-amber-800" :
                          antibiogramSensitivity[drug] === "R" ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground")}>
                        <option value="">—</option>
                        <option value="S">S</option>
                        <option value="I">I</option>
                        <option value="R">R</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveAntibiogram} disabled={antibiogramSaving || !antibiogramOrganism}
                className="h-8 px-4 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
                {antibiogramSaving ? "Saving…" : "Save Antibiogram"}
              </button>
            </div>
          )}

          {/* AI Anomaly Detection — shown when results are entered */}
          {items.some(i => i.result_value) && labHospitalId && (
            <div className="px-4 pb-3">
              <LabAnomalyDetector
                patientId={order.patient_id}
                hospitalId={labHospitalId}
                orderId={order.id}
                autoRun={autoRunAnomaly}
                currentResults={items.map(i => ({
                  test_name: i.test_name,
                  result_value: i.result_value,
                  result_numeric: i.result_numeric,
                  result_flag: i.result_flag,
                  unit: i.unit || i.result_unit,
                  normal_min: i.normal_min,
                  normal_max: i.normal_max,
                  reference_range: i.reference_range,
                }))}
              />
            </div>
          )}

          {/* Lab Auto-Interpretation — shown after anomaly detector when results are entered */}
          {items.some(i => i.result_value) && labHospitalId && (
            <div className="px-4 pb-4">
              <LabInterpretationPanel
                results={items.map(i => ({
                  test_name: i.test_name,
                  result_value: i.result_value,
                  result_numeric: i.result_numeric,
                  result_flag: i.result_flag,
                  unit: i.unit || i.result_unit,
                  normal_min: i.normal_min,
                  normal_max: i.normal_max,
                  reference_range: i.reference_range,
                }))}
                hospitalId={labHospitalId}
                patientId={order.patient_id}
              />
            </div>
          )}
        </TabsContent>

        {/* TAB 2: Sample */}
        <TabsContent value="sample" className="flex-1 overflow-auto m-0 p-4 space-y-3">
          {samples.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No samples recorded</p>}
          {samples.map(sample => {
            const fullSteps = ["pending", "collected", "received", "processing"];
            const sampleIdx = fullSteps.indexOf(sample.status);
            // Derive higher-level workflow status
            const allEntered = items.length > 0 && items.every(i => i.result_value);
            const allReported = items.length > 0 && items.every(i => i.status === "reported" || i.status === "validated");
            const workflowSteps = [
              { key: "pending", label: "Ordered" },
              { key: "collected", label: "Collected" },
              { key: "received", label: "Received" },
              { key: "processing", label: "Processing" },
              { key: "results", label: "Results Entered" },
              { key: "reported", label: "Reported" },
            ];
            const workflowIdx = allReported ? 5 : allEntered ? 4 : sampleIdx >= 0 ? sampleIdx : 0;

            return (
              <div key={sample.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold bg-muted px-2 py-1 rounded capitalize">{sample.sample_type}</span>
                    {orderBarcode && (
                      <span className="text-xs font-mono bg-muted/50 px-2 py-1 rounded text-muted-foreground">{orderBarcode}</span>
                    )}
                    {orderBarcode && (
                      <button
                        onClick={printBarcodeLabel}
                        className="text-[11px] font-medium px-2.5 py-1 rounded border border-border text-foreground hover:bg-muted transition-colors flex items-center gap-1"
                      >
                        🏷️ Print Barcode Label
                      </button>
                    )}
                  </div>
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full capitalize",
                    allReported ? "bg-emerald-100 text-emerald-700" :
                    allEntered ? "bg-blue-100 text-blue-700" :
                    sample.status === "processing" ? "bg-violet-100 text-violet-700" :
                    sample.status === "received" ? "bg-blue-100 text-blue-700" :
                    sample.status === "collected" ? "bg-amber-100 text-amber-700" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {allReported ? "reported" : allEntered ? "results entered" : sample.status}
                  </span>
                </div>

                {/* Full Workflow Stepper */}
                <div className="flex items-center gap-0.5 mb-2">
                  {workflowSteps.map((step, i) => {
                    const isComplete = i <= workflowIdx;
                    const isCurrent = i === workflowIdx;
                    return (
                      <React.Fragment key={step.key}>
                        {i > 0 && <div className={cn("flex-1 h-0.5 rounded", isComplete ? "bg-emerald-500" : "bg-border")} />}
                        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                          isComplete ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border",
                          isCurrent && !isComplete && "ring-2 ring-blue-300"
                        )}>
                          {isComplete ? "✓" : i + 1}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground px-0">
                  {workflowSteps.map(s => <span key={s.key} className="text-center w-12">{s.label.split(" ")[0]}</span>)}
                </div>

                {sample.collected_at && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Collected: {new Date(sample.collected_at).toLocaleString()}
                  </p>
                )}
                {sample.received_at && (
                  <p className="text-[11px] text-muted-foreground">
                    Received: {new Date(sample.received_at).toLocaleString()}
                  </p>
                )}

                {/* Workflow action buttons */}
                {sample.status === "pending" && (
                  <button onClick={handleMarkCollected}
                    className="w-full mt-3 h-9 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 active:scale-[0.97] transition-all">
                    📦 Mark Sample Collected
                  </button>
                )}
                {sample.status === "collected" && (
                  <button onClick={handleMarkReceived}
                    className="w-full mt-3 h-9 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 active:scale-[0.97] transition-all">
                    📥 Mark Sample Received
                  </button>
                )}
                {sample.status === "received" && (
                  <button onClick={handleMarkProcessing}
                    className="w-full mt-3 h-9 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 active:scale-[0.97] transition-all">
                    🔬 Start Processing
                  </button>
                )}
                {sample.status === "processing" && !allEntered && (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <p className="text-xs font-semibold text-blue-700">🧪 Sample is being processed</p>
                    <p className="text-[11px] text-blue-600 mt-1">Switch to the <strong>Results</strong> tab to enter test results</p>
                  </div>
                )}
                {sample.status === "processing" && allEntered && !allReported && (
                  <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <p className="text-xs font-semibold text-emerald-700">✓ All results entered</p>
                    <p className="text-[11px] text-emerald-600 mt-1">Click <strong>Validate & Release</strong> to finalize the report</p>
                  </div>
                )}
                {allReported && (
                  <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <p className="text-xs font-semibold text-emerald-700">✓ Report released</p>
                    <p className="text-[11px] text-emerald-600 mt-1">Use <strong>Print Report</strong> or <strong>WhatsApp</strong> to deliver results</p>
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* TAB 3: History */}
        <TabsContent value="history" className="flex-1 overflow-auto m-0 p-4 space-y-4">
          {Object.keys(historyByTest).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No previous results found for this patient</p>
          )}
          {Object.entries(historyByTest).map(([testName, results]) => (
            <div key={testName} className="bg-card border border-border rounded-lg p-3">
              <p className="text-xs font-bold text-foreground mb-2">{testName}</p>
              <div className="flex flex-wrap gap-2">
                {results.slice(0, 5).map((r: any, i: number) => {
                  const flagS = r.result_flag ? FLAG_STYLES[r.result_flag] : null;
                  return (
                    <div key={i} className={cn("text-xs px-2.5 py-1 rounded-md border", flagS?.bg || "bg-muted", "border-border")}>
                      <span className={cn("font-semibold", flagS?.text || "text-foreground")}>{r.result_value || r.result_numeric}</span>
                      <span className="text-muted-foreground ml-1">{r.result_unit}</span>
                      <span className="text-muted-foreground ml-1.5 text-[10px]">
                        {(r.lab_orders as any)?.order_date ? new Date((r.lab_orders as any).order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* TAB 4: Notes */}
        <TabsContent value="notes" className="flex-1 m-0 p-4">
          <Textarea
            value={labNotes}
            onChange={e => setLabNotes(e.target.value)}
            onBlur={() => {
              supabase.from("lab_orders").update({ clinical_notes: labNotes }).eq("id", order.id);
            }}
            placeholder="Lab notes, QC comments, instrument used..."
            className="h-full min-h-[200px] resize-none"
          />
        </TabsContent>
      </Tabs>

      {/* Action Bar */}
      <div className="shrink-0 bg-card border-t border-border px-5 py-2 flex items-center gap-2 flex-wrap min-h-[56px]">
        <button onClick={() => {
          const unsaved = items.filter(i => localValues[i.id] && localValues[i.id] !== i.result_value);
          if (unsaved.length === 0) { toast({ title: "All results already saved" }); return; }
          Promise.all(unsaved.map(i => saveResult(i, localValues[i.id]))).then(() => {
            toast({ title: `💾 ${unsaved.length} result(s) saved` });
          });
        }}
          className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
          <Save size={14} /> Save All
        </button>
        {/* Single-step validation */}
        {!requiresDualValidation && (
          <button onClick={handleValidateAll}
            disabled={!allResultsEntered || hasUnacknowledgedCritical || validating}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {validating ? "Validating..." : "Validate & Release"}
          </button>
        )}
        {/* Technician: submit for pathologist */}
        {requiresDualValidation && role !== "doctor" && role !== "pathologist" && role !== "radiologist" && order.status !== "pending_validation" && order.status !== "completed" && (
          <button onClick={handleSubmitForValidation}
            disabled={!allResultsEntered || hasUnacknowledgedCritical || validating}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {validating ? "Submitting..." : "Submit for Validation"}
          </button>
        )}
        {/* Pathologist: add notes + sign */}
        {requiresDualValidation && (role === "doctor" || role === "pathologist" || role === "radiologist") && order.status === "pending_validation" && (
          <>
            <input
              type="text"
              value={validationNotes}
              onChange={e => setValidationNotes(e.target.value)}
              placeholder="Pathologist notes (optional)..."
              className="flex-1 h-9 border border-border rounded-lg px-3 text-xs bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none min-w-[180px]"
            />
            <button onClick={handlePathologistValidate}
              disabled={validating}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
              <CheckCircle2 size={14} /> {validating ? "Signing..." : "Validate & Sign"}
            </button>
          </>
        )}
        <div className="flex-1" />
        <button onClick={() => {
          const p = order.patients;
          const doctorName = (order.ordered_by_user as any)?.full_name || "";

          // Group items by category for a structured report
          const grouped: Record<string, TestItem[]> = {};
          items.forEach(i => {
            const cat = (i.category || "Other").toUpperCase();
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(i);
          });

          const categoryRows = Object.entries(grouped).map(([cat, catItems]) => `
            <tr style="background:#f8fafc">
              <td colspan="4" style="font-weight:700;font-size:11px;text-transform:uppercase;color:#475569;padding:5px 10px;letter-spacing:.05em">${cat}</td>
            </tr>
            ${catItems.map(i => {
              const flagStyle = i.result_flag === "H" || i.result_flag === "CH"
                ? "color:#b45309;font-weight:700"
                : i.result_flag === "L" || i.result_flag === "CL"
                  ? "color:#1d4ed8;font-weight:700"
                  : "";
              const flagLabel = FLAG_STYLES[i.result_flag || ""]?.label || "";
              const ref = i.normal_min != null && i.normal_max != null
                ? `${i.normal_min} – ${i.normal_max}`
                : i.normal_max != null ? `< ${i.normal_max}`
                : i.normal_min != null ? `> ${i.normal_min}` : "—";
              const rowBg = i.result_flag === "CH" || i.result_flag === "CL"
                ? "background:#fff5f5"
                : i.result_flag === "H" || i.result_flag === "L"
                  ? "background:#fffbeb" : "";
              return `<tr style="${rowBg}">
                <td>${i.test_name}${i.test_code ? `<br/><span style="font-size:10px;color:#94a3b8">${i.test_code}</span>` : ""}</td>
                <td style="${flagStyle}">${i.result_value || "—"}${flagLabel ? ` <span style="font-size:11px">${flagLabel}</span>` : ""}</td>
                <td>${i.unit || "—"}</td>
                <td style="color:#6b7280">${ref}</td>
              </tr>`;
            }).join("")}
          `).join("");

          const headerExtras = `
            <div style="font-size:11px;color:#64748b;margin-top:4px">
              Laboratory Investigation Report
              ${nablNumber ? ` &nbsp;|&nbsp; NABL Accreditation No: <strong>${nablNumber}</strong>` : ""}
            </div>`;

          const body = `
            ${printHeader(hospitalName || "Lab Report", undefined, headerExtras)}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px;font-size:12px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
              <div><span style="color:#64748b">Patient:</span> <strong>${p?.full_name || "—"}</strong></div>
              <div><span style="color:#64748b">Order No:</span> LAB-${order.id.slice(0, 8).toUpperCase()}</div>
              <div><span style="color:#64748b">UHID:</span> ${p?.uhid || "—"}</div>
              <div><span style="color:#64748b">Date:</span> ${new Date(order.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
              <div><span style="color:#64748b">Age / Gender:</span> ${getAge(p?.dob || null)}${p?.gender ? ` / ${p.gender}` : ""}</div>
              ${doctorName ? `<div><span style="color:#64748b">Ref. Doctor:</span> Dr. ${doctorName}</div>` : ""}
            </div>
            <table>
              <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Ref. Range</th></tr></thead>
              <tbody>${categoryRows}</tbody>
            </table>
            <div style="margin-top:32px;display:flex;justify-content:flex-end">
              <div style="text-align:center;min-width:140px">
                <div style="border-top:1px solid #334155;padding-top:4px;font-size:11px;color:#475569">Lab Technician / Pathologist</div>
              </div>
            </div>
          `;

          logRecordAccess({ hospitalId: labHospitalId, recordType: "Lab_Report", recordId: order.id, patientId: order.patient_id, action: "print" });
          printDocument(`Lab Report – ${p?.full_name || "Patient"}`, body);
        }}
          className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
          <Printer size={13} /> Print Report
        </button>
        <button
          onClick={() => {
            const p = order.patients;
            if (!p?.phone) { toast({ title: "Patient phone not available", variant: "destructive" }); return; }
            if (order.status !== "completed") { toast({ title: "Validate & release report first", variant: "destructive" }); return; }
            const testLines = items.map(i => {
              const emoji = i.result_flag === "CH" || i.result_flag === "CL" ? "🔴" : i.result_flag === "H" || i.result_flag === "L" ? "🟡" : "✅";
              return `• ${i.test_name}: *${i.result_value} ${i.unit || ""}* ${emoji}`;
            }).join("\n");
            const msg = `🏥 *Lab Report*\n*Patient:* ${p.full_name}\n\n📋 *Results:*\n${testLines}`;
            const phone = p.phone?.replace(/\D/g, "");
            window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
          }}
          className="px-3 py-2 rounded-lg border border-emerald-300 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center gap-1.5">
          <MessageSquare size={13} /> WhatsApp
        </button>
      </div>
    </div>
    </>
  );
};

export default LabResultWorkspace;
