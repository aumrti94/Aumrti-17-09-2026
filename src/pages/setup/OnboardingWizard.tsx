import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check, ArrowLeft } from "lucide-react";
import Step1Branding from "./steps/Step1Branding";
import Step2Departments from "./steps/Step2Departments";
import Step3Wards from "./steps/Step3Wards";
import Step4bShifts from "./steps/Step4bShifts";
import Step4Doctors from "./steps/Step4Doctors";
import Step5bStaff from "./steps/Step5bStaff";
import Step5cSchedules from "./steps/Step5cSchedules";
import Step5Fees from "./steps/Step5Fees";
import Step6bPayers from "./steps/Step6bPayers";
import Step6cLabRadiology from "./steps/Step6cLabRadiology";
import Step6Payments from "./steps/Step6Payments";
import Step7WhatsApp from "./steps/Step7WhatsApp";
import Step7bModules from "./steps/Step7bModules";
import Step8GoLive from "./steps/Step8GoLive";

const STEPS = [
  { label: "Branding",       section: "Hospital",      optional: true  },
  { label: "Departments",    section: "Hospital",      optional: false },
  { label: "Wards & Beds",   section: "Structure",     optional: false },
  { label: "Shifts",         section: "Structure",     optional: false },
  { label: "Doctors",        section: "People",        optional: true  },
  { label: "Other Staff",    section: "People",        optional: true  },
  { label: "OPD Schedules",  section: "People",        optional: true  },
  { label: "Fees",           section: "Services",      optional: false },
  { label: "Payers",         section: "Services",      optional: true  },
  { label: "Lab & Radiology", section: "Services",     optional: true  },
  { label: "Payments",       section: "Services",      optional: false },
  { label: "WhatsApp",       section: "Integrations",  optional: true  },
  { label: "Modules",        section: "Integrations",  optional: true  },
  { label: "Go Live",        section: "Launch",        optional: false },
] as const;

const SECTIONS = [
  { label: "Hospital",      indices: [0, 1] },
  { label: "Structure",     indices: [2, 3] },
  { label: "People",        indices: [4, 5, 6] },
  { label: "Services",      indices: [7, 8, 9, 10] },
  { label: "Integrations",  indices: [11, 12] },
  { label: "Launch",        indices: [13] },
];

