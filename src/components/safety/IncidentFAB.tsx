import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import QuickEventModal from "./QuickEventModal";

// Routes where the FAB should be visible
const CLINICAL_PREFIXES = [
  "/opd",
  "/ipd",
  "/emergency",
  "/ot",
  "/nursing",
  "/lab",
  "/radiology",
];

const IncidentFAB: React.FC = () => {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const visible = CLINICAL_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + "/")
  );
  if (!visible) return null;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
              aria-label="Report Incident / Complaint"
              className={
                "fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full " +
                "bg-red-500 text-white shadow-lg ring-2 ring-red-500/30 " +
                "hover:bg-red-600 active:scale-95 transition-all " +
                "flex items-center justify-center " +
                "sm:bottom-8 sm:right-6"
              }
            >
              <AlertTriangle className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs font-medium">
            Report Incident / Complaint
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <QuickEventModal open={open} onOpenChange={setOpen} />
    </>
  );
};

export default IncidentFAB;
