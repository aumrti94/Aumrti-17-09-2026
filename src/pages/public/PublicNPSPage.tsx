import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const PublicNPSPage: React.FC = () => {
  const { surveyId } = useParams<{ surveyId: string }>();
  const [score, setScore] = useState<number | null>(null);
  const [verbatim, setVerbatim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (score === null || !surveyId) return;
    setSubmitting(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("nps-survey-respond", {
        body: { survey_id: surveyId, score, verbatim: verbatim.trim() || undefined },
      });
      if (fnError || data?.error) throw new Error(data?.error || fnError?.message || "Failed to submit");
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!surveyId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Invalid survey link.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="max-w-sm w-full bg-card border border-border rounded-2xl p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto text-green-600" size={40} />
          <h1 className="text-lg font-bold text-foreground">Thank you for your feedback</h1>
          <p className="text-sm text-muted-foreground">Your response helps us improve care for every patient.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-sm w-full bg-card border border-border rounded-2xl p-8 space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-bold text-foreground">How was your recent visit?</h1>
          <p className="text-xs text-muted-foreground">On a scale of 0–10, how likely are you to recommend us to a friend or family member?</p>
        </div>

        <div className="grid grid-cols-11 gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={cn(
                "h-9 rounded-md text-[12px] font-semibold border transition-colors",
                score === n
                  ? n >= 9 ? "bg-green-600 text-white border-green-600"
                    : n >= 7 ? "bg-amber-500 text-white border-amber-500"
                    : "bg-red-500 text-white border-red-500"
                  : "bg-background border-border text-foreground hover:border-primary/50"
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
          <span>Not likely</span>
          <span>Very likely</span>
        </div>

        <Textarea
          value={verbatim}
          onChange={(e) => setVerbatim(e.target.value)}
          placeholder="Anything you'd like to share? (optional)"
          className="text-sm min-h-[80px]"
          maxLength={1000}
        />

        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </p>
        )}

        <Button onClick={submit} disabled={score === null || submitting} className="w-full">
          {submitting ? "Submitting…" : "Submit feedback"}
        </Button>
      </div>
    </div>
  );
};

export default PublicNPSPage;
