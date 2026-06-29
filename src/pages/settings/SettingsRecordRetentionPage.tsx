import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, Loader2, Save, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Default retention schedule per NABH IMS + MCI + legal requirements
const DEFAULTS = [
  { record_type: "OPD_Record",          retention_years: 5,  legal_reference: "MCI Regulations 2002",       notes: "Outpatient encounter records, prescriptions" },
  { record_type: "IPD_Record",          retention_years: 10, legal_reference: "MCI Regulations 2002",       notes: "Admission, nursing notes, discharge summary" },
  { record_type: "MLC_Record",          retention_years: 30, legal_reference: "Medico-legal requirement",   notes: "Medicolegal cases — longer retention mandatory" },
  { record_type: "OT_Record",           retention_years: 10, legal_reference: "MCI Regulations 2002",       notes: "Anaesthesia records, OT notes, implant logs" },
  { record_type: "Lab_Report",          retention_years: 5,  legal_reference: "NABH IMS standards",         notes: "Lab orders, results, validated reports" },
  { record_type: "Radiology_Report",    retention_years: 5,  legal_reference: "NABH IMS standards",         notes: "Radiology orders, reports, DICOM images" },
  { record_type: "Billing",             retention_years: 7,  legal_reference: "Income Tax Act / CGST Act",  notes: "Bills, payments, insurance claims" },
  { record_type: "HR_File",             retention_years: 7,  legal_reference: "Labour Laws",                notes: "Staff credentials, training, payroll records" },
  { record_type: "Consent_Form",        retention_years: 10, legal_reference: "NABH HRM standards",         notes: "Surgical consent, informed consent documents" },
  { record_type: "Blood_Transfusion",   retention_years: 10, legal_reference: "NBTC Guidelines",            notes: "Transfusion records, blood bank logs" },
  { record_type: "Immunisation_Record", retention_years: 20, legal_reference: "NABH AAC standards",         notes: "Vaccination records maintained for life" },
];

interface Policy {
  id?: string;
  record_type: string;
  retention_years: number;
  legal_reference: string;
  notes: string;
  _dirty?: boolean;
  _saving?: boolean;
}

interface ScanResult {
  record_type: string;
  table_name: string;
  count: number;
  retention_years: number;
}

const TABLE_MAP: Record<string, string> = {
  OPD_Record:       "opd_tokens",
  IPD_Record:       "admissions",
  Lab_Report:       "lab_orders",
  Billing:          "bills",
};

