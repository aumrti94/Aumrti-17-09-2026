import React from "react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { bg: string; text: string; label?: string }> = {
  // Patient/Appointment statuses
  active:          { bg: "bg-emerald-100", text: "text-emerald-700" },
  inactive:        { bg: "bg-slate-100",   text: "text-slate-600" },
  waiting:         { bg: "bg-amber-100",   text: "text-amber-700" },
  in_consultation: { bg: "bg-blue-100",    text: "text-blue-700" },
  called:          { bg: "bg-amber-100",   text: "text-amber-800" },
  completed:       { bg: "bg-slate-100",   text: "text-slate-500" },
  cancelled:       { bg: "bg-red-100",     text: "text-red-600" },
  no_show:         { bg: "bg-slate-100",   text: "text-slate-500" },
  // Lab/Radiology
  ordered:         { bg: "bg-blue-100",    text: "text-blue-700" },
  collected:       { bg: "bg-purple-100",  text: "text-purple-700" },
  processing:      { bg: "bg-amber-100",   text: "text-amber-700" },
  resulted:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  reported:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  // Lab/Radiology — remaining live statuses, added when results were surfaced in OPD/IPD.
  // Without these the badge fell back to grey, so "sample collected" and "validated" looked
  // identical to a doctor scanning the list.
  sample_collected:   { bg: "bg-purple-100",  text: "text-purple-700" },
  in_process:         { bg: "bg-amber-100",   text: "text-amber-700" },
  partial_results:    { bg: "bg-amber-100",   text: "text-amber-800" },
  result_entered:     { bg: "bg-sky-100",     text: "text-sky-700",     label: "Result Entered" },
  pending_validation: { bg: "bg-sky-100",     text: "text-sky-800",     label: "Awaiting Validation" },
  validated:          { bg: "bg-emerald-100", text: "text-emerald-700" },
  scheduled:          { bg: "bg-blue-100",    text: "text-blue-700" },
  patient_arrived:    { bg: "bg-purple-100",  text: "text-purple-700" },
  in_progress:        { bg: "bg-amber-100",   text: "text-amber-700" },
  images_acquired:    { bg: "bg-sky-100",     text: "text-sky-700" },
  // Pathology
  registered:         { bg: "bg-blue-100",    text: "text-blue-700" },
  grossing:           { bg: "bg-amber-100",   text: "text-amber-700" },
  reporting:          { bg: "bg-amber-100",   text: "text-amber-700" },
  pending_signoff:    { bg: "bg-sky-100",     text: "text-sky-800",     label: "Pending Sign-off" },
  signed_off:         { bg: "bg-emerald-100", text: "text-emerald-700", label: "Signed Off" },
  amended:            { bg: "bg-red-100",     text: "text-red-700" },
  // External lab referral
  sample_sent:        { bg: "bg-purple-100",  text: "text-purple-700" },
  report_awaited:     { bg: "bg-amber-100",   text: "text-amber-700" },
  // IPD/Admission
  admitted:        { bg: "bg-blue-100",    text: "text-blue-700" },
  discharged:      { bg: "bg-slate-100",   text: "text-slate-500" },
  // Billing
  draft:           { bg: "bg-slate-100",   text: "text-slate-600" },
  finalised:       { bg: "bg-emerald-100", text: "text-emerald-700" },
  paid:            { bg: "bg-emerald-100", text: "text-emerald-700" },
  partial:         { bg: "bg-amber-100",   text: "text-amber-700" },
  pending:         { bg: "bg-amber-100",   text: "text-amber-700" },
  overdue:         { bg: "bg-red-100",     text: "text-red-600" },
  // Priority/urgency
  routine:         { bg: "bg-slate-100",   text: "text-slate-600" },
  urgent:          { bg: "bg-amber-100",   text: "text-amber-700" },
  stat:            { bg: "bg-red-100",     text: "text-red-700" },
  emergency:       { bg: "bg-red-100",     text: "text-red-700" },
  critical:        { bg: "bg-red-100",     text: "text-red-700" },
  // Insurance / TPA
  intimated:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  not_intimated:    { bg: "bg-red-100",     text: "text-red-600",   label: "Not Intimated" },
  late_intimation:  { bg: "bg-amber-100",   text: "text-amber-700", label: "Late — Intimate Now" },
  preauth_expiring: { bg: "bg-amber-100",   text: "text-amber-700", label: "Expiring Soon" },
  preauth_expired:  { bg: "bg-red-100",     text: "text-red-600",   label: "Pre-Auth Expired" },
  resubmitted:      { bg: "bg-blue-100",    text: "text-blue-700" },
  irdai_overdue:    { bg: "bg-red-100",     text: "text-red-700",   label: "IRDAI Overdue" },
  // Platform — subscription status (was PLATFORM_STATUS_PILL in platform-utils.ts).
  // "active"/"cancelled" reuse the patient/billing entries above rather than
  // duplicating a key with a different colour for the same word.
  trial:            { bg: "bg-blue-100",    text: "text-blue-700" },
  suspended:        { bg: "bg-red-100",     text: "text-red-600" },
  past_due:         { bg: "bg-amber-100",   text: "text-amber-700", label: "Past Due" },
  no_subscription:  { bg: "bg-slate-100",   text: "text-slate-600", label: "No Subscription" },
  // Platform — enterprise lead pipeline (was LEAD_STATUS_COLORS in PlansManagerPage.tsx)
  new:              { bg: "bg-blue-100",    text: "text-blue-700" },
  contacted:        { bg: "bg-amber-100",   text: "text-amber-700" },
  demo_scheduled:   { bg: "bg-purple-100",  text: "text-purple-700", label: "Demo Scheduled" },
  converted:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  lost:             { bg: "bg-red-100",     text: "text-red-600" },
  // Platform — admin audit log action types (was ACTION_STYLE in AuditLogPage.tsx)
  hospital_delete_requested: { bg: "bg-amber-100",   text: "text-amber-700", label: "Hospital Delete Requested" },
  hospital_purged:           { bg: "bg-red-100",     text: "text-red-600",   label: "Hospital Purged" },
  hospital_restored:         { bg: "bg-emerald-100", text: "text-emerald-700", label: "Hospital Restored" },
  admin_added:               { bg: "bg-blue-100",    text: "text-blue-700",  label: "Admin Added" },
  admin_deactivated:         { bg: "bg-amber-100",   text: "text-amber-700", label: "Admin Deactivated" },
  erasure_request_approved:  { bg: "bg-red-100",     text: "text-red-600",   label: "Erasure Request Approved" },
  erasure_request_rejected:  { bg: "bg-slate-100",   text: "text-slate-600", label: "Erasure Request Rejected" },
  impersonation_start:       { bg: "bg-purple-100",  text: "text-purple-700", label: "Impersonation Start" },
  impersonation_end:         { bg: "bg-purple-100",  text: "text-purple-600", label: "Impersonation End" },
};

/**
 * Raw `"bg text"` Tailwind classes for a status key, for the rare caller that
 * needs the same colour language on something that isn't a plain `<span>`
 * pill (e.g. an interactive "move to this status" button). Prefer
 * `<StatusBadge>` itself whenever a static display pill is all that's needed.
 */
export function getStatusBadgeClasses(status: string): string {
  const key = status?.toLowerCase() ?? "";
  const config = STATUS_CONFIG[key] ?? { bg: "bg-slate-100", text: "text-slate-600" };
  return `${config.bg} ${config.text}`;
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const key = status?.toLowerCase() ?? "";
  const config = STATUS_CONFIG[key] ?? { bg: "bg-slate-100", text: "text-slate-600" };
  const label = config.label ?? (status?.replace(/_/g, " ") ?? "Unknown");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium capitalize",
        config.bg,
        config.text,
        className
      )}
    >
      {label}
    </span>
  );
};

export default StatusBadge;
