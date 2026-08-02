import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Plus, Settings2, Lock, ChevronDown, ChevronUp, Trash2, Pencil,
  Clock, Zap, Bot, Cpu, AlertCircle, Save, Package, Eye, EyeOff,
  Upload, Wifi, WifiOff, ExternalLink, CheckCircle2, MailOpen,
} from "lucide-react";
import { formatINR } from "@/lib/currency";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackageRate {
  id: string;
  procedure_name: string;
  package_code: string;
  approved_rate: number;
  effective_date: string;
  includes: string;
}

interface TPA {
  id: string;
  tpa_name: string;
  tpa_code: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  claims_email: string | null;
  contact_email: string | null;
  credit_days: number;
  submission_method: string;
  required_documents: string[];
  is_active: boolean;
  // Coverage rules
  room_rent_ceiling: number;
  co_payment_type: string;
  co_payment_value: number;
  deductible: number;
  // SLA
  pre_auth_sla_minutes: number;
  discharge_sla_minutes: number;
  turnaround_days: number;
  sla_alert_channel: string;
  whatsapp_alert_number: string | null;
  // API / HCX integration
  api_endpoint: string | null;
  api_key_encrypted: string | null;
  tpa_hcx_code: string | null;
  // Email submission
  email_subject_template: string | null;
  cc_emails: string[] | null;
  // Package rates
  package_rates: PackageRate[];
}

