import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, RotateCcw, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface IndentItem {
  id: string;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  requested_qty: number;
  approved_qty: number | null;
  issued_qty: number | null;
  returned_qty: number | null;
  remarks: string | null;
  return_reason: string | null;
}

interface Indent {
  id: string;
  indent_number: string;
  status: string;
  requested_at: string;
  approved_at: string | null;
  received_at: string | null;
  remarks: string | null;
  from_store: { name: string } | null;
  to_store: { name: string } | null;
  requested_by_user: { full_name: string } | null;
  approved_by_user: { full_name: string } | null;
}

interface Props {
  indentId: string;
  userRole: "requester" | "store_manager";
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  partially_issued: "bg-sky-100 text-sky-600",
  issued: "bg-blue-100 text-blue-700",
  received: "bg-purple-100 text-purple-700",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const StoreIndentDetailModal: React.FC<Props> = ({ indentId, userRole, onClose, onUpdated }) => {
  const { toast } = useToast();
  const [indent, setIndent] = useState<Indent | null>(null);
  const [items, setItems] = useState<IndentItem[]>([]);
  const [approvedQtys, setApprovedQtys] = useState<Record<string, number>>({});
  const [issuedQtys, setIssuedQtys] = useState<Record<string, number>>({});
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ind }, { data: its }] = await Promise.all([
      (supabase as any)
        .from("store_indents")
        .select("*, from_store:store_locations!store_indents_from_store_id_fkey(name), to_store:store_locations!store_indents_to_store_id_fkey(name), requested_by_user:users!store_indents_requested_by_fkey(full_name), approved_by_user:users!store_indents_approved_by_fkey(full_name)")
        .eq("id", indentId)
        .single(),
      (supabase as any).from("store_indent_items").select("*").eq("indent_id", indentId).order("item_name"),
    ]);
    setIndent(ind);
    setItems(its || []);
    const aq: Record<string, number> = {};
    const iq: Record<string, number> = {};
    (its || []).forEach((item: IndentItem) => {
      aq[item.id] = item.approved_qty ?? item.requested_qty;
      iq[item.id] = item.issued_qty ?? item.approved_qty ?? item.requested_qty;
    });
    setApprovedQtys(aq);
    setIssuedQtys(iq);
  }, [indentId]);

  useEffect(() => { load(); }, [load]);

  const approveAndIssue = async () => {
    if (!indent) return;
    setProcessing(true);
    for (const item of items) {
      await (supabase as any).from("store_indent_items").update({
        approved_qty: approvedQtys[item.id] ?? item.requested_qty,
        issued_qty: issuedQtys[item.id] ?? approvedQtys[item.id] ?? item.requested_qty,
      }).eq("id", item.id);
    }
    const allFull = items.every((i) => (issuedQtys[i.id] ?? 0) >= (i.requested_qty));
    const newStatus = allFull ? "issued" : "partially_issued";
    await (supabase as any).from("store_indents").update({
      status: newStatus,
      approved_by: (await supabase.auth.getUser()).data.user?.id,
      approved_at: new Date().toISOString(),
    }).eq("id", indent.id);

    // Log movements
    const movementRows = items.map((i) => ({
      hospital_id: (indent as any).hospital_id,
      store_id: indent.from_store ? null : null,
      indent_id: indent.id,
      item_name: i.item_name,
      item_code: i.item_code,
      movement_type: "issue",
      quantity: issuedQtys[i.id] ?? 0,
      unit: i.unit,
    })).filter((m) => m.quantity > 0);
    if (movementRows.length > 0) await (supabase as any).from("store_stock_movements").insert(movementRows);

    toast({ title: `Indent ${newStatus === "issued" ? "fully" : "partially"} issued` });
    setProcessing(false);
    onUpdated();
    onClose();
  };

  const reject = async () => {
    if (!indent) return;
    setProcessing(true);
    await (supabase as any).from("store_indents").update({
      status: "rejected",
      remarks: rejectionReason || indent.remarks,
    }).eq("id", indent.id);
    toast({ title: "Indent rejected" });
    setProcessing(false);
    onUpdated();
    onClose();
  };

  const markReceived = async () => {
    if (!indent) return;
    setProcessing(true);
    await (supabase as any).from("store_indents").update({
      status: "received",
      received_by: (await supabase.auth.getUser()).data.user?.id,
      received_at: new Date().toISOString(),
    }).eq("id", indent.id);
    toast({ title: "Items marked as received" });
    setProcessing(false);
    onUpdated();
    onClose();
  };

  const submitReturn = async () => {
    if (!indent) return;
    const returnItems = items.filter((i) => (returnQtys[i.id] || 0) > 0);
    if (returnItems.length === 0) return;
    setProcessing(true);
    for (const item of returnItems) {
      await (supabase as any).from("store_indent_items").update({
        returned_qty: (item.returned_qty || 0) + (returnQtys[item.id] || 0),
        return_reason: returnReasons[item.id] || null,
      }).eq("id", item.id);
    }
    const movRows = returnItems.map((i) => ({
      hospital_id: (indent as any).hospital_id,
      indent_id: indent.id,
      item_name: i.item_name,
      item_code: i.item_code,
      movement_type: "return",
      quantity: returnQtys[i.id],
      unit: i.unit,
    }));
    await (supabase as any).from("store_stock_movements").insert(movRows);
    toast({ title: "Return recorded" });
    setShowReturnForm(false);
    setProcessing(false);
    load();
  };

  if (!indent) return null;

  const canIssue = userRole === "store_manager" && (indent.status === "pending" || indent.status === "approved");
  const canReceive = userRole === "requester" && indent.status === "issued";
  const canReturn = userRole === "requester" && (indent.status === "received" || indent.status === "issued");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-[720px] max-h-[90vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-foreground">{indent.indent_number}</h2>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize", STATUS_COLORS[indent.status] || "bg-muted text-muted-foreground")}>
                {indent.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              From <span className="font-medium">{indent.from_store?.name || "?"}</span> → <span className="font-medium">{indent.to_store?.name || "?"}</span>
              {indent.requested_by_user && <span> · Raised by {indent.requested_by_user.full_name}</span>}
              <span> · {format(new Date(indent.requested_at), "dd MMM yyyy, HH:mm")}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
        </div>

        {/* Items table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Req. Qty</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Approve</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Issue</th>
                  <th className="text-right px-2 py-2 text-muted-foreground font-medium">Returned</th>
                  {showReturnForm && <th className="text-right px-2 py-2 text-muted-foreground font-medium">Return Qty</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.item_name}</p>
                      {item.item_code && <p className="text-muted-foreground">{item.item_code}</p>}
                      {item.remarks && <p className="text-muted-foreground italic">{item.remarks}</p>}
                    </td>
                    <td className="px-2 py-2 text-right">{item.requested_qty} {item.unit}</td>
                    <td className="px-2 py-2 text-right">
                      {canIssue ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="w-16 text-right px-1.5 py-1 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          value={approvedQtys[item.id] ?? ""}
                          onChange={(e) => setApprovedQtys({ ...approvedQtys, [item.id]: Number(e.target.value) })}
                        />
                      ) : (
                        <span>{item.approved_qty ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canIssue ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="w-16 text-right px-1.5 py-1 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          value={issuedQtys[item.id] ?? ""}
                          onChange={(e) => setIssuedQtys({ ...issuedQtys, [item.id]: Number(e.target.value) })}
                        />
                      ) : (
                        <span>{item.issued_qty ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{item.returned_qty || "—"}</td>
                    {showReturnForm && (
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={item.issued_qty ?? 999}
                          className="w-16 text-right px-1.5 py-1 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          value={returnQtys[item.id] || ""}
                          onChange={(e) => setReturnQtys({ ...returnQtys, [item.id]: Number(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Return reason */}
          {showReturnForm && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {items.filter((i) => (returnQtys[i.id] || 0) > 0).map((item) => (
                <div key={item.id}>
                  <label className="text-[10px] text-muted-foreground">{item.item_name} — Return Reason</label>
                  <select
                    className="w-full mt-0.5 px-2 py-1.5 text-xs border border-border rounded bg-background focus:outline-none"
                    value={returnReasons[item.id] || ""}
                    onChange={(e) => setReturnReasons({ ...returnReasons, [item.id]: e.target.value })}
                  >
                    <option value="">— Select —</option>
                    <option value="unused">Unused</option>
                    <option value="expired">Expired</option>
                    <option value="excess">Excess quantity</option>
                    <option value="damaged">Damaged</option>
                    <option value="wrong_item">Wrong item issued</option>
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Reject form */}
          {showRejectForm && (
            <div className="mt-3">
              <label className="text-xs text-muted-foreground font-medium">Rejection Reason</label>
              <textarea
                className="w-full mt-1 px-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                rows={2}
                placeholder="Reason for rejection…"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0 flex-wrap gap-2">
          <div className="flex gap-2">
            {canReturn && !showReturnForm && (
              <button
                onClick={() => setShowReturnForm(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw size={13} /> Return to Store
              </button>
            )}
            {showReturnForm && (
              <>
                <button onClick={() => setShowReturnForm(false)} className="text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel Return</button>
                <button onClick={submitReturn} disabled={processing} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50">
                  <RotateCcw size={13} /> Confirm Return
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2 ml-auto">
            {canIssue && !showRejectForm && (
              <button
                onClick={() => setShowRejectForm(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
              >
                <XCircle size={13} /> Reject
              </button>
            )}
            {showRejectForm && (
              <>
                <button onClick={() => setShowRejectForm(false)} className="text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
                <button onClick={reject} disabled={processing} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-destructive text-white font-semibold hover:bg-destructive/90 transition-all disabled:opacity-50">
                  <XCircle size={13} /> Confirm Reject
                </button>
              </>
            )}
            {canReceive && (
              <button onClick={markReceived} disabled={processing} className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-50">
                <PackageCheck size={13} /> Mark Received
              </button>
            )}
            {canIssue && !showRejectForm && (
              <button onClick={approveAndIssue} disabled={processing} className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50">
                <CheckCircle2 size={13} /> {processing ? "Issuing…" : "Approve & Issue"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreIndentDetailModal;
