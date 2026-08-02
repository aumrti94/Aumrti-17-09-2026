/**
 * Drug batch expiry bucketing. Lifted out of ExpiryControlTab.tsx so that file
 * exports only its component — a file mixing component and non-component exports
 * silently disables Fast Refresh for it.
 */
export type ExpiryGroup = "expired" | "critical" | "warning" | "ok";

export function getGroup(expiryDate: string): ExpiryGroup {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "critical";
  if (daysLeft <= 90) return "warning";
  return "ok";
}