interface InsuranceSettings {
  id?: string;
  plan_tier: "manual" | "ai_assisted" | "automated";
  auto_submit_pre_auth: boolean;
  auto_submit_claims: boolean;
  sla_alert_channel: "in_app" | "whatsapp" | "email" | "sms";
  whatsapp_alert_number: string | null;
  denial_threshold_score: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_DOCS = [
  "Admission letter", "Investigation reports", "Pre-auth form",
  "Policy card copy", "Discharge summary", "Claim form",
  "Aadhar copy", "Referral letter", "PMJAY card", "CGHS card", "ECHS card",
];

const DEFAULT_SETTINGS: InsuranceSettings = {
  plan_tier: "manual",
  auto_submit_pre_auth: false,
  auto_submit_claims: false,
  sla_alert_channel: "in_app",
  whatsapp_alert_number: null,
  denial_threshold_score: 40,
};

const DEFAULT_EMAIL_TEMPLATE = "Claim Submission — {claim_number} — {patient_name}";

function normaliseMethod(v: string): string {
  if (v === "portal") return "manual";
  if (v === "hcx")    return "hcx_api";
  return v || "manual";
}

// Migrate old PackageRate shape ({package_name, procedure, rate, includes}) to new
function normaliseRates(raw: any[]): PackageRate[] {
  return (raw || []).map(r => ({
    id:             r.id ?? crypto.randomUUID(),
    procedure_name: r.procedure_name ?? r.package_name ?? "",
    package_code:   r.package_code   ?? r.tpa_code     ?? "",
    approved_rate:  r.approved_rate  ?? r.rate          ?? 0,
    effective_date: r.effective_date ?? "",
    includes:       r.includes       ?? "",
  }));
}

// ── Plan tier helpers ─────────────────────────────────────────────────────────

const PLAN_META = {
  manual:      { label: "Manual",       full: "Plan A — Manual",       color: "bg-slate-100 text-slate-700",     dot: "bg-slate-400",     price: "₹5,000/mo" },
  ai_assisted: { label: "AI Assisted",  full: "Plan B — AI Assisted",  color: "bg-blue-100 text-blue-700",       dot: "bg-blue-500",      price: "₹12,000/mo" },
  automated:   { label: "Automated",    full: "Plan C — Automated",    color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500",   price: "₹25,000/mo" },
};


interface LockedBannerProps { requiredPlan: "ai_assisted" | "automated"; }
const LockedBanner: React.FC<LockedBannerProps> = ({ requiredPlan }) => (
  <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    <Lock size={13} className="shrink-0" />
    <span>
      Upgrade to <strong>{PLAN_META[requiredPlan].full}</strong> ({PLAN_META[requiredPlan].price}) to unlock this feature.
    </span>
  </div>
);

// ── Coverage summary ──────────────────────────────────────────────────────────

function coverageRuleSummary(tpa: TPA): string {
  const parts: string[] = [];
  if ((tpa.room_rent_ceiling ?? 0) > 0) {
    parts.push(`${formatINR(tpa.room_rent_ceiling)}/day`);
  } else {
    parts.push("No room cap");
  }
  const cpt = tpa.co_payment_type ?? "none";
  if (cpt === "percentage" && (tpa.co_payment_value ?? 0) > 0) {
    parts.push(`Co-pay: ${tpa.co_payment_value}%`);
  } else if (cpt === "fixed" && (tpa.co_payment_value ?? 0) > 0) {
    parts.push(`Co-pay: ${formatINR(tpa.co_payment_value)}`);
  } else {
    parts.push("No co-pay");
  }
  return parts.join(" · ");
}

// ── Main component ────────────────────────────────────────────────────────────

const TPAConfiguration: React.FC = () => {
  const [tpas, setTpas]             = useState<TPA[]>([]);
  const [loading, setLoading]       = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<TPA | null>(null);
  const [form, setForm]             = useState<any>({});

  // Hospital-level plan settings
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [settings, setSettings]           = useState<InsuranceSettings>(DEFAULT_SETTINGS);
  const [settingsId, setSettingsId]       = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Submission method UI state
  const [showApiKey, setShowApiKey]         = useState(false);
  const [testingHcx, setTestingHcx]         = useState(false);
  const [hcxTestResult, setHcxTestResult]   = useState<"ok" | "fail" | null>(null);

  // Package rate master
  const [pkgForm, setPkgForm]       = useState({ procedure_name: "", package_code: "", approved_rate: "", effective_date: "", includes: "" });
  const [editingPkgId, setEditingPkgId] = useState<string | null>(null);
  const csvInputRef                 = useRef<HTMLInputElement>(null);

  const { toast }      = useToast();
  const { hospitalId } = useHospitalId();
  const planTier       = settings.plan_tier;

  // ── Load ────────────────────────────────────────────────────────────────────


  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const [{ data: tpaData }, { data: settingsData }] = await Promise.all([
        (supabase as any).from("tpa_config").select("*").order("tpa_name"),
        (supabase as any)
          .from("hospital_insurance_settings")
          .select("*")
          .eq("hospital_id", hospitalId)
          .maybeSingle(),
      ]);
      setTpas((tpaData || []) as TPA[]);
      if (settingsData) {
        setSettingsId(settingsData.id);
        setSettings({
          plan_tier:              settingsData.plan_tier              ?? "manual",
          auto_submit_pre_auth:   settingsData.auto_submit_pre_auth   ?? false,
          auto_submit_claims:     settingsData.auto_submit_claims      ?? false,
          sla_alert_channel:      settingsData.sla_alert_channel      ?? "in_app",
          whatsapp_alert_number:  settingsData.whatsapp_alert_number  ?? null,
          denial_threshold_score: settingsData.denial_threshold_score ?? 40,
        });
      }
    } catch (e: any) {
      toast({ title: "Failed to load TPA data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [hospitalId, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Plan settings save ────────────────────────────────────────────────────

  const saveSettings = async () => {
    if (!hospitalId) return;
    setSavingSettings(true);
    try {
      const payload = { ...settings, hospital_id: hospitalId };
      if (settingsId) {
        await (supabase as any).from("hospital_insurance_settings").update(payload).eq("id", settingsId);
      } else {
        const { data } = await (supabase as any)
          .from("hospital_insurance_settings").insert(payload).select().maybeSingle();
        if (data?.id) setSettingsId(data.id);
      }
      toast({ title: "Plan settings saved ✓" });
      setSettingsOpen(false);
    } catch (e: any) {
      toast({ title: "Failed to save settings", description: e.message, variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  // ── TPA CRUD ──────────────────────────────────────────────────────────────

  const blankForm = () => ({
    tpa_name: "", tpa_code: "", coordinator_name: "", coordinator_phone: "",
    claims_email: "", contact_email: "", credit_days: 45,
    submission_method: "manual", required_documents: [], is_active: true,
    room_rent_ceiling: 0, co_payment_type: "none", co_payment_value: 0, deductible: 0,
    pre_auth_sla_minutes: 60, discharge_sla_minutes: 180, turnaround_days: 7,
    sla_alert_channel: "in_app", whatsapp_alert_number: "",
    api_endpoint: "", api_key_encrypted: "", tpa_hcx_code: "",
    email_subject_template: DEFAULT_EMAIL_TEMPLATE, cc_emails: "",
    package_rates: [],
  });

  const openNew = () => {
    setEditing(null);
    setForm(blankForm());
    resetPkgForm();
    setShowApiKey(false);
    setHcxTestResult(null);
    setDrawerOpen(true);
  };

  const openEdit = (tpa: TPA) => {
    setEditing(tpa);
    setForm({
      ...tpa,
      submission_method:      normaliseMethod(tpa.submission_method),
      room_rent_ceiling:      tpa.room_rent_ceiling   ?? 0,
      co_payment_type:        tpa.co_payment_type     ?? "none",
      co_payment_value:       tpa.co_payment_value    ?? 0,
      deductible:             tpa.deductible          ?? 0,
      pre_auth_sla_minutes:   tpa.pre_auth_sla_minutes  ?? 60,
      discharge_sla_minutes:  tpa.discharge_sla_minutes ?? 180,
      turnaround_days:        tpa.turnaround_days     ?? 7,
      sla_alert_channel:      tpa.sla_alert_channel   ?? "in_app",
      whatsapp_alert_number:  tpa.whatsapp_alert_number ?? "",
      api_endpoint:           tpa.api_endpoint        ?? "",
      api_key_encrypted:      tpa.api_key_encrypted   ?? "",
      tpa_hcx_code:           tpa.tpa_hcx_code        ?? "",
      email_subject_template: tpa.email_subject_template ?? DEFAULT_EMAIL_TEMPLATE,
      cc_emails:              (tpa.cc_emails || []).join(", "),
      package_rates:          normaliseRates(tpa.package_rates || []),
    });
    resetPkgForm();
    setShowApiKey(false);
    setHcxTestResult(null);
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!hospitalId) return;
    if (!form.tpa_name?.trim()) {
      toast({ title: "TPA name is required", variant: "destructive" }); return;
    }
    try {
      const ccArray = (form.cc_emails || "")
        .split(",").map((e: string) => e.trim()).filter(Boolean);

      const payload: any = {
        hospital_id:            hospitalId,
        tpa_name:               form.tpa_name,
        tpa_code:               form.tpa_code               || null,
        coordinator_name:       form.coordinator_name        || null,
        coordinator_phone:      form.coordinator_phone       || null,
        claims_email:           form.claims_email            || null,
        contact_email:          form.contact_email           || null,
        credit_days:            Number(form.credit_days)     || 45,
        submission_method:      form.submission_method       || "manual",
        required_documents:     form.required_documents      || [],
        is_active:              form.is_active,
        room_rent_ceiling:      Number(form.room_rent_ceiling)   || 0,
        co_payment_type:        form.co_payment_type         || "none",
        co_payment_value:       Number(form.co_payment_value)    || 0,
        deductible:             Number(form.deductible)          || 0,
        pre_auth_sla_minutes:   Number(form.pre_auth_sla_minutes)  || 60,
        discharge_sla_minutes:  Number(form.discharge_sla_minutes) || 180,
        turnaround_days:        Number(form.turnaround_days)   || 7,
        sla_alert_channel:      form.sla_alert_channel       || "in_app",
        whatsapp_alert_number:  form.whatsapp_alert_number    || null,
        api_endpoint:           form.api_endpoint             || null,
        api_key_encrypted:      form.api_key_encrypted        || null,
        tpa_hcx_code:           form.tpa_hcx_code             || null,
        email_subject_template: form.email_subject_template   || DEFAULT_EMAIL_TEMPLATE,
        cc_emails:              ccArray.length ? ccArray : null,
        package_rates:          form.package_rates            || [],
      };

      if (editing) {
        await (supabase as any).from("tpa_config").update(payload).eq("id", editing.id);
        toast({ title: "TPA updated ✓" });
      } else {
        await (supabase as any).from("tpa_config").insert(payload);
        toast({ title: "TPA added ✓" });
      }
      setDrawerOpen(false);
      loadData();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  const toggleDoc = (doc: string) => {
    const docs = form.required_documents || [];
    setForm({
      ...form,
      required_documents: docs.includes(doc)
        ? docs.filter((d: string) => d !== doc)
        : [...docs, doc],
    });
  };

  // ── HCX test connection ───────────────────────────────────────────────────

  const testHcxConnection = async () => {
    if (!form.api_endpoint) {
      toast({ title: "Enter an API endpoint first", variant: "destructive" }); return;
    }
    setTestingHcx(true);
    setHcxTestResult(null);
    try {
      const { error } = await supabase.functions.invoke("test-hcx-connection", {
        body: {
          endpoint:     form.api_endpoint,
          api_key:      form.api_key_encrypted,
          tpa_hcx_code: form.tpa_hcx_code,
        },
      });
      if (error) throw error;
      setHcxTestResult("ok");
      toast({ title: "HCX connection successful ✓" });
    } catch (e: any) {
      setHcxTestResult("fail");
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    } finally {
      setTestingHcx(false);
    }
  };

  // ── Package rate master ───────────────────────────────────────────────────

  const resetPkgForm = () => {
    setPkgForm({ procedure_name: "", package_code: "", approved_rate: "", effective_date: "", includes: "" });
    setEditingPkgId(null);
  };

  const addOrUpdateRate = () => {
    if (!pkgForm.procedure_name.trim()) {
      toast({ title: "Procedure name is required", variant: "destructive" }); return;
    }
    const rates: PackageRate[] = form.package_rates || [];
    if (editingPkgId) {
      setForm({
        ...form,
        package_rates: rates.map(r =>
          r.id === editingPkgId
            ? { ...r, ...pkgForm, approved_rate: Number(pkgForm.approved_rate) || 0 }
            : r
        ),
      });
    } else {
      setForm({
        ...form,
        package_rates: [...rates, {
          id:            crypto.randomUUID(),
          procedure_name: pkgForm.procedure_name,
          package_code:  pkgForm.package_code,
          approved_rate: Number(pkgForm.approved_rate) || 0,
          effective_date: pkgForm.effective_date || new Date().toISOString().slice(0, 10),
          includes:      pkgForm.includes,
        }],
      });
    }
    resetPkgForm();
  };

  const editRate = (r: PackageRate) => {
    setEditingPkgId(r.id);
    setPkgForm({
      procedure_name: r.procedure_name,
      package_code:   r.package_code,
      approved_rate:  String(r.approved_rate),
      effective_date: r.effective_date,
      includes:       r.includes,
    });
  };

  const deleteRate = (id: string) => {
    setForm({ ...form, package_rates: (form.package_rates || []).filter((r: PackageRate) => r.id !== id) });
    if (editingPkgId === id) resetPkgForm();
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || "";
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      // Skip header row if first cell looks like a column name
      const firstCell = lines[0]?.split(",")[0]?.toLowerCase() ?? "";
      const dataLines = /procedure|package|name/i.test(firstCell) ? lines.slice(1) : lines;
      const imported: PackageRate[] = dataLines.map(line => {
        const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        return {
          id:             crypto.randomUUID(),
          procedure_name: cols[0] ?? "",
          package_code:   cols[1] ?? "",
          approved_rate:  Number(cols[2]) || 0,
          effective_date: cols[3] ?? new Date().toISOString().slice(0, 10),
          includes:       cols[4] ?? "",
        };
      }).filter(r => r.procedure_name);
      if (!imported.length) {
        toast({ title: "No valid rows found in CSV", variant: "destructive" }); return;
      }
      setForm((f: any) => ({ ...f, package_rates: [...(f.package_rates || []), ...imported] }));
      toast({ title: `${imported.length} rates imported ✓` });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const method   = form.submission_method || "manual";
  const isHCX    = method === "hcx_api";
  const isRPA    = method === "rpa_bot";
  const isEmail  = method === "email";
  const coPayType = form.co_payment_type ?? "none";
  const planMeta  = PLAN_META[planTier];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-auto p-4 space-y-4">

      {/* ── Plan Settings (admin / collapsible) ── */}
      <div className="rounded-lg border border-border bg-card">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          onClick={() => setSettingsOpen(v => !v)}
        >
          <div className="flex items-center gap-3">
            <Settings2 size={16} className="text-muted-foreground" />
            <span className="text-sm font-semibold">Automation &amp; Alert Settings</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", planMeta.color)}>
              {planMeta.full}
            </span>
          </div>
          {settingsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {settingsOpen && (
          <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Auto-submit Pre-Auth</Label>
                  {planTier === "manual"
                    ? <Lock size={13} className="text-muted-foreground" />
                    : <Switch
                        checked={settings.auto_submit_pre_auth}
                        onCheckedChange={v => setSettings(s => ({ ...s, auto_submit_pre_auth: v }))}
                      />}
                </div>
                {planTier === "manual" && <p className="text-[11px] text-muted-foreground">Requires Plan B+</p>}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Auto-submit Claims</Label>
                  {planTier !== "automated"
                    ? <Lock size={13} className="text-muted-foreground" />
                    : <Switch
                        checked={settings.auto_submit_claims}
                        onCheckedChange={v => setSettings(s => ({ ...s, auto_submit_claims: v }))}
                      />}
                </div>
                {planTier !== "automated" && <p className="text-[11px] text-muted-foreground">Requires Plan C</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-semibold">Default SLA Alert Channel</Label>
                <Select
                  value={settings.sla_alert_channel}
                  onValueChange={v => setSettings(s => ({ ...s, sla_alert_channel: v as any }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">In-App</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settings.sla_alert_channel === "whatsapp" && (
                <div>
                  <Label className="text-sm font-semibold">WhatsApp Number</Label>
                  <Input
                    className="mt-1" placeholder="+91 9XXXXXXXXX"
                    value={settings.whatsapp_alert_number ?? ""}
                    onChange={e => setSettings(s => ({ ...s, whatsapp_alert_number: e.target.value || null }))}
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm font-semibold">Denial Risk Hold Threshold (0–100)</Label>
              <p className="text-xs text-muted-foreground">Claims above this AI score are held for manual review.</p>
              <Input
                className="mt-1 w-28" type="number" min={0} max={100}
                value={settings.denial_threshold_score}
                onChange={e => setSettings(s => ({ ...s, denial_threshold_score: Number(e.target.value) }))}
              />
            </div>

            <Button size="sm" className="gap-1.5" onClick={saveSettings} disabled={savingSettings}>
              <Save size={13} />
              {savingSettings ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        )}
      </div>

      {/* ── TPA Table ── */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold">TPA / Insurer Configuration</h3>
        <Button size="sm" className="gap-1.5 text-xs" onClick={openNew}><Plus size={14} /> Add TPA</Button>
      </div>

      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">TPA Name</TableHead>
              <TableHead className="text-xs">Code</TableHead>
              <TableHead className="text-xs">Coordinator</TableHead>
              <TableHead className="text-xs">Credit Days</TableHead>
              <TableHead className="text-xs">Submission</TableHead>
              <TableHead className="text-xs">Pre-Auth SLA</TableHead>
              <TableHead className="text-xs">Discharge SLA</TableHead>
              <TableHead className="text-xs">Coverage Rules</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            ) : tpas.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">No TPAs configured yet. Click "Add TPA" to get started.</TableCell></TableRow>
            ) : tpas.map(t => (
              <TableRow key={t.id}>
                <TableCell className="text-sm font-medium">{t.tpa_name}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{t.tpa_code || "—"}</TableCell>
                <TableCell className="text-xs">{t.coordinator_name || "—"}</TableCell>
                <TableCell className="text-xs tabular-nums">{t.credit_days}d</TableCell>
                <TableCell><MethodBadge method={t.submission_method} /></TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">{t.pre_auth_sla_minutes ?? 60} min</TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">{t.discharge_sla_minutes ?? 180} min</TableCell>
                <TableCell className="text-xs text-muted-foreground">{coverageRuleSummary(t)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("text-xs", t.is_active ? "text-emerald-700" : "text-muted-foreground")}>
                    {t.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => openEdit(t)}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Plan Status Card (read-only, bottom of page) ── */}
      <PlanStatusCard planTier={planTier} />

      {/* ── Add / Edit Drawer ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? `Edit TPA — ${editing.tpa_name}` : "Add TPA"}</SheetTitle>
          </SheetHeader>

          <div className="space-y-5 mt-4">

            {/* ── SECTION 1: Basic Information ── */}
            <Section title="TPA Information">
              <Field label="TPA / Insurer Name *">
                <Input value={form.tpa_name || ""} onChange={e => setForm({ ...form, tpa_name: e.target.value })} />
              </Field>
              <Field label="TPA Code">
                <Input placeholder="e.g. MEDI, STAR, HCX001" value={form.tpa_code || ""} onChange={e => setForm({ ...form, tpa_code: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Coordinator Name">
                  <Input value={form.coordinator_name || ""} onChange={e => setForm({ ...form, coordinator_name: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <Input value={form.coordinator_phone || ""} onChange={e => setForm({ ...form, coordinator_phone: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Claims Email">
                  <Input type="email" value={form.claims_email || ""} onChange={e => setForm({ ...form, claims_email: e.target.value })} />
                </Field>
                <Field label="Contact Email">
                  <Input type="email" value={form.contact_email || ""} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
                </Field>
              </div>
              <Field label="Credit Days">
                <Input className="w-28" type="number" value={form.credit_days || 45} onChange={e => setForm({ ...form, credit_days: e.target.value })} />
              </Field>

              {/* Required Documents */}
              <div className="pt-1">
                <p className="text-xs font-semibold mb-2">Required Documents</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {DEFAULT_DOCS.map(doc => (
                    <label key={doc} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox" className="rounded"
                        checked={(form.required_documents || []).includes(doc)}
                        onChange={() => toggleDoc(doc)}
                      />
                      {doc}
                    </label>
                  ))}
                </div>
              </div>
            </Section>

            {/* ── SECTION 2: SLA Settings ── */}
            <Section title="SLA Settings" icon={<Clock size={14} />}>
              <p className="text-xs text-muted-foreground -mt-1">
                Timers start when a pre-auth or discharge request is created. IRDAI mandates 60 min for pre-auth and 3 hrs for discharge.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Pre-Auth SLA (min)" hint="IRDAI: 60 min">
                  <Input type="number" min={15} step={15} value={form.pre_auth_sla_minutes ?? 60} onChange={e => setForm({ ...form, pre_auth_sla_minutes: e.target.value })} />
                </Field>
                <Field label="Discharge Approval SLA (min)" hint="IRDAI: 3 hrs">
                  <Input type="number" min={30} step={30} value={form.discharge_sla_minutes ?? 180} onChange={e => setForm({ ...form, discharge_sla_minutes: e.target.value })} />
                </Field>
                <Field label="Claim Turnaround (days)" hint="Settlement target">
                  <Input type="number" min={1} value={form.turnaround_days ?? 7} onChange={e => setForm({ ...form, turnaround_days: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="SLA Alert Channel">
                  <Select value={form.sla_alert_channel || "in_app"} onValueChange={v => setForm({ ...form, sla_alert_channel: v, whatsapp_alert_number: "" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_app">In-App Notification</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {form.sla_alert_channel === "whatsapp" && (
                  <Field label="WhatsApp Alert Number">
                    <Input placeholder="+91 9XXXXXXXXX" value={form.whatsapp_alert_number || ""} onChange={e => setForm({ ...form, whatsapp_alert_number: e.target.value })} />
                  </Field>
                )}
              </div>
            </Section>

            {/* ── SECTION 3: Submission Method ── */}
            <Section title="Submission Method" icon={<Zap size={14} />}>
              <Field label="How claims are sent to this TPA">
                <Select value={method} onValueChange={v => { setForm({ ...form, submission_method: v }); setHcxTestResult(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (staff submits via portal / email)</SelectItem>
                    <SelectItem value="email" disabled={planTier === "manual"}>
                      <span className="flex items-center gap-1.5">
                        <MailOpen size={12} />
                        Email Submission (auto-email claim bundle)
                        {planTier === "manual" && <Lock size={11} className="text-muted-foreground" />}
                      </span>
                    </SelectItem>
                    <SelectItem value="hcx_api" disabled={planTier !== "automated"}>
                      <span className="flex items-center gap-1.5">
                        <Zap size={12} />
                        HCX API (auto via NHA Health Claims Exchange)
                        {planTier !== "automated" && <Lock size={11} className="text-muted-foreground" />}
                      </span>
                    </SelectItem>
                    <SelectItem value="rpa_bot" disabled={planTier !== "automated"}>
                      <span className="flex items-center gap-1.5">
                        <Bot size={12} />
                        RPA Bot (automated portal submission)
                        {planTier !== "automated" && <Lock size={11} className="text-muted-foreground" />}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Email fields */}
              {isEmail && (
                planTier !== "manual" ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><MailOpen size={13} /> Email Submission Settings</p>
                    <Field label="TPA Claim Email Address">
                      <Input type="email" placeholder="claims@tpa.co.in" value={form.claims_email || ""} onChange={e => setForm({ ...form, claims_email: e.target.value })} />
                    </Field>
                    <Field label='Email Subject Template' hint="Tokens: {claim_number}, {patient_name}">
                      <Input value={form.email_subject_template || DEFAULT_EMAIL_TEMPLATE} onChange={e => setForm({ ...form, email_subject_template: e.target.value })} />
                    </Field>
                    <Field label="CC Emails" hint="Comma-separated">
                      <Input placeholder="billing@hospital.com, manager@hospital.com" value={form.cc_emails || ""} onChange={e => setForm({ ...form, cc_emails: e.target.value })} />
                    </Field>
                  </div>
                ) : (
                  <LockedBanner requiredPlan="ai_assisted" />
                )
              )}

              {/* HCX / RPA fields */}
              {(isHCX || isRPA) && (
                planTier === "automated" ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><Cpu size={13} />{isHCX ? "HCX API" : "RPA Bot"} Integration</p>
                    <Field label="HCX Endpoint URL">
                      <Input
                        className="font-mono text-xs"
                        placeholder="https://hcx.nha.gov.in/api/v0.7"
                        value={form.api_endpoint || ""}
                        onChange={e => { setForm({ ...form, api_endpoint: e.target.value }); setHcxTestResult(null); }}
                      />
                    </Field>
                    <Field label="API Key (stored encrypted)">
                      <div className="relative">
                        <Input
                          className="font-mono text-xs pr-9"
                          type={showApiKey ? "text" : "password"}
                          placeholder="••••••••••••••••"
                          value={form.api_key_encrypted || ""}
                          onChange={e => setForm({ ...form, api_key_encrypted: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(v => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </Field>
                    {isHCX && (
                      <Field label="TPA HCX Code">
                        <Input placeholder="e.g. HCX-TPA-0001" value={form.tpa_hcx_code || ""} onChange={e => setForm({ ...form, tpa_hcx_code: e.target.value })} />
                      </Field>
                    )}
                    <div className="flex items-center gap-3">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={testHcxConnection} disabled={testingHcx}>
                        {testingHcx ? <><Wifi size={12} className="animate-pulse" /> Testing…</> : <><Wifi size={12} /> Test Connection</>}
                      </Button>
                      {hcxTestResult === "ok"   && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={13} /> Connected</span>}
                      {hcxTestResult === "fail"  && <span className="flex items-center gap-1 text-xs text-red-600"><WifiOff size={13} /> Failed</span>}
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1"><AlertCircle size={10} /> Keys are encrypted at rest. Contact support to rotate.</p>
                  </div>
                ) : (
                  <LockedBanner requiredPlan="automated" />
                )
              )}
            </Section>

            {/* ── SECTION 4: Package Rate Master ── */}
            <Section title="Package Rate Master" icon={<Package size={14} />}>
              <p className="text-xs text-muted-foreground -mt-1">
                Agreed procedure rates feed into denial risk scoring in Claims to Submit.
              </p>

              {/* Rate table */}
              {(form.package_rates || []).length > 0 && (
                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">Procedure Name</th>
                        <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">Package Code</th>
                        <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">Approved Rate (₹)</th>
                        <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">Effective Date</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.package_rates as PackageRate[]).map(r => (
                        <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                          <td className="px-2 py-1.5 font-medium">{r.procedure_name}</td>
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.package_code || "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.approved_rate.toLocaleString("en-IN")}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.effective_date || "—"}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => editRate(r)} className="text-blue-600 hover:text-blue-800"><Pencil size={12} /></button>
                              <button onClick={() => deleteRate(r.id)} className="text-red-600 hover:text-red-800"><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add / edit rate form */}
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-semibold">{editingPkgId ? "Edit Rate" : "Add Rate"}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Procedure Name *" compact>
                    <Input className="h-7 text-xs" placeholder="e.g. CABG, Appendectomy" value={pkgForm.procedure_name} onChange={e => setPkgForm(p => ({ ...p, procedure_name: e.target.value }))} />
                  </Field>
                  <Field label="Package Code" compact>
                    <Input className="h-7 text-xs font-mono" placeholder="e.g. NHCX-C-001" value={pkgForm.package_code} onChange={e => setPkgForm(p => ({ ...p, package_code: e.target.value }))} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Approved Rate (₹)" compact>
                    <Input className="h-7 text-xs" type="number" min={0} placeholder="0" value={pkgForm.approved_rate} onChange={e => setPkgForm(p => ({ ...p, approved_rate: e.target.value }))} />
                  </Field>
                  <Field label="Effective Date" compact>
                    <Input className="h-7 text-xs" type="date" value={pkgForm.effective_date} onChange={e => setPkgForm(p => ({ ...p, effective_date: e.target.value }))} />
                  </Field>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={addOrUpdateRate}>
                    <Plus size={11} />{editingPkgId ? "Update" : "Add Rate"}
                  </Button>
                  {editingPkgId && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetPkgForm}>Cancel</Button>
                  )}
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs gap-1 ml-auto"
                    onClick={() => csvInputRef.current?.click()}
                  >
                    <Upload size={11} /> Import CSV
                  </Button>
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvImport} />
                </div>
                <p className="text-[10px] text-muted-foreground">CSV format: Procedure Name, Package Code, Approved Rate, Effective Date, Includes</p>
              </div>
            </Section>

            {/* Coverage Rules */}
            <Section title="Coverage Rules">
              <Field label="Room Rent Ceiling (₹ / day)" hint="Leave 0 for no cap">
                <Input type="number" min={0} value={form.room_rent_ceiling ?? 0} onChange={e => setForm({ ...form, room_rent_ceiling: e.target.value })} />
              </Field>
              <Field label="Co-payment Type">
                <Select value={coPayType} onValueChange={v => setForm({ ...form, co_payment_type: v, co_payment_value: 0 })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="fixed">Fixed Amount (₹)</SelectItem>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {coPayType !== "none" && (
                <Field label={coPayType === "fixed" ? "Co-payment Amount (₹)" : "Co-payment Percentage (%)"}>
                  <Input type="number" min={0} placeholder={coPayType === "fixed" ? "e.g. 500" : "e.g. 10"} value={form.co_payment_value ?? 0} onChange={e => setForm({ ...form, co_payment_value: e.target.value })} />
                </Field>
              )}
              <Field label="Annual Deductible (₹)" hint="0 = no deductible">
                <Input type="number" min={0} value={form.deductible ?? 0} onChange={e => setForm({ ...form, deductible: e.target.value })} />
              </Field>
            </Section>

            {/* Active + Save */}
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={form.is_active !== false} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label className="text-sm">Active</Label>
            </div>
            <Button className="w-full mt-2" onClick={save}>
              {editing ? "Update TPA" : "Add TPA"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({
  title, icon, children,
}) => (
  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
    <p className="text-sm font-semibold flex items-center gap-1.5">{icon}{title}</p>
    {children}
  </div>
);

const Field: React.FC<{ label: string; hint?: string; compact?: boolean; children: React.ReactNode }> = ({
  label, hint, compact, children,
}) => (
  <div>
    <Label className={compact ? "text-[11px]" : "text-sm font-semibold"}>{label}</Label>
    {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    <div className="mt-0.5">{children}</div>
  </div>
);

// ── SECTION 5: Plan Status Card (read-only) ───────────────────────────────────

const PLAN_STATUS: Record<string, { features: string[]; next?: string; nextSlug?: "ai_assisted" | "automated" }> = {
  manual: {
    features: ["Manual claims tracking", "Document checklist", "TPA query log", "SLA timer"],
    next: "Plan B — AI Assisted (₹12,000/mo)",
    nextSlug: "ai_assisted",
  },
  ai_assisted: {
    features: ["Everything in Manual", "AI pre-fill for pre-auth", "AI denial risk scoring", "Email auto-submission"],
    next: "Plan C — Automated (₹25,000/mo)",
    nextSlug: "automated",
  },
  automated: {
    features: ["Everything in AI Assisted", "HCX API auto-submit", "RPA bot integration", "Auto-reconciliation"],
  },
};

const PlanStatusCard: React.FC<{ planTier: string }> = ({ planTier }) => {
  const meta   = PLAN_META[planTier as keyof typeof PLAN_META] ?? PLAN_META.manual;
  const status = PLAN_STATUS[planTier] ?? PLAN_STATUS.manual;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Aumrti Plan</p>
          <div className="flex items-center gap-2">
            <span className={cn("inline-block w-2 h-2 rounded-full", meta.dot)} />
            <span className="text-sm font-bold">{meta.full}</span>
            <span className="text-xs text-muted-foreground">{meta.price}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1">
            {status.features.map(f => (
              <span key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> {f}
              </span>
            ))}
          </div>
        </div>
        {status.next && (
          <a
            href="/settings/billing"
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap"
          >
            Upgrade to {status.next.split(" (")[0]} <ExternalLink size={11} />
          </a>
        )}
      </div>
      {status.next && (
        <p className="text-xs text-muted-foreground mt-2">
          Upgrade to unlock AI and Automated features →{" "}
          <a href="/settings/billing" className="text-primary hover:underline">View plans</a>
        </p>
      )}
    </div>
  );
};

// ── Submission method badge ───────────────────────────────────────────────────

const METHOD_STYLES: Record<string, string> = {
  manual:  "bg-slate-100 text-slate-700",
  email:   "bg-blue-100 text-blue-700",
  hcx_api: "bg-purple-100 text-purple-700",
  rpa_bot: "bg-emerald-100 text-emerald-700",
  portal:  "bg-slate-100 text-slate-700",
  hcx:     "bg-purple-100 text-purple-700",
};
const METHOD_LABELS: Record<string, string> = {
  manual: "Manual", email: "Email", hcx_api: "HCX", rpa_bot: "RPA Bot", portal: "Portal", hcx: "HCX",
};

const MethodBadge: React.FC<{ method: string }> = ({ method }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", METHOD_STYLES[method] ?? "bg-muted text-muted-foreground")}>
    {METHOD_LABELS[method] ?? method}
  </span>
);

export default TPAConfiguration;