const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState("");
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [addedDoctors, setAddedDoctors] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/", { replace: true }); return; }

      const { data: user } = await supabase
        .from("users")
        .select("hospital_id")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (!user?.hospital_id) { navigate("/", { replace: true }); return; }

      const { data: hospital, error: hospitalError } = await supabase
        .from("hospitals")
        .select("id, name, setup_complete, wizard_step")
        .eq("id", user.hospital_id)
        .maybeSingle();

      if (hospitalError || !hospital) { navigate("/", { replace: true }); return; }
      if (hospital.setup_complete === true) { navigate("/dashboard", { replace: true }); return; }

      setHospitalId(hospital.id);
      setHospitalName(hospital.name);
      // Resume from where user left off (wizard_step stored in DB)
      const savedStep = (hospital as any).wizard_step;
      if (typeof savedStep === "number" && savedStep > 0 && savedStep < 13) {
        setStep(savedStep);
        // Mark all previous steps as completed
        setCompletedSteps(new Set(Array.from({ length: savedStep }, (_, i) => i)));
      }
      setLoading(false);
    };
    init();
  }, [navigate]);

  const markComplete = (s: number) => {
    setCompletedSteps((prev) => new Set([...prev, s]));
    const nextStep = s < 13 ? s + 1 : s;
    if (s < 13) setStep(nextStep);
    // Persist current progress so wizard can be resumed
    if (hospitalId) {
      supabase.from("hospitals").update({ wizard_step: nextStep } as any).eq("id", hospitalId).then(() => {});
    }
  };

  const handleSkipSetup = async () => {
    if (!hospitalId) return;
    const confirmed = window.confirm("Skip setup? You can always complete it from Settings.");
    if (!confirmed) return;
    await supabase.from("hospitals").update({ setup_complete: true } as any).eq("id", hospitalId);
    toast({ title: "Setup skipped", description: "You can complete setup from Settings anytime." });
    navigate("/dashboard", { replace: true });
  };

  const handleGoLive = async () => {
    if (!hospitalId) return;
    await supabase.from("hospitals").update({ setup_complete: true } as any).eq("id", hospitalId);
    navigate("/dashboard?welcome=true", { replace: true });
  };

  if (loading) return null;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background">
      {/* Header */}
      <header className="h-14 shrink-0 bg-card border-b border-border flex items-center px-6 gap-4">
        <div className="flex items-center gap-3 min-w-[160px]">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="text-base font-bold text-primary">Hospital Setup</span>
        </div>

        {/* Section-grouped progress bar */}
        <div className="flex-1 flex items-center justify-center gap-0 overflow-x-auto">
          {SECTIONS.map((section, si) => (
            <React.Fragment key={section.label}>
              {si > 0 && <div className="w-px h-4 bg-border mx-2 shrink-0 hidden sm:block" />}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide hidden lg:block">
                  {section.label}
                </span>
                <div className="flex items-center gap-1">
                  {section.indices.map((i) => {
                    const done = completedSteps.has(i);
                    const active = i === step;
                    return (
                      <React.Fragment key={i}>
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            onClick={() => (done || i <= step) && setStep(i)}
                            title={STEPS[i].label}
                            className={`w-2.5 h-2.5 rounded-full transition-colors ${
                              done ? "bg-[hsl(160,84%,39%)]" : active ? "bg-primary" : "bg-border"
                            }`}
                          />
                          <span className="text-[9px] text-muted-foreground hidden xl:block leading-none">
                            {STEPS[i].label}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-3 min-w-[160px] justify-end">
          <span className="text-[13px] text-muted-foreground">Step {step + 1} of 14</span>
          <button
            onClick={handleSkipSetup}
            className="text-[12px] text-muted-foreground hover:text-foreground underline"
          >
            Skip setup
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full max-w-[720px] px-6 py-10">
          {step === 0  && <Step1Branding     hospitalId={hospitalId!} hospitalName={hospitalName} onComplete={() => markComplete(0)} />}
          {step === 1  && <Step2Departments  hospitalId={hospitalId!} onComplete={(depts) => { setSelectedDepts(depts); markComplete(1); }} />}
          {step === 2  && <Step3Wards        hospitalId={hospitalId!} onComplete={() => markComplete(2)} />}
          {step === 3  && <Step4bShifts      hospitalId={hospitalId!} onComplete={() => markComplete(3)} onSkip={() => markComplete(3)} />}
          {step === 4  && <Step4Doctors      hospitalId={hospitalId!} onComplete={(docs) => { setAddedDoctors(docs); markComplete(4); }} />}
          {step === 5  && <Step5bStaff       hospitalId={hospitalId!} onComplete={() => markComplete(5)} onSkip={() => markComplete(5)} />}
          {step === 6  && <Step5cSchedules   hospitalId={hospitalId!} doctors={addedDoctors} onComplete={() => markComplete(6)} onSkip={() => markComplete(6)} />}
          {step === 7  && <Step5Fees         hospitalId={hospitalId!} selectedDepts={selectedDepts} onComplete={() => markComplete(7)} />}
          {step === 8  && <Step6bPayers      hospitalId={hospitalId!} onComplete={() => markComplete(8)} onSkip={() => markComplete(8)} />}
          {step === 9  && <Step6cLabRadiology hospitalId={hospitalId!} onComplete={() => markComplete(9)} onSkip={() => markComplete(9)} />}
          {step === 10 && <Step6Payments     hospitalId={hospitalId!} onComplete={() => markComplete(10)} />}
          {step === 11 && <Step7WhatsApp     hospitalId={hospitalId!} hospitalName={hospitalName} onComplete={() => markComplete(11)} />}
          {step === 12 && <Step7bModules     hospitalId={hospitalId!} onComplete={() => markComplete(12)} onSkip={() => markComplete(12)} />}
          {step === 13 && <Step8GoLive       hospitalId={hospitalId!} hospitalName={hospitalName} completedSteps={completedSteps} selectedDepts={selectedDepts} onGoLive={handleGoLive} />}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
