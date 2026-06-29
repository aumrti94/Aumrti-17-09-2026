import React, { useState } from "react";
import { callAI } from "@/lib/aiProvider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Target, TrendingUp, AlertTriangle, Rocket } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props {
  referralId: string;
  diagnosis: string;
  scores: { tool: string; score: number; max_score: number; assessment_type: string }[];
}

const OutcomeTrajectoryPredictor: React.FC<Props> = ({ referralId, diagnosis, scores }) => {
  const { hospitalId } = useHospitalId();
  const [prediction, setPrediction] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const predict = async () => {
    if (!scores.length) return;
    setLoading(true);
    try {
      const response = await callAI({
        featureKey: "voice_scribe",
        hospitalId: hospitalId,
        prompt: `Predict physiotherapy outcome trajectory.
    
Diagnosis: ${diagnosis}
Current outcome scores:
${scores.map(s => `${s.tool} (${s.assessment_type}): ${s.score}/${s.max_score}`).join("\n")}

Sessions completed: ${scores.length}

Based on typical physiotherapy outcomes for this diagnosis:
Return ONLY JSON:
{
  "expected_recovery_weeks": 6,
  "expected_final_score_percent": 85,
  "current_trajectory": "on_track",
  "deviation_flag": false,
  "deviation_reason": null,
  "recommended_adjustment": null,
  "milestone_next_session": "Patient should achieve 50% active ROM by next assessment"
}`,
        maxTokens: 200,
      });

      if (response.error) { setLoading(false); return; }

      const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      setPrediction(parsed);

      await supabase.from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        feature_key: "physio_trajectory",
        module: "physio",
        success: true,
        output_summary: `Trajectory: ${parsed.current_trajectory}, Recovery: ${parsed.expected_recovery_weeks}w`,
      });
    } catch { /* graceful */ }
    setLoading(false);
  };

  if (!prediction) {
    return (
      <Button size="sm" variant="outline" className="text-xs h-7 mt-2" onClick={predict} disabled={loading || scores.length === 0}>
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Target className="h-3 w-3 mr-1" />}
        🎯 Predict Trajectory
      </Button>
    );
  }

  const trajectoryIcon = prediction.current_trajectory === "ahead"
    ? <Rocket className="h-4 w-4 text-green-600" />
    : prediction.current_trajectory === "behind"
    ? <AlertTriangle className="h-4 w-4 text-amber-600" />
    : <TrendingUp className="h-4 w-4 text-blue-600" />;

  const trajectoryColor = prediction.current_trajectory === "ahead"
    ? "border-green-200 bg-green-50"
    : prediction.current_trajectory === "behind"
    ? "border-amber-200 bg-amber-50"
    : "border-blue-200 bg-blue-50";

  const trajectoryText = prediction.current_trajectory === "ahead"
    ? "🚀 Recovering faster than expected"
    : prediction.current_trajectory === "behind"
    ? "⚠️ Progress below expected — review treatment plan"
    : "✅ Progress matches expected trajectory";

  return (
    <Card className={`mt-3 ${trajectoryColor}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          {trajectoryIcon}
          <span className="text-sm font-bold">Recovery Trajectory</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="text-xs">
            <span className="text-muted-foreground">Expected recovery:</span>
            <span className="font-bold ml-1">{prediction.expected_recovery_weeks} weeks</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Projected final:</span>
            <span className="font-bold ml-1">{prediction.expected_final_score_percent}%</span>
          </div>
        </div>

        <p className="text-xs font-medium">{trajectoryText}</p>

        {prediction.milestone_next_session && (
          <div className="rounded-md bg-amber-100 border border-amber-200 p-2">
            <p className="text-[11px] font-medium text-amber-800">
              📌 Next milestone: {prediction.milestone_next_session}
            </p>
          </div>
        )}

        {prediction.recommended_adjustment && (
          <div className="rounded-md bg-green-100 border border-green-200 p-2">
            <p className="text-[11px] font-medium text-green-800">
              💡 {prediction.recommended_adjustment}
            </p>
          </div>
        )}

        {prediction.deviation_flag && prediction.deviation_reason && (
          <p className="text-[11px] text-destructive">⚠️ {prediction.deviation_reason}</p>
        )}
      </CardContent>
    </Card>
  );
};

export default OutcomeTrajectoryPredictor;
