import React, { useCallback } from "react";
import PatientHistoryUploadPanel from "@/components/clinical/PatientHistoryUploadPanel";
import PatientHistoryTimeline from "@/components/clinical/PatientHistoryTimeline";
import { useCurrentHistoryDigest } from "@/lib/historyDigest";

/**
 * Scan-and-read of a patient's outside medical records, as one mountable block.
 *
 * Exists because this pair has TWO homes and they must not drift apart:
 *   • the OPD History tab        — the doctor reads it mid-consultation
 *   • the Patient Details drawer — the front desk scans at registration
 *
 * The second is the one that decides whether the feature succeeds. A consultant with
 * four minutes will not scan 100 pages, so if scanning only exists inside the
 * consultation screen the feature demos well and gets ~8% adoption (Rohit). Keeping
 * the two mounts as one component is what stops the registration path quietly
 * becoming a lesser version of the clinical one.
 *
 * Owns the digest load and refresh; the callbacks below are the only things that
 * differ between the two homes.
 */

interface Props {
  patientId: string;
  hospitalId: string;
  userId: string;
  /** Which consultation triggered the scan. Null at registration. */
  encounterId?: string | null;
  /** Consultation-only: append the summary to the History of Present Illness. */
  onInsertToHpi?: (text: string) => void;
  /** Write digest problems onto the patient's chronic-condition list. */
  onAddChronicConditions?: (conditions: string[]) => void;
  /** Fired when the digest changes, so a parent holding its own copy can reload. */
  onDigestChange?: () => void;
  /** Suppress the section heading where the host already provides one. */
  hideHeading?: boolean;
}

const PatientHistorySection: React.FC<Props> = ({
  patientId, hospitalId, userId, encounterId,
  onInsertToHpi, onAddChronicConditions, onDigestChange, hideHeading,
}) => {
  const { digest, loading, refresh } = useCurrentHistoryDigest(patientId);

  const handleChange = useCallback(() => {
    void refresh();
    onDigestChange?.();
  }, [refresh, onDigestChange]);

  return (
    <div className="space-y-2">
      {!hideHeading && (
        <label className="text-xs font-bold text-slate-700 block">Records from Other Hospitals</label>
      )}
      <PatientHistoryUploadPanel
        patientId={patientId}
        hospitalId={hospitalId}
        userId={userId}
        encounterId={encounterId}
        onIngestComplete={handleChange}
      />
      <PatientHistoryTimeline
        digest={digest}
        loading={loading}
        userId={userId}
        onReviewed={handleChange}
        onInsertToHpi={onInsertToHpi}
        onAddChronicConditions={onAddChronicConditions}
      />
    </div>
  );
};

export default PatientHistorySection;
