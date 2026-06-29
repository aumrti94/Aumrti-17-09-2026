import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, MessageSquare, Bell, Star, AlertTriangle, Send as SendIcon,
  Search, Check, Archive, Paperclip, Filter, ChevronDown, Inbox as InboxIcon,
  User, Phone, ExternalLink, PenSquare, X
} from "lucide-react";
import EmptyState from "@/components/EmptyState";

// ── Types ──

interface InboxMsg {
  id: string;
  hospital_id: string;
  patient_id: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  message_body: string;
  sender_name: string | null;
  sender_phone: string | null;
  is_read: boolean;
  is_starred: boolean;
  assigned_to: string | null;
  priority: string;
  tags: string[];
  parent_id: string | null;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

type Section = "all" | "whatsapp" | "in_app" | "feedback" | "grievance" | "sent" | "starred" | "resolved";

const CHANNEL_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  whatsapp: { label: "WhatsApp", color: "bg-emerald-100 text-emerald-700", icon: MessageSquare },
  in_app: { label: "In-App", color: "bg-blue-100 text-blue-700", icon: Bell },
  feedback: { label: "Feedback", color: "bg-amber-100 text-amber-700", icon: Star },
  grievance: { label: "Grievance", color: "bg-red-100 text-red-700", icon: AlertTriangle },
  portal: { label: "Portal", color: "bg-purple-100 text-purple-700", icon: User },
};

const QUICK_REPLIES = [
  "We'll get back to you shortly",
  "Please visit our billing counter",
  "Your lab report is ready",
  "Appointment confirmed",
];

const SECTIONS: { key: Section; label: string; icon: React.ElementType; channelFilter?: string }[] = [
  { key: "all", label: "All Inbox", icon: InboxIcon },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, channelFilter: "whatsapp" },
  { key: "in_app", label: "In-App", icon: Bell, channelFilter: "in_app" },
  { key: "feedback", label: "Feedback", icon: Star, channelFilter: "feedback" },
  { key: "grievance", label: "Grievances", icon: AlertTriangle, channelFilter: "grievance" },
  { key: "sent", label: "Sent", icon: SendIcon },
  { key: "starred", label: "Starred", icon: Star },
  { key: "resolved", label: "Resolved", icon: Check },
];

