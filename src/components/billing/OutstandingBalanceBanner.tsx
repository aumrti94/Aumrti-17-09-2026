import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchPatientOutstandingBalance } from "@/lib/outstandingBalance";

interface Props {
  patientId: string | null | undefined;
  hospitalId: string | null | undefined;
  /** "dark" matches EmergencyRegistrationModal's dark-themed form; "light" matches the usual card-based modals. */
  variant?: "light" | "dark";
}

/**
 * Non-blocking advisory note: "₹X outstanding from N other visit(s)". Never
 * blocks registration/billing — purely informational, so staff can see a
 * patient's cross-visit balance at the point a new bill or visit is opened.
 */
const OutstandingBalanceBanner: React.FC<Props> = ({ patientId, hospitalId, variant = "light" }) => {
  const [summary, setSummary] = useState<{ totalOutstanding: number; billCount: number } | null>(null);

  useEffect(() => {
    if (!patientId || !hospitalId) { setSummary(null); return; }
    fetchPatientOutstandingBalance(patientId, hospitalId).then(setSummary);
  }, [patientId, hospitalId]);

  if (!summary || summary.totalOutstanding <= 0) return null;

  const message = `₹${summary.totalOutstanding.toLocaleString("en-IN")} outstanding from ${summary.billCount} other visit${summary.billCount !== 1 ? "s" : ""}`;

  if (variant === "dark") {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-orange-600/50 p-2" style={{ background: "rgba(234,88,12,0.12)" }}>
        <AlertTriangle size={12} className="text-amber-400 shrink-0" />
        <span className="text-[11px] text-amber-400 font-medium">{message}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900 px-3 py-2">
      <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-xs text-amber-800 dark:text-amber-400 font-medium">{message}</span>
    </div>
  );
};

export default OutstandingBalanceBanner;
