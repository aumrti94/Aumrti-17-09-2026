import React, { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Check, XCircle, Flag, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AuditEntry {
  id: string;
  feature_key: string;
  confidence: number | null;
  reasoning: string | null;
  user_action: string;
  override_value: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  patientId?: string;
}

const ACTION_STYLES: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  accepted: { label: "Accepted", icon: <Check className="h-3 w-3" />, color: "bg-emerald-100 text-emerald-700" },
  overridden: { label: "Overridden", icon: <Pencil className="h-3 w-3" />, color: "bg-blue-100 text-blue-700" },
  rejected: { label: "Rejected", icon: <XCircle className="h-3 w-3" />, color: "bg-red-100 text-red-700" },
  flagged: { label: "Flagged", icon: <Flag className="h-3 w-3" />, color: "bg-amber-100 text-amber-700" },
};

const featureLabel = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const AIAuditLogDrawer: React.FC<Props> = ({ open, onClose, hospitalId, patientId }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !hospitalId) return;
    setLoading(true);
    let query = (supabase as any)
      .from("ai_suggestions_audit")
      .select("id, feature_key, confidence, reasoning, user_action, override_value, created_at")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (patientId) query = query.eq("patient_id", patientId);
    query.then(({ data }: { data: AuditEntry[] | null }) => {
      setEntries(data || []);
      setLoading(false);
    });
  }, [open, hospitalId, patientId]);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[420px] sm:w-[520px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            AI Decision Audit Log
            {patientId && (
              <span className="text-xs font-normal text-muted-foreground">(this patient)</span>
            )}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-120px)] pr-1">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-12">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No AI decisions recorded yet
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const style = ACTION_STYLES[entry.user_action] ?? ACTION_STYLES.rejected;
                const overrideStr =
                  entry.override_value
                    ? (entry.override_value as any).value ?? JSON.stringify(entry.override_value)
                    : null;

                return (
                  <div key={entry.id} className="border rounded-lg p-3 space-y-1.5 bg-card">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{featureLabel(entry.feature_key)}</span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] gap-1 px-1.5 py-0.5 ${style.color}`}
                      >
                        {style.icon}
                        {style.label}
                      </Badge>
                    </div>

                    {entry.confidence != null && (
                      <p className="text-[11px] text-muted-foreground">
                        Confidence:{" "}
                        <span
                          className={
                            entry.confidence >= 0.8
                              ? "text-emerald-600 font-medium"
                              : entry.confidence >= 0.6
                              ? "text-amber-600 font-medium"
                              : "text-red-600 font-medium"
                          }
                        >
                          {Math.round(entry.confidence * 100)}%
                        </span>
                      </p>
                    )}

                    {entry.reasoning && (
                      <p className="text-[11px] italic text-muted-foreground">
                        &ldquo;{entry.reasoning}&rdquo;
                      </p>
                    )}

                    {entry.user_action === "overridden" && overrideStr && (
                      <p className="text-[11px] text-blue-700 bg-blue-50 rounded px-2 py-1">
                        Override: {overrideStr}
                      </p>
                    )}

                    <p className="text-[10px] text-muted-foreground">
                      {relativeTime(entry.created_at)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default AIAuditLogDrawer;
