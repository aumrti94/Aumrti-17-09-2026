import { ALL_MODULES } from './modules';
import { ROUTE_TO_MODULE_KEY } from '@/lib/moduleKeys';
import { LEGACY_MODULE_PARENT } from './moduleRegistry';

export const ROUTE_ROLES: Record<string, string[]> = {};

ALL_MODULES.forEach(m => {
  const path = m.route.split('?')[0];
  ROUTE_ROLES[path] = m.roles;
});

ROUTE_ROLES['/ipd/day-care'] = ['doctor', 'nurse', 'receptionist', 'billing_executive', 'super_admin', 'hospital_admin'];

// Override / add explicit admin-only routes
ROUTE_ROLES['/settings'] = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/accounts'] = ['accountant', 'billing_executive', 'billing_staff', 'cfo', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/hr'] = ['hr_manager', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/billing'] = ['accountant', 'billing_executive', 'billing_staff', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/billing/closure'] = ['accountant', 'billing_executive', 'cfo', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/insurance'] = ['billing_executive', 'insurance_executive', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/lab'] = ['lab_technician', 'lab_tech', 'doctor', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/radiology'] = ['radiologist', 'doctor', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/nabh/compliance'] = ['super_admin', 'hospital_admin', 'quality_officer', 'quality_manager'];
ROUTE_ROLES['/quality/events'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
  'doctor', 'nurse', 'receptionist', 'nursing_supervisor',
];
ROUTE_ROLES['/ipc/dashboard'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
  'doctor', 'nurse', 'nursing_supervisor',
];
ROUTE_ROLES['/quality/clinical-audits'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
  'doctor', 'nursing_supervisor',
];
ROUTE_ROLES['/quality/qi-projects'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
  'doctor', 'nursing_supervisor',
];
ROUTE_ROLES['/quality/committees'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
  'doctor', 'nursing_supervisor',
];
ROUTE_ROLES['/fms/dashboard'] = [
  'super_admin', 'hospital_admin', 'quality_officer', 'quality_manager',
];
ROUTE_ROLES['/abdm'] = ['super_admin', 'hospital_admin', 'doctor', 'billing_executive'];
ROUTE_ROLES['/settings/record-retention'] = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/change-log']  = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/tv-display']    = ['super_admin', 'hospital_admin', 'receptionist'];
ROUTE_ROLES['/settings/ai-languages']  = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/integrations']  = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/product-mode']  = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/analytics/forecasts']            = ['super_admin', 'hospital_admin', 'cfo', 'doctor'];
ROUTE_ROLES['/analytics/population-health']    = ['super_admin', 'hospital_admin', 'doctor', 'quality_officer', 'quality_manager'];
ROUTE_ROLES['/analytics/revenue-intelligence'] = ['super_admin', 'hospital_admin', 'cfo'];
ROUTE_ROLES['/notifications']                  = ['super_admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist'];
ROUTE_ROLES['/emergency/mci']                  = ['super_admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist'];
ROUTE_ROLES['/quality/jci']                    = ['super_admin', 'hospital_admin', 'quality_officer', 'quality_manager'];
ROUTE_ROLES['/accounts/financial-statements']  = ['super_admin', 'hospital_admin', 'cfo', 'accountant'];
ROUTE_ROLES['/accounts/budget']                = ['super_admin', 'hospital_admin', 'cfo', 'accountant'];
ROUTE_ROLES['/accounts/fixed-assets']          = ['super_admin', 'hospital_admin', 'cfo', 'accountant'];
ROUTE_ROLES['/settings/api-portal']            = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/hl7']                   = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/settings/white-label']           = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/ai/clinical-intelligence']       = ['super_admin', 'hospital_admin', 'doctor', 'nursing_supervisor'];
ROUTE_ROLES['/research']                       = ['super_admin', 'hospital_admin', 'quality_officer', 'quality_manager'];
ROUTE_ROLES['/admin/go-live'] = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/design-system'] = ['super_admin', 'hospital_admin'];
ROUTE_ROLES['/admin/data-migration'] = ['super_admin', 'hospital_admin'];

// Core authenticated routes
ROUTE_ROLES['/dashboard'] = [
  'doctor', 'nurse', 'receptionist', 'pharmacist',
  'lab_technician', 'lab_tech',
  'radiologist',
  'billing_executive', 'billing_staff', 'accountant',
  'hr_manager', 'cfo',
  'super_admin', 'hospital_admin',
];
ROUTE_ROLES['/patients'] = ['doctor', 'nurse', 'receptionist', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/modules'] = [
  'doctor', 'nurse', 'receptionist', 'pharmacist',
  'lab_technician', 'lab_tech',
  'radiologist',
  'billing_executive', 'billing_staff', 'accountant',
  'hr_manager', 'cfo',
  'super_admin', 'hospital_admin',
];
ROUTE_ROLES['/schedule'] = ['receptionist', 'doctor', 'nurse', 'super_admin', 'hospital_admin'];
ROUTE_ROLES['/inbox'] = [
  'doctor', 'nurse', 'receptionist', 'pharmacist',
  'billing_executive', 'billing_staff', 'super_admin', 'hospital_admin',
];

