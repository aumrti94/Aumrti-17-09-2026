import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, addDays } from "date-fns";
import { Bot, ChevronLeft, ChevronRight, RefreshCw, Send, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatINRExact } from "@/lib/currency";

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

async function getHospitalName(): Promise<string> {
  const hospitalId = await getHospitalId();
  if (!hospitalId) return "Hospital";
  const { data } = await supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
  return data?.name || "Hospital";
}

// Fetch today's live KPIs for the snapshot panel
async function fetchTodayKPIs(hospitalId: string, dateStr: string) {
  const yesterday = format(subDays(new Date(dateStr), 1), "yyyy-MM-dd");
  const [opdRes, revRes, revYestRes, bedsOccRes, bedsTotalRes, pendingRes, labPendRes, alertsRes] = await Promise.all([
    supabase.from("opd_encounters").select("id").eq("hospital_id", hospitalId)
      .gte("created_at", dateStr).lte("created_at", dateStr + "T23:59:59"),
    supabase.from("bills").select("paid_amount").eq("hospital_id", hospitalId)
      .eq("bill_date", dateStr).in("payment_status", ["paid", "partial"]),
    supabase.from("bills").select("paid_amount").eq("hospital_id", hospitalId)
      .eq("bill_date", yesterday).in("payment_status", ["paid", "partial"]),
    supabase.from("beds").select("id").eq("hospital_id", hospitalId).eq("is_active", true).eq("status", "occupied"),
    supabase.from("beds").select("id").eq("hospital_id", hospitalId).eq("is_active", true),
    supabase.from("bills").select("balance_due").eq("hospital_id", hospitalId).in("payment_status", ["unpaid", "partial"]),
    supabase.from("lab_order_items").select("id").eq("hospital_id", hospitalId).in("status", ["ordered", "collected"]),
    supabase.from("clinical_alerts").select("id").eq("hospital_id", hospitalId).eq("is_acknowledged", false),
  ]);

  const sum = (rows: any[] | null, f: string) => (rows || []).reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const opdCount = opdRes.data?.length || 0;
  const opdYest = 0; // Simplified
  const revenue = sum(revRes.data, "paid_amount");
  const revenueYest = sum(revYestRes.data, "paid_amount");
  const occupiedBeds = bedsOccRes.data?.length || 0;
  const totalBeds = bedsTotalRes.data?.length || 0;
  const bedOccPct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  const pending = sum(pendingRes.data, "balance_due");
  const labPending = labPendRes.data?.length || 0;
  const critAlerts = alertsRes.data?.length || 0;

  const revChange = revenueYest > 0 ? Math.round(((revenue - revenueYest) / revenueYest) * 100) : 0;

  return {
    rows: [
      { label: "OPD Patients", today: String(opdCount), vs: opdCount > opdYest ? `+${opdCount - opdYest} ↑` : `${opdCount - opdYest}`, ok: true },
      { label: "Revenue Collected", today: formatINRExact(revenue), vs: `${revChange >= 0 ? "↑" : "↓"} ${Math.abs(revChange)}%`, ok: revChange >= 0 },
      { label: "Bed Occupancy", today: `${bedOccPct}%`, vs: `${occupiedBeds}/${totalBeds}`, ok: bedOccPct >= 60 },
      { label: "Pending Bills", today: formatINRExact(pending), vs: `${pendingRes.data?.length || 0} bills`, ok: pending < 500000 },
      { label: "Lab Pending", today: String(labPending), vs: "tests", ok: labPending < 10 },
      { label: "Critical Alerts", today: String(critAlerts), vs: "unack.", ok: critAlerts === 0 },
    ],
    snapshot: {
      opd_patients: opdCount,
      revenue_today: revenue,
      revenue_yesterday: revenueYest,
      bed_occupancy_pct: bedOccPct,
      pending_bills: pending,
      lab_pending: labPending,
      critical_alerts: critAlerts,
      occupied_beds: occupiedBeds,
      total_beds: totalBeds,
    },
  };
}

