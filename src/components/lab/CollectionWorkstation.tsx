import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { TestTube2, Printer, Check, PackageCheck, FlaskConical, XCircle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  SAMPLE_REJECTION_REASONS,
  LabPaymentPendingError,
  collectOrderSamples,
  receiveOrderSamples,
  startOrderProcessing,
  rejectSample,
  resolveOrderBarcode,
} from "@/lib/labSamples";
import { recordAncillaryOverride } from "@/lib/ancillaryGateChecks";
import { useHospitalContext } from "@/contexts/HospitalContext";
import PaymentPendingDialog from "@/components/shared/PaymentPendingDialog";
import PatientIdentityConfirmDialog from "./PatientIdentityConfirmDialog";
import OnboardingTour from "@/components/onboarding/OnboardingTour";

// Phlebotomy / collection workstation (lab plan Phase 5).
// Worklist over lab_samples with collect / receive / process / reject-recollect
// actions, sharing the exact lifecycle code (src/lib/labSamples.ts) the result
// workspace uses. Phase 9 reuses this with admittedOnly for the ward worklist.

interface SampleRow {
  id: string;
  sample_type: string;
  barcode: string | null;
  status: string;
  rejection_reason: string | null;
  recollected_from_sample_id: string | null;
  created_at: string;
  collected_at: string | null;
  lab_orders: {
    id: string;
    accession_number: string | null;
    priority: string;
    status: string;
    order_date: string;
    admission_id: string | null;
    patients: { id: string; full_name: string; uhid: string } | null;
  } | null;
}

const STATUS_TABS = [
  { key: "pending", label: "⏳ To Collect" },
  { key: "collected", label: "📦 Collected" },
  { key: "received", label: "📥 Received" },
  { key: "rejected", label: "🚫 Rejected" },
] as const;

const PRIORITY_ORDER: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };

interface Props {
  hospitalId: string;
  /** Ward mode (Phase 9): only samples for admitted patients. */
  admittedOnly?: boolean;
}

