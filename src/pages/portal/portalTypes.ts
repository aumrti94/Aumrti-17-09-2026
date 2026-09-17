// Split out of PortalLogin.tsx when that file's own login component was deleted 2026-09-05
// (superseded by PatientPortalLogin — see PatientPortal.tsx). Nine files depended on this
// type via `import type { PortalSession } from "./PortalLogin"`; moving it here let the dead
// component go without carrying the type down with it.
export interface PortalSession {
  patientId: string;
  hospitalId: string;
  fullName: string;
  uhid: string;
  phone: string;
  hospitalName: string;
  hospitalLogo: string | null;
  bloodGroup: string | null;
}
