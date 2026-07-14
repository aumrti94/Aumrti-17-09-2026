import { supabase } from "@/integrations/supabase/client";

interface PostingData {
  triggerEvent: string;
  sourceModule: string;
  sourceId: string;
  amount: number;
  description: string;
  entryDate?: string;
  costCentreId?: string;
  hospitalId: string;
  postedBy: string;
}

export const autoPostJournalEntry = async (data: PostingData) => {
  try {
    // Guard: if the source is a bill already posted by the DB trigger (trg_auto_post_bill_journal),
    // skip to prevent a duplicate journal entry. Returns null — callers already have the bill committed.
    // Non-bill sources (payroll, assets, GRN) return null from maybeSingle and bypass this guard.
    const { data: billRow } = await (supabase as any)
      .from("bills")
      .select("posted_to_journal")
      .eq("id", data.sourceId)
      .maybeSingle();
    if (billRow?.posted_to_journal) return null;

    // 1. Find matching rule
    const { data: rule } = await (supabase as any)
      .from("auto_posting_rules")
      .select("*, debit_account:chart_of_accounts!auto_posting_rules_debit_account_id_fkey(id, code, name), credit_account:chart_of_accounts!auto_posting_rules_credit_account_id_fkey(id, code, name)")
      .eq("hospital_id", data.hospitalId)
      .eq("trigger_event", data.triggerEvent)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!rule) {
      // Log the missed posting so the admin can see what's not being journalised.
      // Stores enough of the original PostingData (description/posted_by/
      // entry_date/cost_centre_id) that a later retry can re-post the exact
      // same entry once the missing rule is added, not a reconstructed guess.
      (supabase as any).from("accounting_posting_failures").insert({
        hospital_id:     data.hospitalId,
        trigger_event:   data.triggerEvent,
        source_module:   data.sourceModule,
        source_id:       data.sourceId,
        amount:          data.amount,
        description:     data.description,
        posted_by:       data.postedBy || null,
        entry_date:      data.entryDate || null,
        cost_centre_id:  data.costCentreId || null,
      }).catch(() => {});
      return null;
    }

    // 2. Generate entry number
    const year = new Date().getFullYear();
    const { data: seqData } = await supabase.rpc("next_seq", { p_hospital_id: data.hospitalId, p_type: "journal" });
    // If next_seq returns null the DB trigger has already handled this bill — skip.
    if (seqData == null) return null;
    const entryNumber = `JE-${year}-${String(seqData).padStart(4, "0")}`;

    // 3. Create journal entry
    const { data: entry, error } = await (supabase as any)
      .from("journal_entries")
      .insert({
        hospital_id: data.hospitalId,
        entry_number: entryNumber,
        entry_date: data.entryDate || new Date().toISOString().split("T")[0],
        description: data.description,
        entry_type: `auto_${data.sourceModule}` as any,
        source_module: data.sourceModule,
        source_id: data.sourceId,
        total_debit: data.amount,
        total_credit: data.amount,
        is_balanced: true,
        // posted_by is a uuid FK — coerce an empty string to null so the insert
        // doesn't fail (and silently drop the journal) when no actor is known.
        posted_by: data.postedBy || null,
      })
      .select()
      .maybeSingle();

    if (error || !entry) {
      console.error("Journal entry creation failed:", error);
      return null;
    }

    // 4. Create debit + credit line items
    await supabase.from("journal_line_items").insert([
      {
        hospital_id: data.hospitalId,
        journal_id: entry.id,
        account_id: rule.debit_account_id,
        account_code: rule.debit_account?.code || "",
        account_name: rule.debit_account?.name || "",
        debit_amount: data.amount,
        credit_amount: 0,
        description: data.description,
        cost_centre_id: data.costCentreId || null,
      },
      {
        hospital_id: data.hospitalId,
        journal_id: entry.id,
        account_id: rule.credit_account_id,
        account_code: rule.credit_account?.code || "",
        account_name: rule.credit_account?.name || "",
        debit_amount: 0,
        credit_amount: data.amount,
        description: data.description,
        cost_centre_id: data.costCentreId || null,
      },
    ]);

    // 5. Mark the source bill as journal-posted.
    // No-op if sourceId is not a bills row (e.g. asset, GRN, payroll).
    await (supabase as any).from("bills")
      .update({ posted_to_journal: true })
      .eq("id", data.sourceId);

    return entry;
  } catch (err) {
    console.error("Auto-posting failed:", err);
    return null;
  }
};

// Category → debit account code mapping for manual expense posting
export const EXPENSE_CATEGORY_ACCOUNT: Record<string, string> = {
  salary: "5001", rent: "5020", electricity: "5021", water: "5022",
  telephone: "5023", internet: "5023", fuel: "5060", vehicle: "5060",
  maintenance: "5030", repair: "5030", housekeeping: "5032",
  laundry: "5060", catering: "5060", insurance: "5051",
  professional_fees: "5040", marketing: "5041",
  printing: "5042", stationery: "5042", bank_charges: "5043",
  depreciation: "5050", miscellaneous: "5060", other: "5060",
};

// Payment mode → credit account code
export const PAYMENT_MODE_ACCOUNT: Record<string, string> = {
  cash: "1001", bank_transfer: "1002", upi: "1002", cheque: "1002", card: "1002",
};