const SettingsRecordRetentionPage: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("record_retention_policies")
      .select("*")
      .eq("hospital_id", hospitalId);

    const saved = data || [];
    const merged = DEFAULTS.map(def => {
      const existing = saved.find((s: any) => s.record_type === def.record_type);
      if (existing) return { ...existing, _dirty: false };
      return { ...def, _dirty: false };
    });
    // Also include any custom types not in DEFAULTS
    for (const s of saved) {
      if (!DEFAULTS.find(d => d.record_type === s.record_type)) {
        merged.push({ ...s, _dirty: false });
      }
    }
    setPolicies(merged);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (idx: number, field: keyof Policy, value: string | number) => {
    setPolicies(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value, _dirty: true } : p));
  };

  const handleSaveRow = async (idx: number) => {
    if (!hospitalId) return;
    const p = policies[idx];
    setPolicies(prev => prev.map((row, i) => i === idx ? { ...row, _saving: true } : row));

    const payload = {
      hospital_id: hospitalId,
      record_type: p.record_type,
      retention_years: Number(p.retention_years),
      legal_reference: p.legal_reference || null,
      notes: p.notes || null,
    };

    const { data, error } = await (supabase as any)
      .from("record_retention_policies")
      .upsert(payload, { onConflict: "hospital_id,record_type" })
      .select("id").maybeSingle();

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${p.record_type} retention saved` });
      setPolicies(prev => prev.map((row, i) =>
        i === idx ? { ...row, id: data?.id || row.id, _dirty: false, _saving: false } : row
      ));
    }
  };

  const handleSaveAll = async () => {
    if (!hospitalId) return;
    const dirty = policies.filter(p => p._dirty);
    for (let i = 0; i < policies.length; i++) {
      if (policies[i]._dirty) await handleSaveRow(i);
    }
    if (dirty.length === 0) toast({ title: "No changes to save" });
  };

  const handleScan = async () => {
    if (!hospitalId) return;
    setScanning(true);
    setScanResults(null);
    const results: ScanResult[] = [];

    for (const policy of policies) {
      const tableName = TABLE_MAP[policy.record_type];
      if (!tableName) continue;

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - policy.retention_years);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const { count } = await (supabase as any)
        .from(tableName)
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .lt("created_at", cutoffStr);

      if (count !== null && count > 0) {
        results.push({
          record_type: policy.record_type,
          table_name: tableName,
          count: count,
          retention_years: policy.retention_years,
        });
      }
    }

    setScanResults(results);
    setScanning(false);
    if (results.length === 0) {
      toast({ title: "Retention scan complete", description: "No records exceed their retention period." });
    }
  };

  const dirtyCount = policies.filter(p => p._dirty).length;

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center gap-3 px-5">
        <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Shield className="h-4 w-4 text-primary" />
        <span className="text-base font-bold text-foreground">Record Retention Policies</span>
        <span className="text-xs text-muted-foreground">NABH IMS compliance</span>
        <div className="ml-auto flex items-center gap-2">
          {dirtyCount > 0 && <Badge className="bg-amber-100 text-amber-700 border-amber-200">{dirtyCount} unsaved</Badge>}
          <Button size="sm" variant="outline" onClick={() => navigate("/ims/access-logs")} className="h-7 text-xs gap-1">
            <Shield className="h-3.5 w-3.5" /> Access Logs
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/settings/change-log")} className="h-7 text-xs gap-1">
            <Shield className="h-3.5 w-3.5" /> Change Log
          </Button>
          <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning} className="h-7 text-xs gap-1">
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {scanning ? "Scanning…" : "Retention Scan"}
          </Button>
          <Button size="sm" onClick={handleSaveAll} disabled={dirtyCount === 0} className="h-7 text-xs gap-1">
            <Save className="h-3.5 w-3.5" /> Save All
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-6">
        {/* Scan results */}
        {scanResults !== null && (
          <div className={cn("rounded-lg border p-4", scanResults.length > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30")}>
            <div className="flex items-center gap-2 mb-3">
              {scanResults.length > 0
                ? <AlertTriangle className="h-4 w-4 text-amber-600" />
                : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              <span className="text-sm font-semibold">
                {scanResults.length > 0 ? `${scanResults.length} record type(s) exceed retention period` : "All scanned records are within retention period"}
              </span>
            </div>
            {scanResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-2">These counts are for reference only. No records have been modified. Contact your data governance team before archiving or deleting.</p>
                {scanResults.map(r => (
                  <div key={r.record_type} className="flex items-center justify-between text-xs bg-background/70 rounded px-3 py-2 border border-amber-200">
                    <span className="font-medium">{r.record_type}</span>
                    <span className="text-muted-foreground">Table: <code>{r.table_name}</code></span>
                    <span className="font-mono text-amber-700 font-semibold">{r.count.toLocaleString()} records beyond {r.retention_years}y retention</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Policy table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 border-b grid grid-cols-12 gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            <div className="col-span-3">Record Type</div>
            <div className="col-span-1 text-center">Retention (yrs)</div>
            <div className="col-span-3">Legal Reference</div>
            <div className="col-span-4">Notes</div>
            <div className="col-span-1" />
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground p-6">
              <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading policies…</span>
            </div>
          ) : (
            policies.map((p, idx) => (
              <div
                key={p.record_type}
                className={cn(
                  "px-4 py-2.5 grid grid-cols-12 gap-2 items-center border-b last:border-0 hover:bg-muted/20 transition-colors",
                  p._dirty ? "bg-amber-50/50 dark:bg-amber-950/20" : ""
                )}
              >
                <div className="col-span-3">
                  <span className="text-sm font-medium font-mono">{p.record_type}</span>
                  {p._dirty && <span className="ml-1.5 text-[9px] text-amber-600 font-semibold">UNSAVED</span>}
                </div>
                <div className="col-span-1">
                  <Input
                    type="number"
                    value={p.retention_years}
                    onChange={e => handleChange(idx, "retention_years", parseInt(e.target.value) || 0)}
                    className="h-7 text-xs text-center w-full"
                    min="1" max="100"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    value={p.legal_reference}
                    onChange={e => handleChange(idx, "legal_reference", e.target.value)}
                    className="h-7 text-xs"
                    placeholder="Legal basis"
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    value={p.notes}
                    onChange={e => handleChange(idx, "notes", e.target.value)}
                    className="h-7 text-xs"
                    placeholder="Notes"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  {p._dirty ? (
                    <Button size="sm" onClick={() => handleSaveRow(idx)} disabled={p._saving} className="h-6 text-[10px] px-2">
                      {p._saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Info box */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">NABH IMS Notes</p>
          <p>• Retention periods shown are minimums. Hospitals may retain records longer.</p>
          <p>• MLC records: retain until all legal proceedings are concluded (minimum 30 years).</p>
          <p>• Electronic records must be backed up and restorable per NABH IMS.1 / IMS.2.</p>
          <p>• The Retention Scan counts records in active tables only. Archived or deleted records are not included.</p>
          <p>• Actual archiving/deletion must follow your hospital's data governance SOP and legal counsel advice.</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsRecordRetentionPage;
