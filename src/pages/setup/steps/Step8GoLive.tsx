import React from "react";

interface Props {
  hospitalId: string;
  hospitalName: string;
  completedSteps: Set<number>;
  selectedDepts: string[];
  // The pre-launch steps actually shown in this onboarding flow (excludes Go Live).
  preLaunchSteps: { index: number; label: string }[];
  onGoLive: () => void;
}

const Step8GoLive: React.FC<Props> = ({ hospitalName, completedSteps, selectedDepts, preLaunchSteps, onGoLive }) => {
  const incomplete = preLaunchSteps.filter((s) => !completedSteps.has(s.index)).map((s) => s.label);
  const doneCount = preLaunchSteps.filter((s) => completedSteps.has(s.index)).length;

  return (
    <div>
      <h2 className="text-[22px] font-bold text-foreground">You're ready to go live! 🎉</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-8">Here's a summary of your setup</p>

      <div className="bg-card rounded-2xl border border-border p-6 shadow-card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-muted/40 rounded-lg p-4 border border-border">
            <p className="text-xs text-muted-foreground">Departments</p>
            <p className="text-lg font-bold text-foreground mt-1">{selectedDepts.length} configured</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4 border border-border">
            <p className="text-xs text-muted-foreground">Setup Steps</p>
            <p className="text-lg font-bold text-foreground mt-1">{doneCount} / {preLaunchSteps.length} completed</p>
          </div>
        </div>
      </div>

      {incomplete.length > 0 && (
        <div className="bg-[#FEF3C7] border-l-[3px] border-accent px-3.5 py-2.5 rounded text-[13px] mt-6">
          These items are not yet configured: <strong>{incomplete.join(", ")}</strong>.
          You can complete them from Settings → Setup.
        </div>
      )}

      <button
        onClick={onGoLive}
        className="w-full mt-8 bg-primary text-primary-foreground py-4 rounded-xl text-[17px] font-bold hover:bg-[hsl(220,54%,16%)] transition-colors active:scale-[0.98]"
      >
        🏥 Open My Hospital Dashboard
      </button>

      <p className="text-center mt-4 text-[13px]">
        <a href="#" className="text-secondary hover:underline">Need help? Chat with our support team →</a>
      </p>
    </div>
  );
};

export default Step8GoLive;