const CollectionWorkstation: React.FC<Props> = ({ hospitalId, admittedOnly = false }) => {
  const { toast } = useToast();
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["key"]>("pending");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const { role } = useHospitalContext();
  /** Set when the payment gate refuses a collection — drives PaymentPendingDialog. */
  const [blocked, setBlocked] = useState<{
    row: SampleRow;
    unpaidAmount: number;
    overrideAvailable: boolean;
  } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SampleRow | null>(null);
  const [rejectReason, setRejectReason] = useState<string>(SAMPLE_REJECTION_REASONS[0]);
  const [rejectNote, setRejectNote] = useState("");
  // Bedside two-identifier confirm before collection (Phase 11)
  const [collectConfirm, setCollectConfirm] = useState<SampleRow | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle()
        .then(({ data }) => { if (data) setCurrentUserId(data.id); });
    });
  }, []);

  const fetchSamples = useCallback(async () => {
    setLoading(true);
    let query = (supabase as any)
      .from("lab_samples")
      .select(`
        id, sample_type, barcode, status, rejection_reason, recollected_from_sample_id, created_at, collected_at,
        lab_orders!inner(id, accession_number, priority, status, order_date, admission_id, patients(id, full_name, uhid))
      `)
      .eq("hospital_id", hospitalId)
      .eq("status", tab)
      .order("created_at", { ascending: false })
      .limit(200);
    if (admittedOnly) {
      query = query.not("lab_orders.admission_id", "is", null);
    }
    const { data, error } = await query;
    if (error) console.error("Collection worklist fetch error:", error.message);
    const sorted = ((data || []) as SampleRow[]).sort((a, b) =>
      (PRIORITY_ORDER[a.lab_orders?.priority || "routine"] ?? 2) -
      (PRIORITY_ORDER[b.lab_orders?.priority || "routine"] ?? 2)
    );
    setSamples(sorted);
    setLoading(false);
  }, [hospitalId, tab, admittedOnly]);

  useEffect(() => { fetchSamples(); }, [fetchSamples]);

  // Realtime: any sample change refreshes the worklist
  useEffect(() => {
    const channel = supabase
      .channel(`collection-ws-${admittedOnly ? "ward" : "lab"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_samples", filter: `hospital_id=eq.${hospitalId}` }, () => fetchSamples())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, fetchSamples, admittedOnly]);

  const printLabel = async (row: SampleRow) => {
    const order = row.lab_orders;
    if (!order) return;
    const barcodeValue = await resolveOrderBarcode(order.id, order.patients?.uhid);
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
  <p class="name">${order.patients?.full_name || "Patient"}</p>
  <p>${order.patients?.uhid || ""} | ${row.sample_type.toUpperCase()} | ${dateStr}</p>
</div>
<script>
  JsBarcode("#bc","${barcodeValue}",{format:"CODE128",width:1.5,height:40,displayValue:true,fontSize:8,margin:2});
  setTimeout(()=>{window.print();window.close();},400);
<\/script>
</body></html>`;
    const win = window.open("", "_blank", "width=320,height=270,toolbar=0,menubar=0");
    if (win) { win.document.write(html); win.document.close(); }
    if (currentUserId) {
      await (supabase as any).from("lab_orders").update({
        barcode_printed_at: new Date().toISOString(),
        barcode_printed_by: currentUserId,
      }).eq("id", order.id);
    }
  };

  /** Runs the collection, optionally after an audited override of the payment gate. */
  const runCollect = async (row: SampleRow, overridden = false) => {
    await collectOrderSamples({
      orderId: row.lab_orders!.id,
      userId: currentUserId!,
      uhid: row.lab_orders!.patients?.uhid,
      role,
      overridden,
    });
    toast({ title: "📦 Collected — order moved to the lab queue" });
    fetchSamples();
  };

  const handleOverride = async (reason: string) => {
    const row = blocked?.row;
    if (!row || !currentUserId) return;
    setActingId(row.id);
    try {
      const ok = await recordAncillaryOverride({
        hospitalId,
        service: "lab",
        patientId: row.lab_orders?.patients?.id ?? null,
        reason,
        overriddenBy: currentUserId,
        detail: `Order ${row.lab_orders?.id?.slice(0, 8)}`,
      });
      // Refuse to proceed unaudited — the audit row IS the justification for bypassing.
      if (!ok) throw new Error("The override could not be recorded, so the sample was not collected.");
      setBlocked(null);
      await runCollect(row, true);
    } catch (e: any) {
      toast({ title: "Override failed", description: e.message, variant: "destructive" });
    } finally {
      setActingId(null);
    }
  };

  const act = async (row: SampleRow, action: "collect" | "receive" | "process") => {
    if (!currentUserId || !row.lab_orders) return;
    setActingId(row.id);
    try {
      if (action === "collect") {
        await runCollect(row);
      } else if (action === "receive") {
        await receiveOrderSamples({ orderId: row.lab_orders.id, userId: currentUserId });
        toast({ title: "📥 Received at lab" });
      } else {
        await startOrderProcessing({ orderId: row.lab_orders.id, userId: currentUserId });
        toast({ title: "🔬 Processing started" });
      }
      if (action !== "collect") fetchSamples();
    } catch (e: any) {
      // A pending payment is not an error the collector did anything wrong — it's a step they
      // need to route the attendant through, so it gets its own dialog rather than a red toast.
      if (e instanceof LabPaymentPendingError) {
        setBlocked({ row, unpaidAmount: e.unpaidAmount, overrideAvailable: e.overrideAvailable });
      } else {
        toast({ title: "Action failed", description: e.message, variant: "destructive" });
      }
    } finally {
      setActingId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting || !currentUserId) return;
    setActingId(rejecting.id);
    try {
      const reason = rejectNote.trim() ? `${rejectReason}: ${rejectNote.trim()}` : rejectReason;
      await rejectSample({ sampleId: rejecting.id, userId: currentUserId, reason });
      toast({ title: "🚫 Sample rejected", description: "A recollection sample was queued under 'To Collect'." });
      setRejecting(null);
      setRejectNote("");
      fetchSamples();
    } catch (e: any) {
      toast({ title: "Rejection failed", description: e.message, variant: "destructive" });
    } finally {
      setActingId(null);
    }
  };

  return (
    <div data-tour="lab-worklist" className="p-4 space-y-4">
      <OnboardingTour tourKey="lab_intro" />
      {/* Status tabs */}
      <div className="flex items-center gap-2">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "text-xs font-semibold px-3 py-1.5 rounded-md transition-colors",
              tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto" />
        <RefreshCw size={14} className="text-muted-foreground cursor-pointer hover:text-foreground" onClick={fetchSamples} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : samples.length === 0 ? (
        <div className="text-center py-14">
          <TestTube2 size={36} className="mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No {tab} samples</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Patient</th>
                <th className="px-3 py-2 text-left font-medium">Accession</th>
                <th className="px-3 py-2 text-left font-medium">Sample</th>
                <th className="px-3 py-2 text-left font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">{tab === "rejected" ? "Reason" : "Age"}</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {samples.map(row => {
                const order = row.lab_orders;
                const busy = actingId === row.id;
                return (
                  <tr key={row.id} className={cn(order?.priority === "stat" && "bg-red-50/50")}>
                    <td className="px-3 py-2">
                      <p className="font-semibold">{order?.patients?.full_name || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{order?.patients?.uhid}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{order?.accession_number || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{row.sample_type}</Badge>
                      {row.recollected_from_sample_id && (
                        <Badge variant="outline" className="text-[9px] ml-1 border-amber-400 text-amber-700">Recollection</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "text-[10px] font-bold uppercase",
                        order?.priority === "stat" ? "text-red-600" : order?.priority === "urgent" ? "text-amber-600" : "text-muted-foreground"
                      )}>
                        {order?.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {tab === "rejected"
                        ? <span className="text-red-600">{row.rejection_reason || "—"}</span>
                        : formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {tab !== "rejected" && (
                          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => printLabel(row)} title="Print barcode label">
                            <Printer size={12} /> Label
                          </Button>
                        )}
                        {tab === "pending" && (
                          <Button size="sm" className="h-7 text-[11px] gap-1" disabled={busy || !currentUserId} onClick={() => setCollectConfirm(row)}>
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Collect
                          </Button>
                        )}
                        {tab === "collected" && (
                          <Button size="sm" className="h-7 text-[11px] gap-1" disabled={busy || !currentUserId} onClick={() => act(row, "receive")}>
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />} Receive
                          </Button>
                        )}
                        {tab === "received" && (
                          <Button size="sm" className="h-7 text-[11px] gap-1" disabled={busy || !currentUserId} onClick={() => act(row, "process")}>
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Process
                          </Button>
                        )}
                        {tab !== "rejected" && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 text-[11px] gap-1 text-red-500 hover:bg-red-50"
                            disabled={busy || !currentUserId}
                            onClick={() => { setRejecting(row); setRejectReason(SAMPLE_REJECTION_REASONS[0]); setRejectNote(""); }}
                          >
                            <XCircle size={12} /> Reject
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bedside two-identifier confirm before collection (Phase 11) */}
      {collectConfirm && (
        <PatientIdentityConfirmDialog
          patientName={collectConfirm.lab_orders?.patients?.full_name || "Patient"}
          uhid={collectConfirm.lab_orders?.patients?.uhid}
          onConfirm={() => act(collectConfirm, "collect")}
          onClose={() => setCollectConfirm(null)}
        />
      )}

      {/* Payment gate — only ever fires for a pre-paid hospital's unpaid IPD order */}
      <PaymentPendingDialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        unpaidAmount={blocked?.unpaidAmount ?? 0}
        overrideAvailable={blocked?.overrideAvailable ?? false}
        onOverride={handleOverride}
        blockedAction="sample cannot be collected"
        busy={!!actingId}
      />

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) setRejecting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Sample</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground -mt-1">
            {rejecting?.lab_orders?.patients?.full_name} · {rejecting?.sample_type} — a recollection sample
            will be queued automatically.
          </p>
          <div className="space-y-2">
            {SAMPLE_REJECTION_REASONS.map(r => (
              <label key={r} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input type="radio" name="reject-reason" checked={rejectReason === r} onChange={() => setRejectReason(r)} />
                {r}
              </label>
            ))}
            <Textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="Additional note (optional)"
              className="text-sm min-h-[56px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={confirmReject} disabled={actingId === rejecting?.id}>
              Reject & Queue Recollection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CollectionWorkstation;
