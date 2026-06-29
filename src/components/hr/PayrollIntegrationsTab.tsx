import React, { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Download, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PayrollHook {
  id: string;
  integration_type: "export_csv" | "tally_payroll" | "third_party_api";
  label: string;
  config: Record<string, any>;
  active: boolean;
}

const INTEGRATION_META: Record<string, { title: string; desc: string; icon: string }> = {
  export_csv:       { title: "CSV Export",        desc: "Configure payroll CSV column layout and file options", icon: "📄" },
  tally_payroll:    { title: "Tally Payroll",      desc: "Map Aumrti heads to Tally ledgers for payroll vouchers", icon: "📊" },
  third_party_api:  { title: "Third-Party API",    desc: "Send payroll data to an external HRMS or payroll engine via webhook", icon: "🔗" },
};

const CSV_COLUMNS = ["Name", "Employee ID", "Department", "Designation", "Days Worked", "Basic", "HRA",
  "Allowances", "Gross Pay", "PF", "ESI", "TDS", "Other Deductions", "Net Pay"];

// ── Config editors ─────────────────────────────────────────────────────────
const CsvConfigEditor: React.FC<{ config: Record<string, any>; onChange: (c: Record<string, any>) => void }> = ({ config, onChange }) => {
  const cols: string[] = config.columns ?? CSV_COLUMNS;
  const toggle = (col: string) => {
    const next = cols.includes(col) ? cols.filter((c) => c !== col) : [...cols, col];
    onChange({ ...config, columns: next });
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold mb-1.5">Columns to include</p>
        <div className="flex flex-wrap gap-1.5">
          {CSV_COLUMNS.map((col) => (
            <button key={col} onClick={() => toggle(col)}
              className={cn("px-2.5 py-0.5 rounded-full text-xs border transition-colors",
                cols.includes(col) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
              {col}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">Delimiter</label>
        <select className="h-7 text-xs border rounded px-2" value={config.delimiter ?? ","}
          onChange={(e) => onChange({ ...config, delimiter: e.target.value })}>
          <option value=",">, (comma)</option>
          <option value="&#9;">⇥ (tab)</option>
          <option value=";">; (semicolon)</option>
        </select>
        <label className="text-xs text-muted-foreground ml-3">Filename prefix</label>
        <Input className="h-7 text-xs w-36" value={config.filename_prefix ?? "payroll"}
          onChange={(e) => onChange({ ...config, filename_prefix: e.target.value })} />
      </div>
    </div>
  );
};

const TallyConfigEditor: React.FC<{ config: Record<string, any>; onChange: (c: Record<string, any>) => void }> = ({ config, onChange }) => {
  const heads = ["Basic Salary", "HRA", "Transport Allowance", "Special Allowance", "PF (Employee)", "PF (Employer)", "ESI (Employee)", "ESI (Employer)", "TDS"];
  const field = (key: string) => (
    <div key={key} className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-44 shrink-0">{key}</span>
      <Input className="h-7 text-xs flex-1" placeholder="Tally ledger name"
        value={config[key] ?? ""}
        onChange={(e) => onChange({ ...config, [key]: e.target.value })} />
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-muted-foreground">Company name in Tally</label>
        <Input className="h-7 text-xs w-52" value={config.company_name ?? ""}
          onChange={(e) => onChange({ ...config, company_name: e.target.value })} />
      </div>
      <p className="text-xs font-semibold mb-1">Ledger mapping</p>
      {heads.map((h) => field(h))}
    </div>
  );
};

const ApiConfigEditor: React.FC<{ config: Record<string, any>; onChange: (c: Record<string, any>) => void }> = ({ config, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-28">Webhook URL</label>
      <Input className="h-7 text-xs flex-1" placeholder="https://yourhrms.com/api/payroll"
        value={config.webhook_url ?? ""}
        onChange={(e) => onChange({ ...config, webhook_url: e.target.value })} />
    </div>
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-28">Auth type</label>
      <select className="h-7 text-xs border rounded px-2" value={config.auth_type ?? "bearer"}
        onChange={(e) => onChange({ ...config, auth_type: e.target.value })}>
        <option value="bearer">Bearer token</option>
        <option value="basic">Basic auth</option>
        <option value="api_key">API key header</option>
        <option value="none">None</option>
      </select>
    </div>
    {config.auth_type !== "none" && (
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground w-28">Token / key</label>
        <Input className="h-7 text-xs flex-1" placeholder="••••••••"
          type="password" value={config.auth_token ?? ""}
          onChange={(e) => onChange({ ...config, auth_token: e.target.value })} />
      </div>
    )}
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-28">Payload format</label>
      <select className="h-7 text-xs border rounded px-2" value={config.payload_format ?? "json"}
        onChange={(e) => onChange({ ...config, payload_format: e.target.value })}>
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
      </select>
    </div>
  </div>
);

// ── Hook card ──────────────────────────────────────────────────────────────
const HookCard: React.FC<{
  integrationType: string;
  hook: PayrollHook | null;
  onSave: (type: string, config: Record<string, any>, active: boolean) => Promise<void>;
}> = ({ integrationType, hook, onSave }) => {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(hook?.active ?? false);
  const [config, setConfig] = useState<Record<string, any>>(hook?.config ?? {});
  const [saving, setSaving] = useState(false);
  const meta = INTEGRATION_META[integrationType];

  useEffect(() => {
    setActive(hook?.active ?? false);
    setConfig(hook?.config ?? {});
  }, [hook]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(integrationType, config, active);
    setSaving(false);
  };

  return (
    <div className={cn("border rounded-xl overflow-hidden", active ? "border-primary/40" : "border-border")}>
      <div className="flex items-center gap-3 px-4 py-3 bg-card">
        <span className="text-xl">{meta.icon}</span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{meta.title}</p>
          <p className="text-xs text-muted-foreground">{meta.desc}</p>
        </div>
        <button onClick={() => setActive(!active)}
          className={cn("flex items-center gap-1 text-xs font-medium px-3 h-7 rounded-full border transition-colors",
            active ? "border-primary/40 text-primary bg-primary/5" : "border-border text-muted-foreground")}>
          {active
            ? <><ToggleRight className="h-3.5 w-3.5" /> Enabled</>
            : <><ToggleLeft className="h-3.5 w-3.5" /> Disabled</>}
        </button>
        <button onClick={() => setExpanded(!expanded)} className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted/50">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border p-4 bg-muted/20 space-y-4">
          {integrationType === "export_csv"      && <CsvConfigEditor config={config} onChange={setConfig} />}
          {integrationType === "tally_payroll"   && <TallyConfigEditor config={config} onChange={setConfig} />}
          {integrationType === "third_party_api" && <ApiConfigEditor config={config} onChange={setConfig} />}
          <div className="flex justify-end">
            <Button size="sm" className="h-7 text-xs gap-1.5" disabled={saving} onClick={handleSave}>
              <Save className="h-3 w-3" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────
const PayrollIntegrationsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [hooks, setHooks] = useState<PayrollHook[]>([]);
  const [exportMonth, setExportMonth] = useState(format(new Date(), "yyyy-MM"));
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from("payroll_hooks").select("*").eq("hospital_id", hospitalId);
    setHooks(data || []);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const saveHook = async (integrationType: string, config: Record<string, any>, active: boolean) => {
    const { error } = await (supabase as any).from("payroll_hooks").upsert(
      { hospital_id: hospitalId, integration_type: integrationType,
        label: INTEGRATION_META[integrationType]?.title ?? integrationType,
        config, active, updated_at: new Date().toISOString() },
      { onConflict: "hospital_id,integration_type" }
    );
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Integration settings saved" });
      load();
    }
  };

  const exportPayrollCsv = async () => {
    setExporting(true);
    const [year, month] = exportMonth.split("-");
    const from = `${exportMonth}-01`;
    const to   = `${year}-${month}-${new Date(+year, +month, 0).getDate()}`;

    const { data: runs } = await (supabase as any)
      .from("payroll_runs")
      .select("id, run_date, status")
      .eq("hospital_id", hospitalId)
      .gte("run_date", from)
      .lte("run_date", to)
      .limit(1)
      .maybeSingle();

    if (!runs) {
      toast({ title: "No payroll run found for this month", variant: "destructive" });
      setExporting(false);
      return;
    }

    const { data: slips } = await (supabase as any)
      .from("payslips")
      .select("*, user:users!payslips_user_id_fkey(full_name)")
      .eq("payroll_run_id", runs.id);

    const csvHook = hooks.find((h) => h.integration_type === "export_csv");
    const cols: string[] = csvHook?.config?.columns ?? CSV_COLUMNS;
    const delim: string  = csvHook?.config?.delimiter ?? ",";
    const prefix: string = csvHook?.config?.filename_prefix ?? "payroll";

    const colMap: Record<string, (s: any) => string | number> = {
      "Name":              (s) => s.user?.full_name ?? "",
      "Employee ID":       (s) => s.user_id ?? "",
      "Department":        (s) => s.department ?? "",
      "Designation":       (s) => s.designation ?? "",
      "Days Worked":       (s) => s.days_worked ?? "",
      "Basic":             (s) => s.basic_salary ?? "",
      "HRA":               (s) => s.hra ?? "",
      "Allowances":        (s) => s.other_allowances ?? "",
      "Gross Pay":         (s) => s.gross_pay ?? "",
      "PF":                (s) => s.pf_employee ?? "",
      "ESI":               (s) => s.esi_employee ?? "",
      "TDS":               (s) => s.tds ?? "",
      "Other Deductions":  (s) => s.other_deductions ?? "",
      "Net Pay":           (s) => s.net_pay ?? "",
    };

    const header = cols.join(delim);
    const rowLines = (slips || []).map((s: any) =>
      cols.map((c) => String(colMap[c]?.(s) ?? "")).join(delim)
    );
    const csv = [header, ...rowLines].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${prefix}_${exportMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const getHook = (type: string) => hooks.find((h) => h.integration_type === type) ?? null;

  return (
    <div className="flex flex-col overflow-y-auto flex-1 p-5 gap-5">
      <div>
        <h2 className="text-sm font-bold">Payroll Integrations</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Connect payroll data to external systems or configure export formats</p>
      </div>

      {(["export_csv", "tally_payroll", "third_party_api"] as const).map((type) => (
        <HookCard key={type} integrationType={type} hook={getHook(type)} onSave={saveHook} />
      ))}

      {/* Monthly Export */}
      <div className="border rounded-xl p-4 bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2"><Download className="h-4 w-4" /> Export Payroll Data</p>
            <p className="text-xs text-muted-foreground mt-0.5">Download a CSV of the finalised payroll run for a given month</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={exportMonth}
              onChange={(e) => setExportMonth(e.target.value)}
              className="h-8 text-xs w-36"
            />
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={exportPayrollCsv} disabled={exporting}>
              <Download className="h-3 w-3" />
              {exporting ? "Preparing…" : "Export CSV"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayrollIntegrationsTab;
