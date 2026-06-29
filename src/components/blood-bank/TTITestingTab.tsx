import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ShieldCheck, AlertTriangle, FlaskConical, Loader2, Printer, Plus, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface BloodUnit {
  id: string;
  unit_number: string;
  blood_group: string;
  rh_factor: string;
  component: string;
  status: string;
  tti_status: string;
  expiry_date: string | null;
  isbt_product_code: string | null;
  isbt_donation_id: string | null;
  volume_ml: number | null;
  collected_date?: string;
}

interface TTIRecord {
  id: string;
  unit_id: string;
  hiv_1_2: string;
  hbsag: string;
  hcv: string;
  malaria: string;
  vdrl_rpr: string;
  test_method: string;
  overall_result: string;
  quarantine_reason: string | null;
  tested_at: string | null;
  released_at: string | null;
  updated_at: string;
}

type TTIMarker = "hiv_1_2" | "hbsag" | "hcv" | "malaria" | "vdrl_rpr";

const TTI_MARKERS: Array<{ key: TTIMarker; label: string; abbr: string }> = [
  { key: "hiv_1_2",  label: "HIV I/II",             abbr: "HIV" },
  { key: "hbsag",    label: "HBsAg (Hepatitis B)",   abbr: "HBsAg" },
  { key: "hcv",      label: "HCV (Hepatitis C)",     abbr: "HCV" },
  { key: "malaria",  label: "Malaria Antigen",        abbr: "MAL" },
  { key: "vdrl_rpr", label: "VDRL/RPR (Syphilis)",   abbr: "VDRL" },
];

const TEST_RESULT_COLORS: Record<string, string> = {
  pending:  "bg-slate-100 text-slate-600",
  negative: "bg-emerald-50 text-emerald-700",
  positive: "bg-red-50 text-red-700",
  reactive: "bg-red-50 text-red-700",
  invalid:  "bg-amber-50 text-amber-700",
};

const OVERALL_COLORS: Record<string, string> = {
  pending:  "border-slate-300 text-slate-600",
  passed:   "border-emerald-400 text-emerald-700 bg-emerald-50",
  reactive: "border-red-400 text-red-700 bg-red-50",
  invalid:  "border-amber-400 text-amber-700 bg-amber-50",
};

