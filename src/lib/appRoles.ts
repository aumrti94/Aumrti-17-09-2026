/**
 * The canonical list of app_role enum values, shared wherever a role must be
 * picked or displayed (role editor, discount-approval config, approval gates).
 *
 * These MUST match the `app_role` Postgres enum used by `users.role` and
 * `role_permissions.role_name`. Extracted from SettingsRolesPage's private
 * VALID_APP_ROLES so the discount-approval authorization config and the role
 * editor cannot drift apart — a role offered as an approver must be a role a
 * user can actually hold, or authorization silently never matches (which is
 * exactly what happened with the non-existent "billing_supervisor").
 */

export interface AppRole {
  value: string;
  label: string;
}

export const APP_ROLES: AppRole[] = [
  { value: "super_admin",       label: "Super Admin" },
  { value: "hospital_admin",    label: "Admin" },
  { value: "doctor",            label: "Doctor" },
  { value: "nurse",             label: "Nurse" },
  { value: "receptionist",      label: "Reception" },
  { value: "pharmacist",        label: "Pharmacist" },
  { value: "lab_tech",          label: "Lab Tech" },
  { value: "lab_technician",    label: "Lab Technician" },
  { value: "radiologist",       label: "Radiologist" },
  { value: "accountant",        label: "Accountant" },
  { value: "billing_executive", label: "Billing Executive" },
  { value: "billing_staff",     label: "Billing Staff" },
  { value: "hr_manager",        label: "HR Manager" },
  { value: "cfo",               label: "CFO" },
];

/**
 * Roles that may approve ANY discount tier regardless of the tier's configured
 * approver set — top-of-house always retains override authority. Mirrored by
 * the DB enforcement trigger.
 */
export const DISCOUNT_OVERRIDE_ROLES = ["hospital_admin", "super_admin"] as const;

const LABEL_BY_VALUE = new Map(APP_ROLES.map((r) => [r.value, r.label]));

/** Human label for a role value; falls back to the raw value when unknown. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return LABEL_BY_VALUE.get(role) ?? role;
}

/** Comma-joined labels for a set of roles, e.g. "CFO, Admin". */
export function roleLabels(roles: string[] | null | undefined): string {
  if (!roles || roles.length === 0) return "—";
  return roles.map(roleLabel).join(", ");
}

/**
 * Whether `role` is authorized to approve a tier whose configured approvers are
 * `requiredRoles`. Override roles always qualify.
 */
export function canApproveTier(
  role: string | null | undefined,
  requiredRoles: string[] | null | undefined
): boolean {
  if (!role) return false;
  if ((DISCOUNT_OVERRIDE_ROLES as readonly string[]).includes(role)) return true;
  return (requiredRoles ?? []).includes(role);
}
