/**
 * dayCareProcedures — the procedures booked on one day care admission.
 *
 * A booking used to be one procedure (admissions.day_care_procedure_id). It is now a set,
 * held in admission_day_care_procedures (migration 20261008000158), because a day care list
 * routinely bundles procedures and a bilateral case is one procedure done twice.
 *
 * Everything downstream of the booking — the estimate amount, the deposit bar, the bill —
 * must agree on what "the charge for this booking" means, so that arithmetic lives here as
 * pure functions and nowhere else.
 *
 * The rate is the one FROZEN at booking (`rate`), never a fresh read of
 * day_care_procedures.standard_rate: the master is editable in Settings, and a patient must
 * be billed the figure they were quoted and deposited against.
 */

import { supabase } from "@/integrations/supabase/client";

/** A procedure as selected in the booking modal (rate still live from the master). */
export interface DayCareProcedureSelection {
  procedureId:   string;
  procedureName: string;
  rate:          number;
  quantity:      number;
  durationMinutes?: number;
  preAuthRequired?: boolean;
}

/** Coerce to a finite non-negative number — keeps NaN out of money maths. */
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Coerce to a whole quantity of at least 1 — mirrors the CHECK (quantity > 0). */
export function normalizeQuantity(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** PURE. Charge for one line: frozen rate × quantity. */
export function lineTotal(p: { rate: number; quantity: number }): number {
  return money(p.rate) * normalizeQuantity(p.quantity);
}

/**
 * PURE. The total charge for a booking — what the estimate is seeded from, what the
 * deposit percentage applies to, and what the bill lines must add up to.
 */
export function totalProcedureCharge(
  procedures: Array<{ rate: number; quantity: number }>
): number {
  return Math.round(procedures.reduce((sum, p) => sum + lineTotal(p), 0));
}

/** PURE. Total theatre/chair time, for the board's duration column. */
export function totalDurationMinutes(
  procedures: Array<{ durationMinutes?: number | null; quantity: number }>
): number {
  return procedures.reduce(
    (sum, p) => sum + money(p.durationMinutes) * normalizeQuantity(p.quantity),
    0
  );
}

/** PURE. Any procedure needing pre-auth makes the whole booking need pre-auth. */
export function anyPreAuthRequired(
  procedures: Array<{ preAuthRequired?: boolean | null }>
): boolean {
  return procedures.some(p => !!p.preAuthRequired);
}

/**
 * PURE. One-line label for lists: "Cataract ×2 +1 more".
 * Full detail belongs in the detail panel, not a table cell.
 */
export function describeProcedures(
  procedures: Array<{ procedureName: string; quantity: number }>
): string | null {
  if (procedures.length === 0) return null;
  const [first, ...rest] = procedures;
  const qty = normalizeQuantity(first.quantity);
  const head = qty > 1 ? `${first.procedureName} ×${qty}` : first.procedureName;
  return rest.length > 0 ? `${head} +${rest.length} more` : head;
}

/** PURE. Full multi-line label for the estimate/receipt narrative. */
export function listProcedures(
  procedures: Array<{ procedureName: string; quantity: number }>
): string {
  return procedures
    .map(p => {
      const qty = normalizeQuantity(p.quantity);
      return qty > 1 ? `${p.procedureName} ×${qty}` : p.procedureName;
    })
    .join(", ");
}

/**
 * PURE. Toggle a procedure in/out of the selection, preserving order of first pick.
 * The first selected procedure is the primary one written to
 * admissions.day_care_procedure_id, so order is meaningful — do not sort this.
 */
export function toggleProcedure(
  selected: DayCareProcedureSelection[],
  proc: Omit<DayCareProcedureSelection, "quantity">
): DayCareProcedureSelection[] {
  const existing = selected.findIndex(s => s.procedureId === proc.procedureId);
  if (existing >= 0) return selected.filter((_, i) => i !== existing);
  return [...selected, { ...proc, quantity: 1 }];
}

/** PURE. Set the quantity of an already-selected procedure. */
export function setProcedureQuantity(
  selected: DayCareProcedureSelection[],
  procedureId: string,
  quantity: number
): DayCareProcedureSelection[] {
  return selected.map(s =>
    s.procedureId === procedureId ? { ...s, quantity: normalizeQuantity(quantity) } : s
  );
}

/** The searchable fields of a procedure in the price master. */
export interface SearchableProcedure {
  procedure_name: string;
  procedure_code?: string | null;
  specialty?: string | null;
}

/**
 * PURE. Type-to-filter for the booking dropdown.
 *
 * Every whitespace-separated term must match somewhere, so "eye cat" finds an
 * ophthalmology cataract regardless of the order the user types them in — matching on the
 * whole string instead would find nothing and read as "we don't have that procedure".
 */
export function filterProcedureOptions<T extends SearchableProcedure>(
  options: T[],
  query: string
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter(o => {
    const haystack = [o.procedure_name, o.procedure_code, o.specialty]
      .filter(Boolean).join(" ").toLowerCase();
    return terms.every(t => haystack.includes(t));
  });
}

/** Map a joined admission_day_care_procedures row to the shared shape. */
export function mapProcedureRow(row: any): DayCareProcedureSelection {
  return {
    procedureId:     row.procedure_id,
    procedureName:   row.procedure?.procedure_name || "Day care procedure",
    // Frozen rate, with the master rate only as a fallback for a row written before
    // the freeze existed (there are none — the backfill sets it — but 0 would be a
    // silent money loss, so fall back rather than trust).
    rate:            money(row.rate) || money(row.procedure?.standard_rate),
    quantity:        normalizeQuantity(row.quantity),
    durationMinutes: Number(row.procedure?.duration_minutes) || 0,
    preAuthRequired: !!row.procedure?.pre_auth_required,
  };
}

/** The select fragment used wherever a booking's procedures are joined in. */
export const DAY_CARE_PROCEDURES_SELECT = `
  day_care_items:admission_day_care_procedures(
    procedure_id, quantity, rate,
    procedure:day_care_procedures(procedure_name, duration_minutes, standard_rate, pre_auth_required)
  )
`;

/** I/O. Read one booking's procedures. */
export async function fetchAdmissionProcedures(
  admissionId: string
): Promise<DayCareProcedureSelection[]> {
  const { data } = await (supabase as any)
    .from("admission_day_care_procedures")
    .select(`
      procedure_id, quantity, rate,
      procedure:day_care_procedures(procedure_name, duration_minutes, standard_rate, pre_auth_required)
    `)
    .eq("admission_id", admissionId)
    .order("created_at");
  return (data || []).map(mapProcedureRow);
}

/**
 * I/O. Write the booked procedures for a new admission.
 *
 * Returns the error message on failure so the caller can roll the booking back — a booking
 * with no procedure rows is a booking with no money attached, which is worse than no booking.
 */
export async function saveAdmissionProcedures(
  hospitalId: string,
  admissionId: string,
  procedures: DayCareProcedureSelection[]
): Promise<string | null> {
  if (procedures.length === 0) return "No procedures selected";
  const { error } = await (supabase as any).from("admission_day_care_procedures").insert(
    procedures.map(p => ({
      hospital_id:  hospitalId,
      admission_id: admissionId,
      procedure_id: p.procedureId,
      quantity:     normalizeQuantity(p.quantity),
      rate:         money(p.rate),
    }))
  );
  return error?.message ?? null;
}
