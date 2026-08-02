/**
 * "Trust this device for 30 days" storage for MFA. Lifted out of
 * MFAVerifyModal.tsx so that file exports only its component — a file mixing
 * component and non-component exports silently disables Fast Refresh for it.
 */

export function getDeviceFingerprint(): string {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  // Simple hash — good enough for device recognition (not security-critical)
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

const TRUSTED_KEY = "aumrti_trusted_devices";

export function isTrustedDevice(userId: string): boolean {
  try {
    const stored = localStorage.getItem(TRUSTED_KEY);
    if (!stored) return false;
    const map: Record<string, string> = JSON.parse(stored);
    const expiry = map[`${userId}_${getDeviceFingerprint()}`];
    if (!expiry) return false;
    return new Date(expiry) > new Date();
  } catch {
    return false;
  }
}

export function trustDevice(userId: string) {
  try {
    const stored = localStorage.getItem(TRUSTED_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    map[`${userId}_${getDeviceFingerprint()}`] = expiry.toISOString();
    localStorage.setItem(TRUSTED_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}
