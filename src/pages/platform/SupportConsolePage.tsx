import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Send, Loader2, X, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAdminAction } from "@/lib/adminAudit";
import { cn } from "@/lib/utils";

interface Ticket {
  id: string; hospital_id: string; parent_id: string | null;
  subject: string | null; message_body: string; direction: "inbound" | "outbound";
  category: string; priority: string; status: "open" | "in_progress" | "resolved" | "closed";
  created_at: string; hospitals: { name: string } | null;
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-600",
  in_progress: "bg-amber-500/15 text-amber-600",
  resolved: "bg-emerald-500/15 text-emerald-600",
  closed: "bg-muted text-muted-foreground",
};

async function fetchTickets(): Promise<Ticket[]> {
  const { data } = await (supabase as any)
    .from("platform_support_tickets")
    .select("*, hospitals(name)")
    .is("parent_id", null)
    .order("created_at", { ascending: false });
  return data || [];
}

export default function SupportConsolePage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [thread, setThread] = useState<Ticket[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({ queryKey: ["platform-support-tickets"], queryFn: fetchTickets, staleTime: 20_000 });

  const openTicket = async (t: Ticket) => {
    setSelected(t);
    const { data } = await (supabase as any)
      .from("platform_support_tickets")
      .select("*")
      .or(`id.eq.${t.id},parent_id.eq.${t.id}`)
      .order("created_at", { ascending: true });
    setThread(data || []);
  };

  const reply = async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    const rootId = selected.parent_id || selected.id;
    const { data: inserted } = await (supabase as any)
      .from("platform_support_tickets")
      .insert({
        hospital_id: selected.hospital_id,
        parent_id: rootId,
        message_body: replyText,
        direction: "outbound",
        category: selected.category,
        status: "in_progress",
      })
      .select()
      .maybeSingle();
    if (inserted) {
      setThread((prev) => [...prev, inserted]);
      await (supabase as any).from("platform_support_tickets").update({ status: "in_progress" }).eq("id", rootId);
    }
    setReplyText("");
    setSending(false);
    qc.invalidateQueries({ queryKey: ["platform-support-tickets"] });
  };

  const setStatus = async (status: Ticket["status"]) => {
    if (!selected) return;
    const rootId = selected.parent_id || selected.id;
    await (supabase as any).from("platform_support_tickets").update({ status }).eq("id", rootId);
    logAdminAction("support_ticket_status_changed", { hospitalId: selected.hospital_id, details: { ticket_id: rootId, status } });
    toast.success(`Ticket marked ${status.replace("_", " ")}`);
    setSelected((prev) => (prev ? { ...prev, status } : prev));
    qc.invalidateQueries({ queryKey: ["platform-support-tickets"] });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Support Console</h1>
          <p className="text-[11px] text-muted-foreground">Fleet-wide ticket queue — raised from Settings → Support on the tenant side.</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
              {["Hospital", "Subject", "Category", "Priority", "Status", "Raised"].map((h) => (
                <th key={h} className="px-5 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">No tickets raised yet</td></tr>
            ) : tickets.map((t) => (
              <tr key={t.id} className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => openTicket(t)}>
                <td className="px-5 py-3 text-xs font-medium text-foreground">{t.hospitals?.name || t.hospital_id}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{t.subject || t.message_body.slice(0, 50)}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground capitalize">{t.category.replace("_", " ")}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground capitalize">{t.priority}</td>
                <td className="px-5 py-3"><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", STATUS_STYLE[t.status])}>{t.status.replace("_", " ")}</span></td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(t.created_at), "dd MMM, HH:mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div>
                <p className="text-sm font-semibold text-foreground">{selected.subject || "Support Ticket"}</p>
                <p className="text-[11px] text-muted-foreground">{selected.hospitals?.name}</p>
              </div>
              <button onClick={() => setSelected(null)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-3">
              {thread.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.direction === "inbound" ? "bg-muted text-foreground" : "bg-primary/10 text-foreground"}`}>
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                      <MessageSquare size={10} /> {m.direction === "inbound" ? selected.hospitals?.name : "Aumrti Support"} · {format(new Date(m.created_at), "dd MMM, HH:mm")}
                    </p>
                    {m.message_body}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-4 shrink-0 space-y-2">
              <div className="flex gap-2">
                {(["in_progress", "resolved", "closed"] as const).map((s) => (
                  <button key={s} onClick={() => setStatus(s)}
                    className={cn("text-[10px] font-medium px-2 py-1 rounded-full border", selected.status === s ? STATUS_STYLE[s] : "border-border text-muted-foreground hover:text-foreground")}>
                    Mark {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              {selected.status !== "closed" && (
                <div className="flex gap-2">
                  <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply to hospital…" onKeyDown={(e) => e.key === "Enter" && reply()}
                    className="flex-1 h-9 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
                  <button onClick={reply} disabled={!replyText.trim() || sending}
                    className="px-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
