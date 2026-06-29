import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const IST = "Asia/Kolkata";

/** Format a UTC ISO string to IST date: "15 Apr 2026" */
export function formatDateIST(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const zoned = toZonedTime(new Date(isoString), IST);
    return format(zoned, "dd MMM yyyy");
  } catch {
    return "—";
  }
}

/** Format a UTC ISO string to IST date+time: "15 Apr 2026, 14:30" */
export function formatDateTimeIST(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const zoned = toZonedTime(new Date(isoString), IST);
    return format(zoned, "dd MMM yyyy, HH:mm");
  } catch {
    return "—";
  }
}

/** Format as IST time only: "14:30" */
export function formatTimeIST(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const zoned = toZonedTime(new Date(isoString), IST);
    return format(zoned, "HH:mm");
  } catch {
    return "—";
  }
}
