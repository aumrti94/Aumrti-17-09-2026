import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, ExternalLink, FileText, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface EvidenceItem {
  id: string;
  title: string;
  evidence_type: string | null;
  module_reference: string | null;
  url: string | null;
  uploaded_at: string;
  notes: string | null;
}

interface EvidenceManagerProps {
  hospitalId: string;
  complianceId: string;
}

const EVIDENCE_TYPES = [
  "Policy", "SOP", "Form", "Record", "Report",
  "Screenshot", "Training", "Audit", "Committee Minutes", "Other",
];

const TYPE_COLOURS: Record<string, string> = {
  Policy:            "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SOP:               "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Form:              "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Record:            "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Report:            "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  Audit:             "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Training:          "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  Screenshot:        "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  "Committee Minutes":"bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
};

const BLANK_FORM = { title: "", evidence_type: "", module_reference: "", url: "", notes: "" };

const EvidenceManager: React.FC<EvidenceManagerProps> = ({ hospitalId, complianceId }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("nabh_evidence_items")
      .select("id, title, evidence_type, module_reference, url, uploaded_at, notes")
      .eq("nabh_compliance_id", complianceId)
      .order("uploaded_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [complianceId]); // eslint-disable-line

  const save = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("nabh_evidence_items").insert({
      hospital_id: hospitalId,
      nabh_compliance_id: complianceId,
      title: form.title.trim(),
      evidence_type: form.evidence_type || null,
      module_reference: form.module_reference || null,
      url: form.url || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to save evidence", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Evidence item added" });
    setModalOpen(false);
    setForm(BLANK_FORM);
    load();
  };

  const remove = async (id: string) => {
    setDeleting(id);
    await (supabase as any).from("nabh_evidence_items").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
    setDeleting(null);
    toast({ title: "Evidence item removed" });
  };

  const set = (k: keyof typeof BLANK_FORM) => (v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Evidence Items</h4>
        <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Evidence
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          No evidence items yet. Add your first document, policy, or screenshot.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div
              key={item.id}
              className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border bg-muted/30"
            >
              <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  {item.evidence_type && (
                    <Badge
                      className={`text-[10px] px-1.5 py-0 font-medium ${
                        TYPE_COLOURS[item.evidence_type] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {item.evidence_type}
                    </Badge>
                  )}
                </div>
                {item.module_reference && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.module_reference}</p>
                )}
                {item.notes && (
                  <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{item.notes}</p>
                )}
                <p className="text-[10px] text-muted-foreground/50 mt-1">
                  {item.uploaded_at ? format(new Date(item.uploaded_at), "dd MMM yyyy") : "—"}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Open link"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => remove(item.id)}
                  disabled={deleting === item.id}
                  title="Remove"
                >
                  {deleting === item.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Evidence Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.title}
                onChange={e => set("title")(e.target.value)}
                placeholder="e.g. OPD Consent Form Template v2"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Evidence Type</Label>
              <Select value={form.evidence_type} onValueChange={set("evidence_type")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Module Reference</Label>
              <Input
                value={form.module_reference}
                onChange={e => set("module_reference")(e.target.value)}
                placeholder="e.g. OPD → ConsultationWorkspace"
              />
            </div>
            <div className="space-y-1.5">
              <Label>URL / Link</Label>
              <Input
                value={form.url}
                onChange={e => set("url")(e.target.value)}
                placeholder="https://drive.google.com/…"
                type="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => set("notes")(e.target.value)}
                rows={2}
                placeholder="Additional context or version info…"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Add Evidence"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EvidenceManager;
