import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Receipt, Plus, IndianRupee, Search, X } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import type { BillRecord } from "@/pages/billing/BillingPage";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";
import { billStatusDisplay, isRefundStatus } from "@/lib/billStatus";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "partial", label: "Partial" },
  { key: "paid", label: "Paid" },
];

const DATE_FILTERS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

interface Props {
  bills: BillRecord[];
  loading: boolean;
  selectedBillId: string | null;
  onSelectBill: (id: string) => void;
  statusFilter: string;
  onStatusFilter: (f: string) => void;
  dateFilter: string;
  onDateFilter: (f: string) => void;
  startDate: string;
  endDate: string;
  onStartDate: (d: string) => void;
  onEndDate: (d: string) => void;
  onNewBill: () => void;
  onAdvanceReceipt: () => void;
  todayCollection: number;
  pendingAmount: number;
  billCount: number;
  patientSearch: string;
  onPatientSearch: (v: string) => void;
}

const BillQueue: React.FC<Props> = ({
  bills, loading, selectedBillId, onSelectBill,
  statusFilter, onStatusFilter, dateFilter, onDateFilter,
  startDate, endDate, onStartDate, onEndDate,
  onNewBill, onAdvanceReceipt, todayCollection, pendingAmount, billCount,
  patientSearch, onPatientSearch,
}) => {
  const { permissions, role } = useHospitalContext();
  return (
  <aside data-tour="billing-bill-queue" className="w-80 shrink-0 bg-card border-r border-border flex flex-col overflow-hidden h-full">
    {/* Header */}
    <div className="px-4 py-3 border-b border-border flex-shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">Bills</span>
        {hasActionAccess("billing", "new_bill", permissions, role) && (
          <Button data-tour="billing-new-bill" size="sm" className="h-7 text-[11px] gap-1" onClick={onNewBill}>
            <Plus size={14} /> New Bill
          </Button>
        )}
      </div>

      {/* Patient search */}
      <div className="relative mt-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={patientSearch}
          onChange={e => onPatientSearch(e.target.value)}
          placeholder="Name / UHID / phone / ABHA…"
          className="w-full pl-7 pr-7 py-1.5 text-[12px] border border-border rounded-md bg-background focus:border-primary focus:outline-none"
        />
        {patientSearch && (
          <button
            onClick={() => onPatientSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className={cn("flex gap-1.5 mt-2 overflow-x-auto", patientSearch && "opacity-40 pointer-events-none")}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onStatusFilter(f.key)}
            className={cn(
              "px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors",
              statusFilter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>

    {/* Stats */}
    <div className="px-4 py-1.5 bg-muted/50 border-b border-border flex gap-4 text-[11px] flex-shrink-0">
      {patientSearch ? (
        <span className="text-primary font-medium">All dates · {billCount} bills found</span>
      ) : (
        <>
          <span className="text-success font-bold">₹{todayCollection.toLocaleString("en-IN")} collected</span>
          <span className="text-accent font-medium">₹{pendingAmount.toLocaleString("en-IN")} pending</span>
          <span className="text-muted-foreground">{billCount} bills</span>
        </>
      )}
    </div>

    {/* Date filter — hidden when patient search is active */}
    <div className={cn("px-4 py-1.5 border-b border-border flex-shrink-0 space-y-1.5", patientSearch && "opacity-40 pointer-events-none")}>
      <div className="flex items-center gap-2">
        {DATE_FILTERS.map((d) => (
          <button
            key={d.key}
            onClick={() => onDateFilter(d.key)}
            className={cn(
              "text-[11px] font-medium transition-colors whitespace-nowrap",
              dateFilter === d.key ? "text-primary underline" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={startDate}
          onChange={e => onStartDate(e.target.value)}
          className="flex-1 text-[11px] border border-border rounded px-1.5 py-1 bg-card text-foreground focus:border-primary focus:outline-none"
        />
        <span className="text-[11px] text-muted-foreground shrink-0">to</span>
        <input
          type="date"
          value={endDate}
          onChange={e => onEndDate(e.target.value)}
          className="flex-1 text-[11px] border border-border rounded px-1.5 py-1 bg-card text-foreground focus:border-primary focus:outline-none"
        />
      </div>
    </div>

    {/* Bill list */}
    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
      ) : bills.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No bills for this period"
          description="Bills created from OPD, IPD, and emergency appear here"
          actionLabel={hasActionAccess("billing", "new_bill", permissions, role) ? "+ Create Bill" : undefined}
          onAction={hasActionAccess("billing", "new_bill", permissions, role) ? onNewBill : undefined}
        />
      ) : (
        bills.map((bill) => {
          const isPendingIPD = bill.bill_status === "pending_ipd";
          // Money collected against a booking with no bill yet. Deliberately styled apart
          // from a bill so nobody reads it as revenue already invoiced.
          const isDepositHeld = bill.bill_status === "deposit_held";
          const sb = billStatusDisplay(bill.payment_status);
          // The refund flow rewrites balance_due back up to the full total, so a refunded
          // bill would otherwise read "₹51,500 due" — money the patient was handed back.
          const isRefunded = isRefundStatus(bill.payment_status);
          const days = isPendingIPD
            ? Math.max(1, Math.ceil((Date.now() - new Date(bill.bill_date).getTime()) / 86400000))
            : 0;
          return (
            <button
              key={bill.id}
              onClick={() => onSelectBill(bill.id)}
              className={cn(
                "w-full text-left p-2.5 rounded-lg border transition-all",
                "border-l-[3px]",
                isPendingIPD ? "border-l-accent"
                  : isDepositHeld ? "border-l-teal-500"
                  : sb.border,
                selectedBillId === bill.id
                  ? "bg-primary/5 border-primary"
                  : isPendingIPD
                  ? "border-accent/40 bg-accent/5 hover:bg-accent/10"
                  : isDepositHeld
                  ? "border-teal-500/40 bg-teal-500/5 hover:bg-teal-500/10"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono text-muted-foreground">{bill.bill_number}</span>
                {isPendingIPD ? (
                  <span className="text-[11px] font-bold text-accent">Day {days}</span>
                ) : isDepositHeld ? (
                  // The DEPOSIT is the headline figure, not the estimate: it is the money
                  // actually in hand, which is the question this screen has to answer.
                  <span className="text-[13px] font-bold text-teal-600">₹{bill.paid_amount.toLocaleString("en-IN")}</span>
                ) : (
                  <span className="text-[13px] font-bold text-foreground">₹{bill.total_amount.toLocaleString("en-IN")}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[9px] font-bold">
                  {bill.patient_name.charAt(0)}
                </div>
                <span className="text-[13px] font-bold text-foreground truncate">{bill.patient_name}</span>
                {bill.is_mlc && (
                  <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-red-600 text-white flex-shrink-0">MLC</span>
                )}
                {bill.payer_type && bill.payer_type !== "cash" && (
                  <span className={cn(
                    "text-[9px] px-1.5 py-px rounded-full font-bold flex-shrink-0",
                    bill.payer_type === "corporate" ? "bg-blue-600 text-white" :
                    bill.payer_type === "tpa" ? "bg-purple-600 text-white" :
                    bill.payer_type === "pmjay" ? "bg-green-600 text-white" :
                    bill.payer_type === "cghs" ? "bg-teal-600 text-white" :
                    bill.payer_type === "esi" ? "bg-orange-600 text-white" :
                    bill.payer_type === "state_scheme" ? "bg-indigo-600 text-white" :
                    "bg-slate-500 text-white"
                  )}>
                    {bill.payer_type === "corporate" ? "Corp" :
                     bill.payer_type === "tpa" ? "TPA" :
                     bill.payer_type === "pmjay" ? "PMJAY" :
                     bill.payer_type === "cghs" ? "CGHS" :
                     bill.payer_type === "esi" ? "ESI" :
                     bill.payer_type === "state_scheme" ? "State" :
                     bill.payer_type === "credit" ? "Credit" : "Other"}
                  </span>
                )}
              </div>
              <div className="flex justify-between mt-1">
                <Badge variant="outline" className="text-[10px] h-5">{bill.bill_type.toUpperCase()}</Badge>
                {isPendingIPD ? (
                  <span className="text-[11px] text-accent font-medium">Click to create bill →</span>
                ) : isDepositHeld ? (
                  <span className={cn("text-[11px]", bill.balance_due > 0 ? "text-destructive" : "text-muted-foreground")}>
                    {bill.balance_due > 0
                      ? `₹${bill.balance_due.toLocaleString("en-IN")} short`
                      : "Bills on admission"}
                  </span>
                ) : isRefunded ? (
                  // No figure quoted: the refunded amount is what was PAID, which is not
                  // necessarily this bill's total. The exact sum is on the bill's Refunds tab.
                  <span className={cn("text-[11px]", bill.payment_status === "refunded" ? "text-violet-600" : "text-amber-600")}>
                    {bill.payment_status === "refunded" ? "Refunded to patient" : "Refund awaiting approval"}
                  </span>
                ) : (
                  <span className={cn("text-[11px]", bill.balance_due > 0 ? "text-destructive" : "text-success")}>
                    {bill.balance_due > 0 ? `₹${bill.balance_due.toLocaleString("en-IN")} due` : "Settled"}
                  </span>
                )}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">{bill.bill_date}</span>
                {isPendingIPD ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-accent/10 text-accent">Pending IPD</span>
                ) : isDepositHeld ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-teal-500/10 text-teal-600">Deposit held</span>
                ) : (
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", sb.badge)}>{sb.label}</span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>

    {/* Footer */}
    <div className="border-t border-border p-3 flex-shrink-0">
      <Button variant="outline" className="w-full h-9 text-xs gap-1.5" onClick={onAdvanceReceipt}>
        <IndianRupee size={14} /> Advance Receipt
      </Button>
    </div>
  </aside>
  );
};

export default BillQueue;
