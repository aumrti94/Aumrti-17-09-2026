import React from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  patientId: string | null;
}

const IPDDocumentsTab: React.FC<Props> = () => {
  return (
    <div className="h-full flex flex-col items-center justify-center p-4">
      <FileText className="h-10 w-10 text-slate-300 mb-3" />
      <p className="text-sm text-slate-500 font-medium">Patient Documents</p>
      <p className="text-xs text-slate-400 mt-1 mb-4">Consent forms, lab reports, and radiology images</p>
      <Button size="sm" variant="outline" className="text-xs h-8"
        onClick={() => toast({ title: "Document management", description: "Upload feature coming in Phase 5" })}>
        <Upload className="h-3.5 w-3.5 mr-1" /> Upload Document
      </Button>
    </div>
  );
};

export default IPDDocumentsTab;
