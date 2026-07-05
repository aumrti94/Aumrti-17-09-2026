import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Layers, UserCog, Loader2, DownloadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Salary Setup — the missing UI that makes the statutory Payroll Run engine usable.
 * Manages salary_structures (CTC-breakup templates) and staff_salary_assignments
 * (links a staff member to a structure + their monthly gross). Both tables are read
 * by PayrollRunTab but previously had no way to be populated.
 */

interface SalaryStructure {
  id: string;
  name: string;
  basic_pct: number;
  hra_pct: number;
  da_pct: number;
  ta_fixed: number;
  medical_allowance: number;
  pt_state: string | null;
}

interface StaffRow {
  id: string;
  full_name: string;
  structure_name: string | null;
  gross_monthly: number | null;
}

const PT_STATES = ["AP", "TS", "KA", "MH", "TN", "GJ", "WB"];

const emptyTemplate = {
  name: "",
  basic_pct: 40,
  hra_pct: 20,
  da_pct: 0,
  ta_fixed: 1600,
  medical_allowance: 1250,
  pt_state: "AP",
};

const emptyAssignment = {
  structure_id: "",
  gross_monthly: "",
  effective_from: new Date().toISOString().split("T")[0],
  pan_number: "",
  pf_account_number: "",
  esi_ip_number: "",
  bank_account: "",
  bank_ifsc: "",
};

