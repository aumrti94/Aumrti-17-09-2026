import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const auditTypes = ["internal", "external", "nabh_surveillance", "nabh_accreditation", "peer", "unannounced"];

const nabhChapters = ["AAC", "COP", "MOM", "HIC", "CQI", "ROM", "FMS", "HRM", "MRD", "PRE"];

const ScheduleAuditModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    audit_title: "",
    audit_type: "internal",
    scheduled_date: "",
    auditor_name: "",
    chapters: [] as string[],
  });

  const toggleChapter = (ch: string) => {
    setForm((f) => ({
      ...f,
      chapters: f.chapters.includes(ch) ? f.chapters.filter((c) => c !== ch) : [...f.chapters, ch],
    }));
  };

  const handleSave = async () => {
    if (!form.audit_title.trim() || !form.scheduled_date) {
      toast({ title: "Title and date required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) { toast({ title: "Not authenticated", variant: "destructive" }); setSaving(false); return; }

      const { data: userProfile } = await supabase.from("users").select("hospital_id").eq("auth_user_id", userId).maybeSingle();
      if (!userProfile) { toast({ title: "User profile not found", variant: "destructive" }); setSaving(false); return; }

      await supabase.from("audit_records").insert({
        hospital_id: userProfile.hospital_id,
        audit_title: form.audit_title,
        audit_type: form.audit_type,
        scheduled_date: form.scheduled_date,
        auditor_name: form.auditor_name || null,
        chapters_covered: form.chapters,
        created_by: userId,
      });

      toast({ title: "Audit scheduled" });
      onOpenChange(false);
      setForm({ audit_title: "", audit_type: "internal", scheduled_date: "", auditor_name: "", chapters: [] });
    } catch (err: any) {
      toast({ title: "Error scheduling audit", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Schedule Audit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input value={form.audit_title} onChange={(e) => setForm({ ...form, audit_title: e.target.value })} className="mt-1" placeholder="e.g. Q1 Internal Audit" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.audit_type} onValueChange={(v) => setForm({ ...form, audit_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {auditTypes.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Auditor Name</Label>
            <Input value={form.auditor_name} onChange={(e) => setForm({ ...form, auditor_name: e.target.value })} className="mt-1" placeholder="Optional" />
          </div>
          <div>
            <Label className="text-xs">NABH Chapters</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {nabhChapters.map((ch) => (
                <button
                  key={ch}
                  onClick={() => toggleChapter(ch)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    form.chapters.includes(ch)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
            {saving ? "Saving…" : "Schedule Audit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleAuditModal;
