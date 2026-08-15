import React from "react";
import type { EncounterData, PrescriptionData } from "../ConsultationWorkspace";

interface Props {
  prescription: PrescriptionData;
  onChange: (partial: Partial<PrescriptionData>) => void;
  encounter: EncounterData;
  onEncounterChange: (partial: Partial<EncounterData>) => void;
}

const PlanAdviceTab: React.FC<Props> = ({ prescription, onChange, encounter, onEncounterChange }) => {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3 max-w-2xl">
      <div>
        <label className="text-xs font-bold text-slate-700 mb-1 block">Plan &amp; Investigations</label>
        <textarea
          value={encounter.soap_plan}
          onChange={(e) => onEncounterChange({ soap_plan: e.target.value })}
          placeholder="Management plan, investigations advised, referrals..."
          className="w-full min-h-[120px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-bold text-slate-700 mb-1 block">Advice &amp; Instructions</label>
        <textarea
          value={prescription.advice_notes}
          onChange={(e) => onChange({ advice_notes: e.target.value })}
          placeholder="Advice and instructions for the patient..."
          className="w-full min-h-[100px] border border-slate-200 rounded-lg p-3 text-sm resize-none focus:border-[#1A2F5A] focus:ring-2 focus:ring-[#1A2F5A]/10 outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-slate-700 mb-1 block">Follow-up</label>
          <input
            type="text"
            value={encounter.follow_up_notes}
            onChange={(e) => onEncounterChange({ follow_up_notes: e.target.value })}
            placeholder="e.g. Follow up with MRI report"
            className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#1A2F5A]"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-700 mb-1 block">Review date</label>
          <input
            type="date"
            value={prescription.review_date}
            onChange={(e) => onChange({ review_date: e.target.value })}
            className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#1A2F5A]"
          />
        </div>
      </div>
    </div>
  );
};

export default PlanAdviceTab;