const InboxPage: React.FC = () => {
  const { toast } = useToast();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMsg[]>([]);
  const [activeSection, setActiveSection] = useState<Section>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxMsg[]>([]);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState("whatsapp");
  const [sending, setSending] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composePhone, setComposePhone] = useState("");
  const [composeMsg, setComposeMsg] = useState("");
  const [composeName, setComposeName] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── Load data
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: ud } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (!ud) return;
      setHospitalId(ud.hospital_id);

      const { data } = await supabase
        .from("inbox_messages")
        .select("*")
        .eq("hospital_id", ud.hospital_id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (data) setMessages(data as any);
    })();
  }, []);

  // ── Realtime subscription
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inbox_messages", filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          setMessages((prev) => [payload.new as InboxMsg, ...prev]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId]);

  // ── Load thread when message selected
  useEffect(() => {
    if (!selectedId || !hospitalId) { setThread([]); return; }
    const sel = messages.find((m) => m.id === selectedId);
    if (!sel) return;

    const rootId = sel.parent_id || sel.id;
    (async () => {
      const { data } = await supabase
        .from("inbox_messages")
        .select("*")
        .eq("hospital_id", hospitalId)
        .or(`id.eq.${rootId},parent_id.eq.${rootId}`)
        .order("created_at", { ascending: true });
      if (data) setThread(data as any);

      // Mark as read
      if (!sel.is_read) {
        await supabase.from("inbox_messages").update({ is_read: true } as any).eq("id", sel.id);
        setMessages((prev) => prev.map((m) => m.id === sel.id ? { ...m, is_read: true } : m));
      }
    })();
  }, [selectedId, hospitalId]);

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread]);

  // ── Filtered list
  const filteredMessages = messages.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (!m.message_body.toLowerCase().includes(q) && !m.sender_name?.toLowerCase().includes(q) && !m.subject?.toLowerCase().includes(q)) return false;
    }
    switch (activeSection) {
      case "whatsapp": return m.channel === "whatsapp" && m.direction === "inbound";
      case "in_app": return m.channel === "in_app" && m.direction === "inbound";
      case "feedback": return m.channel === "feedback";
      case "grievance": return m.channel === "grievance";
      case "sent": return m.direction === "outbound";
      case "starred": return m.is_starred;
      case "resolved": return m.status === "resolved" || m.status === "closed";
      default: return m.direction === "inbound" && m.status !== "resolved" && m.status !== "closed";
    }
  });

  // ── Counts
  const counts: Record<Section, number> = {
    all: messages.filter((m) => m.direction === "inbound" && !m.is_read && m.status !== "resolved").length,
    whatsapp: messages.filter((m) => m.channel === "whatsapp" && !m.is_read && m.direction === "inbound").length,
    in_app: messages.filter((m) => m.channel === "in_app" && !m.is_read && m.direction === "inbound").length,
    feedback: messages.filter((m) => m.channel === "feedback" && !m.is_read).length,
    grievance: messages.filter((m) => m.channel === "grievance" && m.status === "open").length,
    sent: messages.filter((m) => m.direction === "outbound").length,
    starred: messages.filter((m) => m.is_starred).length,
    resolved: messages.filter((m) => m.status === "resolved" || m.status === "closed").length,
  };

  const selectedMsg = messages.find((m) => m.id === selectedId);

  // ── Actions
  const handleResolve = async () => {
    if (!selectedMsg || !hospitalId) return;
    await supabase.from("inbox_messages").update({ status: "resolved", resolved_at: new Date().toISOString() } as any).eq("id", selectedMsg.id);
    setMessages((prev) => prev.map((m) => m.id === selectedMsg.id ? { ...m, status: "resolved" } : m));
    toast({ title: "Marked as resolved ✓" });
  };

  const handleStar = async () => {
    if (!selectedMsg) return;
    const newVal = !selectedMsg.is_starred;
    await supabase.from("inbox_messages").update({ is_starred: newVal } as any).eq("id", selectedMsg.id);
    setMessages((prev) => prev.map((m) => m.id === selectedMsg.id ? { ...m, is_starred: newVal } : m));
  };

  const handlePriorityChange = async (val: string) => {
    if (!selectedMsg) return;
    await supabase.from("inbox_messages").update({ priority: val } as any).eq("id", selectedMsg.id);
    setMessages((prev) => prev.map((m) => m.id === selectedMsg.id ? { ...m, priority: val } : m));
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedMsg || !hospitalId) return;
    setSending(true);

    const rootId = selectedMsg.parent_id || selectedMsg.id;
    const { data: inserted } = await supabase.from("inbox_messages").insert({
      hospital_id: hospitalId,
      patient_id: selectedMsg.patient_id,
      channel: replyChannel,
      direction: "outbound",
      message_body: replyText,
      sender_name: "Staff",
      sender_phone: selectedMsg.sender_phone,
      parent_id: rootId,
      status: "open",
    } as any).select().maybeSingle();

    if (inserted) {
      setThread((prev) => [...prev, inserted as any]);
      setMessages((prev) => [inserted as any, ...prev]);
    }

    // Send via WhatsApp if channel is whatsapp
    if (replyChannel === "whatsapp" && selectedMsg.sender_phone) {
      await sendWhatsApp({ hospitalId, phone: selectedMsg.sender_phone, message: replyText });
    }

    setReplyText("");
    setSending(false);
    toast({ title: "Reply sent ✓" });
  };

  const handleCompose = async () => {
    if (!composeMsg.trim() || !composePhone.trim() || !hospitalId) return;
    setSending(true);

    await supabase.from("inbox_messages").insert({
      hospital_id: hospitalId,
      channel: "whatsapp",
      direction: "outbound",
      message_body: composeMsg,
      sender_name: composeName || "Staff",
      sender_phone: composePhone,
      status: "open",
    } as any);

    await sendWhatsApp({ hospitalId, phone: composePhone, message: composeMsg });

    setShowCompose(false);
    setComposeMsg("");
    setComposePhone("");
    setComposeName("");
    setSending(false);
    toast({ title: "Message sent ✓" });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (diff < 604800000) return d.toLocaleDateString("en-IN", { weekday: "short" });
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden bg-background">
      {/* ══ COLUMN 1: Navigation ══ */}
      <div className="w-[240px] shrink-0 border-r border-border bg-card flex flex-col">
        {/* Compose button */}
        <div className="p-3">
          <Button className="w-full" onClick={() => setShowCompose(true)}>
            <PenSquare size={14} className="mr-2" /> New Message
          </Button>
        </div>

        {/* Sections */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const count = counts[sec.key];
            const isActive = activeSection === sec.key;
            return (
              <button
                key={sec.key}
                onClick={() => { setActiveSection(sec.key); setSelectedId(null); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold border-l-[3px] border-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className="flex-1 text-left">{sec.label}</span>
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[20px] text-center",
                    sec.key === "grievance" && count > 0
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Tags section */}
          <div className="pt-4 px-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {["Urgent", "Billing", "Appointment", "Report", "Other"].map((tag) => (
                <button
                  key={tag}
                  className="px-2 py-0.5 text-[10px] rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </nav>
      </div>

      {/* ══ COLUMN 2: Message List ══ */}
      <div className="w-[360px] shrink-0 border-r border-border bg-muted/30 flex flex-col">
        {/* Toolbar */}
        <div className="h-12 flex items-center gap-2 px-3 border-b border-border bg-card shrink-0">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="pl-8 h-8 text-xs bg-muted/50"
            />
          </div>
          <Button size="sm" variant="ghost" className="h-8 px-2">
            <Filter size={14} />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {filteredMessages.length === 0 ? (
            <EmptyState
              icon="📬"
              title="Inbox is empty"
              description="Patient messages, feedback, and grievances appear here"
            />
          ) : (
            filteredMessages.map((msg) => {
              const ch = CHANNEL_CONFIG[msg.channel];
              const isSelected = selectedId === msg.id;
              return (
                <button
                  key={msg.id}
                  onClick={() => setSelectedId(msg.id)}
                  className={cn(
                    "w-full text-left px-3.5 py-3 border-b border-border transition-colors",
                    isSelected ? "bg-primary/5" : "hover:bg-card",
                    !msg.is_read && "bg-card"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* Unread dot */}
                    <div className="mt-1.5 w-2 shrink-0">
                      {!msg.is_read && <div className="w-[6px] h-[6px] rounded-full bg-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Row 1 */}
                      <div className="flex items-center justify-between">
                        <span className={cn("text-[13px] truncate", !msg.is_read ? "font-bold text-foreground" : "text-foreground")}>
                          {msg.sender_name || "Unknown"}
                        </span>
                        <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{formatTime(msg.created_at)}</span>
                      </div>
                      {/* Row 2 */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {ch && (
                          <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", ch.color)}>
                            {ch.label}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {msg.subject || msg.message_body.slice(0, 60)}
                        </span>
                      </div>
                      {/* Row 3 */}
                      {msg.priority === "urgent" && (
                        <span className="text-[10px] text-destructive font-medium mt-0.5 inline-block">🔴 Urgent</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ══ COLUMN 3: Conversation View ══ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-card">
        {!selectedMsg ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <InboxIcon size={48} className="text-muted-foreground/30 mb-3" />
            <p className="text-base text-muted-foreground">Select a message to read</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="h-[60px] shrink-0 border-b border-border px-5 flex items-center justify-between bg-card">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-foreground">{selectedMsg.sender_name || "Unknown"}</span>
                  {CHANNEL_CONFIG[selectedMsg.channel] && (
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", CHANNEL_CONFIG[selectedMsg.channel].color)}>
                      {CHANNEL_CONFIG[selectedMsg.channel].label}
                    </span>
                  )}
                </div>
                {selectedMsg.sender_phone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone size={10} /> {selectedMsg.sender_phone}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedMsg.priority} onValueChange={handlePriorityChange}>
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                {selectedMsg.status !== "resolved" && (
                  <Button size="sm" variant="outline" onClick={handleResolve} className="h-8 text-xs">
                    <Check size={14} className="mr-1" /> Resolve
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={handleStar} className="h-8 px-2">
                  <Star size={14} className={selectedMsg.is_starred ? "fill-amber-400 text-amber-400" : ""} />
                </Button>
              </div>
            </div>

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {thread.map((m) => {
                const isOutbound = m.direction === "outbound";
                return (
                  <div key={m.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[70%]")}>
                      {!isOutbound && (
                        <p className="text-[11px] text-muted-foreground mb-1 ml-1">{m.sender_name || "Patient"}</p>
                      )}
                      <div className={cn(
                        "px-3.5 py-2.5 text-sm leading-relaxed",
                        isOutbound
                          ? "bg-primary text-primary-foreground rounded-xl rounded-br-sm"
                          : "bg-muted rounded-xl rounded-bl-sm text-foreground"
                      )}>
                        <p className="whitespace-pre-wrap">{m.message_body}</p>
                      </div>
                      <p className={cn("text-[10px] text-muted-foreground mt-1", isOutbound ? "text-right mr-1" : "ml-1")}>
                        {formatTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            {/* Reply area */}
            {selectedMsg.status !== "resolved" && selectedMsg.status !== "closed" && (
              <div className="shrink-0 border-t border-border bg-muted/30 p-3 space-y-2">
                {/* Quick replies */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {QUICK_REPLIES.map((qr) => (
                    <button
                      key={qr}
                      onClick={() => setReplyText(qr)}
                      className="shrink-0 px-2.5 py-1 text-[11px] rounded-full border border-border text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
                    >
                      {qr}
                    </button>
                  ))}
                </div>

                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type reply..."
                  rows={2}
                  className="text-sm resize-none"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                />

                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    {["whatsapp", "in_app"].map((ch) => (
                      <button
                        key={ch}
                        onClick={() => setReplyChannel(ch)}
                        className={cn(
                          "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                          replyChannel === ch
                            ? "bg-primary/10 border-primary text-primary font-medium"
                            : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {ch === "whatsapp" ? "💬 WhatsApp" : "📱 In-App"}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" onClick={handleReply} disabled={!replyText.trim() || sending}>
                    <SendIcon size={14} className="mr-1.5" />
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ Compose Modal ══ */}
      {showCompose && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowCompose(false)}>
          <div className="bg-card rounded-xl shadow-xl w-[440px] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">New WhatsApp Message</h3>
              <button onClick={() => setShowCompose(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground">Recipient Name</label>
                <Input value={composeName} onChange={(e) => setComposeName(e.target.value)} placeholder="Patient name" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Phone Number</label>
                <Input value={composePhone} onChange={(e) => setComposePhone(e.target.value)} placeholder="+91 9876543210" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Message</label>
                <Textarea value={composeMsg} onChange={(e) => setComposeMsg(e.target.value)} placeholder="Type your message..." rows={4} className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCompose(false)}>Cancel</Button>
              <Button onClick={handleCompose} disabled={sending || !composeMsg.trim() || !composePhone.trim()}>
                <SendIcon size={14} className="mr-1.5" /> {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InboxPage;