const SalaryStructureSetup: React.FC<{
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  onSaved: () => void;
}> = ({ open, onClose, hospitalId, onSaved }) => {
  const { toast } = useToast();
  const [tab, setTab] = useState<"templates" | "assign">("assign");
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [template, setTemplate] = useState({ ...emptyTemplate });
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [assignment, setAssignment] = useState({ ...emptyAssignment });

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [structRes, staffRes, assignRes] = await Promise.all([
      (supabase as any).from("salary_structures").select("*").eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
      (supabase as any).from("staff_salary_assignments")
        .select("staff_id, gross_monthly, salary_structures(name)")
        .eq("hospital_id", hospitalId).is("effective_to", null),
    ]);

    setStructures((structRes.data || []) as SalaryStructure[]);
    const assignMap = new Map((assignRes.data || []).map((a: any) => [a.staff_id, a]));
    setStaff((staffRes.data || []).map((s: any) => {
      const a: any = assignMap.get(s.id);
      return {
        id: s.id,
        full_name: s.full_name,
        structure_name: a?.salary_structures?.name || null,
        gross_monthly: a?.gross_monthly ?? null,
      };
    }));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const saveTemplate = async () => {
    if (!template.name.trim()) {
      toast({ title: "Template name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("salary_structures").insert({
      hospital_id: hospitalId,
      name: template.name.trim(),
      basic_pct: template.basic_pct,
      hra_pct: template.hra_pct,
      da_pct: template.da_pct,
      ta_fixed: template.ta_fixed,
      medical_allowance: template.medical_allowance,
      pt_state: template.pt_state,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to save template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Structure "${template.name}" created` });
      setTemplate({ ...emptyTemplate });
      load();
    }
  };

  const [importing, setImporting] = useState(false);

  // One-time bridge: seed staff_salary_assignments from staff_profiles.basic_salary
  // (the legacy field set in the staff editor) for staff who have no assignment yet.
  const importFromProfiles = async () => {
    setImporting(true);
    try {
      // Ensure a default structure exists to link to
      let structureId = structures[0]?.id;
      if (!structureId) {
        const { data: created, error: cErr } = await (supabase as any).from("salary_structures").insert({
          hospital_id: hospitalId, name: "Default (Basic 40% / HRA 20% / DA 10%)",
          basic_pct: 40, hra_pct: 20, da_pct: 10, ta_fixed: 1600, medical_allowance: 1250, pt_state: "AP",
        }).select("id").maybeSingle();
        if (cErr || !created) throw cErr || new Error("Could not create default structure");
        structureId = created.id;
      }

      const { data: profiles } = await (supabase as any)
        .from("staff_profiles")
        .select("user_id, basic_salary, pan_number, uan_number")
        .eq("hospital_id", hospitalId).eq("is_active", true);
      const { data: existing } = await (supabase as any)
        .from("staff_salary_assignments")
        .select("staff_id").eq("hospital_id", hospitalId).is("effective_to", null);
      const assigned = new Set((existing || []).map((a: any) => a.staff_id));

      const today = new Date().toISOString().split("T")[0];
      const toInsert = (profiles || [])
        .filter((p: any) => Number(p.basic_salary) > 0 && !assigned.has(p.user_id))
        .map((p: any) => ({
          hospital_id: hospitalId, staff_id: p.user_id, structure_id: structureId,
          // basic is 40% of gross → gross ≈ basic / 0.40
          gross_monthly: Math.round(Number(p.basic_salary) / 0.40),
          effective_from: today, effective_to: null,
          pan_number: p.pan_number || null, pf_account_number: p.uan_number || null,
        }));

      if (toInsert.length === 0) {
        toast({ title: "Nothing to import", description: "All staff with a basic salary already have an assignment." });
      } else {
        const { error } = await (supabase as any).from("staff_salary_assignments").upsert(toInsert, { onConflict: "staff_id,effective_from" });
        if (error) throw error;
        toast({ title: `Imported ${toInsert.length} salary assignment(s)` });
      }
      load();
      onSaved();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
    setImporting(false);
  };

  const saveAssignment = async () => {
    if (!selectedStaff || !assignment.structure_id || !assignment.gross_monthly) {
      toast({ title: "Select staff, structure and gross salary", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Close any currently-open assignment for this staff, then insert the new one.
    await (supabase as any).from("staff_salary_assignments")
      .update({ effective_to: assignment.effective_from })
      .eq("staff_id", selectedStaff)
      .is("effective_to", null);

    const { error } = await (supabase as any).from("staff_salary_assignments").upsert({
      hospital_id: hospitalId,
      staff_id: selectedStaff,
      structure_id: assignment.structure_id,
      gross_monthly: parseFloat(assignment.gross_monthly),
      effective_from: assignment.effective_from,
      effective_to: null,
      pan_number: assignment.pan_number || null,
      pf_account_number: assignment.pf_account_number || null,
      esi_ip_number: assignment.esi_ip_number || null,
      bank_account: assignment.bank_account || null,
      bank_ifsc: assignment.bank_ifsc || null,
    }, { onConflict: "staff_id,effective_from" });

    setSaving(false);
    if (error) {
      toast({ title: "Failed to assign salary", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salary assigned" });
      setSelectedStaff("");
      setAssignment({ ...emptyAssignment });
      load();
      onSaved();
    }
  };

  const inr = (n: number | null) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);

  const numField = (label: string, key: keyof typeof template, suffix = "%") => (
    <div>
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          className="h-8 text-xs mt-0.5"
          value={(template as any)[key]}
          onChange={(e) => setTemplate((t) => ({ ...t, [key]: Number(e.target.value) }))}
        />
        <span className="text-[10px] text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Salary Setup</DialogTitle>
        </DialogHeader>

        {/* Tab switch */}
        <div className="flex items-center gap-1 border border-border rounded-md w-fit overflow-hidden">
          <button
            onClick={() => setTab("assign")}
            className={cn("flex items-center gap-1.5 px-3 h-8 text-xs", tab === "assign" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}
          >
            <UserCog className="h-3.5 w-3.5" /> Assign to Staff
          </button>
          <button
            onClick={() => setTab("templates")}
            className={cn("flex items-center gap-1.5 px-3 h-8 text-xs", tab === "templates" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50")}
          >
            <Layers className="h-3.5 w-3.5" /> Salary Structures
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : tab === "assign" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 border border-border px-3 py-2">
              <span className="text-[11px] text-muted-foreground">Migrating from the old staff-editor basic salary? Seed assignments in one click.</span>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 shrink-0" onClick={importFromProfiles} disabled={importing}>
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                Import from staff profiles
              </Button>
            </div>
            {structures.length === 0 && (
              <div className="text-xs rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                No salary structures yet — "Import from staff profiles" will create a default one, or create your own in the <strong>Salary Structures</strong> tab.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Staff</Label>
                <select className="w-full h-8 text-xs mt-0.5 border border-input rounded-md px-2 bg-background"
                  value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}>
                  <option value="">Select staff…</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.structure_name ? ` (${s.structure_name})` : ""}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Salary Structure</Label>
                <select className="w-full h-8 text-xs mt-0.5 border border-input rounded-md px-2 bg-background"
                  value={assignment.structure_id} onChange={(e) => setAssignment((a) => ({ ...a, structure_id: e.target.value }))}>
                  <option value="">Select structure…</option>
                  {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Monthly Gross (₹)</Label>
                <Input type="number" className="h-8 text-xs mt-0.5" value={assignment.gross_monthly}
                  onChange={(e) => setAssignment((a) => ({ ...a, gross_monthly: e.target.value }))} placeholder="e.g. 30000" />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Effective From</Label>
                <Input type="date" className="h-8 text-xs mt-0.5" value={assignment.effective_from}
                  onChange={(e) => setAssignment((a) => ({ ...a, effective_from: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">PAN</Label>
                <Input className="h-8 text-xs mt-0.5" value={assignment.pan_number}
                  onChange={(e) => setAssignment((a) => ({ ...a, pan_number: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">UAN (PF)</Label>
                <Input className="h-8 text-xs mt-0.5" value={assignment.pf_account_number}
                  onChange={(e) => setAssignment((a) => ({ ...a, pf_account_number: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Bank A/C</Label>
                <Input className="h-8 text-xs mt-0.5" value={assignment.bank_account}
                  onChange={(e) => setAssignment((a) => ({ ...a, bank_account: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">IFSC</Label>
                <Input className="h-8 text-xs mt-0.5" value={assignment.bank_ifsc}
                  onChange={(e) => setAssignment((a) => ({ ...a, bank_ifsc: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <Button size="sm" onClick={saveAssignment} disabled={saving || structures.length === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Save Assignment
            </Button>

            {/* Current assignments */}
            <div className="border border-border rounded-lg overflow-hidden mt-2">
              <div className="px-3 py-1.5 bg-muted/40 text-[11px] font-semibold text-muted-foreground">Current Assignments</div>
              <div className="divide-y divide-border max-h-52 overflow-y-auto">
                {staff.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <span className="flex-1 truncate">{s.full_name}</span>
                    {s.structure_name
                      ? <><Badge variant="secondary" className="text-[10px]">{s.structure_name}</Badge><span className="text-muted-foreground w-24 text-right">{inr(s.gross_monthly)}</span></>
                      : <span className="text-amber-600 text-[10px]">Not set</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label className="text-[10px] uppercase text-muted-foreground">Structure Name</Label>
                <Input className="h-8 text-xs mt-0.5" value={template.name}
                  onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))} placeholder="e.g. Staff Nurse Grade A" />
              </div>
              {numField("Basic %", "basic_pct")}
              {numField("HRA %", "hra_pct")}
              {numField("DA %", "da_pct")}
              {numField("Transport ₹", "ta_fixed", "₹")}
              {numField("Medical ₹", "medical_allowance", "₹")}
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">PT State</Label>
                <select className="w-full h-8 text-xs mt-0.5 border border-input rounded-md px-2 bg-background"
                  value={template.pt_state} onChange={(e) => setTemplate((t) => ({ ...t, pt_state: e.target.value }))}>
                  {PT_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">PF 12% (capped ₹1,800) and ESI 0.75% (if gross ≤ ₹21k) are applied automatically per statute.</p>
            <Button size="sm" onClick={saveTemplate} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Create Structure
            </Button>

            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/40 text-[11px] font-semibold text-muted-foreground">Existing Structures ({structures.length})</div>
              <div className="divide-y divide-border max-h-52 overflow-y-auto">
                {structures.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <span className="flex-1 font-medium">{s.name}</span>
                    <span className="text-muted-foreground text-[10px]">Basic {s.basic_pct}% · HRA {s.hra_pct}% · PT {s.pt_state || "—"}</span>
                  </div>
                ))}
                {structures.length === 0 && <div className="px-3 py-3 text-center text-muted-foreground text-xs">No structures yet</div>}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SalaryStructureSetup;
