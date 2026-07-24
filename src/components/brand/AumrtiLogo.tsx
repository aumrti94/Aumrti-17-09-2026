import React, { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for the Aumrti product mark.
 *
 * Artwork lives in /public so it is referenced by URL (no bundler import), which
 * keeps the same files usable from index.html, the manifest and print HTML.
 *
 * If the artwork is missing we fall back to the inline cross mark rather than
 * rendering a broken-image icon — the app must never look broken over branding.
 */

/**
 * Both variants currently point at the same artwork — icon-192.svg holds the full
 * Aumrti logo. Split them the day a separate square mark-only file exists.
 */
export const AUMRTI_LOCKUP_SRC = "/icon-192.svg";
export const AUMRTI_MARK_SRC = "/icon-192.svg";

type Variant = "lockup" | "mark";

interface AumrtiLogoProps {
  /** "lockup" = mark + wordmark (wide); "mark" = square icon only. */
  variant?: Variant;
  className?: string;
  title?: string;
}

/**
 * Last-resort placeholder if the artwork fails to load.
 *
 * The cross is drawn with `currentColor` and the plate is only ever a tint of it,
 * so the mark can never end up invisible (a white cross on a white plate) whatever
 * surface it lands on — that produced blank boxes in the sidebar and login footer.
 */
const FallbackMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Aumrti">
    <rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor" fillOpacity="0.15" />
    <path d="M14 9h4v14h-4z" fill="currentColor" />
    <path d="M9 14h14v4H9z" fill="currentColor" />
  </svg>
);

const AumrtiLogo: React.FC<AumrtiLogoProps> = ({
  variant = "mark",
  className,
  title = "Aumrti",
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <FallbackMark className={cn("shrink-0", className)} />;
  }

  return (
    <img
      src={variant === "lockup" ? AUMRTI_LOCKUP_SRC : AUMRTI_MARK_SRC}
      alt={title}
      title={title}
      onError={() => setFailed(true)}
      className={cn("object-contain shrink-0", className)}
    />
  );
};

export default AumrtiLogo;
