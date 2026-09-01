/**
 * Professional print utility — opens a new window with print-specific HTML.
 * All branding (header layout, font, colors, footer) is applied automatically
 * from the branding_config saved in Settings → Branding. fetchHospitalBrand()
 * must be called before printHeader() / printDocument() — all 37 callers already do this.
 */

export interface BrandConfig {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  address: string | null;
  tagline: string | null;
  font_family: string | null;
  branding_config: {
    headerLayout: number;
    fontSize: number;
    footerLeft: string;
    footerCenter: string;
    footerRight: string;
    handwriting?: Partial<HandwritingConfig>;
  } | null;
}

// Module-level brand cache — populated by fetchHospitalBrand(), consumed by
// printHeader() and printDocument(). Same async call chain, never stale.
let _brandCache: BrandConfig | null = null;

// ─── HTML escape ──────────────────────────────────────────────────────────────
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Handwriting print mode ───────────────────────────────────────────────────
// Arogyasri / TPA claim files are routinely returned when the clinical narrative
// looks machine-set, so the doctor-authored free text (ward rounds, nursing notes,
// drug orders) can be rendered in a script face on the printout. Only the typeface
// changes — the author name, timestamp and text are the same record shown on screen.

export type HandwritingSection = "wardRounds" | "nursingNotes" | "medications" | "dischargeSummary";

export interface HandwritingConfig {
  enabled: boolean;
  /** Must be one of HANDWRITING_FONTS — anything else falls back to the default. */
  font: string;
  /** Multiplier on the base print font size. Script faces run small, so > 1 is normal. */
  scale: number;
  /** Ink colour, #rgb or #rrggbb. */
  color: string;
  /** Forward slant in degrees, 0–12. */
  slant: number;
  sections: Record<HandwritingSection, boolean>;
}

export const HANDWRITING_FONTS = [
  "Caveat",
  "Kalam",
  "Patrick Hand",
  "Indie Flower",
  "Shadows Into Light",
  "Architects Daughter",
  "Gloria Hallelujah",
  "Reenie Beanie",
] as const;

export const HANDWRITING_SECTION_LABELS: Record<HandwritingSection, string> = {
  wardRounds: "Ward round notes (S/O/A/P)",
  nursingNotes: "Nursing & misc notes",
  medications: "Medication orders",
  dischargeSummary: "Discharge summary narrative",
};

export const DEFAULT_HANDWRITING: HandwritingConfig = {
  enabled: false,
  font: "Caveat",
  scale: 1.3,
  color: "#1e3a8a",
  slant: 0,
  sections: { wardRounds: true, nursingNotes: true, medications: true, dischargeSummary: false },
};

/** Merge the saved config over the defaults and clamp every field to a safe value. */
export function resolveHandwriting(brand?: BrandConfig | null): HandwritingConfig {
  const raw = (brand === undefined ? _brandCache : brand)?.branding_config?.handwriting;
  if (!raw) return DEFAULT_HANDWRITING;
  const font = HANDWRITING_FONTS.includes(raw.font as any) ? raw.font! : DEFAULT_HANDWRITING.font;
  const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw.color || "") ? raw.color! : DEFAULT_HANDWRITING.color;
  const scale = Math.min(2, Math.max(0.8, Number(raw.scale) || DEFAULT_HANDWRITING.scale));
  const slant = Math.min(12, Math.max(0, Number(raw.slant) || 0));
  return {
    enabled: !!raw.enabled,
    font,
    color,
    scale,
    slant,
    sections: { ...DEFAULT_HANDWRITING.sections, ...(raw.sections || {}) },
  };
}

/**
 * Render one piece of clinician-authored text for a printout, in the handwriting
 * face when that section is switched on. Escapes the text and keeps line breaks —
 * safe to use anywhere the raw DB value was previously interpolated.
 */
export function hw(
  section: HandwritingSection,
  text: string | number | null | undefined,
  fallback = "—",
): string {
  const raw = text === null || text === undefined ? "" : String(text).trim();
  if (!raw) return fallback;
  const safe = esc(raw).replace(/\r?\n/g, "<br/>");
  const cfg = resolveHandwriting();
  if (!cfg.enabled || !cfg.sections[section]) return safe;
  return `<span class="hw">${safe}</span>`;
}

