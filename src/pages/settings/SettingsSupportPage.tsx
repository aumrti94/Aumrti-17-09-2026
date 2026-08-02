import React, { useEffect, useState, useCallback } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Send, Loader2, MessageSquare, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatDateTimeIST } from "@/lib/dateUtils";

interface Ticket {
  id: string;
  parent_id: string | null;
  subject: string | null;
  message_body: string;
  direction: "inbound" | "outbound";
  category: string;
  priority: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-600",
  in_progress: "bg-amber-500/15 text-amber-600",
  resolved: "bg-emerald-500/15 text-emerald-600",
  closed: "bg-muted text-muted-foreground",
};

const SettingsSupportPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [thread, setThread] = useState<Ticket[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newBody, setNewBody] = useState("");

  const loadTickets = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("platform_support_tickets")
      .select("*")
      .eq("hospital_id", hospitalId)
      .is("parent_id", null)
      .order("created_at", { ascending: false });
    setTickets(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const openTicket = async (t: Ticket) => {
    setSelected(t);
    const { data } = await (supabase as any)
      .from("platform_support_tickets")
      .select("*")
      .or(`id.eq.${t.id},parent_id.eq.${t.id}`)
      .order("created_at", { ascending: true });
    setThread(data || []);
  };

  const createTicket = async () => {
    if (!hospitalId || !newBody.trim()) return;
    setSending(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("platform_support_tickets").insert({
      hospital_id: hospitalId,
      subject: newSubject.trim() || null,
      message_body: newBody,
      category: newCategory,
      direction: "inbound",
      created_by: user?.id,
    });
    setSending(false);
    if (error) {
      toast({ title: "Failed to submit ticket", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Support ticket submitted" });
    setShowNew(false);
    setNewSubject(""); setNewBody(""); setNewCategory("other");
    loadTickets();
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selected || !hospitalId) return;
    setSending(true);
    const rootId = selected.parent_id || selected.id;
    const { data: inserted } = await (supabase as any)
      .from("platform_support_tickets")
      .insert({
        hospital_id: hospitalId,
        parent_id: rootId,
        message_body: replyText,
        direction: "inbound",
        category: selected.category,
      })
      .select()
      .maybeSingle();
    if (inserted) setThread((prev) => [...prev, inserted]);
    setReplyText("");
    setSending(false);
    toast({ title: "Reply sent" });
  };

  return (
    <SettingsPageWrapper title="Support" hideSave>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <p className="text-sm text-muted-foreground max-w-xl">
            Raise a support ticket and Aumrti's team will respond here. For anything urgent, you can still{" "}
            <a href="mailto:support@aumrti.in" className="text-primary underline">email support directly</a>.
          </p>
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New Ticket</Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Subject</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Raised</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No support tickets yet</td></tr>
              ) : tickets.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => openTicket(t)}>
                  <td className="px-4 py-2.5 text-foreground">{t.subject || t.message_body.slice(0, 60)}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline" className="capitalize text-xs">{t.category.replace("_", " ")}</Badge></td>
                  <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status]}`}>{t.status.replace("_", " ")}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTimeIST(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New ticket modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl w-[420px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">New Support Ticket</p>
              <button onClick={() => setShowNew(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Subject</label>
                <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="billing">Billing</option>
                  <option value="technical">Technical</option>
                  <option value="clinical_workflow">Clinical Workflow</option>
                  <option value="training">Training</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Describe the issue</label>
                <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)}
                  className="w-full mt-1 h-24 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5">
              <Button className="w-full" onClick={createTicket} disabled={!newBody.trim() || sending}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Send className="h-3.5 w-3.5 mr-2" />}
                Submit Ticket
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Thread drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <p className="text-sm font-semibold text-foreground">{selected.subject || "Support Ticket"}</p>
              <button onClick={() => setSelected(null)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-3">
              {thread.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.direction === "outbound" ? "bg-muted text-foreground" : "bg-primary/10 text-foreground"}`}>
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                      <MessageSquare size={10} /> {m.direction === "outbound" ? "Aumrti Support" : "You"} · {formatDateTimeIST(m.created_at)}
                    </p>
                    {m.message_body}
                  </div>
                </div>
              ))}
            </div>
            {selected.status !== "closed" && (
              <div className="border-t border-border p-4 shrink-0 flex gap-2">
                <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply…" onKeyDown={(e) => e.key === "Enter" && handleReply()}
                  className="flex-1 h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                <Button size="sm" onClick={handleReply} disabled={!replyText.trim() || sending}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </SettingsPageWrapper>
  );
};

export default SettingsSupportPage;
