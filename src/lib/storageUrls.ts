// ── Supabase Storage URL helpers ────────────────────────────────────────────
//
// Private buckets can't be linked to directly — every view has to go through a
// short-lived signed URL. Historically each upload site hand-rolled this, and
// several stored a full `getPublicUrl(...)` result in the database instead of a
// storage path. Rows written before a bucket was made private therefore hold a
// public URL, while new rows hold a bare path.
//
// `resolveStorageUrl` accepts either shape so the two can coexist without a
// flag day. Same tolerance the insurance checklist already relies on — see
// DocumentChecklist.tsx, which signs bare paths and passes through the full
// URLs returned by the auto-fetch edge functions.

import { supabase } from "@/integrations/supabase/client";

/**
 * Bucket names, so callers don't repeat string literals.
 *
 * PUBLIC_ASSETS is deliberately the only public one — branding images have to
 * load without auth in <img> tags and print views. Everything holding PHI or
 * staff PII lives in a private bucket and is read through a signed URL.
 */
export const BUCKETS = {
  patientDocuments: "patient-documents",
  insuranceDocuments: "insurance-documents",
  grnInvoices: "grn-invoices",
  dicom: "dicom",
  woundPhotos: "wound-photos",
  /** Staff documents, credential docs, expense receipts. */
  hospitalPrivate: "hospital-private",
  /** Public — branding/logos only. */
  publicAssets: "hospital-assets",
} as const;

/** decodeURIComponent that leaves malformed input alone instead of throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A literal '%' in the filename — already decoded, use as-is.
    return value;
  }
}

/**
 * Extract the object path from a Supabase Storage URL for `bucket`.
 * Returns null when the URL doesn't point at that bucket (e.g. a document
 * fetched from an external system), so callers can pass it through untouched.
 */
export function storagePathFromPublicUrl(bucket: string, url: string): string | null {
  // Strip query (`?token=`, cache-busters) and fragment before matching.
  const clean = url.split("#")[0].split("?")[0];

  // Prefer the canonical shapes; fall back to a bare `/<bucket>/` so that
  // hand-built or proxied URLs still resolve.
  const markers = [
    `/object/public/${bucket}/`,
    `/object/sign/${bucket}/`,
    `/${bucket}/`,
  ];

  for (const marker of markers) {
    const idx = clean.indexOf(marker);
    if (idx >= 0) return safeDecode(clean.slice(idx + marker.length));
  }
  return null;
}

/**
 * Turn a stored file reference into something openable.
 *
 *  • bare storage path        → signed URL
 *  • public URL for `bucket`  → path derived, then signed
 *  • any other http(s) URL    → returned unchanged (externally hosted)
 *
 * Throws when signing fails so callers can surface a toast.
 */
export async function resolveStorageUrl(
  bucket: string,
  stored: string,
  expiresIn = 3600,
): Promise<string> {
  let path: string;

  if (/^https?:\/\//i.test(stored)) {
    const derived = storagePathFromPublicUrl(bucket, stored);
    if (!derived) return stored; // not ours — leave it alone
    path = derived;
  } else {
    // Backfilled values keep the percent-encoding `getPublicUrl` applied.
    path = safeDecode(stored);
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Could not generate a link for this file");
  }
  return data.signedUrl;
}

/**
 * Resolve and open in a new tab. Convenience for the many list rows that just
 * need a working "View" button; returns false when signing failed so the
 * caller can toast.
 */
export async function openStoredFile(bucket: string, stored: string): Promise<boolean> {
  try {
    const url = await resolveStorageUrl(bucket, stored);
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
