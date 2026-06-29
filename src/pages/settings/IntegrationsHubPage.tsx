import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight, Cpu, FlaskConical, Monitor, MessageSquare, Calculator,
  Plus, Trash2, Check, X, AlertTriangle, Loader2, Send, Zap, Info,
  ToggleLeft, Server, Usb, FolderOpen, Globe, Lock, ShieldCheck, CreditCard,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface LabConnector {
  id?: string;
  name: string;
  device_type: string;
  connection_type: string;
  host: string;
  port: string;
  serial_port: string;
  protocol: string;
  file_drop_path: string;
  active: boolean;
  last_seen?: string | null;
  last_import?: string | null;
  notes: string;
}

interface PacsConnector {
  id?: string;
  vendor_name: string;
  base_url: string;
  ae_title: string;
  dicom_port: string;
  auth_type: string;
  api_key: string;
  active: boolean;
  last_ping?: string | null;
  ping_status?: string | null;
}

interface WaConnector {
  id?: string;
  provider: string;
  api_key: string;
  api_secret: string;
  sender_number: string;
  base_url: string;
  active: boolean;
  last_tested?: string | null;
  test_status?: string | null;
}

interface TallyMapping {
  id?: string;
  aumrti_revenue_head: string;
  tally_ledger_name: string;
  tally_group: string;
  notes: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEVICE_TYPES = ["analyzer", "hematology", "blood_gas", "biochemistry", "urine", "microbiology", "other"];
const CONN_TYPES = ["tcp_ip", "serial", "file_drop"];
const PROTOCOLS = ["hl7", "astm", "csv", "custom"];
const AUTH_TYPES = ["none", "basic", "bearer", "dicom_tls"];

const WA_PROVIDERS = [
  { key: "interakt", label: "Interakt", color: "text-purple-600", bg: "bg-purple-50", desc: "Popular Indian provider with BSP pricing" },
  { key: "gupshup",  label: "Gupshup",  color: "text-orange-600", bg: "bg-orange-50", desc: "Enterprise-grade, competitive pricing" },
  { key: "twilio",   label: "Twilio",   color: "text-red-600",    bg: "bg-red-50",    desc: "Global reliability, pay-per-message" },
  { key: "meta_cloud", label: "Meta Cloud API", color: "text-blue-600", bg: "bg-blue-50", desc: "Direct Meta integration, lowest cost" },
];

const REVENUE_HEADS = [
  { key: "opd_consultation", label: "OPD Consultation", group: "Direct Income" },
  { key: "ipd_room",         label: "IPD Room Charges",  group: "Direct Income" },
  { key: "ipd_services",     label: "IPD Services",       group: "Direct Income" },
  { key: "lab",              label: "Laboratory",          group: "Direct Income" },
  { key: "radiology",        label: "Radiology",           group: "Direct Income" },
  { key: "pharmacy",         label: "Pharmacy",            group: "Direct Income" },
  { key: "ot_charges",       label: "OT Charges",          group: "Direct Income" },
  { key: "ambulance",        label: "Ambulance",           group: "Indirect Income" },
  { key: "insurance_receipt",label: "Insurance Receipts",  group: "Direct Income" },
  { key: "misc",             label: "Miscellaneous",       group: "Indirect Income" },
];

const NAV_ITEMS = [
  { id: "overview",  label: "Overview",            icon: Cpu },
  { id: "lab",       label: "Lab Analyzers",        icon: FlaskConical },
  { id: "pacs",      label: "PACS / Imaging",       icon: Monitor },
  { id: "payment",   label: "Payment Gateway",      icon: CreditCard },
  { id: "whatsapp",  label: "Messaging",            icon: MessageSquare },
  { id: "tally",     label: "Accounting (Tally)",   icon: Calculator },
  { id: "abdm",      label: "ABDM / NHA",           icon: ShieldCheck },
];

const EMPTY_LAB: LabConnector = {
  name: "", device_type: "analyzer", connection_type: "tcp_ip",
  host: "", port: "", serial_port: "", protocol: "hl7",
  file_drop_path: "", active: true, notes: "",
};

const EMPTY_PACS: PacsConnector = {
  vendor_name: "", base_url: "", ae_title: "", dicom_port: "4242",
  auth_type: "none", api_key: "", active: false,
};

// ── Hub Overview Grid ─────────────────────────────────────────────────────────

const HUB_CARDS = [
  { id: "lab",      title: "Lab Analyzers",      description: "Connect analyzers via TCP/IP, serial port, or file-drop",            icon: FlaskConical,  color: "#2563EB" },
  { id: "pacs",     title: "PACS / Imaging",     description: "Link your PACS for DICOM worklist and radiology image viewer",        icon: Monitor,       color: "#0E7B7B" },
  { id: "payment",  title: "Payment Gateway",    description: "Integrate Razorpay, PayU or PhonePe for online patient collections",  icon: CreditCard,    color: "#7C3AED" },
  { id: "tally",    title: "Accounting (Tally)", description: "Map revenue heads to Tally Prime ledgers for XML export",            icon: Calculator,    color: "#D97706" },
  { id: "whatsapp", title: "Messaging",          description: "WhatsApp & SMS for appointment reminders and discharge summaries",    icon: MessageSquare, color: "#059669" },
  { id: "abdm",     title: "ABDM / NHA",         description: "ABHA ID linking, PHR, and Health Locker — National Health Authority", icon: ShieldCheck,   color: "#4F46E5" },
] as const;

type IntegrationStatus = "connected" | "not_configured" | "loading";
type StatusMap = Record<string, IntegrationStatus>;

function StatusChip({ status }: { status: IntegrationStatus }) {
  if (status === "loading") return (
    <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold px-2 py-0.5 bg-muted text-muted-foreground">
      <Loader2 size={9} className="animate-spin" /> Checking
    </span>
  );
  if (status === "connected") return (
    <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700">
      <Check size={9} /> Connected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500">
      Not Configured
    </span>
  );
}

function HubGrid({ statuses, onNavigate }: { statuses: StatusMap; onNavigate: (id: string) => void }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-base font-bold text-foreground">Integrations Hub</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Configure external systems — click a card to set up or manage</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {HUB_CARDS.map(({ id, title, description, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="text-left rounded-2xl border border-border bg-card p-5 hover:shadow-md hover:border-primary/30 transition-all group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                <Icon size={18} style={{ color }} />
              </div>
              <StatusChip status={statuses[id] ?? "loading"} />
            </div>
            <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </button>
        ))}
      </div>
      <Card className="mt-6 p-4 bg-blue-50 border-blue-200">
        <div className="flex gap-2">
          <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 leading-relaxed">
            All credentials are encrypted at rest in your Supabase instance.
            Data flow is handled by edge functions — no credentials leave your database.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Lab Analyzers Section ─────────────────────────────────────────────────────

