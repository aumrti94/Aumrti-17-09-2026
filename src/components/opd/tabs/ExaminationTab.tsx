import React, { useState } from "react";
import { Pencil } from "lucide-react";
import type { EncounterData } from "../ConsultationWorkspace";
import DiagnosisPanel from "../DiagnosisPanel";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";

interface Props {
  encounter: EncounterData;
  onChange: (partial: Partial<EncounterData>) => void;
  encounterId?: string | null;
  hospitalId?: string | null;
  patientId?: string | null;
  userId?: string | null;
  seedDiagnosis?: { text: string; icd10_code: string; nonce: number } | null;
}

const SkeletonChips = () => (
  <div className="flex flex-wrap gap-1 mb-2">
    {Array.from({ length: 6 }).map((_, i) => (
      <span key={i} className="h-6 w-20 rounded-full bg-muted animate-pulse inline-block" />
    ))}
  </div>
);

const ExaminationTab: React.FC<Props> = ({ encounter, onChange, encounterId, hospitalId, patientId, userId, seedDiagnosis }) => {
  const [showManager, setShowManager] = useState(false);

  const { items: examFindings, isLoading, save, reset } = useDoctorQuickPicks<string>("exam_findings");

  const appendToExam = (text: string) => {
    const cur = encounter.examination_notes;
    onChange({ examination_notes: cur + (cur ? ", " : "") + text });
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* General Examination */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-bold text-slate-700">General Examination</label>
          <button
            onClick={() => setShowManager(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-[#1A2F5A] transition-colors"
          >
            <Pencil className="h-3 w-3" />
            {showManager ? "Done" : "Manage"}
          </button>
        </div>

        {isLoading ? (
          <SkeletonChips />
        ) : (
          <div className="flex flex-wrap gap-1 mb-2">
            {examFindings.map((c) => (
              <button
                key={c}
                onClick={() => appendToExam(c)}
                className="text-xs px-2.5 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {showManager && !isLoading && (
          <QuickPickManagerPanel
            items={examFindings}
            onSave={save}
            onReset={reset}
            label="examination finding chips"
          />
        )}

        <textarea
          value={encounter.examination_notes}
          onChange={(e) => onChange({ examination_notes: e.target.value })}
          className="w-full min-h-[90px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none mt-2"
          placeholder="General examination findings..."
        />
      </div>

      {/* Systemic Examination */}
      <div>
        <label className="text-xs font-bold text-slate-700 mb-1 block">Systemic Examination / Clinical Notes</label>
        <textarea
          value={encounter.soap_objective}
          onChange={(e) => onChange({ soap_objective: e.target.value })}
          className="w-full min-h-[90px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
          placeholder="Systemic examination findings..."
        />
      </div>

      {/* Multi-Diagnosis Panel */}
      <DiagnosisPanel
        encounterId={encounterId ?? null}
        hospitalId={hospitalId ?? null}
        patientId={patientId ?? null}
        userId={userId ?? null}
        onPrimaryChange={(diagnosis, icd10_code) => onChange({ diagnosis, icd10_code })}
        seedDiagnosis={seedDiagnosis ?? null}
      />
    </div>
  );
};

export default ExaminationTab;
