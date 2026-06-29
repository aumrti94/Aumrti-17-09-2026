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

// ─── Header layout renderers ──────────────────────────────────────────────────
function logoImg(url: string | null | undefined, name: string, inline = ""): string {
  if (!url) return "";
  return `<img src="${url}" alt="${esc(name)} logo" style="max-height:60px;max-width:160px;object-fit:contain;${inline}" />`;
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
      return `<div style="text-align:center;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid ${color};">
  ${logo ? `<div style="margin-bottom:6px;">${logo}</div>` : ""}
  ${nameHtml}${taglineHtml}${subHtml}${extHtml}
</div>`;

    // Layout 3 — Full Colour Band
    case 3: {
      const whiteLogo = logoUrl
        ? `<img src="${logoUrl}" alt="${esc(name)} logo" style="max-height:54px;max-width:140px;object-fit:contain;background:#fff;padding:4px;border-radius:4px;" />`
        : "";
      return `<div style="background:${color};color:#fff;padding:14px 20px;margin-bottom:18px;display:flex;align-items:center;gap:14px;border-radius:4px;">
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
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid ${color};">
  <div>${nameHtml}${taglineHtml}${subHtml}${extHtml}</div>
  ${logo || ""}
</div>`;

    // Layout 5 — Text Only
    case 5:
      return `<div style="text-align:center;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid ${color};">
  ${nameHtml}${taglineHtml}${subHtml}${extHtml}
</div>`;

    // Layout 6 — Minimal
    case 6:
      return `<div style="padding-bottom:10px;margin-bottom:18px;border-bottom:1px solid #e2e8f0;">
  <span style="font-size:26px;font-weight:800;color:${color};">${esc(name)}</span>
  ${subHtml}${extHtml}
</div>`;

    // Layout 1 (default) — Logo Left + Center Text
    default:
      return `<div style="display:flex;align-items:flex-start;gap:14px;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid ${color};">
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

  const html = `<!DOCTYPE html>
<html><head><title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter&family=Poppins&family=Roboto&family=Noto+Sans&family=Open+Sans&family=Lato&family=Nunito&family=Raleway&display=swap');
  body { font-family: ${fontFamily}; padding: 40px; margin: 0; font-size: ${fontSize}px; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 11px;
       text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: ${fontSize}px; }
  .header { padding-bottom: 14px; margin-bottom: 18px; }
  .amount { font-family: monospace; font-weight: 600; }
  .label { color: #64748b; font-size: 11px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .total-row { display: flex; justify-content: space-between; font-weight: bold;
               font-size: ${fontSize + 2}px; border-top: 2px solid ${color}; padding-top: 8px; margin-top: 8px; }
  .section-title { font-size: ${fontSize + 1}px; font-weight: 700; color: ${color}; margin: 16px 0 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px;
           font-weight: 600; background: #f1f5f9; color: #475569; }
  pre { white-space: pre-wrap; font-family: inherit; }
  @media print { body { padding: 20px; } }
</style>
</head><body>${bodyHtml}
${footerHtml}
</body></html>`;

  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => printWin.print(), 300);
}

/**
 * Format currency in Indian locale for print.
 */
export function printAmount(n: number): string {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
