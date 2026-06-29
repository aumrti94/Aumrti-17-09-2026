import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { differenceInDays, differenceInHours, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import { Bot, Hand, Bell, Zap } from "lucide-react";
import SLATimer from "./SLATimer";

// ── Types ──────────────────────────────────────────────────────────────────

type PlanTier = "manual" | "ai_assisted" | "automated";

interface AdmissionRow {
  id: string;
  patient_name: string;
  patient_id: string;
  uhid: string;
  ward_name: string;
  bed_number: string;
  insurance_type: string;
  insurance_id: string | null;
  admitted_at: string;
  doctor_name: string;
  pre_auth_status: string | null;
  pre_auth_approved: number | null;
  intimation_sent_at: string | null;
  intimation_method: string | null;
  is_emergency_admission: boolean;
  valid_until: string | null;
  pre_auth_id: string | null;
  sla_deadline: string | null;
  automation_mode: string;
  tpa_name: string;
  // Utilization
  bill_total: number | null;
  supplementary_pa_id: string | null;
  // TPA contract limits
  room_rent_ceiling:   number | null;
  co_payment_type:     string | null;
  co_payment_value:    number | null;
  copayment_collected: boolean;
}

export interface AdmissionContext {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  insurance_type: string;
  admitted_at?: string;
  estimated_amount?: string;
  notes?: string;
}

interface Props {
  onNavigate?: (nav: string, admissionData?: AdmissionContext) => void;
  onNeedsSupplementary?: (count: number) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function intimationStatus(row: AdmissionRow): string {
  if (row.intimation_sent_at) return "intimated";
  const hrs = differenceInHours(new Date(), new Date(row.admitted_at));
  return hrs > (row.is_emergency_admission ? 24 : 48) ? "late_intimation" : "not_intimated";
}

function preAuthExpiryStatus(row: AdmissionRow): "expiring" | "expired" | null {
  if (row.pre_auth_status !== "approved" || !row.valid_until) return null;
  const expiry = new Date(row.valid_until);
  if (isPast(expiry)) return "expired";
  return differenceInDays(expiry, new Date()) <= 3 ? "expiring" : null;
}

function utilizationPct(row: AdmissionRow): number | null {
  if (!row.bill_total || !row.pre_auth_approved || row.pre_auth_approved <= 0) return null;
  return (row.bill_total / row.pre_auth_approved) * 100;
}

// ── UtilizationBar ─────────────────────────────────────────────────────────

const UtilizationBar: React.FC<{ row: AdmissionRow }> = ({ row }) => {
  const pct = utilizationPct(row);
  if (pct === null) return <span className="text-[10px] text-muted-foreground">—</span>;

  const capped  = Math.min(pct, 100);
  const barColor =
    pct >= 80 ? "bg-red-500"    :
    pct >= 60 ? "bg-amber-500"  : "bg-emerald-500";
  const textColor =
    pct >= 80 ? "text-red-700"  :
    pct >= 60 ? "text-amber-700": "text-emerald-700";

  return (
    <div className="space-y-0.5 min-w-[120px]">
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", barColor)}
          style={{ width: `${capped}%` }}
        />
      </div>
      <p className={cn("text-[10px] font-medium tabular-nums", textColor)}>
        {formatINR(row.bill_total!)} / {formatINR(row.pre_auth_approved!)}
        {" "}
        <span className="font-bold">({Math.round(pct)}%)</span>
      </p>
    </div>
  );
};

// ── IntimateNowPopover ─────────────────────────────────────────────────────

const IntimateNowPopover: React.FC<{ row: AdmissionRow; onDone: () => void }> = ({ row, onDone }) => {
  const [open,           setOpen]           = useState(false);
  const [admType,        setAdmType]        = useState<"emergency" | "planned">(row.is_emergency_admission ? "emergency" : "planned");
  const [method,         setMethod]         = useState("phone");
  const [intimationTime, setIntimationTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [saving,         setSaving]         = useState(false);
  const { toast }      = useToast();
  const { hospitalId } = useHospitalId();

  const confirm = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const sentAt = new Date(intimationTime).toISOString();

    await Promise.all([
      (supabase as any).from("insurance_pre_auth").update({
        intimation_sent_at: sentAt,
        intimation_method: method,
        is_emergency_admission: admType === "emergency",
      }).eq("admission_id", row.id).eq("hospital_id", hospitalId),

      (supabase as any).from("insurance_intimations").update({
        status: "sent", sent_at: sentAt,
      }).eq("admission_id", row.id).eq("hospital_id", hospitalId).in("status", ["pending", "failed"]),
    ]);

    await (supabase as any).from("clinical_alerts").update({
      is_acknowledged: true, acknowledged_at: new Date().toISOString(),
    }).eq("hospital_id", hospitalId)
      .in("alert_type", ["intimation_send_failure", "intimation_deadline_approaching"])
      .eq("is_acknowledged", false);

    toast({ title: "Intimation recorded ✓" });
    setSaving(false);
    setOpen(false);
    onDone();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs h-7 border-amber-400 text-amber-700 hover:bg-amber-50">
          Intimate Now
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 space-y-3" align="end">
        <p className="text-sm font-semibold">Record Intimation</p>
        <div>
          <Label className="text-sm font-medium">Admission Type</Label>
          <div className="flex gap-4 mt-1">
            {(["emergency", "planned"] as const).map(t => (
              <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={admType === t} onChange={() => setAdmType(t)} />
                {t === "emergency" ? "Emergency (24h)" : "Planned (48h)"}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-sm font-medium">Date &amp; Time of Intimation</Label>
          <input
            type="datetime-local"
            className="mt-1 w-full text-sm border border-input rounded-md px-3 py-1.5 bg-background"
            value={intimationTime}
            onChange={e => setIntimationTime(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-sm font-medium">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="phone">Phone Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="portal">TPA Portal</SelectItem>
              <SelectItem value="walk-in">Walk-in</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={confirm} disabled={saving}>
          {saving ? "Saving…" : "Confirm Intimation"}
        </Button>
      </PopoverContent>
    </Popover>
  );
};

// ── Main component ─────────────────────────────────────────────────────────

const ActiveAdmissions: React.FC<Props> = ({ onNavigate, onNeedsSupplementary }) => {
  const [rows,          setRows]          = useState<AdmissionRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [planTier,      setPlanTier]      = useState<PlanTier>("manual");
  const [manualModeRows,setManualModeRows]= useState<Set<string>>(new Set());
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  // Prevent Plan C from auto-submitting the same admission twice per session
  const autoProcessedRef = useRef<Set<string>>(new Set());
  // Only show the full-screen spinner on the very first load; background refreshes
  // keep existing rows visible to avoid the blink-loading loop.
  const isInitialLoadRef = useRef(true);

  const isManual = (row: AdmissionRow) =>
    row.automation_mode === "manual" || manualModeRows.has(row.id);

  // ── Plan tier fetch ──────────────────────────────────────────────────

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("hospital_insurance_settings")
      .select("plan_tier")
      .eq("hospital_id", hospitalId)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.plan_tier) setPlanTier(data.plan_tier as PlanTier);
      });
  }, [hospitalId]);

  // ── Toggle manual / auto ─────────────────────────────────────────────

  const toggleManualMode = async (row: AdmissionRow) => {
    const newMode = isManual(row) ? "auto" : "manual";
    setManualModeRows(prev => {
      const next = new Set(prev);
      newMode === "manual" ? next.add(row.id) : next.delete(row.id);
      return next;
    });
    if (row.pre_auth_id) {
      await (supabase as any).from("insurance_pre_auth")
        .update({ automation_mode: newMode }).eq("id", row.pre_auth_id);
    }
    if (hospitalId) {
      await (supabase as any).from("insurance_automation_log").insert({
        hospital_id: hospitalId, admission_id: row.id, pre_auth_id: row.pre_auth_id,
        event_type: "manual_override", status: "success", triggered_by: "staff",
        notes: `Switched to ${newMode} mode`,
      });
    }
    toast({
      title: newMode === "manual" ? "Manual mode enabled" : "Automation restored",
      description: newMode === "manual"
        ? "All manual action buttons are now visible for this patient."
        : "Automation will handle this patient's workflow again.",
    });
  };

  // ── Data load ────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const initial = isInitialLoadRef.current;
    isInitialLoadRef.current = false;
    if (initial) setLoading(true);
    const { data: admissions } = await supabase
      .from("admissions")
      .select("id, admitted_at, insurance_type, insurance_id, patient_id, ward_id, bed_id, admitting_doctor_id")
      .eq("status", "active")
      .neq("insurance_type", "self_pay");

    if (!admissions?.length) { setRows([]); setLoading(false); return; }

    const patientIds   = [...new Set(admissions.map(a => a.patient_id))];
    const wardIds      = [...new Set(admissions.map(a => a.ward_id))];
    const bedIds       = [...new Set(admissions.map(a => a.bed_id))];
    const doctorIds    = [...new Set(admissions.map(a => a.admitting_doctor_id))];
    const admissionIds = admissions.map(a => a.id);

    const [pRes, wRes, bRes, dRes, paRes] = await Promise.all([
      supabase.from("patients").select("id, full_name, uhid").in("id", patientIds),
      supabase.from("wards").select("id, name").in("id", wardIds),
      supabase.from("beds").select("id, bed_number, status").in("id", bedIds),
      supabase.from("users").select("id, full_name").in("id", doctorIds),
      (supabase as any).from("insurance_pre_auth")
        .select("id, admission_id, status, approved_amount, tpa_name, intimation_sent_at, intimation_method, is_emergency_admission, valid_until, automation_mode, sla_deadline")
        .in("admission_id", admissionIds),
    ]);

    const pMap  = Object.fromEntries((pRes.data  || []).map(p => [p.id, p]));
    const wMap  = Object.fromEntries((wRes.data  || []).map(w => [w.id, w]));
    const bMap  = Object.fromEntries((bRes.data  || []).map(b => [b.id, b]));
    const dMap  = Object.fromEntries((dRes.data  || []).map(d => [d.id, d]));
    const paMap = Object.fromEntries((paRes.data || []).map(pa => [pa.admission_id, pa]));

    // Load TPA config for room rent / co-payment display
    const tpaNames = [...new Set((paRes.data || []).map((pa: any) => pa?.tpa_name).filter(Boolean))];
    let tpaConfigMap: Record<string, any> = {};
    if (tpaNames.length > 0) {
      const { data: tpaConfigs } = await (supabase as any)
        .from("tpa_config")
        .select("tpa_name, room_rent_ceiling, co_payment_type, co_payment_value")
        .in("tpa_name", tpaNames);
      tpaConfigMap = Object.fromEntries((tpaConfigs || []).map((t: any) => [t.tpa_name, t]));
    }

    const activeAdmissions = admissions.filter(a => (bMap[a.bed_id] as any)?.status === "occupied");

    // ── Bill totals for approved pre-auths ─────────────────────────
    const approvedAdmIds = activeAdmissions
      .filter(a => (paMap[a.id] as any)?.status === "approved")
      .map(a => a.id);

    let billTotalMap: Record<string, number> = {};
    if (approvedAdmIds.length > 0) {
      const { data: billData } = await (supabase as any)
        .from("bills")
        .select("admission_id, total_amount")
        .in("admission_id", approvedAdmIds)
        .neq("bill_status", "cancelled");
      for (const b of billData ?? []) {
        billTotalMap[b.admission_id] =
          (billTotalMap[b.admission_id] ?? 0) + Number(b.total_amount ?? 0);
      }
    }

    // ── Supplementary pre-auth existence check ──────────────────────
    const approvedPaIds = activeAdmissions
      .map(a => (paMap[a.id] as any)?.id)
      .filter(Boolean);

    let suppMap: Record<string, string> = {};  // parent_pre_auth_id → supplementary_id
    if (approvedPaIds.length > 0) {
      const { data: suppData } = await (supabase as any)
        .from("insurance_pre_auth")
        .select("id, parent_pre_auth_id")
        .in("parent_pre_auth_id", approvedPaIds)
        .not("status", "in", '("rejected","cancelled")');
      for (const s of suppData ?? []) {
        suppMap[s.parent_pre_auth_id] = s.id;
      }
    }

    const built: AdmissionRow[] = activeAdmissions.map(a => {
      const pa = paMap[a.id] as any;
      return {
        id:                   a.id,
        patient_name:         pMap[a.patient_id]?.full_name || "Unknown",
        patient_id:           a.patient_id,
        uhid:                 pMap[a.patient_id]?.uhid || "",
        ward_name:            wMap[a.ward_id]?.name || "",
        bed_number:           bMap[a.bed_id]?.bed_number || "",
        insurance_type:       a.insurance_type,
        insurance_id:         a.insurance_id,
        admitted_at:          a.admitted_at,
        doctor_name:          dMap[a.admitting_doctor_id]?.full_name || "",
        pre_auth_status:      pa?.status || null,
        pre_auth_approved:    pa?.approved_amount ? Number(pa.approved_amount) : null,
        intimation_sent_at:   pa?.intimation_sent_at || null,
        intimation_method:    pa?.intimation_method || null,
        is_emergency_admission: pa?.is_emergency_admission ?? false,
        valid_until:          pa?.valid_until || null,
        pre_auth_id:          pa?.id || null,
        sla_deadline:         pa?.sla_deadline || null,
        automation_mode:      pa?.automation_mode || "auto",
        tpa_name:             pa?.tpa_name || a.insurance_type,
        bill_total:           billTotalMap[a.id] ?? null,
        supplementary_pa_id:  pa?.id ? (suppMap[pa.id] ?? null) : null,
        room_rent_ceiling:    Number(tpaConfigMap[pa?.tpa_name]?.room_rent_ceiling ?? 0) || null,
        co_payment_type:      tpaConfigMap[pa?.tpa_name]?.co_payment_type ?? null,
        co_payment_value:     Number(tpaConfigMap[pa?.tpa_name]?.co_payment_value ?? 0) || null,
        copayment_collected:  (pa as any)?.copayment_collected ?? false,
      };
    });

    setRows(built);

    // Bubble up supplementary alert count
    const needsCount = built.filter(r => {
      const pct = utilizationPct(r);
      return pct !== null && pct >= 80 && r.pre_auth_status === "approved" && !r.supplementary_pa_id;
    }).length;
    onNeedsSupplementary?.(needsCount);

    setLoading(false);
  }, [onNeedsSupplementary]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Plan C: auto-create supplementary at 80% ─────────────────────

  useEffect(() => {
    if (planTier !== "automated" || !hospitalId || rows.length === 0) return;

    const process = async (row: AdmissionRow) => {
      const pct = utilizationPct(row);
      if (!pct || pct < 80) return;
      if (!row.pre_auth_id || !row.pre_auth_approved || !row.bill_total) return;
      if (row.supplementary_pa_id) return;
      if (autoProcessedRef.current.has(row.id)) return;
      autoProcessedRef.current.add(row.id);

      const gap = Math.ceil(row.bill_total * 1.3 - row.pre_auth_approved);
      if (gap <= 0) return;

      try {
        // 1. Create supplementary pre-auth
        await (supabase as any).from("insurance_pre_auth").insert({
          hospital_id:         hospitalId,
          admission_id:        row.id,
          patient_id:          row.patient_id,
          tpa_name:            row.tpa_name,
          estimated_amount:    gap,
          status:              "pending",
          is_extension:        true,
          parent_pre_auth_id:  row.pre_auth_id,
          supplementary_required: true,
          notes: `Supplementary pre-auth auto-requested. Original approval: ${formatINR(row.pre_auth_approved)}. Current bill: ${formatINR(row.bill_total)}. Estimated additional requirement: ${formatINR(gap)}.`,
          submission_mode:     "automated",
        });

        // 2. Mark supplementary_required on original pre-auth
        await (supabase as any).from("insurance_pre_auth")
          .update({ supplementary_required: true, supplementary_amount: gap })
          .eq("id", row.pre_auth_id);

        // 3. Log automation event
        await (supabase as any).from("insurance_automation_log").insert({
          hospital_id: hospitalId, admission_id: row.id, pre_auth_id: row.pre_auth_id,
          event_type: "supplementary_auto_created", status: "success", triggered_by: "system",
          notes: `Auto-created supplementary for ${row.patient_name} at ${Math.round(pct)}% utilization`,
        });

        // 4. WhatsApp alert to TPA desk (best-effort)
        try {
          const { data: settings } = await (supabase as any)
            .from("hospital_insurance_settings")
            .select("whatsapp_alert_number, sla_alert_channel")
            .eq("hospital_id", hospitalId).maybeSingle();

          if (settings?.sla_alert_channel === "whatsapp" && settings?.whatsapp_alert_number) {
            await (supabase as any).functions.invoke("send-whatsapp-alert", {
              body: {
                to: settings.whatsapp_alert_number,
                message: `🔔 Supplementary pre-auth auto-submitted for ${row.patient_name} (${row.uhid}). Bill ${formatINR(row.bill_total)} vs approved ${formatINR(row.pre_auth_approved)}. Estimated gap: ${formatINR(gap)}. TPA: ${row.tpa_name}.`,
              },
            });
          }
        } catch { /* WhatsApp alert is non-critical */ }

        toast({
          title: `Supplementary pre-auth auto-created`,
          description: `${row.patient_name} — ${formatINR(gap)} submitted to TPA.`,
        });
        loadData();
      } catch (err: any) {
        toast({
          title: "Auto-supplementary failed",
          description: `${row.patient_name}: ${err?.message ?? "Unknown error"}`,
          variant: "destructive",
        });
      }
    };

    rows.forEach(process);
  // Only re-run when the rows array identity changes (i.e., after loadData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, planTier, hospitalId]);

  // ── Request supplementary (manual) ────────────────────────────────

  const requestSupplementary = (row: AdmissionRow) => {
    if (!row.bill_total || !row.pre_auth_approved) return;
    const gap = Math.ceil(row.bill_total * 1.3 - row.pre_auth_approved);
    onNavigate?.("preauth", {
      admission_id:     row.id,
      patient_id:       row.patient_id,
      patient_name:     row.patient_name,
      insurance_type:   row.insurance_type,
      admitted_at:      row.admitted_at,
      estimated_amount: String(Math.max(gap, 0)),
      notes: `Supplementary pre-auth requested. Original approval: ${formatINR(row.pre_auth_approved)}. Current bill: ${formatINR(row.bill_total)}. Estimated additional requirement: ${formatINR(Math.max(gap, 0))}.`,
    });
  };

  // ── Co-payment calculation ────────────────────────────────────────

  const calcCopayment = (row: AdmissionRow, days: number): number | null => {
    if (!row.co_payment_type || row.co_payment_type === "none" || !row.co_payment_value) return null;
    if (row.co_payment_type === "percentage" && row.bill_total)
      return Math.round(row.bill_total * (row.co_payment_value / 100));
    if (row.co_payment_type === "fixed")
      return row.co_payment_value;
    if (row.co_payment_type === "per_day")
      return row.co_payment_value * days;
    return null;
  };

  const markCopaymentCollected = useCallback(async (row: AdmissionRow) => {
    if (!row.pre_auth_id) return;
    await (supabase as any).from("insurance_pre_auth").update({
      copayment_collected: true,
      copayment_collected_at: new Date().toISOString(),
    }).eq("id", row.pre_auth_id);
    toast({ title: "Co-payment marked as collected ✓" });
    loadData();
  }, [loadData, toast]);

  // ── Pre-auth badge ─────────────────────────────────────────────────

  const preAuthBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline" className="text-xs">Not Done</Badge>;
    const map: Record<string, string> = {
      approved:    "bg-emerald-50 text-emerald-700 border-emerald-200",
      pending:     "bg-amber-50 text-amber-700 border-amber-200",
      submitted:   "bg-blue-50 text-blue-700 border-blue-200",
      rejected:    "bg-red-50 text-red-700 border-red-200",
    };
    return <Badge variant="outline" className={cn("text-xs capitalize", map[status] || "")}>{status}</Badge>;
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Loading…
    </div>
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader className="[&_th]:h-8 [&_th]:py-0 [&_th]:px-3">
            <TableRow>
              <TableHead className="text-xs">Patient</TableHead>
              <TableHead className="text-xs">UHID</TableHead>
              <TableHead className="text-xs">Ward / Bed</TableHead>
              <TableHead className="text-xs">Insurance</TableHead>
              <TableHead className="text-xs">Pre-Auth</TableHead>
              <TableHead className="text-xs">Utilization</TableHead>
              <TableHead className="text-xs">Co-Pay / Rent</TableHead>
              <TableHead className="text-xs">Intimation</TableHead>
              <TableHead className="text-xs">Auth Validity</TableHead>
              <TableHead className="text-xs">SLA</TableHead>
              <TableHead className="text-xs">Days</TableHead>
              <TableHead className="text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:py-2 [&_td]:px-3">
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground text-sm py-8">
                  No active insurance admissions
                </TableCell>
              </TableRow>
            ) : rows.map(r => {
              const days       = differenceInDays(new Date(), new Date(r.admitted_at));
              const intStatus  = intimationStatus(r);
              const expiry     = preAuthExpiryStatus(r);
              const pct        = utilizationPct(r);
              const needsSupp  = pct !== null && pct >= 80 && r.pre_auth_status === "approved";
              const suppExists = !!r.supplementary_pa_id;

              return (
                <TableRow
                  key={r.id}
                  className={cn(needsSupp && !suppExists && "bg-red-50/20")}
                >
                  {/* Patient */}
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-1.5">
                      {needsSupp && !suppExists && (
                        <span title="Supplementary Pre-Auth Required">
                          <Bell size={12} className="text-red-500 shrink-0 animate-pulse" />
                        </span>
                      )}
                      {r.patient_name}
                    </div>
                  </TableCell>

                  {/* UHID */}
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-mono">{r.uhid}</Badge>
                  </TableCell>

                  {/* Ward / Bed */}
                  <TableCell className="text-xs text-muted-foreground">
                    {r.ward_name} · Bed {r.bed_number}
                  </TableCell>

                  {/* Insurance */}
                  <TableCell className="text-xs capitalize">
                    {r.insurance_type.replace("_", " ")}
                  </TableCell>

                  {/* Pre-Auth */}
                  <TableCell>{preAuthBadge(r.pre_auth_status)}</TableCell>

                  {/* Utilization */}
                  <TableCell>
                    {r.pre_auth_status === "approved" ? (
                      <UtilizationBar row={r} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Co-Payment / Room Rent */}
                  <TableCell>
                    <div className="space-y-0.5">
                      {(() => {
                        const copayDue = calcCopayment(r, days);
                        const dailyBill = (r.bill_total && days > 0) ? r.bill_total / days : null;
                        const rentBreached = r.room_rent_ceiling && dailyBill && dailyBill > r.room_rent_ceiling;
                        return (
                          <>
                            {copayDue !== null && (
                              r.copayment_collected ? (
                                <span className="text-[10px] text-emerald-700 flex items-center gap-1">
                                  ✓ Co-pay collected
                                </span>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-amber-700 font-medium">
                                    Co-pay due: {formatINR(copayDue)}
                                  </span>
                                  {r.pre_auth_id && (
                                    <button
                                      onClick={() => markCopaymentCollected(r)}
                                      className="block text-[10px] text-blue-600 underline underline-offset-2 hover:text-blue-800"
                                    >
                                      Mark Collected
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                            {rentBreached && (
                              <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200 px-1 py-0">
                                ⚠ Rent {formatINR(Math.round(dailyBill!))}/d &gt; {formatINR(r.room_rent_ceiling!)}/d limit
                              </Badge>
                            )}
                            {!copayDue && !rentBreached && (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>

                  {/* Intimation */}
                  <TableCell>
                    <StatusBadge status={intStatus} />
                  </TableCell>

                  {/* Auth Validity */}
                  <TableCell>
                    {expiry === "expired"  && <StatusBadge status="preauth_expired" />}
                    {expiry === "expiring" && <StatusBadge status="preauth_expiring" />}
                  </TableCell>

                  {/* SLA */}
                  <TableCell>
                    {r.pre_auth_id && (
                      <SLATimer
                        id={r.pre_auth_id}
                        slaDeadline={r.sla_deadline}
                        status={r.pre_auth_status || "pending"}
                        createdAt={r.admitted_at}
                        patientName={r.patient_name}
                        tpaName={r.insurance_type}
                      />
                    )}
                  </TableCell>

                  {/* Days */}
                  <TableCell className={cn(
                    "text-xs font-medium tabular-nums",
                    days > 45 ? "text-destructive" : ""
                  )}>
                    {days}
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    <div className="flex gap-1 items-center flex-nowrap">

                      {/* Manual / Auto toggle */}
                      {r.pre_auth_id && (
                        <button
                          onClick={() => toggleManualMode(r)}
                          title={isManual(r) ? "Manual mode — click to restore automation" : "Auto mode — click to switch to manual"}
                          className={cn(
                            "h-6 w-6 rounded flex items-center justify-center border transition-colors shrink-0",
                            isManual(r)
                              ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100"
                          )}
                        >
                          {isManual(r) ? <Hand size={12} /> : <Bot size={12} />}
                        </button>
                      )}

                      {/* Supplementary Pre-Auth — shown at 80%+ utilization when approved */}
                      {needsSupp && (
                        suppExists ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-50 text-violet-700 border-violet-200 shrink-0">
                            {planTier === "automated" ? <><Zap size={9} className="mr-0.5" />Auto-Submitted</> : "Supp. Pending"}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 border-red-400 text-red-700 hover:bg-red-50 gap-1 shrink-0"
                            onClick={() => requestSupplementary(r)}
                          >
                            <Bell size={10} />
                            Supplementary Pre-Auth
                          </Button>
                        )
                      )}

                      {/* Intimate Now */}
                      {r.pre_auth_status && (!r.intimation_sent_at || isManual(r)) && (
                        <IntimateNowPopover row={r} onDone={loadData} />
                      )}

                      {/* Request Pre-Auth */}
                      {(!r.pre_auth_status || isManual(r)) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => onNavigate?.("preauth", {
                            admission_id: r.id, patient_id: r.patient_id,
                            patient_name: r.patient_name, insurance_type: r.insurance_type,
                          })}
                        >
                          {r.pre_auth_status && isManual(r) ? "Re-Submit Pre-Auth" : "Request Pre-Auth"}
                        </Button>
                      )}

                      {/* Extend Auth */}
                      {r.pre_auth_status === "approved" && expiry && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 border-amber-400 text-amber-700 hover:bg-amber-50"
                          onClick={() => onNavigate?.("preauth", {
                            admission_id: r.id, patient_id: r.patient_id,
                            patient_name: r.patient_name, insurance_type: r.insurance_type,
                          })}
                        >
                          Extend Auth
                        </Button>
                      )}

                      {/* View fallback */}
                      {r.pre_auth_status && !expiry && r.intimation_sent_at && !isManual(r) && !needsSupp && (
                        <Button size="sm" variant="ghost" className="text-xs h-7">View</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ActiveAdmissions;
