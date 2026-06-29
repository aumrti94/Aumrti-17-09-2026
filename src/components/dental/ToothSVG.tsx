import React from "react";

export type Surface = "O" | "M" | "D" | "B" | "L";
export type ToothStatus =
  | "normal"
  | "caries"
  | "filling"
  | "crown"
  | "rct"
  | "missing"
  | "implant"
  | "bridge"
  | "extraction_planned";

interface ToothSVGProps {
  toothNumber: number;
  surfaces: Partial<Record<Surface, ToothStatus>>;
  overallStatus?: ToothStatus;
  onClick: (surface: Surface) => void;
}

const getStatusColor = (status?: ToothStatus) => {
  switch (status) {
    case "caries":
      return "#ef4444"; // red-500
    case "filling":
      return "#3b82f6"; // blue-500
    case "crown":
      return "#eab308"; // yellow-500
    case "rct":
      return "#ec4899"; // pink-500
    case "missing":
      return "#9ca3af"; // gray-400
    case "implant":
      return "#22c55e"; // green-500
    case "bridge":
      return "#f97316"; // orange-500
    case "extraction_planned":
      return "#fca5a5"; // red-300
    default:
      return "#ffffff"; // normal
  }
};

export const ToothSVG: React.FC<ToothSVGProps> = ({
  toothNumber,
  surfaces,
  overallStatus,
  onClick,
}) => {
  // If the entire tooth is missing, render a disabled state with a cross
  if (overallStatus === "missing") {
    return (
      <div className="flex flex-col items-center gap-1 cursor-not-allowed opacity-50">
        <span className="text-[14px] font-mono font-bold text-muted-foreground">{toothNumber}</span>
        <svg width="40" height="40" viewBox="0 0 40 40">
          <rect x="0" y="0" width="40" height="40" fill={getStatusColor("missing")} stroke="#cbd5e1" strokeWidth="1" />
          <line x1="0" y1="0" x2="40" y2="40" stroke="#64748b" strokeWidth="2" />
          <line x1="40" y1="0" x2="0" y2="40" stroke="#64748b" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[14px] font-mono font-bold text-foreground">{toothNumber}</span>
      <svg width="40" height="40" viewBox="0 0 40 40" className="cursor-pointer hover:shadow-sm transition-all drop-shadow-sm">
        {/* Top (Buccal/Facial) */}
        <polygon
          points="0,0 40,0 28,12 12,12"
          fill={getStatusColor(surfaces.B)}
          stroke="#cbd5e1" strokeWidth="1"
          onClick={() => onClick("B")}
          className="hover:opacity-80 transition-opacity"
        />
        {/* Bottom (Lingual/Palatal) */}
        <polygon
          points="0,40 40,40 28,28 12,28"
          fill={getStatusColor(surfaces.L)}
          stroke="#cbd5e1" strokeWidth="1"
          onClick={() => onClick("L")}
          className="hover:opacity-80 transition-opacity"
        />
        {/* Left (Mesial/Distal) */}
        <polygon
          points="0,0 12,12 12,28 0,40"
          fill={getStatusColor(surfaces.M)}
          stroke="#cbd5e1" strokeWidth="1"
          onClick={() => onClick("M")}
          className="hover:opacity-80 transition-opacity"
        />
        {/* Right (Distal/Mesial) */}
        <polygon
          points="40,0 28,12 28,28 40,40"
          fill={getStatusColor(surfaces.D)}
          stroke="#cbd5e1" strokeWidth="1"
          onClick={() => onClick("D")}
          className="hover:opacity-80 transition-opacity"
        />
        {/* Center (Occlusal/Incisal) */}
        <rect
          x="12" y="12" width="16" height="16"
          fill={getStatusColor(surfaces.O)}
          stroke="#cbd5e1" strokeWidth="1"
          onClick={() => onClick("O")}
          className="hover:opacity-80 transition-opacity"
        />

        {/* Overlays for overall tooth conditions */}
        {overallStatus === "crown" && <circle cx="20" cy="20" r="16" fill="none" stroke={getStatusColor("crown")} strokeWidth="3" pointerEvents="none" />}
        {overallStatus === "rct" && <line x1="20" y1="4" x2="20" y2="36" stroke={getStatusColor("rct")} strokeWidth="4" pointerEvents="none" strokeLinecap="round" />}
        {overallStatus === "extraction_planned" && <line x1="4" y1="4" x2="36" y2="36" stroke={getStatusColor("extraction_planned")} strokeWidth="4" pointerEvents="none" strokeLinecap="round" />}
        {overallStatus === "implant" && <rect x="16" y="2" width="8" height="36" rx="2" fill="none" stroke={getStatusColor("implant")} strokeWidth="3" pointerEvents="none" />}
      </svg>
    </div>
  );
};