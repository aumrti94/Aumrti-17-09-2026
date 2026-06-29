import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { EncounterData } from "../ConsultationWorkspace";

interface Props {
  encounter: EncounterData;
  onChange: (partial: Partial<EncounterData>) => void;
}

function getVital(vitals: Record<string, unknown>, key: string): string {
  return String(vitals[key] ?? "");
}

function setVital(vitals: Record<string, unknown>, key: string, val: string): Record<string, unknown> {
  return { ...vitals, [key]: val };
}

const VitalCard: React.FC<{
  label: string; unit: string; value: string; placeholder: string;
  onChange: (v: string) => void; alert?: "amber" | "red" | "green"; type?: string;
}> = ({ label, unit, value, placeholder, onChange, alert, type = "number" }) => (
  <div className={cn(
    "bg-white border rounded-lg p-3 transition-colors",
    alert === "red" ? "border-red-300" : alert === "amber" ? "border-amber-300" : alert === "green" ? "border-emerald-300" : "border-slate-200"
  )}>
    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-xl font-semibold text-slate-900 bg-transparent outline-none mt-1"
    />
    <span className="text-[11px] text-slate-400">{unit}</span>
  </div>
);

const VitalsTab: React.FC<Props> = ({ encounter, onChange }) => {
  const v = encounter.vitals;

  const update = (key: string, val: string) => {
    onChange({ vitals: setVital(v, key, val) });
  };

  const sys = parseFloat(getVital(v, "bp_systolic"));
  const dia = parseFloat(getVital(v, "bp_diastolic"));
  const pulse = parseFloat(getVital(v, "pulse"));
  const temp = parseFloat(getVital(v, "temperature"));
  const spo2 = parseFloat(getVital(v, "spo2"));
  const weight = parseFloat(getVital(v, "weight_kg"));
  const height = parseFloat(getVital(v, "height_cm"));

  const bmi = useMemo(() => {
    if (!weight || !height) return null;
    return weight / Math.pow(height / 100, 2);
  }, [weight, height]);

  const bmiCategory = useMemo(() => {
    if (!bmi) return null;
    if (bmi < 18.5) return { label: "Underweight", color: "text-blue-600" };
    if (bmi < 25) return { label: "Normal", color: "text-emerald-600" };
    if (bmi < 30) return { label: "Overweight", color: "text-amber-600" };
    return { label: "Obese", color: "text-red-600" };
  }, [bmi]);

  const bpAlert = sys > 180 ? "red" : sys > 140 ? "amber" : undefined;
  const pulseAlert = pulse > 100 || pulse < 60 ? "amber" : undefined;
  const tempAlert = temp > 100.4 ? "amber" : undefined;
  const spo2Alert = spo2 < 95 ? "red" : spo2 <= 97 ? "amber" : spo2 >= 98 ? "green" : undefined;

  return (
    <div className="h-full p-4 overflow-y-auto">
      <div className="grid grid-cols-3 gap-3">
        {/* BP */}
        <div className={cn("bg-white border rounded-lg p-3 transition-colors", bpAlert === "red" ? "border-red-300" : bpAlert === "amber" ? "border-amber-300" : "border-slate-200")}>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Blood Pressure</label>
          <div className="flex items-center gap-1 mt-1">
            <input type="number" value={getVital(v, "bp_systolic")} onChange={(e) => update("bp_systolic", e.target.value)} placeholder="120" className="w-16 text-xl font-semibold text-slate-900 bg-transparent outline-none" />
            <span className="text-slate-400 text-lg">/</span>
            <input type="number" value={getVital(v, "bp_diastolic")} onChange={(e) => update("bp_diastolic", e.target.value)} placeholder="80" className="w-16 text-xl font-semibold text-slate-900 bg-transparent outline-none" />
          </div>
          <span className="text-[11px] text-slate-400">mmHg · Normal: 90-140/60-90</span>
        </div>

        <VitalCard label="Pulse Rate" unit="beats/min · Normal: 60-100" value={getVital(v, "pulse")} placeholder="72" onChange={(val) => update("pulse", val)} alert={pulseAlert} />
        <VitalCard label="Temperature" unit="°F · Normal: 97-99" value={getVital(v, "temperature")} placeholder="98.6" onChange={(val) => update("temperature", val)} alert={tempAlert} />
        <VitalCard label="SpO2" unit="% · Normal: ≥ 98%" value={getVital(v, "spo2")} placeholder="98" onChange={(val) => update("spo2", val)} alert={spo2Alert} />
        <VitalCard label="Weight" unit="kg" value={getVital(v, "weight_kg")} placeholder="65" onChange={(val) => update("weight_kg", val)} />
        <VitalCard label="Height" unit="cm" value={getVital(v, "height_cm")} placeholder="170" onChange={(val) => update("height_cm", val)} />
      </div>

      {/* BMI */}
      {bmi && bmiCategory && (
        <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">BMI</span>
            <p className="text-2xl font-bold text-slate-900">{bmi.toFixed(1)}</p>
          </div>
          <span className={cn("text-sm font-semibold", bmiCategory.color)}>{bmiCategory.label}</span>
        </div>
      )}
    </div>
  );
};

export default VitalsTab;
