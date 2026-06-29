import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Star, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const PREM_DIMENSIONS = [
  { key: "prem_communication", label: "Communication by staff" },
  { key: "prem_cleanliness", label: "Cleanliness & hygiene" },
  { key: "prem_responsiveness", label: "Responsiveness to needs" },
  { key: "prem_dignity", label: "Dignity & respect" },
  { key: "prem_discharge_info", label: "Discharge information" },
  { key: "prem_overall", label: "Overall experience" },
] as const;

type PREMKey = (typeof PREM_DIMENSIONS)[number]["key"];

interface Survey {
  id: string;
  status: string;
  response_token: string;
  hospital_id: string;
  patient_id: string;
}

const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4, 5].map(n => (
      <button key={n} type="button" onClick={() => onChange(n)}>
        <Star className={cn("h-7 w-7 transition-colors", n <= value ? "fill-amber-400 text-amber-400" : "text-gray-300 hover:text-amber-200")} />
      </button>
    ))}
  </div>
);

const PROMAResponsePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PREM scores
  const [premScores, setPremScores] = useState<Record<PREMKey, number>>({
    prem_communication: 0, prem_cleanliness: 0, prem_responsiveness: 0,
    prem_dignity: 0, prem_discharge_info: 0, prem_overall: 0,
  });

  // PROM
  const [painScore, setPainScore] = useState(0);
  const [mobility, setMobility] = useState<string>("normal");
  const [ableToWork, setAbleToWork] = useState<boolean | null>(null);
  const [readmitted, setReadmitted] = useState<boolean | null>(null);
  const [comments, setComments] = useState("");

  useEffect(() => {
    const fetchSurvey = async () => {
      if (!token) { setError("Invalid survey link."); setLoading(false); return; }
      const { data, error: fetchErr } = await (supabase as any)
        .from("prom_prem_surveys")
        .select("id, status, response_token, hospital_id, patient_id")
        .eq("response_token", token)
        .maybeSingle();
      if (fetchErr || !data) { setError("Survey not found or link has expired."); setLoading(false); return; }
      if (data.status === "responded") { setSubmitted(true); setLoading(false); return; }
      if (data.status === "expired") { setError("This survey link has expired."); setLoading(false); return; }
      setSurvey(data);
      setLoading(false);
    };
    fetchSurvey();
  }, [token]);

  const submit = async () => {
    if (!survey) return;
    const allPremFilled = Object.values(premScores).every(v => v > 0);
    if (!allPremFilled) {
      alert("Please rate all experience dimensions before submitting."); return;
    }
    setSaving(true);
    const { error: updateErr } = await (supabase as any)
      .from("prom_prem_surveys")
      .update({
        ...premScores,
        prom_pain_score: painScore,
        prom_mobility: mobility,
        prom_able_to_work: ableToWork,
        prom_readmitted: readmitted,
        comments: comments || null,
        responded_at: new Date().toISOString(),
        status: "responded",
      })
      .eq("response_token", token);
    if (updateErr) { alert("Submission failed. Please try again."); setSaving(false); return; }
    setSubmitted(true);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Survey Unavailable</h2>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Thank you! 🙏</h2>
          <p className="text-muted-foreground text-sm">Your feedback has been recorded. It helps us continuously improve our care.</p>
          <p className="text-muted-foreground text-xs mt-3">Get well soon!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto bg-white rounded-xl shadow-sm border p-6">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-foreground">Share Your Experience</h1>
          <p className="text-sm text-muted-foreground mt-1">Takes 2 minutes • Your feedback matters</p>
        </div>

        {/* PREM Section */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-4 pb-2 border-b">🏥 Your Hospital Experience</h2>
          <div className="space-y-4">
            {PREM_DIMENSIONS.map(dim => (
              <div key={dim.key}>
                <p className="text-sm font-medium mb-1">{dim.label}</p>
                <StarRating value={premScores[dim.key]}
                  onChange={v => setPremScores(s => ({ ...s, [dim.key]: v }))} />
              </div>
            ))}
          </div>
        </div>

        {/* PROM Section */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-4 pb-2 border-b">📋 Your Recovery</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Current pain level (0 = none, 10 = worst)</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">0</span>
                <input type="range" min={0} max={10} value={painScore}
                  onChange={e => setPainScore(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-xs text-muted-foreground">10</span>
                <span className="ml-2 font-bold text-primary w-6 text-center">{painScore}</span>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Mobility compared to before admission</p>
              {["normal", "limited", "bed_rest"].map(m => (
                <label key={m} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                  <input type="radio" name="mobility" value={m} checked={mobility === m}
                    onChange={() => setMobility(m)} />
                  <span className="text-sm">
                    {m === "normal" ? "Normal / as before" : m === "limited" ? "Some limitations" : "Bed rest / cannot walk"}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Are you able to perform daily activities?</p>
              <div className="flex gap-3">
                {[true, false].map(v => (
                  <label key={String(v)} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="able_to_work" checked={ableToWork === v}
                      onChange={() => setAbleToWork(v)} />
                    <span className="text-sm">{v ? "Yes" : "No"}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Were you readmitted to any hospital since discharge?</p>
              <div className="flex gap-3">
                {[true, false].map(v => (
                  <label key={String(v)} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="readmitted" checked={readmitted === v}
                      onChange={() => setReadmitted(v)} />
                    <span className="text-sm">{v ? "Yes" : "No"}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="mb-6">
          <p className="text-sm font-medium mb-1">Any other comments or suggestions?</p>
          <textarea
            className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
            rows={3}
            placeholder="Your feedback helps us improve care for everyone…"
            value={comments}
            onChange={e => setComments(e.target.value)}
          />
        </div>

        <Button className="w-full" size="lg" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</> : "Submit Feedback"}
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-3">Your response is confidential and used only to improve hospital services.</p>
      </div>
    </div>
  );
};

export default PROMAResponsePage;
