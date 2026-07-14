// ── Document AI engine ──────────────────────────────────────────────────────
//
// Real content extraction + analysis for uploaded patient / insurance documents.
// Unlike the earlier approach (which stuffed a truncated base64 prefix into a text
// prompt and let the model hallucinate), this converts the file into a proper
// multimodal attachment (image / PDF) or extracts real text (DOCX / plain text)
// and asks the model to read the ACTUAL document.
//
// Used by:
//   • src/components/clinical/PatientDocuments.tsx   (general patient uploads)
//   • src/components/insurance/DocumentChecklist.tsx (pre-auth checklist verify)

import { callAI, type AIAttachment } from "@/lib/aiProvider";

// Image formats vision models (Claude / Gemini / GPT-4o) read natively.
const VISION_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

// Extensions → mime, for files the browser doesn't tag with a type.
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
};

export type DocInputKind = "image" | "pdf" | "docx" | "text" | "unsupported";

export interface PolicyContext {
  policyNumber?: string;
  insurerName?: string; // TPA / insurer on the pre-auth
  patientName?: string;
}

export interface PolicyCheck {
  policyNumber: string | null;
  insurerName: string | null;
  memberName: string | null;
  validTill: string | null;
  matches: boolean | null;    // null = no policy context supplied to compare against
  issue: string | null;       // populated when matches === false
}

export interface DocAnalysis {
  analyzable: boolean;        // false when the file type can't be read at all
  documentType: string;       // canonical id, e.g. "discharge_summary"
  documentName: string;       // suggested display name
  summary: string;            // 2-3 sentence key findings
  extractedText: string;      // full text pulled from the document
  importantValues: string;    // doses, results, dates, ids
  matches: boolean | null;    // vs. expectedLabel (null when none given)
  matchConfidence: number;    // 0-100
  issue: string | null;       // mismatch reason (when matches === false)
  policy: PolicyCheck | null; // populated only when policyContext given
  error?: string;             // set when the AI call itself failed
}

export interface AnalyzeArgs {
  file: File;
  hospitalId: string;
  patientId?: string;
  /** Human label of the checklist slot the user uploaded against, e.g. "Discharge Summary". */
  expectedLabel?: string;
  /** When provided, extract & cross-check policy details (insurance card / photo id). */
  policyContext?: PolicyContext;
}

// ── File → model input classification ──────────────────────────────────────

export function classifyFile(file: File): { kind: DocInputKind; mediaType: string } {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mediaType = file.type || EXT_MIME[ext] || "application/octet-stream";

  if (VISION_IMAGE_TYPES.has(mediaType) || VISION_IMAGE_TYPES.has(EXT_MIME[ext] || ""))
    return { kind: "image", mediaType: EXT_MIME[ext] && VISION_IMAGE_TYPES.has(EXT_MIME[ext]) ? EXT_MIME[ext] : mediaType };
  if (mediaType === "application/pdf" || ext === "pdf")
    return { kind: "pdf", mediaType: "application/pdf" };
  if (ext === "docx" || mediaType.includes("wordprocessingml"))
    return { kind: "docx", mediaType };
  if (mediaType.startsWith("text/") || ext === "txt" || ext === "csv" || ext === "rtf")
    return { kind: "text", mediaType };
  // bmp/tiff/doc/heic etc. — no reliable in-browser reader / vision support
  return { kind: "unsupported", mediaType };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// DOCX text extraction runs client-side via mammoth (lazy-imported so it never
// bloats the initial bundle and only loads when a .docx is actually uploaded).
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value || "";
}

// ── Prompt construction ────────────────────────────────────────────────────