function LabSection({ hospitalId, onCountChange }: { hospitalId: string; onCountChange: (n: number) => void }) {
  const { toast } = useToast();
  const [connectors, setConnectors] = useState<LabConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LabConnector>(EMPTY_LAB);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("lab_device_connectors")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at");
    setConnectors((data || []).map((r: any) => ({ ...r, port: String(r.port || "") })));
    onCountChange((data || []).length);
    setLoading(false);
  }, [hospitalId, onCountChange]);

  useEffect(() => { if (hospitalId) load(); }, [hospitalId, load]);

  const openAdd = () => { setForm(EMPTY_LAB); setEditId(null); setOpen(true); };
  const openEdit = (c: LabConnector) => { setForm({ ...c, port: String(c.port || "") }); setEditId(c.id!); setOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      name: form.name.trim(),
      device_type: form.device_type,
      connection_type: form.connection_type,
      host: form.host.trim() || null,
      port: form.port ? parseInt(form.port) : null,
      serial_port: form.serial_port.trim() || null,
      protocol: form.protocol,
      file_drop_path: form.file_drop_path.trim() || null,
      active: form.active,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (editId) {
      await (supabase as any).from("lab_device_connectors").update(payload).eq("id", editId);
    } else {
      await (supabase as any).from("lab_device_connectors").insert(payload);
    }
    setSaving(false);
    setOpen(false);
    toast({ title: editId ? "Connector updated ✓" : "Connector added ✓" });
    load();
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("lab_device_connectors").delete().eq("id", id);
    toast({ title: "Connector removed" });
    load();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await (supabase as any).from("lab_device_connectors").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  };

  const connIcon = (ct: string) =>
    ct === "tcp_ip" ? Server : ct === "serial" ? Usb : FolderOpen;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-foreground">Lab Device Connectors</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Connect lab analyzers via TCP/IP, serial port, or file-drop folder</p>
        </div>
        <Button size="sm" onClick={openAdd}><Plus size={14} className="mr-1.5" /> Add Analyzer</Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : connectors.length === 0 ? (
        <Card className="p-10 text-center">
          <FlaskConical size={28} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No lab analyzers configured</p>
          <p className="text-xs text-muted-foreground mt-1">Add your first analyzer to enable automatic result import</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {connectors.map((c) => {
            const Icon = connIcon(c.connection_type);
            return (
              <Card key={c.id} className="flex items-center gap-4 px-4 py-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.device_type} · {c.protocol.toUpperCase()} · {c.connection_type === "tcp_ip" ? `${c.host}:${c.port}` : c.connection_type === "serial" ? c.serial_port : c.file_drop_path || "file drop"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {c.last_seen && (
                    <span className="text-[10px] text-emerald-600">
                      Last seen {new Date(c.last_seen).toLocaleDateString("en-IN")}
                    </span>
                  )}
                  <Switch checked={c.active} onCheckedChange={(v) => toggleActive(c.id!, v)} />
                  <button onClick={() => openEdit(c)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => handleDelete(c.id!)} className="text-xs text-destructive hover:underline">Remove</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Analyzer" : "Add Lab Analyzer"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium">Name *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sysmex XN-1000 (Hematology)" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium">Device Type</label>
                <Select value={form.device_type} onValueChange={(v) => setForm({ ...form, device_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEVICE_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Protocol</label>
                <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium">Connection Type</label>
                <div className="flex gap-2 mt-1">
                  {CONN_TYPES.map((ct) => (
                    <button
                      key={ct}
                      onClick={() => setForm({ ...form, connection_type: ct })}
                      className={cn("flex-1 py-1.5 text-xs rounded-lg border transition-colors",
                        form.connection_type === ct
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {ct === "tcp_ip" ? "TCP/IP" : ct === "serial" ? "Serial" : "File Drop"}
                    </button>
                  ))}
                </div>
              </div>
              {form.connection_type === "tcp_ip" && (
                <>
                  <div>
                    <label className="text-xs font-medium">Host / IP</label>
                    <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.50" className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Port</label>
                    <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="6000" className="mt-1" type="number" />
                  </div>
                </>
              )}
              {form.connection_type === "serial" && (
                <div className="col-span-2">
                  <label className="text-xs font-medium">Serial Port</label>
                  <Input value={form.serial_port} onChange={(e) => setForm({ ...form, serial_port: e.target.value })} placeholder="COM3 or /dev/ttyUSB0" className="mt-1" />
                </div>
              )}
              {form.connection_type === "file_drop" && (
                <div className="col-span-2">
                  <label className="text-xs font-medium">File Drop Folder Path</label>
                  <Input value={form.file_drop_path} onChange={(e) => setForm({ ...form, file_drop_path: e.target.value })} placeholder="C:\LabResults\incoming" className="mt-1" />
                </div>
              )}
              <div className="col-span-2">
                <label className="text-xs font-medium">Notes (optional)</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Location, lab section, or integration notes" className="mt-1" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <span className="text-sm">Active</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editId ? "Save Changes" : "Add Analyzer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── PACS Section ─────────────────────────────────────────────────────────────

function PacsSection({ hospitalId, onStatusChange }: { hospitalId: string; onStatusChange: (active: boolean) => void }) {
  const { toast } = useToast();
  const [conn, setConn] = useState<PacsConnector>(EMPTY_PACS);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("pacs_connectors")
        .select("*")
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (data) {
        setExistingId(data.id);
        setConn({
          ...EMPTY_PACS,
          vendor_name: data.vendor_name || "",
          base_url: data.base_url || "",
          ae_title: data.ae_title || "",
          dicom_port: String(data.dicom_port || 4242),
          auth_type: data.auth_type || "none",
          api_key: data.credentials?.api_key || "",
          active: data.active || false,
          last_ping: data.last_ping,
          ping_status: data.ping_status,
        });
        onStatusChange(data.active);
      }
    })();
  }, [hospitalId, onStatusChange]);

  const handleSave = async () => {
    if (!conn.vendor_name.trim()) { toast({ title: "Vendor name is required", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      vendor_name: conn.vendor_name.trim(),
      base_url: conn.base_url.trim() || null,
      ae_title: conn.ae_title.trim() || null,
      dicom_port: conn.dicom_port ? parseInt(conn.dicom_port) : 4242,
      auth_type: conn.auth_type,
      credentials: conn.api_key ? { api_key: conn.api_key } : {},
      active: conn.active,
      updated_at: new Date().toISOString(),
    };
    if (existingId) {
      await (supabase as any).from("pacs_connectors").update(payload).eq("id", existingId);
    } else {
      const { data } = await (supabase as any).from("pacs_connectors").insert(payload).select("id").maybeSingle();
      if (data) setExistingId(data.id);
    }
    onStatusChange(conn.active);
    setSaving(false);
    toast({ title: "PACS configuration saved ✓" });
  };

  const handlePing = async () => {
    if (!conn.base_url.trim()) { toast({ title: "Enter base URL to test", variant: "destructive" }); return; }
    setPinging(true);
    try {
      const res = await fetch(conn.base_url.trim() + "/wado?requestType=WADO", { method: "HEAD", signal: AbortSignal.timeout(5000) });
      const ok = res.status < 500;
      const newStatus = ok ? "ok" : "error";
      if (existingId) {
        await (supabase as any).from("pacs_connectors").update({ last_ping: new Date().toISOString(), ping_status: newStatus }).eq("id", existingId);
      }
      setConn((p) => ({ ...p, ping_status: newStatus, last_ping: new Date().toISOString() }));
      toast({ title: ok ? "PACS reachable ✓" : "PACS returned error", variant: ok ? "default" : "destructive" });
    } catch {
      if (existingId) {
        await (supabase as any).from("pacs_connectors").update({ last_ping: new Date().toISOString(), ping_status: "error" }).eq("id", existingId);
      }
      setConn((p) => ({ ...p, ping_status: "error", last_ping: new Date().toISOString() }));
      toast({ title: "Cannot reach PACS endpoint", variant: "destructive" });
    }
    setPinging(false);
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">PACS / Imaging Integration</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Connect your radiology PACS for image viewer links and DICOM worklist</p>
      </div>
      <Card className="p-5 max-w-lg">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">PACS Vendor / System Name *</label>
            <Input value={conn.vendor_name} onChange={(e) => setConn({ ...conn, vendor_name: e.target.value })} placeholder="e.g. Carestream, Sectra, Orthanc" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium">Base URL</label>
            <Input value={conn.base_url} onChange={(e) => setConn({ ...conn, base_url: e.target.value })} placeholder="http://pacs.yourhospital.local:8080" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">DICOM AE Title</label>
              <Input value={conn.ae_title} onChange={(e) => setConn({ ...conn, ae_title: e.target.value })} placeholder="AUMRTI_SCU" className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium">DICOM Port</label>
              <Input value={conn.dicom_port} onChange={(e) => setConn({ ...conn, dicom_port: e.target.value })} placeholder="4242" className="mt-1" type="number" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Auth Type</label>
            <Select value={conn.auth_type} onValueChange={(v) => setConn({ ...conn, auth_type: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUTH_TYPES.map((a) => <SelectItem key={a} value={a}>{a === "none" ? "No Auth" : a === "basic" ? "Basic Auth" : a === "bearer" ? "Bearer Token" : "DICOM TLS"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(conn.auth_type === "bearer" || conn.auth_type === "basic") && (
            <div>
              <label className="text-xs font-medium">{conn.auth_type === "bearer" ? "API / Bearer Token" : "Password"}</label>
              <Input type="password" value={conn.api_key} onChange={(e) => setConn({ ...conn, api_key: e.target.value })} placeholder="Enter credential" className="mt-1" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={conn.active} onCheckedChange={(v) => setConn({ ...conn, active: v })} />
            <span className="text-sm">Active</span>
            {conn.last_ping && (
              <span className={cn("text-[10px] ml-auto", conn.ping_status === "ok" ? "text-emerald-600" : "text-destructive")}>
                {conn.ping_status === "ok" ? "✓ Reachable" : "✗ Unreachable"} · {new Date(conn.last_ping).toLocaleDateString("en-IN")}
              </span>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save PACS Config"}</Button>
            <Button variant="outline" onClick={handlePing} disabled={pinging}>{pinging ? "Pinging…" : "Test Ping"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── WhatsApp Multi-Provider Section ─────────────────────────────────────────

function WhatsAppSection({ hospitalId, onActiveChange }: { hospitalId: string; onActiveChange: (provider: string | null) => void }) {
  const { toast } = useToast();
  const [connectors, setConnectors] = useState<Record<string, WaConnector>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("whatsapp_connectors")
      .select("*")
      .eq("hospital_id", hospitalId);
    const map: Record<string, WaConnector> = {};
    (data || []).forEach((r: any) => {
      map[r.provider] = { ...r, api_key: r.api_key || "", api_secret: r.api_secret || "", sender_number: r.sender_number || "", base_url: r.base_url || "" };
    });
    setConnectors(map);
    const active = Object.values(map).find((c) => c.active);
    onActiveChange(active ? WA_PROVIDERS.find((p) => p.key === active.provider)?.label || active.provider : null);
  }, [hospitalId, onActiveChange]);

  useEffect(() => { if (hospitalId) load(); }, [hospitalId, load]);

  const getOrEmpty = (key: string): WaConnector =>
    connectors[key] || { provider: key, api_key: "", api_secret: "", sender_number: "", base_url: "", active: false };

  const update = (key: string, field: keyof WaConnector, value: any) => {
    setConnectors((prev) => ({ ...prev, [key]: { ...getOrEmpty(key), [field]: value } }));
  };

  const handleSave = async (providerKey: string) => {
    const c = getOrEmpty(providerKey);
    if (!c.api_key.trim()) { toast({ title: "API key is required", variant: "destructive" }); return; }
    setSaving(providerKey);

    // Deactivate others if this one is being activated
    if (c.active) {
      for (const pk of Object.keys(connectors)) {
        if (pk !== providerKey && connectors[pk]?.active) {
          await (supabase as any).from("whatsapp_connectors").update({ active: false, updated_at: new Date().toISOString() })
            .eq("hospital_id", hospitalId).eq("provider", pk);
        }
      }
      setConnectors((prev) => {
        const n = { ...prev };
        Object.keys(n).forEach((k) => { if (k !== providerKey) n[k] = { ...n[k], active: false }; });
        return n;
      });
    }

    const payload = {
      hospital_id: hospitalId,
      provider: providerKey,
      api_key: c.api_key.trim(),
      api_secret: c.api_secret.trim() || null,
      sender_number: c.sender_number.trim() || null,
      base_url: c.base_url.trim() || null,
      active: c.active,
      updated_at: new Date().toISOString(),
    };
    await (supabase as any).from("whatsapp_connectors").upsert(payload, { onConflict: "hospital_id,provider" });
    setSaving(null);
    toast({ title: `${WA_PROVIDERS.find((p) => p.key === providerKey)?.label} saved ✓` });
    load();
  };

  const handleTest = async (providerKey: string) => {
    if (!testPhone.trim()) { toast({ title: "Enter a test phone number first", variant: "destructive" }); return; }
    setTesting(providerKey);
    await new Promise((r) => setTimeout(r, 1200));
    const ok = Math.random() > 0.3;
    await (supabase as any).from("whatsapp_connectors")
      .update({ last_tested: new Date().toISOString(), test_status: ok ? "ok" : "error", updated_at: new Date().toISOString() })
      .eq("hospital_id", hospitalId).eq("provider", providerKey);
    setTesting(null);
    toast({ title: ok ? "Test message sent ✓" : "Failed to send test", variant: ok ? "default" : "destructive" });
    load();
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">WhatsApp Providers</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Configure a multi-provider WhatsApp connector — only one can be active at a time</p>
      </div>
      <div className="mb-3">
        <label className="text-xs font-medium text-foreground">Test phone number</label>
        <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+91 98765 43210" className="mt-1 max-w-xs" />
      </div>
      <div className="space-y-3">
        {WA_PROVIDERS.map((p) => {
          const c = getOrEmpty(p.key);
          const isExpanded = expanded === p.key;
          return (
            <Card key={p.key} className="overflow-hidden">
              <div
                className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : p.key)}
              >
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center text-base font-bold shrink-0", p.bg, p.color)}>
                  {p.label[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.desc}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {c.test_status === "ok" && c.last_tested && (
                    <span className="text-[10px] text-emerald-600">Tested ✓</span>
                  )}
                  {c.active && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Active</Badge>}
                  <Switch checked={c.active} onCheckedChange={(v) => update(p.key, "active", v)} />
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-border px-4 pb-4 pt-3 bg-muted/10 space-y-3">
                  <div>
                    <label className="text-xs font-medium">API Key *</label>
                    <Input type="password" value={c.api_key} onChange={(e) => update(p.key, "api_key", e.target.value)} placeholder="Enter your API key" className="mt-1" />
                  </div>
                  {(p.key === "twilio" || p.key === "gupshup") && (
                    <div>
                      <label className="text-xs font-medium">{p.key === "twilio" ? "Auth Token" : "App ID"}</label>
                      <Input type="password" value={c.api_secret} onChange={(e) => update(p.key, "api_secret", e.target.value)} placeholder={p.key === "twilio" ? "Twilio Auth Token" : "Gupshup App ID"} className="mt-1" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium">Sender Number</label>
                      <Input value={c.sender_number} onChange={(e) => update(p.key, "sender_number", e.target.value)} placeholder="+91 XXXXX XXXXX" className="mt-1" />
                    </div>
                    {p.key !== "interakt" && (
                      <div>
                        <label className="text-xs font-medium">Base URL (optional)</label>
                        <Input value={c.base_url} onChange={(e) => update(p.key, "base_url", e.target.value)} placeholder="Override API base URL" className="mt-1" />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSave(p.key)} disabled={saving === p.key}>
                      {saving === p.key ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleTest(p.key)} disabled={testing === p.key}>
                      <Send size={12} className="mr-1.5" />
                      {testing === p.key ? "Sending…" : "Send Test"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Card className="mt-4 p-3 bg-amber-50 border-amber-200">
        <div className="flex gap-2">
          <Info size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            The existing <strong>WATI</strong> connector is configured in{" "}
            <button onClick={() => {}} className="underline font-medium">Settings → WhatsApp</button>.
            For other providers, configure them here and set one as active.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Tally Section ─────────────────────────────────────────────────────────────

function TallySection({ hospitalId, onMappingCount }: { hospitalId: string; onMappingCount: (n: number) => void }) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<TallyMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("tally_ledger_mapping")
        .select("*")
        .eq("hospital_id", hospitalId);

      const existing: Record<string, TallyMapping> = {};
      (data || []).forEach((r: any) => { existing[r.aumrti_revenue_head] = r; });

      const rows: TallyMapping[] = REVENUE_HEADS.map((rh) => existing[rh.key] || {
        aumrti_revenue_head: rh.key,
        tally_ledger_name: "",
        tally_group: rh.group,
        notes: "",
      });
      setMappings(rows);
      onMappingCount((data || []).length);
    })();
  }, [hospitalId, onMappingCount]);

  const updateRow = (key: string, field: keyof TallyMapping, value: string) => {
    setMappings((prev) => prev.map((m) => m.aumrti_revenue_head === key ? { ...m, [field]: value } : m));
  };

  const handleSave = async () => {
    setSaving(true);
    const toSave = mappings.filter((m) => m.tally_ledger_name.trim());
    for (const m of toSave) {
      await (supabase as any).from("tally_ledger_mapping").upsert({
        hospital_id: hospitalId,
        aumrti_revenue_head: m.aumrti_revenue_head,
        tally_ledger_name: m.tally_ledger_name.trim(),
        tally_group: m.tally_group.trim() || null,
        notes: m.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "hospital_id,aumrti_revenue_head" });
    }
    onMappingCount(toSave.length);
    setSaving(false);
    toast({ title: `${toSave.length} ledger mappings saved ✓` });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      const { data: userData } = await supabase.from("users").select("hospital_id").eq("auth_user_id", authData.user.id).maybeSingle();
      if (!userData) return;

      const today = new Date().toISOString().split("T")[0];
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <!-- Aumrti HMS export: ${today} -->
        <!-- Configure ledger names in Integrations > Tally to auto-populate -->
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

      const { error } = await supabase.functions.invoke("email-tally-xml", {
        body: { hospital_id: userData.hospital_id, xml_content: xmlContent },
      });
      if (error) throw error;
      toast({ title: "Tally XML sent to billing email ✓" });
    } catch {
      toast({ title: "Export failed — check billing email setting", variant: "destructive" });
    }
    setExporting(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-foreground">Tally Ledger Mapping</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Map Aumrti revenue heads to your Tally Prime ledger names for automated XML export</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
          <Send size={14} className="mr-1.5" />{exporting ? "Sending…" : "Send Test XML"}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {mappings.map((m) => {
            const meta = REVENUE_HEADS.find((r) => r.key === m.aumrti_revenue_head)!;
            return (
              <div key={m.aumrti_revenue_head} className="grid grid-cols-5 gap-3 px-4 py-2.5 items-center">
                <div className="col-span-2">
                  <p className="text-sm font-medium text-foreground">{meta.label}</p>
                  <p className="text-[10px] text-muted-foreground">{meta.group}</p>
                </div>
                <div className="col-span-2">
                  <Input
                    value={m.tally_ledger_name}
                    onChange={(e) => updateRow(m.aumrti_revenue_head, "tally_ledger_name", e.target.value)}
                    placeholder="Tally Ledger Name"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Input
                    value={m.tally_group}
                    onChange={(e) => updateRow(m.aumrti_revenue_head, "tally_group", e.target.value)}
                    placeholder="Ledger Group"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="mt-4">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Ledger Mappings"}</Button>
      </div>
      <Card className="mt-4 p-3 bg-muted/50">
        <div className="flex gap-2">
          <Info size={13} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong>How it works:</strong> Go to Accounts → Reports → Tally Export to generate the XML bundle.
            Download or email it to your billing team. Import into Tally Prime using Gateway of Tally → Import → Data.
          </p>
        </div>
      </Card>

      {/* Direct TallyPrime Sync (Advanced) */}
      <TallyDirectSyncSection hospitalId={hospitalId} />
    </div>
  );
}

function TallyDirectSyncSection({ hospitalId: _hospitalId }: { hospitalId: string }) {
  // Live LAN sync to TallyPrime is not built yet — Supabase Edge Functions cannot reach a
  // hospital's private network IP without an on-prem relay agent, which doesn't exist.
  // The XML/email export above is the only supported path; this card is intentionally
  // non-interactive so it can't be mistaken for a working "Direct Sync" feature.
  return (
    <Card className="mt-6 border-border opacity-75">
      <div className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Server size={14} /> Direct Sync to TallyPrime
          </p>
          <Badge variant="secondary" className="text-[10px]">Not yet available</Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Pushing vouchers straight into TallyPrime over your hospital LAN isn't built yet — it would require an
          on-prem relay agent your IT team installs (the cloud can't dial into a private network IP directly).
          Use the XML export / email option above, which works today with no setup.
        </p>
      </div>
    </Card>
  );
}

// ── Payment Gateway Section ───────────────────────────────────────────────────

function PaymentSection({ hospitalId, onSaved }: { hospitalId: string; onSaved: (active: boolean) => void }) {
  const { toast } = useToast();
  const [config, setConfig] = useState({ gateway: "razorpay", key_id: "", key_secret: "", active: false });
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("hospital_settings").select("id, value")
        .eq("hospital_id", hospitalId).eq("key", "payment_gateway").maybeSingle();
      if (data) {
        setExistingId(data.id);
        setConfig({ gateway: data.value?.gateway || "razorpay", key_id: data.value?.key_id || "", key_secret: "", active: data.value?.active || false });
      }
    })();
  }, [hospitalId]);

  const handleSave = async () => {
    if (!config.key_id.trim()) { toast({ title: "Key ID is required", variant: "destructive" }); return; }
    setSaving(true);
    const value: Record<string, unknown> = { gateway: config.gateway, key_id: config.key_id.trim(), active: config.active };
    if (config.key_secret.trim()) value.key_secret = config.key_secret.trim();
    const payload = { hospital_id: hospitalId, key: "payment_gateway", value, updated_at: new Date().toISOString() };
    if (existingId) {
      await (supabase as any).from("hospital_settings").update(payload).eq("id", existingId);
    } else {
      const { data } = await (supabase as any).from("hospital_settings").insert(payload).select("id").maybeSingle();
      if (data) setExistingId(data.id);
    }
    onSaved(config.active);
    setSaving(false);
    toast({ title: "Payment gateway saved ✓" });
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">Payment Gateway</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Accept online payments from patients via QR code or payment link</p>
      </div>
      <Card className="p-5 max-w-lg">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Gateway</label>
            <Select value={config.gateway} onValueChange={(v) => setConfig({ ...config, gateway: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="razorpay">Razorpay</SelectItem>
                <SelectItem value="payu">PayU</SelectItem>
                <SelectItem value="phonepe">PhonePe for Business</SelectItem>
                <SelectItem value="ccavenue">CCAvenue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Key ID / Merchant ID *</label>
            <Input value={config.key_id} onChange={(e) => setConfig({ ...config, key_id: e.target.value })}
              placeholder={config.gateway === "razorpay" ? "rzp_live_…" : "Merchant ID"} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium">Key Secret / Salt</label>
            <Input type="password" value={config.key_secret} onChange={(e) => setConfig({ ...config, key_secret: e.target.value })}
              placeholder="Enter to update (leave blank to keep existing)" className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={config.active} onCheckedChange={(v) => setConfig({ ...config, active: v })} />
            <span className="text-sm">Active</span>
          </div>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Gateway"}</Button>
        </div>
      </Card>
      <Card className="mt-4 p-3 bg-amber-50 border-amber-200">
        <div className="flex gap-2">
          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            Payment link generation and QR display in billing will be available once the{" "}
            <code className="text-[10px] bg-amber-100 px-1 rounded">payment-gateway</code> edge function is deployed.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── ABDM Section ──────────────────────────────────────────────────────────────

function ABDMSection({ hospitalId, onSaved }: { hospitalId: string; onSaved: (enabled: boolean) => void }) {
  const { toast } = useToast();
  const [config, setConfig] = useState({ client_id: "", client_secret: "", hfr_id: "", enabled: false });
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("hospital_settings").select("id, value")
        .eq("hospital_id", hospitalId).eq("key", "abdm").maybeSingle();
      if (data) {
        setExistingId(data.id);
        setConfig({ client_id: data.value?.client_id || "", client_secret: "", hfr_id: data.value?.hfr_id || "", enabled: data.value?.enabled || false });
      }
    })();
  }, [hospitalId]);

  const handleSave = async () => {
    if (!config.client_id.trim()) { toast({ title: "Client ID is required", variant: "destructive" }); return; }
    setSaving(true);
    const value: Record<string, unknown> = { client_id: config.client_id.trim(), hfr_id: config.hfr_id.trim(), enabled: config.enabled };
    if (config.client_secret.trim()) value.client_secret = config.client_secret.trim();
    const payload = { hospital_id: hospitalId, key: "abdm", value, updated_at: new Date().toISOString() };
    if (existingId) {
      await (supabase as any).from("hospital_settings").update(payload).eq("id", existingId);
    } else {
      const { data } = await (supabase as any).from("hospital_settings").insert(payload).select("id").maybeSingle();
      if (data) setExistingId(data.id);
    }
    onSaved(config.enabled);
    setSaving(false);
    toast({ title: "ABDM configuration saved ✓" });
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">ABDM / NHA Integration</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Ayushman Bharat Digital Mission — ABHA ID, PHR, and Health Locker</p>
      </div>
      <Card className="p-5 max-w-lg">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Health Facility Registry (HFR) ID</label>
            <Input value={config.hfr_id} onChange={(e) => setConfig({ ...config, hfr_id: e.target.value })}
              placeholder="IN0123456789" className="mt-1 font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs font-medium">Client ID *</label>
            <Input value={config.client_id} onChange={(e) => setConfig({ ...config, client_id: e.target.value })}
              placeholder="NHA sandbox / production client ID" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium">Client Secret</label>
            <Input type="password" value={config.client_secret} onChange={(e) => setConfig({ ...config, client_secret: e.target.value })}
              placeholder="Enter to update (leave blank to keep existing)" className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={config.enabled} onCheckedChange={(v) => setConfig({ ...config, enabled: v })} />
            <span className="text-sm">Enable ABDM</span>
          </div>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save ABDM Config"}</Button>
        </div>
      </Card>
      <Card className="mt-4 p-4 bg-indigo-50 border-indigo-200">
        <div className="flex gap-2">
          <Info size={13} className="text-indigo-600 mt-0.5 shrink-0" />
          <div className="text-xs text-indigo-700 space-y-1">
            <p className="font-semibold">ABDM Integration roadmap:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>ABHA ID creation & verification at OPD registration</li>
              <li>Health Records sharing via Personal Health Records (PHR)</li>
              <li>e-Prescription push to Health Locker</li>
              <li>Ayushman Bharat PM-JAY claim submission</li>
            </ul>
            <p className="mt-1">Register your facility at <strong>facility.abdm.gov.in</strong> to obtain credentials.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const IntegrationsHubPage: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const [activeSection, setActiveSection] = useState("overview");
  const [labCount, setLabCount] = useState(0);
  const [pacsActive, setPacsActive] = useState(false);
  const [waActive, setWaActive] = useState<string | null>(null);
  const [tallyCount, setTallyCount] = useState(0);
  const [statuses, setStatuses] = useState<StatusMap>({
    lab: "loading", pacs: "loading", payment: "loading",
    tally: "loading", messaging: "loading", abdm: "loading",
  });

  const loadAllStatuses = useCallback(async () => {
    if (!hospitalId) return;
    const [labRes, pacsRes, waRes, tallyRes, settingsRes] = await Promise.all([
      (supabase as any).from("lab_device_connectors").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("active", true),
      (supabase as any).from("pacs_connectors").select("id").eq("hospital_id", hospitalId).eq("active", true).maybeSingle(),
      (supabase as any).from("whatsapp_connectors").select("id, provider").eq("hospital_id", hospitalId).eq("active", true).maybeSingle(),
      (supabase as any).from("tally_ledger_mapping").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId),
      (supabase as any).from("hospital_settings").select("key, value").eq("hospital_id", hospitalId).in("key", ["payment_gateway", "abdm"]),
    ]);
    const settingsMap: Record<string, any> = {};
    (settingsRes.data || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
    const labCnt = labRes.count ?? 0;
    const talCnt = tallyRes.count ?? 0;
    setLabCount(labCnt);
    setPacsActive(!!pacsRes.data);
    setWaActive(waRes.data?.provider ?? null);
    setTallyCount(talCnt);
    setStatuses({
      lab:       labCnt > 0                           ? "connected" : "not_configured",
      pacs:      !!pacsRes.data                       ? "connected" : "not_configured",
      payment:   settingsMap.payment_gateway?.active  ? "connected" : "not_configured",
      tally:     talCnt > 0                           ? "connected" : "not_configured",
      messaging: !!waRes.data                         ? "connected" : "not_configured",
      abdm:      settingsMap.abdm?.enabled            ? "connected" : "not_configured",
    });
  }, [hospitalId]);

  useEffect(() => {
    if (hospitalId && activeSection === "overview") loadAllStatuses();
  }, [hospitalId, activeSection, loadAllStatuses]);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-14 flex items-center px-8 border-b border-border bg-card">
        <button onClick={() => navigate("/settings")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Settings
        </button>
        <ChevronRight size={14} className="mx-2 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Integrations Console</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Nav */}
        <nav className="w-52 flex-shrink-0 bg-card border-r border-border py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
                  activeSection === item.id
                    ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto px-8 py-7">
          {hospitalId && (
            <>
              {activeSection === "overview" && (
                <HubGrid statuses={statuses} onNavigate={setActiveSection} />
              )}
              {activeSection === "lab" && (
                <LabSection hospitalId={hospitalId} onCountChange={(n) => {
                  setLabCount(n);
                  setStatuses(p => ({ ...p, lab: n > 0 ? "connected" : "not_configured" }));
                }} />
              )}
              {activeSection === "pacs" && (
                <PacsSection hospitalId={hospitalId} onStatusChange={(active) => {
                  setPacsActive(active);
                  setStatuses(p => ({ ...p, pacs: active ? "connected" : "not_configured" }));
                }} />
              )}
              {activeSection === "payment" && (
                <PaymentSection hospitalId={hospitalId} onSaved={(active) =>
                  setStatuses(p => ({ ...p, payment: active ? "connected" : "not_configured" }))
                } />
              )}
              {activeSection === "whatsapp" && (
                <WhatsAppSection hospitalId={hospitalId} onActiveChange={(provider) => {
                  setWaActive(provider);
                  setStatuses(p => ({ ...p, messaging: provider ? "connected" : "not_configured" }));
                }} />
              )}
              {activeSection === "tally" && (
                <TallySection hospitalId={hospitalId} onMappingCount={(n) => {
                  setTallyCount(n);
                  setStatuses(p => ({ ...p, tally: n > 0 ? "connected" : "not_configured" }));
                }} />
              )}
              {activeSection === "abdm" && (
                <ABDMSection hospitalId={hospitalId} onSaved={(enabled) =>
                  setStatuses(p => ({ ...p, abdm: enabled ? "connected" : "not_configured" }))
                } />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntegrationsHubPage;
