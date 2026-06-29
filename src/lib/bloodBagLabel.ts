import QRCode from "qrcode";
import { printDocument } from "./printUtils";
import { formatBloodGroup } from "./bloodCompatibility";
import { format } from "date-fns";

export function buildQRString(hospitalId: string, bagNumber: string, collectionDate: string | Date): string {
  const d = typeof collectionDate === "string" ? new Date(collectionDate) : collectionDate;
  const dateKey = format(d, "yyyyMMdd");
  return `BB-${hospitalId.substring(0, 8)}-${bagNumber}-${dateKey}`;
}

export async function generateQRDataUrl(qrString: string): Promise<string> {
  return await QRCode.toDataURL(qrString, { width: 220, margin: 1, errorCorrectionLevel: "M" });
}

interface BagLabelInput {
  hospitalName: string;
  unitNumber: string;
  component: string;
  bloodGroup: string;
  rhFactor: string;
  collectedAt: string;
  expiryAt: string;
  qrCode: string;
  ttiStatus: "available" | "quarantine" | "pending_tti";
  quarantineReason?: string | null;
}

export async function printBloodBagLabel(bag: BagLabelInput): Promise<void> {
  const qrUrl = await generateQRDataUrl(bag.qrCode);
  const componentName = bag.component.replace(/_/g, " ").toUpperCase();
  const groupDisplay = formatBloodGroup(bag.bloodGroup, bag.rhFactor);

  const statusBanner =
    bag.ttiStatus === "quarantine"
      ? `<div style="background:#fee2e2;border:2px solid #dc2626;color:#991b1b;padding:8px;text-align:center;font-weight:700;font-size:14px;margin:8px 0;">⚠ QUARANTINED — DO NOT ISSUE${bag.quarantineReason ? `<br/><span style="font-size:11px;font-weight:600;">${bag.quarantineReason}</span>` : ""}</div>`
      : bag.ttiStatus === "available"
        ? `<div style="background:#dcfce7;border:2px solid #16a34a;color:#166534;padding:6px;text-align:center;font-weight:700;font-size:12px;margin:8px 0;">✓ TTI CLEAR — AVAILABLE FOR ISSUE</div>`
        : `<div style="background:#fef3c7;border:2px solid #d97706;color:#92400e;padding:6px;text-align:center;font-weight:700;font-size:12px;margin:8px 0;">⏳ TTI PENDING</div>`;

  const body = `
    <div style="width:380px;border:2px solid #1A2F5A;padding:12px;margin:0 auto;font-family:Arial,sans-serif;">
      <div style="text-align:center;border-bottom:1px solid #cbd5e1;padding-bottom:6px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:700;color:#1A2F5A;">${bag.hospitalName}</div>
        <div style="font-size:10px;color:#64748b;">BLOOD BANK — UNIT LABEL</div>
      </div>

      <div style="text-align:center;font-size:48px;font-weight:900;color:#dc2626;line-height:1;margin:8px 0;">
        ${groupDisplay}
      </div>

      <div style="text-align:center;font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">
        ${componentName}
      </div>

      ${statusBanner}

      <div style="display:flex;gap:12px;align-items:center;margin-top:8px;">
        <div style="flex:1;font-size:11px;line-height:1.5;">
          <div><span style="color:#64748b;">Bag No:</span> <strong style="font-family:'JetBrains Mono',monospace;">${bag.unitNumber}</strong></div>
          <div><span style="color:#64748b;">Collected:</span> <strong>${format(new Date(bag.collectedAt), "dd/MM/yyyy")}</strong></div>
          <div><span style="color:#64748b;">Expires:</span> <strong style="color:#b91c1c;">${format(new Date(bag.expiryAt), "dd/MM/yyyy")}</strong></div>
        </div>
        <div style="width:144px;height:144px;border:1px solid #cbd5e1;padding:4px;background:#fff;">
          <img src="${qrUrl}" style="width:100%;height:100%;display:block;" alt="QR" />
        </div>
      </div>

      <div style="text-align:center;font-size:9px;color:#64748b;margin-top:6px;font-family:'JetBrains Mono',monospace;word-break:break-all;">
        ${bag.qrCode}
      </div>
    </div>
  `;

  printDocument(`Blood Bag Label - ${bag.unitNumber}`, body, { width: 480, height: 640 });
}
