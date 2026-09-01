/**
 * The unified shape the OPD/IPD Reports panel renders.
 *
 * Lab, microbiology, histopathology, referred-out tests and imaging live in five different
 * tables with five different row shapes. Rather than forcing them into one table layout —
 * which is how a culture ends up displayed as if it were a number — each is normalised into
 * a ReportCard for the list, and the untouched source row is carried in `payload` so the
 * detail drawer can render each in its own idiom.
 */

export type ReportKind = "lab" | "micro" | "pathology" | "external" | "radiology";

export interface ReportCard {
  /** Unique across kinds — "lab:<uuid>", "radiology:<uuid>", … */
  key: string;
  kind: ReportKind;
  /** Primary key of the record this card represents. */
  id: string;
  /**
   * For microbiology and histopathology, the parent lab_orders.id. Microbiology is
   * acknowledged on the parent order (lab_results has no review stamp of its own).
   */
  parentId?: string;
  /** radiology_reports.id — the review stamp for imaging lives on the report, not the order. */
  reportId?: string;
  /** YYYY-MM-DD used for date grouping. */
  date: string;
  title: string;
  subtitle?: string;
  /** Raw DB status; rendered through the shared StatusBadge. */
  status: string;
  priority?: string | null;
  /** Released by the lab/radiologist and therefore safe for the doctor to act on. */
  released: boolean;
  /** A clinician has acknowledged reading it. */
  reviewed: boolean;
  /** Re-issued after sign-off — must be read again even if previously reviewed. */
  amended?: boolean;
  /** Critical value or critical imaging finding. */
  critical: boolean;
  abnormalCount?: number;
  /** When the result was released, not when it was ordered. */
  resultedAt?: string | null;
  hasImages?: boolean;
  /** The source row(s), passed straight to the detail renderer for this kind. */
  payload: any;
}
