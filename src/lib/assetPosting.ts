// ─────────────────────────────────────────────────────────────────────────────
// Pure builders for fixed-asset GL journal lines. Kept separate from the UI so
// the double-entry balancing is unit-testable. Amounts use the seed chart of
// accounts (1101-1105 asset, 1110 accumulated dep, 1002 bank, 3001 capital,
// 4020 gain / other income, 5060 loss / misc expense).
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export const CATEGORY_ASSET_ACCOUNT: Record<string, string> = {
  medical_equipment: "1101",
  furniture:         "1102",
  it_equipment:      "1103",
  vehicle:           "1104",
  building:          "1105",
  land:              "1105",
  other:             "1101",
};

export function assetAccountFor(category: string): string {
  return CATEGORY_ASSET_ACCOUNT[category] || "1101";
}

/** Fresh purchase — Dr asset / Cr funding source (bank / AP / capital). */
export function buildAcquisitionLines(assetAccount: string, cost: number, fundingAccount: string, name = ""): JournalLineInput[] {
  return [
    { accountCode: assetAccount, debit: cost, description: `Acquisition — ${name}` },
    { accountCode: fundingAccount, credit: cost, description: `Funding — ${name}` },
  ];
}

/** Pre-existing asset — Dr cost / Cr accumulated dep / Cr capital (net book value). No P&L. */
export function buildOpeningLines(assetAccount: string, cost: number, accumDep: number, name = ""): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountCode: assetAccount, debit: cost, description: `Opening asset — ${name}` },
  ];
  if (accumDep > 0) lines.push({ accountCode: "1110", credit: accumDep, description: "Opening accumulated depreciation" });
  lines.push({ accountCode: "3001", credit: cost - accumDep, description: "Opening balance — capital" });
  return lines;
}

/**
 * Disposal — reverse the asset (Cr cost) and its accumulated dep (Dr 1110), bring
 * in proceeds (Dr bank), and book the gain (Cr 4020) or loss (Dr 5060).
 * Balanced by construction: Dr = accumDep + proceeds + loss; Cr = cost + gain.
 */
export function buildDisposalLines(assetAccount: string, cost: number, accumDep: number, proceeds: number, name = ""): JournalLineInput[] {
  const nbv = cost - accumDep;
  const gainLoss = proceeds - nbv;
  const lines: JournalLineInput[] = [];
  if (accumDep > 0) lines.push({ accountCode: "1110", debit: accumDep, description: "Reverse accumulated depreciation" });
  if (proceeds > 0) lines.push({ accountCode: "1002", debit: proceeds, description: "Disposal proceeds" });
  if (gainLoss < 0) lines.push({ accountCode: "5060", debit: -gainLoss, description: "Loss on asset disposal" });
  lines.push({ accountCode: assetAccount, credit: cost, description: `Disposal — ${name}` });
  if (gainLoss > 0) lines.push({ accountCode: "4020", credit: gainLoss, description: "Gain on asset disposal" });
  return lines;
}
