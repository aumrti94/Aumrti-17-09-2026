/**
 * Roles permitted to generate the NABH weekly digest. Lifted out of
 * WeeklyDigestModal.tsx so that file exports only its component — a file mixing
 * component and non-component exports silently disables Fast Refresh for it.
 */
export const DIGEST_ALLOWED_ROLES = [
  "super_admin",
  "hospital_admin",
  "medical_superintendent",
  "quality_head",
  "quality_manager",
  "quality_officer",
];
