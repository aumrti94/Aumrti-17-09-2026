/**
 * documentNumber — the one place a mortuary / MLC / MCCD / journal-voucher number is minted.
 *
 * These numbers used to be invented at each call site, three different ways, none of them
 * safe:
 *
 *   edMortuary.ts       BODY-2026-${Math.random()*9000+1000}    — collides ~1 in 9000
 *   MortuaryPage.tsx    BODY-2026-${admissions.length + 1}      — length of an in-memory,
 *                                                                 already-FILTERED array
 *   AdmitPatientModal   MLC-2026-${Date.now().slice(-4)}        — two admits in the same
 *                                                                 10s window collide
 *
 * The `.length + 1` variants are the worst of the three: they count the rows currently
 * loaded in the browser, not the rows in the table, so they restart from 1 whenever the
 * list is filtered or paginated and repeat forever once any row is deleted.
 *
 * All of them now draw from `next_seq(hospital_id, type)` (20260510000002), the same atomic
 * INSERT … ON CONFLICT … RETURNING counter that journal entries, UHIDs and radiology
 * accessions already use. It is per-hospital, so two hospitals keep independent series —
 * which is the whole reason 20261008000159 moved these columns off a global UNIQUE and onto
 * UNIQUE (hospital_id, <number>).
 *
 * Like `next_seq` everywhere else in the app the counter does not reset each year; the year
 * in the label is descriptive, not part of the key. Matching that keeps one behaviour rather
 * than two.
 */

import { supabase } from "@/integrations/supabase/client";

/** Series a document number can be drawn from. The value is the `next_seq` seq_type key. */
export type DocumentNumberKind = "body" | "mlc" | "mccd" | "journal_voucher";

const PREFIX: Record<DocumentNumberKind, string> = {
  body: "BODY",
  mlc: "MLC",
  mccd: "MCCD",
  journal_voucher: "JV",
};

/** PURE. Assembles the label; separated from the I/O so it can be tested without a DB. */
export function formatDocumentNumber(
  kind: DocumentNumberKind,
  seq: number,
  year: number = new Date().getFullYear()
): string {
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Mint the next number in this hospital's series.
 *
 * Throws when the sequence cannot be read. Deliberately no `Date.now()` / random fallback:
 * a fabricated identifier is worse than a failed save, because it lands in the register
 * looking legitimate and only surfaces later as a duplicate or an unreconcilable gap. This
 * mirrors `generateAdmissionNumber`'s "never write a guessed identifier" rule.
 */
export async function nextDocumentNumber(
  hospitalId: string,
  kind: DocumentNumberKind
): Promise<string> {
  const { data, error } = await (supabase as any).rpc("next_seq", {
    p_hospital_id: hospitalId,
    p_type: kind,
  });
  if (error || data == null) {
    throw new Error(error?.message || `Could not generate a ${PREFIX[kind]} number`);
  }
  return formatDocumentNumber(kind, Number(data));
}
