import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props {
  review: any;
  onUpdated: () => void;
}

const TOPIC_COLORS: Record<string, string> = {
  "waiting time": "bg-orange-100 text-orange-700",
  "staff behaviour": "bg-purple-100 text-purple-700",
  "billing": "bg-yellow-100 text-yellow-700",
  "cleanliness": "bg-green-100 text-green-700",
  "clinical care": "bg-blue-100 text-blue-700",
  "food": "bg-cyan-100 text-cyan-700",
  "communication": "bg-indigo-100 text-indigo-700",
};

const ReviewSentimentAnalyser: React.FC<Props> = ({ review, onUpdated }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(review.ai_analysis || null);

  const analyse = async () => {
    setLoading(true);
    try {
      const response = await callAI({
        featureKey: "voice_scribe",
        hospitalId: hospitalId,
        prompt: `Analyse this hospital review for actionable insights.
    
Rating: ${review.rating}/5
Review: "${review.review_text || "No text"}"

Return ONLY JSON:
{
  "sentiment": "negative",
  "sentiment_score": -0.6,
  "topics_mentioned": ["waiting time", "staff behaviour"],
  "department_implicated": "OPD",
  "urgency": "high",
  "requires_escalation": true,
  "action_required": "Contact patient and investigate staff complaint"
}`,
        maxTokens: 200,
      });

      if (response.error) { toast({ title: "AI Error", description: response.error, variant: "destructive" }); setLoading(false); return; }

      const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      setAnalysis(parsed);

      // Update review with AI analysis
      await supabase.from("online_reviews").update({
        sentiment: parsed.sentiment,
      }).eq("id", review.id);

      // If requires escalation, create grievance
      if (parsed.requires_escalation) {
        await supabase.from("grievances").insert({
          hospital_id: hospitalId,
          patient_name: review.reviewer_name || "Online Reviewer",
          category: parsed.department_implicated === "OPD" ? "waiting_time" : "clinical_care",
          severity: parsed.urgency === "high" ? "high" : "medium",
          description: `Auto-escalated from ${review.platform} review (${review.rating}/5): ${review.review_text || "No text"}. AI Action: ${parsed.action_required}`,
          channel: "portal",
          status: "open",
        });
        toast({ title: "⚠️ Review escalated to grievance", description: parsed.action_required });
      }

      // Log to ai_feature_logs
      await supabase.from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        feature_key: "review_sentiment",
        module: "crm",
        success: true,
        output_summary: `Sentiment: ${parsed.sentiment}, Topics: ${parsed.topics_mentioned?.join(", ")}`,
      });

      onUpdated();
    } catch (e) {
      toast({ title: "Analysis failed", variant: "destructive" });
    }
    setLoading(false);
  };

  if (!analysis) {
    return (
      <Button size="sm" variant="outline" className="text-xs h-6 mt-1" onClick={analyse} disabled={loading}>
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
        AI Analyse
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {(analysis.topics_mentioned || []).map((topic: string) => (
          <Badge key={topic} className={`text-[10px] ${TOPIC_COLORS[topic.toLowerCase()] || "bg-muted text-muted-foreground"}`}>
            {topic}
          </Badge>
        ))}
        {analysis.department_implicated && (
          <Badge variant="outline" className="text-[10px]">Dept: {analysis.department_implicated}</Badge>
        )}
      </div>
      {analysis.requires_escalation && (
        <div className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3" />
          <span className="font-medium">Escalated: {analysis.action_required}</span>
        </div>
      )}
    </div>
  );
};

export default ReviewSentimentAnalyser;
