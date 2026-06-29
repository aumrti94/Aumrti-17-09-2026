import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: "incident",     label: "Incident" },
  { value: "near_miss",    label: "Near Miss" },
  { value: "sentinel",     label: "Sentinel Event" },
  { value: "complaint",    label: "Complaint" },
  { value: "grievance",    label: "Grievance" },
  { value: "legal_notice", label: "Legal Notice" },
  { value: "claim",        label: "Claim" },
];

const CATEGORIES = [
  { value: "fall",             label: "Fall" },
  { value: "medication_error", label: "Medication Error" },
  { value: "surgery",          label: "Surgery" },
  { value: "lab",              label: "Lab" },
  { value: "billing",          label: "Billing" },
  { value: "behaviour",        label: "Behaviour" },
  { value: "privacy",          label: "Privacy" },
  { value: "equipment",        label: "Equipment" },
  { value: "infection",        label: "Infection" },
  { value: "other",            label: "Other" },
];

const BLANK = {
  event_type: "",
  category: "",
  description: "",
  immediate_action_taken: "",
};

interface Patient { id: string; full_name: string; uhid: string; }

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const QuickEventModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  // Patient search
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setForm(BLANK);
      setPatientQuery("");
      setPatientResults([]);
      setSelectedPatient(null);
    }
  }, [open]);

  // Debounced patient search
  useEffect(() => {
    if (selectedPatient) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!patientQuery.trim() || patientQuery.length < 2) {
      setPatientResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (!hospitalId) return;
      setSearchLoading(true);
      const { data } = await supabase
        .from("patients")
        .select("id, full_name, uhid")
        .eq("hospital_id", hospitalId)
        .or(`full_name.ilike.%${patientQuery}%,uhid.ilike.%${patientQuery}%`)
        .order("full_name")
        .limit(6);
      setPatientResults(data || []);
      setSearchLoading(false);
    }, 300);
  }, [patientQuery, hospitalId, selectedPatient]);

  const set = (k: keyof typeof BLANK) => (v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setPatientQuery(p.full_name);
    setPatientResults([]);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setPatientQuery("");
    setPatientResults([]);
  };

  const save = async () => {
    if (!hospitalId) return;
    if (!form.event_type) {
      toast({ title: "Event type required", variant: "destructive" });
      return;
    }
    if (!form.description.trim() || form.description.trim().length < 10) {
      toast({ title: "Description must be at least 10 characters", variant: "destructive" });
      return;
    }

    setSaving(true);

    const year = new Date().getFullYear();
    const { count } = await (supabase as any)
      .from("safety_events")
      .select("*", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .gte("reported_at", `${year}-01-01`);
    const eventNumber = `EV-${year}-${String((count || 0) + 1).padStart(4, "0")}`;

    const payload: Record<string, any> = {
      hospital_id: hospitalId,
      event_number: eventNumber,
      event_type: form.event_type,
      description: form.description.trim(),
      reported_by: userId ?? null,
    };
    if (form.category) payload.category = form.category;
    if (form.immediate_action_taken.trim())
      payload.immediate_action_taken = form.immediate_action_taken.trim();
    if (selectedPatient) payload.patient_id = selectedPatient.id;

    const { error } = await (supabase as any)
      .from("safety_events")
      .insert(payload);

    setSaving(false);

    if (error) {
      toast({ title: "Failed to file event", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: `Event filed: ${eventNumber}`,
      description: "Visible in Safety Events workspace.",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Report Incident / Complaint
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Event type */}
          <div className="space-y-1">
            <Label className="text-xs">
              Event Type <span className="text-destructive">*</span>
            </Label>
            <Select value={form.event_type} onValueChange={set("event_type")}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={form.category} onValueChange={set("category")}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value} className="text-xs">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Patient search */}
          <div className="space-y-1">
            <Label className="text-xs">Patient (optional)</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={patientQuery}
                onChange={e => {
                  if (selectedPatient) clearPatient();
                  setPatientQuery(e.target.value);
                }}
                placeholder="Search name or UHID…"
                className={cn("h-8 text-xs pl-7 pr-7", selectedPatient && "bg-green-50 dark:bg-green-900/10")}
              />
              {(patientQuery || selectedPatient) && (
                <button
                  type="button"
                  onClick={clearPatient}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Inline results */}
            {patientResults.length > 0 && !selectedPatient && (
              <div className="border border-border rounded-md bg-popover shadow-md overflow-hidden">
                {patientResults.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPatient(p)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <span className="font-medium text-foreground">{p.full_name}</span>
                    <span className="text-muted-foreground font-mono">{p.uhid}</span>
                  </button>
                ))}
              </div>
            )}
            {searchLoading && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </p>
            )}
            {selectedPatient && (
              <p className="text-[10px] text-green-600 dark:text-green-400">
                ✓ {selectedPatient.full_name} · {selectedPatient.uhid}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label className="text-xs">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={e => set("description")(e.target.value)}
              placeholder="Describe what happened, when, and who was involved…"
              className="text-xs resize-none"
            />
          </div>

          {/* Immediate action */}
          <div className="space-y-1">
            <Label className="text-xs">Immediate Action Taken</Label>
            <Textarea
              rows={2}
              value={form.immediate_action_taken}
              onChange={e => set("immediate_action_taken")(e.target.value)}
              placeholder="What was done immediately after?"
              className="text-xs resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Filing…</>
                : "File Event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickEventModal;
