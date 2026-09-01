import React from "react";
import InvestigationResultsPanel from "@/components/clinical/InvestigationResultsPanel";

// IPD per-admission investigations.
//
// This used to be a standalone read-only table that showed scalar lab results and radiology
// impressions for the admission — and nothing else. Cultures, histopathology and referred-out
// tests were invisible here, it never refreshed after mount, and OPD had no equivalent at all.
//
// The rendering now lives in the shared InvestigationResultsPanel so the ward doctor and the
// OPD doctor read results in exactly the same place, in the same format, live. This file is
// kept as a thin wrapper so the IPD tab key, its permission entry and its import site are
// unchanged.

interface Props {
  admissionId: string;
  hospitalId: string;
  patientId?: string | null;
  userId?: string | null;
}

const InvestigationsTab: React.FC<Props> = ({ admissionId, hospitalId, patientId, userId }) => {
  if (!patientId) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-[14px]">
        Patient not resolved for this admission.
      </div>
    );
  }

  return (
    <InvestigationResultsPanel
      hospitalId={hospitalId}
      patientId={patientId}
      admissionId={admissionId}
      currentUserId={userId}
    />
  );
};

export default InvestigationsTab;
