import React from "react";
import { Sparkles, Check, X, AlertTriangle } from "lucide-react";

export interface AIRecommendationPanelProps {
  title?: string;
  recommendations: Array<{
    id: string;
    text: string;
    confidenceScore?: number;
    reasoning?: string;
    isWarning?: boolean;
  }>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  isLoading?: boolean;
}

export const AIRecommendationPanel: React.FC<AIRecommendationPanelProps> = ({
  title = "AI Insights & Recommendations",
  recommendations,
  onAccept,
  onReject,
  isLoading = false,
}) => {
  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-card shadow-sm h-full max-h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
        <Sparkles size={16} className="text-[hsl(222,55%,23%)]" />
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-16 bg-muted rounded-lg w-full"></div>
            <div className="h-16 bg-muted rounded-lg w-full"></div>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No recommendations available at this time.
          </div>
        ) : (
          recommendations.map((rec) => (
            <div 
              key={rec.id} 
              className={`p-3 rounded-lg border ${
                rec.isWarning 
                  ? "bg-amber-50/50 border-amber-200" 
                  : "bg-background border-border"
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                {rec.isWarning ? (
                  <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <Sparkles size={16} className="text-[hsl(222,55%,23%)] mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm text-foreground font-medium leading-snug">
                    {rec.text}
                  </p>
                  {rec.reasoning && (
                    <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                      {rec.reasoning}
                    </p>
                  )}
                  {rec.confidenceScore !== undefined && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Confidence:</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[100px]">
                        <div 
                          className="h-full bg-emerald-500" 
                          style={{ width: `${rec.confidenceScore * 100}%` }} 
                        />
                      </div>
                      <span className="text-[10px] font-medium text-foreground">
                        {Math.round(rec.confidenceScore * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border/50">
                <button 
                  onClick={() => onReject(rec.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                >
                  <X size={12} /> Reject
                </button>
                <button 
                  onClick={() => onAccept(rec.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-[hsl(222,55%,23%)] hover:opacity-90 rounded transition-opacity"
                >
                  <Check size={12} /> Accept
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