// ── ISBT 128 Label Generator (returns HTML for print window) ──────────────
function generateISBT128Label(unit: BloodUnit): string {
  const donationId = unit.isbt_donation_id || `DON${unit.id.slice(0, 8).toUpperCase()}`;
  const productCode = unit.isbt_product_code || "E0781"; // E0781 = Whole Blood default
  const expiry = unit.expiry_date
    ? new Date(unit.expiry_date).toLocaleDateString("en-IN")
    : "—";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>ISBT 128 Blood Label</title>
<style>
  body { font-family: monospace; font-size: 11px; margin: 0; padding: 4px; width: 90mm; }
  .label { border: 2px solid #000; padding: 6px; width: 86mm; box-sizing: border-box; }
  .header { font-weight: bold; font-size: 13px; text-align: center; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .big { font-size: 20px; font-weight: bold; letter-spacing: 2px; }
  .barcode { font-family: 'Free 3 of 9', 'Code 39', monospace; font-size: 28px; text-align: center; letter-spacing: 4px; border: 1px solid #ccc; padding: 4px; margin: 6px 0; }
  .warning { background: #ffeb3b; font-weight: bold; text-align: center; padding: 2px; margin-top: 4px; font-size: 10px; }
  @media print { body { margin: 0; padding: 0; } }
</style>
</head>
<body>
<div class="label">
  <div class="header">ISBT 128 — BLOOD COMPONENT</div>

  <div class="row">
    <span><strong>Donation ID:</strong></span>
    <span class="big">${donationId}</span>
  </div>

  <div class="barcode">*${donationId}*</div>

  <div class="row">
    <span><strong>Product Code:</strong> ${productCode}</span>
    <span><strong>Component:</strong> ${unit.component.toUpperCase()}</span>
  </div>
  <div class="row">
    <span><strong>Blood Group:</strong> <span style="font-size:16px;font-weight:bold">${unit.blood_group} ${unit.rh_factor === "positive" ? "Rh+" : "Rh-"}</span></span>
    <span><strong>Vol:</strong> ${unit.volume_ml ? `${unit.volume_ml} mL` : "—"}</span>
  </div>
  <div class="row">
    <span><strong>Unit No:</strong> ${unit.unit_number}</span>
  </div>
  <div class="row">
    <span><strong>Expiry:</strong> ${expiry}</span>
    <span><strong>TTI:</strong> ${unit.tti_status === "passed" ? "✓ Cleared" : "⚠ Pending"}</span>
  </div>

  ${unit.tti_status !== "passed"
    ? `<div class="warning">⚠ DO NOT ISSUE — TTI NOT CLEARED</div>`
    : `<div style="background:#e8f5e9;color:#1b5e20;font-weight:bold;text-align:center;padding:2px;margin-top:4px;font-size:10px;">TTI CLEARED — SAFE FOR TRANSFUSION</div>`}
</div>
</body>
</html>`;
}

const TTITestingTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  const [units, setUnits]       = useState<BloodUnit[]>([]);
  const [records, setRecords]   = useState<Record<string, TTIRecord>>({});
  const [loading, setLoading]   = useState(true);
  const [selectedUnit, setSelectedUnit] = useState<BloodUnit | null>(null);
  const [testing, setTesting]   = useState(false);

  // Form state for TTI dialog
  const [testResults, setTestResults] = useState<Record<TTIMarker, string>>({
    hiv_1_2: "pending", hbsag: "pending", hcv: "pending",
    malaria: "pending",  vdrl_rpr: "pending",
  });
  const [testMethod, setTestMethod] = useState("elisa");
  const [quarantineReason, setQuarantineReason] = useState("");

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [unitsRes, ttiRes] = await Promise.all([
      (supabase as any)
        .from("blood_units")
        .select("id,unit_number,blood_group,rh_factor,component,status,tti_status,expiry_date,isbt_product_code,isbt_donation_id,volume_ml,collected_date")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("blood_unit_tti_tests")
        .select("*")
        .eq("hospital_id", hospitalId),
    ]);

    if (unitsRes.data) setUnits(unitsRes.data as BloodUnit[]);
    if (ttiRes.data) {
      const map: Record<string, TTIRecord> = {};
      (ttiRes.data as TTIRecord[]).forEach(r => { map[r.unit_id] = r; });
      setRecords(map);
    }
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openTTIDialog = (unit: BloodUnit) => {
    setSelectedUnit(unit);
    const existing = records[unit.id];
    if (existing) {
      setTestResults({
        hiv_1_2:  existing.hiv_1_2  || "pending",
        hbsag:    existing.hbsag    || "pending",
        hcv:      existing.hcv      || "pending",
        malaria:  existing.malaria  || "pending",
        vdrl_rpr: existing.vdrl_rpr || "pending",
      });
      setTestMethod(existing.test_method || "elisa");
      setQuarantineReason(existing.quarantine_reason || "");
    } else {
      setTestResults({ hiv_1_2: "pending", hbsag: "pending", hcv: "pending", malaria: "pending", vdrl_rpr: "pending" });
      setTestMethod("elisa");
      setQuarantineReason("");
    }
  };

  const computeOverall = (results: Record<TTIMarker, string>): string => {
    const values = Object.values(results);
    if (values.includes("positive") || values.includes("reactive")) return "reactive";
    if (values.includes("invalid")) return "invalid";
    if (values.every(v => v === "negative")) return "passed";
    return "pending";
  };

  const saveTTI = async () => {
    if (!selectedUnit || !hospitalId) return;
    setTesting(true);

    const overall = computeOverall(testResults);
    const now     = new Date().toISOString();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    let userId: string | null = null;
    if (user) {
      const { data: u } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      userId = u?.id ?? null;
    }

    const payload = {
      hospital_id:       hospitalId,
      unit_id:           selectedUnit.id,
      ...testResults,
      test_method:       testMethod,
      overall_result:    overall,
      quarantine_reason: overall !== "passed" ? quarantineReason || null : null,
      tested_by:         userId,
      tested_at:         now,
      released_at:       overall === "passed" ? now : null,
      released_by:       overall === "passed" ? userId : null,
      updated_at:        now,
    };

    const existing = records[selectedUnit.id];
    if (existing?.id) {
      await (supabase as any).from("blood_unit_tti_tests").update(payload).eq("id", existing.id);
    } else {
      await (supabase as any).from("blood_unit_tti_tests").insert(payload);
    }

    // Update tti_status on blood_units
    await (supabase as any).from("blood_units").update({
      tti_status: overall,
      // Set status to quarantine if reactive
      ...(overall === "reactive" ? { status: "quarantined" } : {}),
    }).eq("id", selectedUnit.id);

    setTesting(false);
    setSelectedUnit(null);
    fetchData();
    toast({
      title: overall === "passed" ? "Unit cleared for issue ✓" : `Unit ${overall} — quarantined`,
      variant: overall === "passed" ? "default" : "destructive",
    });
  };

  const printLabel = (unit: BloodUnit) => {
    const html = generateISBT128Label(unit);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  // Stats
  const pendingCount  = units.filter(u => u.tti_status === "pending" || !u.tti_status).length;
  const passedCount   = units.filter(u => u.tti_status === "passed").length;
  const reactiveCount = units.filter(u => u.tti_status === "reactive").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Awaiting TTI", value: pendingCount, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Cleared", value: passedCount, color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: "Reactive / Quarantined", value: reactiveCount, color: "text-red-700", bg: "bg-red-50" },
        ].map(s => (
          <div key={s.label} className={cn("rounded-lg border p-3", s.bg)}>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className={cn("text-[22px] font-bold mt-0.5", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Legal notice */}
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[12px] text-amber-800">
        <p className="font-bold flex items-center gap-1.5 mb-1">
          <AlertTriangle size={13} /> NBTC / NABH Requirement
        </p>
        <p>
          All blood units must be tested for HIV I/II, HBsAg, HCV, Malaria, and VDRL/RPR
          before issue. Reactive units must be quarantined and notified per Drugs &amp; Cosmetics Act.
          ISBT 128 labeling is mandatory for all components.
        </p>
      </div>

      {/* Unit table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
          <FlaskConical size={14} className="text-muted-foreground" />
          <span className="text-[13px] font-bold">Blood Units — TTI Status</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Unit Number</th>
                <th className="px-3 py-2 text-left font-medium">Component</th>
                <th className="px-3 py-2 text-left font-medium">Blood Group</th>
                <th className="px-3 py-2 text-left font-medium">TTI Status</th>
                <th className="px-3 py-2 text-left font-medium">HIV/HBsAg/HCV/MAL/VDRL</th>
                <th className="px-3 py-2 text-left font-medium">Expiry</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {units.map(unit => {
                const tti = records[unit.id];
                const overallStatus = unit.tti_status || "pending";
                return (
                  <tr key={unit.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono font-semibold">{unit.unit_number}</td>
                    <td className="px-3 py-2 capitalize">{unit.component}</td>
                    <td className="px-3 py-2 font-bold">
                      {unit.blood_group} {unit.rh_factor === "positive" ? "Rh+" : "Rh-"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", OVERALL_COLORS[overallStatus] || OVERALL_COLORS.pending)}
                      >
                        {overallStatus === "passed" ? "✓ Cleared" :
                         overallStatus === "reactive" ? "⚠ Reactive" :
                         overallStatus === "invalid" ? "⚠ Invalid" : "⏳ Pending"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {tti ? (
                        <div className="flex gap-1 flex-wrap">
                          {TTI_MARKERS.map(m => (
                            <span
                              key={m.key}
                              className={cn(
                                "text-[9px] px-1 rounded font-mono",
                                TEST_RESULT_COLORS[tti[m.key]] || TEST_RESULT_COLORS.pending
                              )}
                              title={m.label}
                            >
                              {m.abbr}: {tti[m.key]?.slice(0, 3).toUpperCase()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">Not tested</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {unit.expiry_date
                        ? new Date(unit.expiry_date).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-0.5"
                          onClick={() => openTTIDialog(unit)}
                        >
                          <FlaskConical size={10} />
                          {tti ? "Update TTI" : "Enter TTI"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-0.5"
                          onClick={() => printLabel(unit)}
                          title="Print ISBT 128 label"
                        >
                          <Printer size={10} /> Label
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* TTI Entry Dialog */}
      {selectedUnit && (
        <Dialog open onOpenChange={open => !open && setSelectedUnit(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical size={16} /> TTI Testing — {selectedUnit.unit_number}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 text-[13px] bg-muted/40 rounded p-2">
                <span className="font-bold text-red-700">
                  {selectedUnit.blood_group} {selectedUnit.rh_factor === "positive" ? "Rh+" : "Rh-"}
                </span>
                <span className="capitalize">{selectedUnit.component}</span>
                {selectedUnit.expiry_date && (
                  <span className="text-muted-foreground">Exp: {new Date(selectedUnit.expiry_date).toLocaleDateString("en-IN")}</span>
                )}
              </div>

              {/* Test method */}
              <div>
                <Label className="text-xs">Testing Method</Label>
                <select
                  value={testMethod}
                  onChange={e => setTestMethod(e.target.value)}
                  className="mt-1 w-full h-8 text-sm border border-border rounded-md px-2 bg-background"
                >
                  <option value="elisa">ELISA</option>
                  <option value="nat">NAT (Nucleic Acid Testing)</option>
                  <option value="rapid">Rapid Test</option>
                  <option value="serology">Serology</option>
                </select>
              </div>

              {/* Individual marker results */}
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Test</th>
                      <th className="px-3 py-1.5 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {TTI_MARKERS.map(m => (
                      <tr key={m.key}>
                        <td className="px-3 py-2 font-medium">{m.label}</td>
                        <td className="px-3 py-2">
                          <select
                            value={testResults[m.key]}
                            onChange={e => setTestResults(prev => ({ ...prev, [m.key]: e.target.value }))}
                            className={cn(
                              "w-28 h-7 text-xs border rounded px-1",
                              testResults[m.key] === "positive" || testResults[m.key] === "reactive"
                                ? "border-red-400 bg-red-50 text-red-700"
                                : testResults[m.key] === "negative"
                                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                : "border-border bg-background"
                            )}
                          >
                            <option value="pending">Pending</option>
                            <option value="negative">Negative ✓</option>
                            <option value="positive">Positive ⚠</option>
                            <option value="reactive">Reactive ⚠</option>
                            <option value="invalid">Invalid</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Overall result preview */}
              {(() => {
                const overall = computeOverall(testResults);
                return (
                  <div className={cn("rounded p-2.5 text-[12px] font-medium flex items-center gap-2",
                    overall === "passed" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                    overall === "reactive" ? "bg-red-50 text-red-700 border border-red-200" :
                    "bg-muted text-muted-foreground border border-border"
                  )}>
                    {overall === "passed" ? <Check size={14} /> :
                     overall === "reactive" ? <AlertTriangle size={14} /> : <FlaskConical size={14} />}
                    Overall: {overall === "passed" ? "CLEARED FOR ISSUE" :
                              overall === "reactive" ? "REACTIVE — QUARANTINE UNIT" :
                              overall === "invalid" ? "INVALID — RE-TEST REQUIRED" :
                              "Testing incomplete"}
                  </div>
                );
              })()}

              {/* Quarantine reason if reactive */}
              {(testResults.hiv_1_2 === "positive" || testResults.hbsag === "positive" ||
                testResults.hcv === "positive" || testResults.malaria === "positive" ||
                testResults.vdrl_rpr === "positive") && (
                <div>
                  <Label className="text-xs">Quarantine Reason / Notes</Label>
                  <Textarea
                    value={quarantineReason}
                    onChange={e => setQuarantineReason(e.target.value)}
                    placeholder="Document reactive marker and recommended action..."
                    rows={2}
                    className="mt-1 text-xs"
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setSelectedUnit(null)}>Cancel</Button>
              <Button size="sm" onClick={saveTTI} disabled={testing} className="gap-1">
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Save TTI Results
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default TTITestingTab;
