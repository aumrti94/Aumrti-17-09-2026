import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { autoPostJournalEntry } from "@/lib/accounting";
import { AlertOctagon, RotateCw } from "lucide-react";

interface FailureRow {
  id: string;
  hospital_id: string;
  trigger_event: string;
  source_module: string | null;
  source_id: string;
  amount: number | null;
  description: string | null;
  posted_by: string | null;
  entry_date: string | null;
  cost_centre_id: string | null;
  created_at: string;
}

interface Props {
  hospitalId: string | null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Surfaces rows in accounting_posting_failures — trigger events autoPostJournalEntry
 * couldn't post because no matching auto_posting_rules row existed. Previously these
 * failed silently with no UI anywhere reading this table, and there was no way to
 * retry once the missing rule was added — "Retry" re-runs the exact original posting
 * and marks the row resolved (drops off this list) on success.
 */
const PostingFailuresCard: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("accounting_posting_failures")
      .select("id, hospital_id, trigger_event, source_module, source_id, amount, description, posted_by, entry_date, cost_centre_id, created_at")
      .eq("hospital_id", hospitalId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    setFailures(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const retry = async (f: FailureRow) => {
    setRetryingId(f.id);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase
      .from("users").select("id").eq("auth_user_id", user?.id || "").maybeSingle();
    const currentUserId = userData?.id || null;

    const result = await autoPostJournalEntry({
      triggerEvent: f.trigger_event,
      sourceModule: f.source_module || "unknown",
      sourceId: f.source_id,
      amount: Number(f.amount) || 0,
      description: f.description || `Retry: ${f.trigger_event} — ${f.source_id}`,
      entryDate: f.entry_date || undefined,
      costCentreId: f.cost_centre_id || undefined,
      hospitalId: f.hospital_id,
      postedBy: currentUserId || f.posted_by || "",
    });

    if (result) {
      await (supabase as any).from("accounting_posting_failures").update({
        resolved_at: new Date().toISOString(),
        resolved_by: currentUserId,
      }).eq("id", f.id);
      toast({ title: "Journal entry posted ✓", description: `${f.trigger_event} — resolved` });
      setFailures((prev) => prev.filter((x) => x.id !== f.id));
    } else {
      toast({
        title: "Retry failed",
        description: "Still no matching posting rule for this trigger event — add one in Accounts → Posting Rules first.",
        variant: "destructive",
      });
    }
    setRetryingId(null);
  };

  if (!loading && failures.length === 0) return null;

  return (
    <div className="border border-destructive/30 rounded-xl p-4 bg-destructive/5">
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon className="h-4 w-4 text-destructive" />
        <div>
          <p className="text-[13px] font-bold text-destructive">Unposted Journal Entries</p>
          <p className="text-[11px] text-muted-foreground">
            Events with no matching auto-posting rule — no journal entry was created for these
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-[12px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {failures.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] bg-card border border-border"
            >
              <span className="font-mono font-medium text-destructive shrink-0">{f.trigger_event}</span>
              <span className="text-muted-foreground shrink-0">{f.source_module || "—"}</span>
              <span className="text-muted-foreground truncate">{f.source_id}</span>
              <span className="ml-auto font-semibold shrink-0">
                {f.amount != null ? `₹${Number(f.amount).toLocaleString("en-IN")}` : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(f.created_at)}</span>
              <button
                onClick={() => retry(f)}
                disabled={retryingId === f.id}
                className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
              >
                <RotateCw className={`h-3 w-3 ${retryingId === f.id ? "animate-spin" : ""}`} />
                {retryingId === f.id ? "Retrying…" : "Retry"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PostingFailuresCard;
