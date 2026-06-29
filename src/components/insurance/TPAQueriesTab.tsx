import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { callAI } from "@/lib/aiProvider";

interface TPAQuery {
  id: string;
  query_text: string;
  raised_by_tpa: string | null;
  raised_at: string;
  replied_text: string | null;
  replied_at: string | null;
  status: string;
  priority: string;
  claim_id: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-50 text-red-700",
  replied: "bg-blue-50 text-blue-700",
  escalated: "bg-orange-50 text-orange-700",
  closed: "bg-green-50 text-green-700",
};

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-amber-500 text-white",
  normal: "bg-blue-100 text-blue-700",
  low: "bg-slate-100 text-slate-500",
};

const TPAQueriesTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [queries, setQueries] = useState<TPAQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQuery, setNewQuery] = useState({ query_text: "", raised_by_tpa: "", priority: "normal" });
  const [userId, setUserId] = useState<string | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data) setUserId(data.id); });
    });
  }, []);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    let q = (supabase as any).from("tpa_queries").select("*").eq("hospital_id", hospitalId)
      .order("raised_at", { ascending: false }).limit(100);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data } = await q;
    setQueries(data || []);
    setLoading(false);
  }, [hospitalId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const submitReply = async (q: TPAQuery) => {
    if (!replyText.trim()) return;
    await (supabase as any).from("tpa_queries").update({
      replied_text: replyText.trim(),
      replied_at: new Date().toISOString(),
      replied_by: userId,
      status: "replied",
    }).eq("id", q.id);
    toast({ title: "Reply submitted" });
    setReplyingId(null);
    setReplyText("");
    load();
  };

  const escalate = async (q: TPAQuery) => {
    await (supabase as any).from("tpa_queries").update({ priority: "urgent", status: "escalated" }).eq("id", q.id);
    toast({ title: "Query escalated" });
    load();
  };

  const close = async (q: TPAQuery) => {
    await (supabase as any).from("tpa_queries").update({ status: "closed" }).eq("id", q.id);
    load();
  };

  const suggestAIReply = async (q: TPAQuery) => {
    if (!hospitalId) return;
    setAiSuggesting(q.id);
    setReplyingId(q.id);
    const result = await callAI({
      featureKey: "tpa_query_reply",
      hospitalId,
      prompt: `You are an Indian hospital TPA coordinator. Draft a professional reply to this TPA query.

TPA: ${q.raised_by_tpa || "Insurance Company"}
Query: ${q.query_text}
Priority: ${q.priority}

Write a concise, professional reply (3-5 sentences) that:
- Acknowledges the query
- Commits to providing the requested information
- States a realistic timeline (24-48 hours for urgent, 3-5 days for normal)
- Maintains a cooperative tone

Return only the reply text, no subject line or signature.`,
      maxTokens: 200,
    });
    if (result.text && !result.error) {
      setReplyText(result.text.trim());
      await (supabase as any).from("tpa_queries").update({ ai_suggested_reply: result.text.trim() }).eq("id", q.id);
    } else {
      toast({ title: "AI suggestion failed — type reply manually", variant: "destructive" });
    }
    setAiSuggesting(null);
  };

  const submitNew = async () => {
    if (!newQuery.query_text.trim() || !hospitalId) return;
    await (supabase as any).from("tpa_queries").insert({
      hospital_id: hospitalId,
      query_text: newQuery.query_text.trim(),
      raised_by_tpa: newQuery.raised_by_tpa.trim() || null,
      priority: newQuery.priority,
      status: "open",
    });
    toast({ title: "Query logged" });
    setShowAddForm(false);
    setNewQuery({ query_text: "", raised_by_tpa: "", priority: "normal" });
    load();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex gap-1">
          {["all", "open", "replied", "escalated", "closed"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn("px-3 py-1 rounded-full text-[11px] font-semibold transition-colors capitalize",
                statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {s}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowAddForm(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Log Query
        </Button>
      </div>

      {showAddForm && (
        <div className="flex-shrink-0 px-4 py-3 border-b bg-muted/30 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input value={newQuery.raised_by_tpa} onChange={e => setNewQuery(v => ({ ...v, raised_by_tpa: e.target.value }))}
              placeholder="TPA Name (e.g. Medi Assist)" className="h-8 col-span-1 rounded-md border border-input bg-background px-2 text-xs" />
            <select value={newQuery.priority} onChange={e => setNewQuery(v => ({ ...v, priority: e.target.value }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <Button size="sm" onClick={submitNew} className="h-8">Save Query</Button>
          </div>
          <textarea value={newQuery.query_text} onChange={e => setNewQuery(v => ({ ...v, query_text: e.target.value }))}
            placeholder="Query text from TPA..." rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-none" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
        ) : queries.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No TPA queries</p>
          </div>
        ) : queries.map(q => (
          <div key={q.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {q.raised_by_tpa && <span className="text-xs font-semibold">{q.raised_by_tpa}</span>}
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold", STATUS_STYLES[q.status] || "")}>{q.status}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold", PRIORITY_STYLES[q.priority] || "")}>{q.priority}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{new Date(q.raised_at).toLocaleDateString("en-IN")}</span>
                </div>
                <p className="text-xs text-foreground">{q.query_text}</p>
                {q.replied_text && (
                  <div className="mt-1.5 pl-2 border-l-2 border-primary/30">
                    <p className="text-[10px] text-muted-foreground">Reply · {q.replied_at ? new Date(q.replied_at).toLocaleDateString("en-IN") : "—"}</p>
                    <p className="text-xs">{q.replied_text}</p>
                  </div>
                )}

                {replyingId === q.id && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Reply</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 text-violet-700 border-violet-200 hover:bg-violet-50"
                        onClick={() => suggestAIReply(q)}
                        disabled={aiSuggesting === q.id}
                      >
                        {aiSuggesting === q.id ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        AI Suggest
                      </Button>
                    </div>
                    <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply or click AI Suggest..." rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-none" />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={() => submitReply(q)}>Submit Reply</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setReplyingId(null); setReplyText(""); }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>

              {q.status !== "closed" && q.status !== "replied" && (
                <div className="flex gap-1 shrink-0">
                  {replyingId !== q.id && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setReplyingId(q.id); setReplyText(""); }}>Reply</Button>
                  )}
                  {q.priority !== "urgent" && q.status !== "escalated" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-orange-600 border-orange-200" onClick={() => escalate(q)}>Escalate</Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => close(q)}>Close</Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TPAQueriesTab;