export const BYPASS_ROLES = ["super_admin", "hospital_admin"];

/**
 * Mapping from route path to the module key used in the role_permissions blob.
 *
 * Derived from the canonical `ROUTE_TO_MODULE_KEY` (the same map Layers 1 & 2 use) so a
 * route resolves to its OWN module key instead of being bucketed into one of ~18 parents.
 * Only the internal governance / convenience routes that the sellable registry does not
 * carry are added on top. Specialty modules that previously inherited a bucket keep working
 * via the LEGACY_MODULE_PARENT fallback in `hasAccess`/`hasPermission` below.
 */
export const ROUTE_TO_MODULE: Record<string, string> = {
  ...ROUTE_TO_MODULE_KEY,
  // Internal / non-sellable governance routes (not in the canonical registry)
  "/patients": "patients",
  "/reports": "reports",
  "/users": "user_management",
  "/schedule": "opd",
  "/teleconsult": "telemedicine",
  // Quality sub-pages resolve to the quality module
  "/quality/events": "quality",
  "/quality/clinical-audits": "quality",
  "/quality/qi-projects": "quality",
  "/quality/committees": "quality",
};

/**
 * Resolve a module's permission entry from the blob, falling back to the legacy parent
 * bucket when the specific key is absent. This keeps modules that USED to inherit a
 * bucket (e.g. /dialysis → ipd) working for role blobs written before the rewire, until
 * the backfill migration normalizes them.
 */
function resolveModPerms(permissions: Record<string, any>, moduleKey: string): any {
  const direct = permissions[moduleKey];
  if (direct !== undefined && direct !== null) return direct;
  const parent = LEGACY_MODULE_PARENT[moduleKey];
  if (parent) return permissions[parent];
  return undefined;
}

/**
 * Checks if a role (or specifically its permissions) has access to a path
 */
export function hasAccess(
  path: string, 
  role: string | null, 
  permissions?: Record<string, any> | null
): boolean {
  if (!role) return false;
  
  // 1. Hard-coded bypass roles (Super Admin / Admin always have access)
  if (BYPASS_ROLES.includes(role)) return true;

  const normalizedPath = path.split("?")[0].replace(/\/$/, "") || "/";

  // 1.5 Core routes that all authenticated users can access
  const coreRoutes = ["/dashboard", "/modules", "/settings/profile", "/inbox", "/my-hr"];
  if (coreRoutes.includes(normalizedPath)) return true;

  // 2. Check Database Overrides (Dynamic Permissions)
  // When permissions is explicitly set (even empty {}), use ONLY permissions — no static fallthrough.
  // This ensures a role with zero permissions configured is denied, not granted by static defaults.
  if (permissions !== null && permissions !== undefined) {
    if (permissions.all === true) return true;

    // Find the module key by checking exact matches or parent prefixes
    let moduleKey = ROUTE_TO_MODULE[normalizedPath];

    if (!moduleKey) {
      const parentPath = Object.keys(ROUTE_TO_MODULE).find(p =>
        normalizedPath === p || normalizedPath.startsWith(p + "/")
      );
      if (parentPath) {
        moduleKey = ROUTE_TO_MODULE[parentPath];
      }
    }

    if (moduleKey) {
      const modPerms = resolveModPerms(permissions, moduleKey);

      if (modPerms) {
        if (typeof modPerms === "string") {
          return modPerms === "r" || modPerms === "rw";
        }
        if (typeof modPerms === "object") {
          return (modPerms as any).view === true;
        }
      }

      return false;
    }

    // Path has no module mapping — deny by default when permissions are explicitly configured
    return false;
  }

  // 3. Fallback to Static System Definitions (only when no permissions row configured)
  const allowedRoles = ROUTE_ROLES[normalizedPath];
  if (!allowedRoles) return false;

  return allowedRoles.includes(role);
}

/**
 * Checks if a user has a specific granular permission for a module
 */
export function hasPermission(
  moduleKey: string, 
  action: "view" | "create" | "edit" | "delete" | "approve" | "export", 
  permissions: Record<string, any> | null,
  role: string | null
): boolean {
  if (!role) return false;
  if (BYPASS_ROLES.includes(role)) return true;
  if (!permissions) return false;
  if (permissions.all === true) return true;

  const modPerms = resolveModPerms(permissions, moduleKey);
  if (!modPerms) return false;

  // Handle legacy string format
  if (typeof modPerms === "string") {
    if (action === "view") return modPerms === "r" || modPerms === "rw";
    if (action === "create" || action === "edit" || action === "delete") return modPerms === "rw";
    if (action === "export") return modPerms === "r" || modPerms === "rw";
    return false;
  }

  // Handle granular object format
  return !!(modPerms as any)[action];
}