// Anomaly detection (compare today vs simple baseline)
function detectAnomalies(snapshot: Record<string, number>) {
  const anomalies: Array<{
    metric: string; type: "spike" | "drop"; value: number; severity: "high" | "medium";
  }> = [];

  if (snapshot.critical_alerts > 3) {
    anomalies.push({ metric: "Critical Alerts", type: "spike", value: snapshot.critical_alerts, severity: "high" });
  }
  if (snapshot.bed_occupancy_pct > 95) {
    anomalies.push({ metric: "Bed Occupancy", type: "spike", value: snapshot.bed_occupancy_pct, severity: "medium" });
  }
  if (snapshot.lab_pending > 20) {
    anomalies.push({ metric: "Lab Backlog", type: "spike", value: snapshot.lab_pending, severity: "medium" });
  }
  return anomalies;
}

const AIDigestTab: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSendingWA, setIsSendingWA] = useState(false);
  const queryClient = useQueryClient();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dateLabel = format(selectedDate, "EEEE, dd MMMM yyyy");

  // Fetch existing digest
  const { data: digest, refetch: refetchDigest } = useQuery({
    queryKey: ["analytics-digest", dateStr],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;
      const { data } = await supabase.from("ai_digests")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("digest_date", dateStr)
        .maybeSingle();
      return data;
    },
  });

  // Fetch today's KPIs
  const { data: kpiData } = useQuery({
    queryKey: ["analytics-digest-kpis", dateStr],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;
      return fetchTodayKPIs(hospitalId, dateStr);
    },
  });

  const anomalies = kpiData ? detectAnomalies(kpiData.snapshot) : [];

  const generateDigest = async () => {
    setIsGenerating(true);
    try {
      const hospitalId = await getHospitalId();
      const hospitalName = await getHospitalName();
      if (!hospitalId) throw new Error("No hospital");

      const kpis = kpiData?.snapshot || {};

      const { data: fnData, error: fnError } = await supabase.functions.invoke("ai-executive-digest", {
        body: {
          hospital_name: hospitalName,
          date: dateStr,
          snapshot: kpis,
          anomalies,
        },
      });

      if (fnError) throw fnError;
      const digestText = fnData?.digest_text;
      if (!digestText) throw new Error("No digest generated");

      await supabase.from("ai_digests").upsert({
        hospital_id: hospitalId,
        digest_date: dateStr,
        digest_text: digestText,
        kpi_snapshot: kpis as any,
        anomalies: anomalies as any,
        generated_at: new Date().toISOString(),
      }, { onConflict: "hospital_id,digest_date" });

      await refetchDigest();
      toast.success("AI Digest generated ✓");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to generate digest");
    } finally {
      setIsGenerating(false);
    }
  };

  const sendWhatsApp = async () => {
    if (!digest?.digest_text) return;
    setIsSendingWA(true);

    try {
      const hospitalId = await getHospitalId();
      if (!hospitalId) throw new Error("Hospital not found");

      // Look up current user's phone for delivery target
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userRow } = await supabase
        .from("users")
        .select("phone")
        .eq("auth_user_id", user?.id ?? "")
        .maybeSingle();

      const message = `🏥 *Daily Digest — ${dateLabel}*\n\n${digest.digest_text.slice(0, 1200)}\n\nFull analytics: ${window.location.origin}/analytics`;

      // Attempt server-side send via Meta Cloud API
      if (userRow?.phone) {
        const { data: result, error } = await supabase.functions.invoke("send-whatsapp-meta", {
          body: { phone: userRow.phone, message, type: "session" },
        });

        if (!error && (result as any)?.success) {
          // Mark as delivered in ai_digests
          await supabase.from("ai_digests" as any).update({ delivered_whatsapp: true })
            .eq("hospital_id", hospitalId)
            .eq("digest_date", dateStr);
          await refetchDigest();
          toast.success("Digest sent via WhatsApp ✓");
          setIsSendingWA(false);
          return;
        }

        // 422 means Meta Cloud API not configured — fall through to wa.me link
        if (error?.message?.includes("422") || (result as any)?.error?.includes("not the active WhatsApp")) {
          toast.info("Meta Cloud API not configured — opening WhatsApp link instead");
        } else if (error || (result as any)?.error) {
          toast.error(`WhatsApp send failed: ${(result as any)?.error || error?.message}`);
          setIsSendingWA(false);
          return;
        }
      }

      // Fallback: open wa.me link (no phone configured or Meta Cloud not set up)
      const text = encodeURIComponent(message);
      window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(err.message || "WhatsApp send failed");
    }

    setIsSendingWA(false);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT — Digest Viewer */}
      <div className="w-[380px] flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            <div>
              <h2 className="text-base font-bold text-foreground">AI Executive Digest</h2>
              <p className="text-[11px] text-muted-foreground">Powered by Lovable AI</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedDate(d => subDays(d, 1))}>
              <ChevronLeft size={14} />
            </Button>
            <span className="text-[13px] font-semibold text-foreground">{dateLabel}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedDate(d => addDays(d, 1))}>
              <ChevronRight size={14} />
            </Button>
          </div>

          {digest ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600">
              <CheckCircle size={12} /> Generated at {digest.generated_at ? format(new Date(digest.generated_at), "h:mm a") : "—"}
            </div>
          ) : (
            <div className="text-[11px] text-amber-600">Not generated for this day</div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {digest?.digest_text ? (
            <div className="space-y-4 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
              {digest.digest_text}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <Bot size={48} className="text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No digest for this day yet</p>
              <Button onClick={generateDigest} disabled={isGenerating} className="gap-2">
                {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                Generate Now
              </Button>
            </div>
          )}
        </div>

        {digest && (
          <div className="p-3 border-t border-border flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] flex-1 gap-1.5"
              onClick={sendWhatsApp}
              disabled={isSendingWA}
            >
              {isSendingWA
                ? <><Loader2 size={12} className="animate-spin" />Sending...</>
                : digest?.delivered_whatsapp
                  ? <><CheckCircle size={12} className="text-emerald-600" />Delivered ✓</>
                  : <><Send size={12} />Send to WhatsApp</>}
            </Button>
            <Button size="sm" variant="outline" className="text-[11px] flex-1 gap-1.5" onClick={generateDigest} disabled={isGenerating}>
              {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Regenerate
            </Button>
          </div>
        )}
      </div>

      {/* RIGHT — KPI Snapshot + Anomalies */}
      <div className="flex-1 flex flex-col overflow-y-auto p-5 gap-5">
        {/* KPI Snapshot */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Today's Key Numbers</h3>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b border-border">
                <th className="text-left pb-2 font-medium">KPI</th>
                <th className="text-right pb-2 font-medium">Today</th>
                <th className="text-right pb-2 font-medium">vs Yesterday</th>
                <th className="text-right pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(kpiData?.rows || []).map((row, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 font-medium text-foreground">{row.label}</td>
                  <td className="py-2 text-right font-semibold text-foreground">{row.today}</td>
                  <td className="py-2 text-right text-muted-foreground">{row.vs}</td>
                  <td className="py-2 text-right">
                    <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full", row.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-destructive")}>
                      {row.ok ? "✅" : "❌"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Anomaly Detection */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-3">⚡ Anomaly Detection</h3>
          {anomalies.length === 0 ? (
            <div className="text-[12px] text-emerald-600 flex items-center gap-1.5">
              <CheckCircle size={14} /> All metrics within normal range
            </div>
          ) : (
            <div className="space-y-2">
              {anomalies.map((a, i) => (
                <div key={i} className={cn(
                  "rounded-lg p-3 border",
                  a.severity === "high" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", a.severity === "high" ? "bg-red-200 text-destructive" : "bg-amber-200 text-amber-700")}>
                      {a.type === "spike" ? "↑" : "↓"} {a.metric} {a.type}
                    </span>
                  </div>
                  <p className="text-[12px] text-foreground">Current: {a.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIDigestTab;
