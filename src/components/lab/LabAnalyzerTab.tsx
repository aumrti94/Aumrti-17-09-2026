import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Cpu, Plus, RefreshCw, CheckCircle2, AlertCircle, Clock,
  ChevronDown, ChevronRight, Eye, Check, X, Loader2, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Device {
  id: string;
  device_name: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  protocol: string;
  host: string | null;
  port: number | null;
  is_bidirectional: boolean;
  auto_validate: boolean;
  last_connected_at: string | null;
  last_result_at: string | null;
  result_count: number;
  is_active: boolean;
}

interface Message {
  id: string;
  device_id: string | null;
  protocol: string;
  message_type: string | null;
  patient_id_external: string | null;
  accession_number: string | null;
  order_item_id: string | null;
  status: string;
  match_confidence: string | null;
  error_reason: string | null;
  received_at: string;
  raw_message: string;
  // joined
  lab_order_items?: {
    test_name?: string;
    result_value?: string;
  } | null;
}

interface PendingResult {
  message: Message;
  parsedResults: ParsedObservation[];
}

interface ParsedObservation {
  code: string;
  name: string;
  value: string;
  unit: string;
  refRange: string;
  flag: string;
}

function parseResultsFromRaw(raw: string, protocol: string): ParsedObservation[] {
  const results: ParsedObservation[] = [];

  if (protocol.startsWith("hl7")) {
    const lines = raw.replace(/\r/g, "\n").split("\n");
    for (const line of lines) {
      if (!line.startsWith("OBX")) continue;
      const f = line.split("|");
      const codeParts = (f[3] || "").split("^");
      results.push({
        code:     codeParts[0] || "",
        name:     codeParts[1] || codeParts[0] || "",
        value:    f[5] || "",
        unit:     (f[6] || "").split("^")[0] || "",
        refRange: f[7] || "",
        flag:     f[8] || "N",
      });
    }
  } else if (protocol.startsWith("astm")) {
    const lines = raw.replace(/\r/g, "\n").split("\n");
    for (const line of lines) {
      if (!line.startsWith("\x02R") && !line.startsWith("R")) continue;
      const f = line.replace(/^\x02/, "").split("|");
      if (f[0]?.charAt(1) !== "R") continue;
      const codeParts = (f[2] || "").split("^");
      results.push({
        code:     codeParts[3] || codeParts[0] || "",
        name:     codeParts[4] || codeParts[0] || "",
        value:    f[3] || "",
        unit:     f[4] || "",
        refRange: f[5] || "",
        flag:     f[6] || "N",
      });
    }
  }

  return results;
}

const PROTOCOL_LABELS: Record<string, string> = {
  hl7_mllp:    "HL7 MLLP",
  astm_e1381:  "ASTM E1381",
  astm_e1394:  "ASTM E1394",
  tcp_raw:     "TCP Raw",
  serial_rs232:"RS-232",
};

const FLAG_COLORS: Record<string, string> = {
  H:  "text-orange-600 font-bold",
  HH: "text-red-700 font-bold",
  L:  "text-blue-600 font-bold",
  LL: "text-blue-800 font-bold",
  A:  "text-red-600 font-bold",
  AA: "text-red-700 font-bold animate-pulse",
  N:  "text-emerald-700",
};

const EMPTY_DEVICE: Partial<Device> = {
  device_name: "", manufacturer: "", model: "",
  protocol: "hl7_mllp", host: "", port: 2575,
  is_bidirectional: true, auto_validate: false, is_active: true,
};

const LabAnalyzerTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [devices, setDevices] = useState<Device[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [parsedResults, setParsedResults] = useState<ParsedObservation[]>([]);
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [postingId, setPostingId] = useState<string | null>(null);

  // Add / edit device dialog
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Partial<Device>>(EMPTY_DEVICE);
  const [savingDevice, setSavingDevice] = useState(false);

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [devRes, msgRes] = await Promise.all([
      (supabase as any)
        .from("lab_device_connectors")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("device_name"),
      (supabase as any)
        .from("lab_analyzer_messages")
        .select("*")
        .eq("hospital_id", hospitalId)
        .in("status", ["pending", "matched"])
        .order("received_at", { ascending: false })
        .limit(100),
    ]);
    if (devRes.data) setDevices(devRes.data as Device[]);
    if (msgRes.data) setMessages(msgRes.data as Message[]);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Real-time subscription for new analyzer messages ──
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("lab-analyzer-messages")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "lab_analyzer_messages", filter: `hospital_id=eq.${hospitalId}` },
        (payload: any) => {
          const msg = payload.new as Message;
          if (["pending", "matched"].includes(msg.status)) {
            setMessages(prev => [msg, ...prev]);
            toast({
              title: `Analyzer result received`,
              description: `Accession: ${msg.accession_number || "unknown"} · ${msg.protocol}`,
            });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, toast]);

  // ── Post result manually ──────────────────────────────
  const postResult = async (msg: Message, obs: ParsedObservation, reviewedValue: string) => {
    if (!msg.order_item_id) {
      toast({ title: "No matched order item. Link manually first.", variant: "destructive" });
      return;
    }
    setPostingId(msg.id);

    const flagMap: Record<string, string> = {
      H: "high", HH: "high", L: "low", LL: "low", A: "critical", AA: "critical", N: "normal",
    };

    await (supabase as any).from("lab_order_items").update({
      result_value:    reviewedValue,
      result_unit:     obs.unit,
      reference_range: obs.refRange || null,
      result_flag:     flagMap[obs.flag.toUpperCase()] || "normal",
      status:          "resulted",
      resulted_at:     new Date().toISOString(),
    }).eq("id", msg.order_item_id);

    await (supabase as any).from("lab_analyzer_messages").update({
      status:       "posted",
      processed_at: new Date().toISOString(),
    }).eq("id", msg.id);

    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setSelectedMessage(null);
    setPostingId(null);
    toast({ title: "Result posted ✓" });
  };

  // ── Ignore message ────────────────────────────────────
  const ignoreMessage = async (msgId: string) => {
    await (supabase as any).from("lab_analyzer_messages").update({ status: "ignored" }).eq("id", msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    if (selectedMessage?.id === msgId) setSelectedMessage(null);
    toast({ title: "Message ignored" });
  };

  // ── Save device ───────────────────────────────────────
  const saveDevice = async () => {
    if (!hospitalId || !editingDevice.protocol) return;
    setSavingDevice(true);
    const payload = {
      hospital_id:      hospitalId,
      device_name:      editingDevice.device_name || null,
      manufacturer:     editingDevice.manufacturer || null,
      model:            editingDevice.model || null,
      serial_number:    editingDevice.serial_number || null,
      protocol:         editingDevice.protocol,
      host:             editingDevice.host || null,
      port:             editingDevice.port || null,
      is_bidirectional: editingDevice.is_bidirectional ?? true,
      auto_validate:    editingDevice.auto_validate ?? false,
      is_active:        editingDevice.is_active ?? true,
      updated_at:       new Date().toISOString(),
    };

    if ((editingDevice as Device).id) {
      await (supabase as any).from("lab_device_connectors").update(payload).eq("id", (editingDevice as Device).id);
    } else {
      await (supabase as any).from("lab_device_connectors").insert(payload);
    }
    setSavingDevice(false);
    setShowDeviceDialog(false);
    setEditingDevice(EMPTY_DEVICE);
    fetchData();
    toast({ title: "Analyzer saved ✓" });
  };

  const openMessage = (msg: Message) => {
    setSelectedMessage(msg);
    setParsedResults(parseResultsFromRaw(msg.raw_message, msg.protocol));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* ── Pending results banner ─── */}
      {messages.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <p className="text-[13px] font-medium text-amber-800">
            {messages.length} analyzer result{messages.length > 1 ? "s" : ""} awaiting review
          </p>
          <RefreshCw
            size={13}
            className="ml-auto text-amber-600 cursor-pointer hover:text-amber-800"
            onClick={fetchData}
          />
        </div>
      )}

      {/* ── Main layout: message queue + detail ─── */}
      <div className="flex gap-4 min-h-[400px]">
        {/* Left: pending messages */}
        <div className="w-[320px] shrink-0 border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
            <span className="text-[12px] font-bold text-foreground flex items-center gap-1.5">
              <Cpu size={13} /> Result Inbox
            </span>
            <Badge variant="outline" className="text-[10px]">{messages.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {messages.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-[12px] text-muted-foreground">All results reviewed</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  New results appear here in real-time when analyzers push data.
                </p>
              </div>
            ) : (
              messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => openMessage(msg)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors",
                    selectedMessage?.id === msg.id && "bg-blue-50 border-l-2 border-l-blue-500"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-semibold text-foreground truncate">
                      {msg.accession_number || "Unknown accession"}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] shrink-0",
                        msg.match_confidence === "high"
                          ? "border-emerald-400 text-emerald-700"
                          : msg.match_confidence === "medium"
                          ? "border-amber-400 text-amber-700"
                          : "border-red-300 text-red-600"
                      )}
                    >
                      {msg.match_confidence ?? "unmatched"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {PROTOCOL_LABELS[msg.protocol] || msg.protocol}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {formatDistanceToNow(new Date(msg.received_at), { addSuffix: true })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: message detail + post */}
        <div className="flex-1 border border-border rounded-lg overflow-hidden flex flex-col">
          {selectedMessage ? (
            <>
              <div className="shrink-0 px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-3">
                <Eye size={14} className="text-muted-foreground" />
                <span className="text-[13px] font-bold">
                  {selectedMessage.accession_number || "No accession"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {PROTOCOL_LABELS[selectedMessage.protocol] || selectedMessage.protocol}
                </span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-red-500 hover:bg-red-50"
                  onClick={() => ignoreMessage(selectedMessage.id)}
                >
                  <X size={12} /> Ignore
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Result rows */}
                {parsedResults.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                      Parsed Results ({parsedResults.length})
                    </p>
                    <div className="border border-border rounded overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead className="bg-muted/60">
                          <tr>
                            <th className="px-3 py-1.5 text-left font-medium">Test</th>
                            <th className="px-3 py-1.5 text-left font-medium">Value</th>
                            <th className="px-3 py-1.5 text-left font-medium">Unit</th>
                            <th className="px-3 py-1.5 text-left font-medium">Ref Range</th>
                            <th className="px-3 py-1.5 text-left font-medium">Flag</th>
                            <th className="px-3 py-1.5 text-left font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {parsedResults.map((obs, idx) => (
                            <ResultRow
                              key={idx}
                              obs={obs}
                              message={selectedMessage}
                              onPost={postResult}
                              posting={postingId === selectedMessage.id}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded p-3">
                    <p className="text-[12px] text-amber-700">
                      Could not parse result observations from this message.
                      Review the raw message below and post manually.
                    </p>
                  </div>
                )}

                {/* Match info */}
                <div className="bg-muted/40 rounded p-3 space-y-1 text-[11px]">
                  <p><span className="text-muted-foreground">Accession:</span> {selectedMessage.accession_number || "—"}</p>
                  <p><span className="text-muted-foreground">Patient ID (ext.):</span> {selectedMessage.patient_id_external || "—"}</p>
                  <p><span className="text-muted-foreground">Match:</span> {selectedMessage.match_confidence || "unmatched"}</p>
                  <p><span className="text-muted-foreground">Order item:</span> {selectedMessage.order_item_id ? "✓ Linked" : "Not linked"}</p>
                </div>

                {/* Raw message */}
                <div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Raw Message</p>
                  <pre className="text-[10px] font-mono bg-slate-900 text-slate-300 p-3 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {selectedMessage.raw_message}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Cpu size={36} className="text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[13px] text-muted-foreground">Select a message to review</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Analyzer Device List ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
          <span className="text-[13px] font-bold flex items-center gap-2">
            <Cpu size={14} /> Connected Analyzers
          </span>
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1"
            onClick={() => { setEditingDevice(EMPTY_DEVICE); setShowDeviceDialog(true); }}
          >
            <Plus size={12} /> Add Analyzer
          </Button>
        </div>

        {devices.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-muted-foreground">No analyzers configured.</p>
            <p className="text-[12px] text-muted-foreground/70 mt-1">
              Add your lab analyzers to receive results automatically via HL7 or ASTM.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {devices.map(dev => (
              <div key={dev.id} className="px-4 py-3 flex items-center gap-4">
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  dev.is_active ? "bg-emerald-500" : "bg-slate-300"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">
                    {dev.device_name || "Unnamed device"}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                    {dev.manufacturer && <span>{dev.manufacturer}</span>}
                    {dev.model && <span>{dev.model}</span>}
                    <Badge variant="outline" className="text-[9px]">
                      {PROTOCOL_LABELS[dev.protocol] || dev.protocol}
                    </Badge>
                    {dev.host && <span className="font-mono">{dev.host}:{dev.port}</span>}
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground shrink-0">
                  {dev.last_result_at ? (
                    <p>{formatDistanceToNow(new Date(dev.last_result_at), { addSuffix: true })}</p>
                  ) : (
                    <p className="text-muted-foreground/50">No results yet</p>
                  )}
                  <p>{dev.result_count} results total</p>
                </div>
                {dev.auto_validate && (
                  <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700 shrink-0">
                    Auto-post
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] gap-1 shrink-0"
                  onClick={() => { setEditingDevice({ ...dev }); setShowDeviceDialog(true); }}
                >
                  <Settings2 size={12} /> Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Integration Guide ─── */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-[12px] text-blue-800">
        <p className="font-bold mb-1 flex items-center gap-1.5">
          <Clock size={13} /> How analyzer integration works
        </p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Add your analyzer above with its IP address and protocol (HL7 MLLP is most common).</li>
          <li>
            Deploy the MLLP relay agent on your hospital LAN server — it listens on port 2575
            and forwards messages to this HMS via the <code className="bg-blue-100 px-1 rounded">lab-analyzer-ingest</code> edge function.
          </li>
          <li>Results appear in the inbox above in real-time and are matched to open orders by accession number.</li>
          <li>Lab technician reviews and clicks "Post" to write the result into the patient's record.</li>
          <li>Enable "Auto-post" only for analyzers with reliable accession number encoding.</li>
        </ol>
      </div>

      {/* Add/Edit Device Dialog */}
      <Dialog open={showDeviceDialog} onOpenChange={setShowDeviceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(editingDevice as Device).id ? "Edit Analyzer" : "Add Analyzer"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Device Name *</Label>
                <Input
                  value={editingDevice.device_name || ""}
                  onChange={e => setEditingDevice(d => ({ ...d, device_name: e.target.value }))}
                  placeholder="e.g. Mindray BS-380 Chemistry"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Manufacturer</Label>
                <Input
                  value={editingDevice.manufacturer || ""}
                  onChange={e => setEditingDevice(d => ({ ...d, manufacturer: e.target.value }))}
                  placeholder="Mindray, ROCHE, Abbott"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Model</Label>
                <Input
                  value={editingDevice.model || ""}
                  onChange={e => setEditingDevice(d => ({ ...d, model: e.target.value }))}
                  placeholder="BS-380"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Protocol *</Label>
                <select
                  value={editingDevice.protocol || "hl7_mllp"}
                  onChange={e => setEditingDevice(d => ({ ...d, protocol: e.target.value }))}
                  className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                >
                  <option value="hl7_mllp">HL7 MLLP (most common)</option>
                  <option value="astm_e1394">ASTM E1394</option>
                  <option value="astm_e1381">ASTM E1381</option>
                  <option value="tcp_raw">TCP Raw</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">IP Address / Host</Label>
                <Input
                  value={editingDevice.host || ""}
                  onChange={e => setEditingDevice(d => ({ ...d, host: e.target.value }))}
                  placeholder="192.168.1.50"
                  className="mt-1 h-8 text-sm font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Port</Label>
                <Input
                  type="number"
                  value={editingDevice.port ?? 2575}
                  onChange={e => setEditingDevice(d => ({ ...d, port: Number(e.target.value) }))}
                  className="mt-1 h-8 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={editingDevice.auto_validate ?? false}
                onCheckedChange={v => setEditingDevice(d => ({ ...d, auto_validate: v }))}
              />
              <div>
                <p className="text-[12px] font-medium">Auto-post results</p>
                <p className="text-[11px] text-muted-foreground">
                  Skip manual review. Only enable for trusted analyzers with reliable accession encoding.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowDeviceDialog(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={saveDevice}
              disabled={savingDevice || !editingDevice.device_name || !editingDevice.protocol}
            >
              {savingDevice ? <><Loader2 size={12} className="animate-spin" /> Saving...</> : "Save Analyzer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── Result row with editable value ────────────────────────────────────────────
interface ResultRowProps {
  obs: ParsedObservation;
  message: Message;
  onPost: (msg: Message, obs: ParsedObservation, value: string) => void;
  posting: boolean;
}

const ResultRow: React.FC<ResultRowProps> = ({ obs, message, onPost, posting }) => {
  const [editValue, setEditValue] = useState(obs.value);
  const flagClass = FLAG_COLORS[obs.flag.toUpperCase()] || FLAG_COLORS["N"];
  const hasOrderLink = !!message.order_item_id;

  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium">{obs.name || obs.code}</p>
        <p className="text-[10px] text-muted-foreground font-mono">{obs.code}</p>
      </td>
      <td className="px-3 py-2">
        <Input
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          className="h-7 text-[12px] w-24"
        />
      </td>
      <td className="px-3 py-2 text-muted-foreground">{obs.unit}</td>
      <td className="px-3 py-2 text-muted-foreground">{obs.refRange}</td>
      <td className={cn("px-3 py-2", flagClass)}>{obs.flag}</td>
      <td className="px-3 py-2">
        <Button
          size="sm"
          className="h-6 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700"
          onClick={() => onPost(message, obs, editValue)}
          disabled={posting || !hasOrderLink}
          title={!hasOrderLink ? "No order linked. Search and link the order first." : ""}
        >
          {posting ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
          Post
        </Button>
      </td>
    </tr>
  );
};

export default LabAnalyzerTab;
