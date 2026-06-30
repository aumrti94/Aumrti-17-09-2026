import React from "react";
import { FileText } from "lucide-react";
import PatientDocuments from "@/components/clinical/PatientDocuments";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId: string | null;
}

const IPDDocumentsTab: React.FC<Props> = ({ hospitalId, userId, patientId }) => {
  if (!patientId || !hospitalId || !userId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <FileText className="h-10 w-10 text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 font-medium">Patient Documents</p>
        <p className="text-xs text-slate-400 mt-1">Loading patient context…</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <PatientDocuments patientId={patientId} hospitalId={hospitalId} userId={userId} />
    </div>
  );
};

export default IPDDocumentsTab;