/** Google Fonts URL for the given families — shared by the print window and the settings preview. */
export function fontsHref(families: string[]): string {
  const q = families.map((f) => `family=${f.trim().replace(/\s+/g, "+")}`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

// ─── Header layout renderers ──────────────────────────────────────────────────
function logoImg(url: string | null | undefined, name: string, inline = ""): string {
  if (!url) return "";
  return `<img src="${url}" alt="${esc(name)} logo" style="max-height:46px;max-width:150px;object-fit:contain;${inline}" />`;
}

function buildHeaderHtml(
  layout: number,
  name: string,
  tagline: string,
  logoUrl: string | null | undefined,
  color: string,
  subtitle?: string,
  extras?: string,
): string {
  const logo = logoImg(logoUrl, name);
  const nameHtml = `<span style="font-size:20px;font-weight:700;color:${color};">${esc(name)}</span>`;
  const taglineHtml = tagline ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${esc(tagline)}</div>` : "";
  const subHtml = subtitle ? `<div style="font-size:12px;color:#475569;margin-top:4px;">${esc(subtitle)}</div>` : "";
  const extHtml = extras || "";

  switch (layout) {

    // Layout 2 — Center All
    case 2:
      return `<div style="text-align:center;padding-bottom:9px;margin-bottom:12px;border-bottom:2px solid ${color};">
  ${logo ? `<div style="margin-bottom:6px;">${logo}</div>` : ""}
  ${nameHtml}${taglineHtml}${subHtml}${extHtml}
</div>`;

    // Layout 3 — Full Colour Band
    case 3: {
      const whiteLogo = logoUrl
        ? `<img src="${logoUrl}" alt="${esc(name)} logo" style="max-height:42px;max-width:130px;object-fit:contain;background:#fff;padding:4px;border-radius:4px;" />`
        : "";
      return `<div style="background:${color};color:#fff;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:14px;border-radius:4px;">
  ${whiteLogo}
  <div>
    <div style="font-size:20px;font-weight:700;color:#fff;">${esc(name)}</div>
    ${tagline ? `<div style="font-size:11px;color:rgba(255,255,255,0.85);margin-top:2px;">${esc(tagline)}</div>` : ""}
  </div>
</div>
${subHtml}${extHtml}`;
    }

    // Layout 4 — Logo Right
    case 4:
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:9px;margin-bottom:12px;border-bottom:2px solid ${color};">
  <div>${nameHtml}${taglineHtml}${subHtml}${extHtml}</div>
  ${logo || ""}
</div>`;

    // Layout 5 — Text Only
    case 5:
      return `<div style="text-align:center;padding-bottom:9px;margin-bottom:12px;border-bottom:2px solid ${color};">
  ${nameHtml}${taglineHtml}${subHtml}${extHtml}
</div>`;

    // Layout 6 — Minimal
    case 6:
      return `<div style="padding-bottom:8px;margin-bottom:12px;border-bottom:1px solid #e2e8f0;">
  <span style="font-size:26px;font-weight:800;color:${color};">${esc(name)}</span>
  ${subHtml}${extHtml}
</div>`;

    // Layout 1 (default) — Logo Left + Center Text
    default:
      return `<div style="display:flex;align-items:flex-start;gap:14px;padding-bottom:9px;margin-bottom:12px;border-bottom:2px solid ${color};">
  ${logo ? `<div style="flex-shrink:0;">${logo}</div>` : ""}
  <div style="flex:1;text-align:center;">${nameHtml}${taglineHtml}${subHtml}${extHtml}</div>
</div>`;
  }
}

// ─── Footer builder ───────────────────────────────────────────────────────────
function buildPrintFooter(brand: BrandConfig | null): string {
  const cfg = brand?.branding_config;
  const fl = cfg?.footerLeft?.trim() || "";
  const fc = cfg?.footerCenter?.trim() || "";
  const fr = cfg?.footerRight?.trim() || "";
  const hasCustom = fl || fc || fr;

  if (hasCustom) {
    return `<div class="footer" style="border-top:1px dashed #cbd5e1;margin-top:24px;padding-top:8px;font-size:10px;color:#64748b;">
  <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
    <span>${esc(fl)}</span><span>${esc(fc)}</span><span>${esc(fr)}</span>
  </div>
  <div style="text-align:center;color:#94a3b8;">Powered by Aumrti HMS</div>
</div>`;
  }
  return `<div class="footer" style="border-top:1px dashed #cbd5e1;margin-top:24px;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center;">Powered by Aumrti HMS</div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch hospital branding (all fields) and cache for use by printHeader / printDocument.
 * All 37 print callers call this first — the cache is always warm by print time.
 */
export async function fetchHospitalBrand(supabaseClient: any, hospitalId: string): Promise<BrandConfig> {
  const { data } = await supabaseClient
    .from("hospitals")
    .select("name, logo_url, primary_color, accent_color, address, tagline, font_family, branding_config")
    .eq("id", hospitalId)
    .maybeSingle();

  const brand: BrandConfig = {
    name: data?.name ?? "Hospital",
    logo_url: data?.logo_url ?? null,
    primary_color: data?.primary_color ?? null,
    accent_color: data?.accent_color ?? null,
    address: data?.address ?? null,
    tagline: data?.tagline ?? null,
    font_family: data?.font_family ?? null,
    branding_config: data?.branding_config ?? null,
  };
  _brandCache = brand;
  return brand;
}

/**
 * Build a hospital header for printed documents.
 * Reads header layout from the cached branding config automatically.
 * Signature is backwards-compatible — all existing callers work unchanged.
 */
export function printHeader(
  hospitalName: string,
  subtitle?: string,
  extras?: string,
  logoUrl?: string | null,
  primaryColor?: string | null,
): string {
  const brand = _brandCache;
  const color = primaryColor ?? brand?.primary_color ?? "#1A2F5A";
  const logo = logoUrl !== undefined ? logoUrl : brand?.logo_url;
  const layout = brand?.branding_config?.headerLayout ?? 1;
  const tagline = brand?.tagline ?? "";

  return buildHeaderHtml(layout, hospitalName, tagline, logo, color, subtitle, extras);
}

/**
 * Open a print window with the body HTML. Applies branding (font, colors, footer)
 * from the cached brand config automatically. Backwards-compatible.
 */
export function printDocument(
  title: string,
  bodyHtml: string,
  options?: { width?: number; height?: number },
) {
  const printWin = window.open(
    "",
    "_blank",
    `width=${options?.width || 800},height=${options?.height || 600}`,
  );
  if (!printWin) {
    alert("Please allow popups to print documents");
    return;
  }

  const brand = _brandCache;
  const fontFamily = brand?.font_family ? `'${brand.font_family}', sans-serif` : "Arial, sans-serif";
  const fontSize = brand?.branding_config?.fontSize ?? 13;
  const color = brand?.primary_color ?? "#1A2F5A";
  const footerHtml = buildPrintFooter(brand);

  // UI fonts, plus the script face only when handwriting mode is actually on.
  const handwriting = resolveHandwriting(brand);
  const families = ["Inter", "Poppins", "Roboto", "Noto Sans", "Open Sans", "Lato", "Nunito", "Raleway"];
  if (handwriting.enabled) families.push(handwriting.font);
  const hwSize = Math.round(fontSize * handwriting.scale);
  const hwCss = `.hw { font-family: '${handwriting.font}', 'Segoe Script', cursive; font-size: ${hwSize}px;
         line-height: 1.45; letter-spacing: .2px; color: ${handwriting.color};${
    handwriting.slant ? ` display: inline-block; transform: skewX(-${handwriting.slant}deg);` : ""
  } }`;

  const html = `<!DOCTYPE html>
<html><head><title>${esc(title)}</title>
<link id="print-fonts" rel="stylesheet" href="${fontsHref(families)}" />
<style>
  body { font-family: ${fontFamily}; padding: 24px; margin: 0; font-size: ${fontSize}px; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { background: #f1f5f9; padding: 5px 8px; text-align: left; font-size: 11px;
       text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: ${fontSize}px; }
  .header { padding-bottom: 8px; margin-bottom: 10px; }
  .amount { font-family: monospace; font-weight: 600; }
  .label { color: #64748b; font-size: 11px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .total-row { display: flex; justify-content: space-between; font-weight: bold;
               font-size: ${fontSize + 2}px; border-top: 2px solid ${color}; padding-top: 5px; margin-top: 5px; }
  .section-title { font-size: ${fontSize + 1}px; font-weight: 700; color: ${color}; margin: 10px 0 5px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px;
           font-weight: 600; background: #f1f5f9; color: #475569; }
  pre { white-space: pre-wrap; font-family: inherit; }
  ${hwCss}
  td .hw, .hw { max-width: 100%; }
  @media print { body { padding: 12px; } }
</style>
</head><body>${bodyHtml}
${footerHtml}
</body></html>`;

  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();

  // Wait for the webfonts before opening the print dialog — a script face that hasn't
  // downloaded yet silently falls back to generic `cursive`, which defeats the point.
  // Order matters: the stylesheet must land before document.fonts.ready means anything.
  // 2.5s ceiling so a slow or offline font host never blocks the dialog.
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    printWin.print();
  };
  const afterStylesheet = () => {
    const fonts = (printWin.document as any).fonts;
    if (fonts?.ready) fonts.ready.then(go).catch(go);
    else setTimeout(go, 200);
  };
  const link = printWin.document.getElementById("print-fonts") as HTMLLinkElement | null;
  if (link && !(link.sheet)) {
    link.addEventListener("load", afterStylesheet);
    link.addEventListener("error", afterStylesheet);
  } else {
    afterStylesheet();
  }
  setTimeout(go, 2500);
}

/**
 * Format currency in Indian locale for print.
 */
export function printAmount(n: number): string {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