// Manual journal entry with specific debit/credit accounts (bypasses auto_posting_rules)
export const postManualExpenseJournal = async (data: {
  hospitalId: string;
  postedBy: string;
  amount: number;
  description: string;
  expenseCategory: string;
  paymentMode: string;
  sourceId: string;
  costCentreId?: string;
  entryDate?: string;
}) => {
  try {
    const debitCode = EXPENSE_CATEGORY_ACCOUNT[data.expenseCategory] || "5060";
    const creditCode = PAYMENT_MODE_ACCOUNT[data.paymentMode] || "1001";

    // Lookup accounts
    const [{ data: debitAcct }, { data: creditAcct }] = await Promise.all([
      (supabase as any).from("chart_of_accounts").select("id, code, name").eq("hospital_id", data.hospitalId).eq("code", debitCode).maybeSingle(),
      (supabase as any).from("chart_of_accounts").select("id, code, name").eq("hospital_id", data.hospitalId).eq("code", creditCode).maybeSingle(),
    ]);

    if (!debitAcct || !creditAcct) return null;

    const year = new Date().getFullYear();
    const { data: seqData2 } = await supabase.rpc("next_seq", { p_hospital_id: data.hospitalId, p_type: "journal" });
    if (seqData2 == null) return null;
    const entryNumber = `JE-${year}-${String(seqData2).padStart(4, "0")}`;

    const { data: entry, error } = await (supabase as any).from("journal_entries").insert({
      hospital_id: data.hospitalId,
      entry_number: entryNumber,
      entry_date: data.entryDate || new Date().toISOString().split("T")[0],
      description: data.description,
      entry_type: "manual" as any,
      source_module: "accounts",
      source_id: data.sourceId,
      total_debit: data.amount,
      total_credit: data.amount,
      is_balanced: true,
      posted_by: data.postedBy || null,
    }).select().maybeSingle();

    if (error || !entry) return null;

    await supabase.from("journal_line_items").insert([
      { hospital_id: data.hospitalId, journal_id: entry.id, account_id: debitAcct.id, account_code: debitAcct.code, account_name: debitAcct.name, debit_amount: data.amount, credit_amount: 0, description: data.description, cost_centre_id: data.costCentreId || null },
      { hospital_id: data.hospitalId, journal_id: entry.id, account_id: creditAcct.id, account_code: creditAcct.code, account_name: creditAcct.name, debit_amount: 0, credit_amount: data.amount, description: data.description, cost_centre_id: data.costCentreId || null },
    ]);

    return entry;
  } catch (err) {
    console.error("Manual expense posting failed:", err);
    return null;
  }
};

// Multi-line (>2) balanced journal by account CODE. Used where a single event splits across
// more than two accounts (e.g. GRN: Dr goods + Dr GST input credit / Cr AP). If any account
// code can't be resolved the whole entry is skipped and logged to accounting_posting_failures.
export const postMultiLineJournal = async (data: {
  hospitalId: string;
  postedBy: string;
  sourceModule: string;
  sourceId: string;
  description: string;
  entryDate?: string;
  triggerEvent?: string;
  lines: { accountCode: string; debit?: number; credit?: number; description?: string }[];
}) => {
  try {
    const codes = Array.from(new Set(data.lines.map((l) => l.accountCode)));
    const { data: accts } = await (supabase as any)
      .from("chart_of_accounts")
      .select("id, code, name")
      .eq("hospital_id", data.hospitalId)
      .in("code", codes);
    const byCode: Record<string, any> = {};
    (accts || []).forEach((a: any) => { byCode[a.code] = a; });

    const totalDebit = data.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = data.lines.reduce((s, l) => s + (l.credit || 0), 0);
    const missing = data.lines.some((l) => !byCode[l.accountCode]);
    if (missing || Math.abs(totalDebit - totalCredit) > 0.01) {
      await (supabase as any).from("accounting_posting_failures").insert({
        hospital_id: data.hospitalId, trigger_event: data.triggerEvent || "multi_line",
        source_module: data.sourceModule, source_id: data.sourceId,
        amount: totalDebit, description: data.description, posted_by: data.postedBy || null,
        entry_date: data.entryDate || null,
      }).catch(() => {});
      return null;
    }

    const year = new Date().getFullYear();
    const { data: seq } = await supabase.rpc("next_seq", { p_hospital_id: data.hospitalId, p_type: "journal" });
    if (seq == null) return null;
    const entryNumber = `JE-${year}-${String(seq).padStart(4, "0")}`;

    const { data: entry, error } = await (supabase as any).from("journal_entries").insert({
      hospital_id: data.hospitalId, entry_number: entryNumber,
      entry_date: data.entryDate || new Date().toISOString().split("T")[0],
      description: data.description, entry_type: `auto_${data.sourceModule}` as any,
      source_module: data.sourceModule, source_id: data.sourceId,
      total_debit: totalDebit, total_credit: totalCredit, is_balanced: true, posted_by: data.postedBy || null,
    }).select().maybeSingle();
    if (error || !entry) return null;

    await supabase.from("journal_line_items").insert(
      data.lines.map((l) => ({
        hospital_id: data.hospitalId, journal_id: entry.id,
        account_id: byCode[l.accountCode].id, account_code: l.accountCode, account_name: byCode[l.accountCode].name,
        debit_amount: l.debit || 0, credit_amount: l.credit || 0, description: l.description || data.description,
      }))
    );
    return entry;
  } catch (err) {
    console.error("Multi-line posting failed:", err);
    return null;
  }
};
