/**
 * Local-date formatting for OT schedule queries — avoids the UTC shift that
 * toISOString() introduces. Lifted out of OTPage.tsx so that file exports only
 * its component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export const formatDateForQuery = (date: Date | string): string => {
  const d = typeof date === "string" ? new Date(date + (date.includes("T") ? "" : "T00:00:00")) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
