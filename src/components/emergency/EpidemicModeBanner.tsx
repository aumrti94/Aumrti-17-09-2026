import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

interface Protocol {
  id: string;
  protocol_name: string;
  triage_mode: string;
  ppe_level: string;
  isolation_beds: number | null;
  visitor_policy: string | null;
  activated_at: string;
}

interface Props {
  protocol: Protocol | null;
}

const EpidemicModeBanner: React.FC<Props> = ({ protocol }) => {
  if (!protocol) return null;
  return (
    <div className="flex-shrink-0 bg-red-600 text-white px-4 py-2 flex items-center gap-3 z-50">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 animate-pulse" />
      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
      <span className="text-sm font-bold uppercase tracking-wide">EPIDEMIC MODE ACTIVE:</span>
      <span className="text-sm font-semibold">{protocol.protocol_name}</span>
      <span className="text-xs opacity-80">|</span>
      <span className="text-xs">Triage: <strong>{protocol.triage_mode.replace("_", " ").toUpperCase()}</strong></span>
      <span className="text-xs opacity-80">|</span>
      <span className="text-xs">PPE: <strong>{protocol.ppe_level.toUpperCase()}</strong></span>
      {protocol.isolation_beds && (
        <>
          <span className="text-xs opacity-80">|</span>
          <span className="text-xs">Isolation Beds: <strong>{protocol.isolation_beds}</strong></span>
        </>
      )}
      {protocol.visitor_policy && (
        <>
          <span className="text-xs opacity-80">|</span>
          <span className="text-xs">Visitors: <strong>{protocol.visitor_policy}</strong></span>
        </>
      )}
      <span className="ml-auto text-xs opacity-70">
        Since {new Date(protocol.activated_at).toLocaleString()}
      </span>
    </div>
  );
};

export default EpidemicModeBanner;