function buildPrompt(args: AnalyzeArgs, inlineText: string | null): string {
  const { expectedLabel, policyContext } = args;

  const parts: string[] = [
    `You are a medical & insurance document analyst for an Indian hospital.`,
    inlineText
      ? `The document text is provided below.`
      : `The document (image/PDF) is attached — read it directly.`,
  ];

  if (expectedLabel) {
    parts.push(
      `The billing team uploaded this file against the checklist slot "${expectedLabel}". ` +
      `Judge whether the document genuinely IS a "${expectedLabel}".`
    );
  }

  if (policyContext) {
    const ctx: string[] = [];
    if (policyContext.policyNumber) ctx.push(`policy number on record: "${policyContext.policyNumber}"`);
    if (policyContext.insurerName) ctx.push(`insurer/TPA on record: "${policyContext.insurerName}"`);
    if (policyContext.patientName) ctx.push(`patient name on record: "${policyContext.patientName}"`);
    parts.push(
      `This may be an insurance card / policy copy / photo ID. Extract the policy details and ` +
      `compare them against what the hospital has on record (${ctx.join("; ") || "none provided"}).`
    );
  }

  parts.push(
    `Return ONLY a JSON object (no markdown fences, no prose) with EXACTLY these keys:`,
    `{`,
    `  "document_type": "old_prescription|old_report|discharge_summary|admission_note|investigation_reports|ot_notes|implant_sticker|drug_chart|nurses_notes|pre_auth_approval|xray_image|insurance_card|photo_id|referral_letter|other",`,
    `  "document_name": "short human-friendly title",`,
    `  "key_findings": "2-3 sentence summary of what the document contains",`,
    `  "extracted_text": "the full readable text extracted from the document",`,
    `  "important_values": "critical items: drug doses, lab results with ranges, diagnoses, dates, reference/approval numbers",`,
    expectedLabel
      ? `  "matches": true or false (does it match "${expectedLabel}"?),\n  "match_confidence": 0-100,\n  "issue": "empty string if it matches, else one line on what is wrong",`
      : `  "matches": null,\n  "match_confidence": 0,\n  "issue": "",`,
    policyContext
      ? `  "policy": {"policy_number": string|null, "insurer_name": string|null, "member_name": string|null, "valid_till": string|null, "matches": true/false/null, "issue": "empty string unless a mismatch with the on-record values"}`
      : `  "policy": null`,
    `}`,
  );

  if (inlineText) {
    parts.push(``, `--- DOCUMENT TEXT START ---`, inlineText.substring(0, 12000), `--- DOCUMENT TEXT END ---`);
  }

  return parts.join("\n");
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function analyzeDocument(args: AnalyzeArgs): Promise<DocAnalysis> {
  const { file, hospitalId, patientId } = args;

  const fallback = (over: Partial<DocAnalysis>): DocAnalysis => ({
    analyzable: false,
    documentType: "other",
    documentName: file.name,
    summary: "",
    extractedText: "",
    importantValues: "",
    matches: args.expectedLabel ? null : null,
    matchConfidence: 0,
    issue: null,
    policy: null,
    ...over,
  });

  const { kind, mediaType } = classifyFile(file);

  let attachments: AIAttachment[] | undefined;
  let inlineText: string | null = null;

  try {
    if (kind === "image") {
      attachments = [{ kind: "image", mediaType, data: await fileToBase64(file) }];
    } else if (kind === "pdf") {
      attachments = [{ kind: "pdf", mediaType: "application/pdf", data: await fileToBase64(file) }];
    } else if (kind === "docx") {
      inlineText = await extractDocxText(file);
      if (!inlineText.trim()) return fallback({ error: "Could not read any text from this Word document." });
    } else if (kind === "text") {
      inlineText = await file.text();
      if (!inlineText.trim()) return fallback({ error: "The file appears to be empty." });
    } else {
      // unsupported (bmp/tiff/doc/dicom/etc.) — stored raw, no analysis
      return fallback({ error: `Automatic analysis isn't supported for ${file.name.split(".").pop()?.toUpperCase() || "this"} files yet — the file was saved as-is.` });
    }
  } catch (prepErr) {
    return fallback({ error: prepErr instanceof Error ? prepErr.message : "Could not read the file." });
  }

  const prompt = buildPrompt(args, inlineText);

  const result = await callAI({
    featureKey: "document_ocr",
    hospitalId,
    patientId,
    prompt,
    attachments,
    maxTokens: 1500,
  });

  if (result.error || !result.text) {
    return fallback({ error: result.error || "AI analysis returned no response." });
  }

  // Parse the JSON — tolerate stray markdown fences / leading prose.
  let parsed: Record<string, any>;
  try {
    const cleaned = result.text
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned);
  } catch {
    // Model answered but not as JSON — keep the raw text as the extraction so
    // the upload still surfaces something useful.
    return fallback({
      analyzable: true,
      extractedText: result.text,
      summary: result.text.substring(0, 240),
      error: "Analysis completed but structured parsing failed.",
    });
  }

  const rawPolicy = parsed.policy && typeof parsed.policy === "object" ? parsed.policy : null;

  return {
    analyzable: true,
    documentType: String(parsed.document_type || "other"),
    documentName: String(parsed.document_name || file.name),
    summary: String(parsed.key_findings || ""),
    extractedText: String(parsed.extracted_text || ""),
    importantValues: String(parsed.important_values || ""),
    matches:
      parsed.matches === true ? true : parsed.matches === false ? false : null,
    matchConfidence: Number(parsed.match_confidence) || 0,
    issue: parsed.issue ? String(parsed.issue) : null,
    policy: rawPolicy
      ? {
          policyNumber: rawPolicy.policy_number ?? null,
          insurerName: rawPolicy.insurer_name ?? null,
          memberName: rawPolicy.member_name ?? null,
          validTill: rawPolicy.valid_till ?? null,
          matches:
            rawPolicy.matches === true ? true : rawPolicy.matches === false ? false : null,
          issue: rawPolicy.issue ? String(rawPolicy.issue) : null,
        }
      : null,
  };
}
