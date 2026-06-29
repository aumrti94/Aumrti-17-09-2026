import React, { useState } from "react";

export interface ToothCondition {
  id: string;
  condition: "healthy" | "decayed" | "filled" | "missing" | "crown" | "root-canal";
}

export interface OdontogramProps {
  initialState?: Record<string, ToothCondition>;
  onChange?: (state: Record<string, ToothCondition>) => void;
  readOnly?: boolean;
}

const TEETH_TOP = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28"
];
const TEETH_BOTTOM = [
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38"
];

const CONDITION_COLORS = {
  "healthy": "#ffffff",
  "decayed": "#ef4444",
  "filled": "#3b82f6",
  "missing": "#94a3b8",
  "crown": "#f59e0b",
  "root-canal": "#8b5cf6"
};

export const Odontogram: React.FC<OdontogramProps> = ({
  initialState = {},
  onChange,
  readOnly = false,
}) => {
  const [teethState, setTeethState] = useState<Record<string, ToothCondition>>(initialState);
  const [selectedCondition, setSelectedCondition] = useState<ToothCondition["condition"]>("decayed");

  const handleToothClick = (toothId: string) => {
    if (readOnly) return;
    const newState = {
      ...teethState,
      [toothId]: { id: toothId, condition: selectedCondition }
    };
    setTeethState(newState);
    if (onChange) onChange(newState);
  };

  const getToothColor = (id: string) => {
    const condition = teethState[id]?.condition || "healthy";
    return CONDITION_COLORS[condition];
  };

  const ToothSVG = ({ id }: { id: string }) => (
    <div 
      className="flex flex-col items-center gap-1 cursor-pointer transition-transform hover:scale-110"
      onClick={() => handleToothClick(id)}
    >
      <span className="text-[10px] font-mono text-muted-foreground">{id}</span>
      <svg width="24" height="32" viewBox="0 0 24 32" className="drop-shadow-sm">
        <path 
          d="M 6 0 L 18 0 C 21 0 24 3 24 8 L 22 16 C 22 24 16 32 12 32 C 8 32 2 24 2 16 L 0 8 C 0 3 3 0 6 0 Z" 
          fill={getToothColor(id)} 
          stroke="#cbd5e1" 
          strokeWidth="1.5"
        />
        {teethState[id]?.condition === "missing" && (
          <line x1="0" y1="0" x2="24" y2="32" stroke="#ef4444" strokeWidth="2" />
        )}
      </svg>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      {!readOnly && (
        <div className="flex items-center gap-3 flex-wrap p-2 bg-white rounded-lg shadow-sm border border-slate-100">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">Tools:</span>
          {(Object.keys(CONDITION_COLORS) as Array<ToothCondition["condition"]>).map(cond => (
            <button
              key={cond}
              onClick={() => setSelectedCondition(cond)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-all ${
                selectedCondition === cond 
                  ? "bg-slate-800 text-white shadow-md scale-105" 
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <div 
                className="w-3 h-3 rounded-full border border-slate-300" 
                style={{ backgroundColor: CONDITION_COLORS[cond] }} 
              />
              {cond.replace("-", " ")}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-8 items-center bg-white p-6 rounded-xl shadow-inner border border-slate-200">
        <div className="flex gap-2">
          {TEETH_TOP.slice(0, 8).map(id => <ToothSVG key={id} id={id} />)}
          <div className="w-4" /> {/* Midline separator */}
          {TEETH_TOP.slice(8).map(id => <ToothSVG key={id} id={id} />)}
        </div>
        
        <div className="w-full h-px bg-slate-200" /> {/* Upper/Lower separator */}
        
        <div className="flex gap-2">
          {TEETH_BOTTOM.slice(0, 8).map(id => <ToothSVG key={id} id={id} />)}
          <div className="w-4" /> {/* Midline separator */}
          {TEETH_BOTTOM.slice(8).map(id => <ToothSVG key={id} id={id} />)}
        </div>
      </div>
    </div>
  );
};
