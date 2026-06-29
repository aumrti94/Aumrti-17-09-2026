import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { logNABHEvidence, mapTextToNABHCriterion } from "@/lib/nabh-evidence";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFiled?: () => void;
}

const incidentTypeCards = [
  { value: "fall", emoji: "🤸", label: "Patient Fall" },
  { value: "medication_error", emoji: "💊", label: "Medication Error" },
  { value: "near_miss", emoji: "⚠️", label: "Near Miss" },
  { value: "adverse_event", emoji: "📋", label: "Adverse Event" },
  { value: "equipment_failure", emoji: "🔧", label: "Equipment Failure" },
  { value: "infection", emoji: "🦠", label: "Infection" },
  { value: "complaint", emoji: "💬", label: "Complaint" },
  { value: "other", emoji: "📝", label: "Other" },
];

const severities = [
  { value: "minor", label: "Minor", desc: "No harm" },
  { value: "moderate", label: "Moderate", desc: "Temporary harm" },
  { value: "major", label: "Major", desc: "Permanent harm" },
  { value: "sentinel", label: "Sentinel", desc: "Death / permanent harm" },
];

const FileIncidentModal: React.FC<Props> = ({ open, onOpenChange, onFiled }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    incident_type: "near_miss",
    severity: "minor",
    description: "",
    immediate_action: "",
    incident_datetime: new Date().toISOString().slice(0, 16),
    patient_involved: false,
  });

  const handleSave = async () => {
    if (!form.description.trim() || form.description.trim().length < 50) {
      toast({ title: "Description must be at least 50 characters", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Attempt session refresh for stale tokens
      await supabase.auth.refreshSession();
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) { toast({ title: "Session expired — please log in again", variant: "destructive" }); setSaving(false); return; }

      const { data: userProfile } = await supabase
        .from("users")
        .select("hospital_id, full_name")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!userProfile) { toast({ title: "User profile not found", variant: "destructive" }); setSaving(false); return; }

      const dt = new Date(form.incident_datetime);
      const dateStr = dt.toISOString().split("T")[0];
      const timeStr = dt.toTimeString().slice(0, 8);
      const seq = Date.now().toString(36).toUpperCase().slice(-4);
      const incidentNumber = `INC-${dateStr.replace(/-/g, "")}-${seq}`;

      const { error } = await supabase.from("incident_reports").insert({
        hospital_id: userProfile.hospital_id,
        incident_number: incidentNumber,
        incident_date: dateStr,
        incident_time: timeStr,
        incident_type: form.incident_type,
        severity: form.severity,
        description: form.description,
        immediate_action: form.immediate_action || null,
        reported_by: userId,
      });

      if (error) throw error;

      // Auto-create critical alert for sentinel/major
      if (form.severity === "sentinel" || form.severity === "major") {
        await supabase.from("clinical_alerts").insert({
          hospital_id: userProfile.hospital_id,
          alert_type: "incident",
          severity: form.severity === "sentinel" ? "critical" : "high",
          alert_message: `${form.severity.toUpperCase()} incident reported: ${form.incident_type.replace(/_/g, " ")} — ${incidentNumber}`,
        });
      }

      // NABH evidence auto-log: try AI mapping first, fallback to CQI
      const evidenceText = `Incident #${incidentNumber} reported by ${userProfile.full_name}. Type: ${form.incident_type.replace(/_/g, " ")}. Severity: ${form.severity}. ${form.description}`;
      const aiMapping = await mapTextToNABHCriterion(evidenceText, userProfile.hospital_id);
      if (aiMapping) {
        await logNABHEvidence(userProfile.hospital_id, aiMapping.criterion, evidenceText, aiMapping.status);
        toast({
          title: `NABH ${aiMapping.criterion} auto-mapped`,
          description: aiMapping.rationale,
        });
      } else {
        // Fallback: static CQI log if AI unavailable
        logNABHEvidence(
          userProfile.hospital_id,
          "CQI",
          evidenceText
        );
      }

      toast({ title: "Incident filed", description: incidentNumber });
      onOpenChange(false);
      onFiled?.();
      setForm({
        incident_type: "near_miss",
        severity: "minor",
        description: "",
        immediate_action: "",
        incident_datetime: new Date().toISOString().slice(0, 16),
        patient_involved: false,
      });
    } catch (err: any) {
      toast({ title: "Error filing incident", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">File Incident Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Date & Time */}
          <div>
            <Label className="text-xs">Date & Time</Label>
            <Input
              type="datetime-local"
              value={form.incident_datetime}
              onChange={(e) => setForm({ ...form, incident_datetime: e.target.value })}
              className="mt-1"
            />
          </div>

          {/* Incident Type — radio cards */}
          <div>
            <Label className="text-xs">Incident Type</Label>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {incidentTypeCards.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, incident_type: t.value })}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all",
                    form.incident_type === t.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  )}
                >
                  <span className="text-lg">{t.emoji}</span>
                  <span className="text-[9px] font-medium leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Severity — radio buttons */}
          <div>
            <Label className="text-xs">Severity</Label>
            <div className="flex gap-2 mt-1.5">
              {severities.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setForm({ ...form, severity: s.value })}
                  className={cn(
                    "flex-1 text-center py-2 rounded-lg border transition-all",
                    form.severity === s.value
                      ? s.value === "sentinel"
                        ? "border-destructive bg-destructive/10 ring-1 ring-destructive"
                        : "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="text-[10px] font-semibold block">{s.label}</span>
                  <span className="text-[8px] text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </div>
            {form.severity === "sentinel" && (
              <div className="mt-2 bg-destructive/10 border border-destructive/30 rounded-lg p-2.5 text-xs text-destructive">
                ⚠️ Sentinel events must be reported to CMO and Medical Director immediately.
                A critical alert will be auto-created.
              </div>
            )}
          </div>

          {/* Patient involved */}
          <div className="flex items-center gap-3">
            <Switch
              checked={form.patient_involved}
              onCheckedChange={(v) => setForm({ ...form, patient_involved: v })}
            />
            <Label className="text-xs">Patient involved?</Label>
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs">Description * <span className="text-muted-foreground">(min 50 chars)</span></Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 text-xs"
              rows={4}
              placeholder="What happened? Provide detailed account of the incident…"
            />
            <p className="text-[9px] text-muted-foreground mt-0.5 text-right">
              {form.description.length}/50 min
            </p>
          </div>

          {/* Immediate Action */}
          <div>
            <Label className="text-xs">Immediate Action Taken</Label>
            <Textarea
              value={form.immediate_action}
              onChange={(e) => setForm({ ...form, immediate_action: e.target.value })}
              className="mt-1 text-xs"
              rows={2}
              placeholder="What was done immediately after the incident?"
            />
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
            {saving ? "Submitting…" : "Submit Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FileIncidentModal;
