/**
 * ABDMConsentBanner — Patient-facing ABDM data-sharing disclosure notice.
 *
 * Shown when any ABDM feature is first used for a patient:
 *   - After ABHA ID is created
 *   - When a care context is linked
 *   - On patient registration completion (if ABDM features are enabled)
 *
 * The banner is dismissible per-session via sessionStorage.
 * Once dismissed it does not re-appear until the next browser session.
 */

import React, { useEffect, useState } from "react";
import { ShieldCheck, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const SESSION_KEY = "abdm_consent_banner_dismissed";

interface Props {
  /** Force-show regardless of dismiss state (e.g. right after ABHA creation). */
  forceShow?: boolean;
  /** Callback fired when patient clicks "Manage Consent". */
  onManageConsent?: () => void;
  className?: string;
}

const ABDMConsentBanner: React.FC<Props> = ({ forceShow = false, onManageConsent, className }) => {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    const dismissed = sessionStorage.getItem(SESSION_KEY);
    if (!dismissed) setVisible(true);
  }, [forceShow]);

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(false);
  };

  const handleManage = () => {
    if (onManageConsent) {
      onManageConsent();
    } else {
      navigate("/abdm");
    }
    handleDismiss();
  };

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "relative flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm",
        className,
      )}
    >
      {/* Icon */}
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-blue-900 leading-snug">
          Ayushman Bharat Digital Mission (ABDM)
        </p>
        <p className="mt-0.5 text-[12px] text-blue-800 leading-relaxed">
          Your health records will be shared with the Ayushman Bharat Digital Mission network
          <strong> only with your explicit consent</strong> via the ABHA app or your preferred PHR
          application. You can view, grant, or revoke consent at any time.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <a
            href="https://abdm.gov.in/patients"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Learn more <ExternalLink size={10} />
          </a>
          <button
            type="button"
            onClick={handleManage}
            className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-800 transition-colors active:scale-95"
          >
            <ShieldCheck size={10} /> Manage Consent
          </button>
        </div>
      </div>

      {/* Dismiss */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-700 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default ABDMConsentBanner;
